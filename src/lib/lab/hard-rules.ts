/**
 * ★HARD_RULES（2026-11-01 用户定案）
 *
 * 这些**不是开关**，是**硬底线** —— 写死在 prompt 里，不许违反。
 *
 * 来源（全是实测出来的）：
 *   ① 6 个生成结果里 **4 个在压暗图片**：
 *      gen_001: brightness(0.32) / (0.22) / (0.55)   ← 压到 1/3~1/5
 *      gen_003/004/006: brightness(0.88~0.98) + saturate(0.85~0.95)
 *      ⇒ 用户原话：「图片被降低了像素，我以为是怀旧效果，每版都用，必须删掉」
 *
 *   ② 6 个里 **0 个有贴纸**（drop-shadow 白边出现 0 次）
 *   ③ 6 个里 **3 个没有描边字**，有描边的也把 stroke 画在了字**内部**
 *      ⇒ 用户原话：「围边是为字的外围，不是一笔一划围起来，这很难看」
 *      ⇒ 根因：SVG text 缺 paint-order="stroke"
 *
 *   ④ three.js 装了但 **AI 用不到**（独立 HTML 不能 import npm）
 */

const IMAGE_RULES = [
  '【图片处理 · 硬底线（不许违反）】',
  '',
  '**禁止**（这三条是"图片被毁"的直接原因）：',
  '  ❌ filter: brightness(< 0.95) —— 压暗 = 看起来蒙了一层灰、细节糊掉',
  '  ❌ filter: saturate(< 0.95)  —— 降饱和 = 食物变灰、没食欲',
  '  ❌ filter: contrast(> 1.15)  —— 拉对比 = 高光死、暗部并级',
  '  ❌ 在整张图上盖半透明深色层（rgba(0,0,0,.3) 之类）来"突出文字"',
  '',
  '**允许**（这些是"提亮/校准"，不是毁图）：',
  '  ✅ brightness(1.0 ~ 1.12)',
  '  ✅ contrast(1.0 ~ 1.10)',
  '  ✅ saturate(1.0 ~ 1.15)',
  '  ✅ 轻微暖色叠加 rgba(255,200,120,.06)（不超过 8%）',
  '',
  '**文字压在图上怎么办 —— 只有两条路，都不许动图**：',
  '  ① **围边优先**：给文字加粗描边（见下条），字自己够清楚，不需要压图',
  '  ② **局部色块兜底**：只在**文字那一块**后面垫一个半透明色块（只覆盖文字区域，',
  '     不覆盖整张图）；色块圆角 ≥ 12px，透明度 0.35~0.6',
  '',
  '判据：**把这张图和原图并排看，如果"暗了一档"或"灰了一档" ⇒ 违规。**',
].join('\n')

const TEXT_STROKE_RULES = [
  '【文字围边 · 三种正确写法 + 两条禁令】',
  '',
  '⚠️ "围边" = **沿字形外轮廓包一圈实心色**，宽度 = 字号的 **8~15%**。',
  '   **不是**在笔画中间画细线（那是错的）。',
  '',
  '**写法 A · CSS 单层（最简单）**',
  '    -webkit-text-stroke: 10px #E8452F;',
  '    color: #FFF;',
  '  字号 120px ⇒ 描边 10~18px。低于 5%（6px）会变成"划线"，不是围边。',
  '',
  '**写法 B · SVG 多层（做花字/三层描边，推荐）**',
  '    <text x="360" y="200" text-anchor="middle" font-size="120" font-weight="900"',
  '      paint-order="stroke" stroke="#FF3D8B" stroke-width="42"',
  '      stroke-linejoin="round" fill="#FF3D8B">鲜切!!</text>          <!-- ③ 最外彩边 -->',
  '    <text ... paint-order="stroke" stroke="#FFFFFF" stroke-width="20"',
  '      stroke-linejoin="round" fill="#FFFFFF">鲜切!!</text>          <!-- ② 白边 -->',
  '    <text ... fill="url(#gradGold)">鲜切!!</text>                    <!-- ① 渐变填充 -->',
  '',
  '  ⇒ **关键：paint-order="stroke"** —— 让描边画在填充下面，才会露出字外一圈。',
  '',
  '**写法 C · 发光（不是描边，但很有效）**',
  '    filter: drop-shadow(0 0 4px #FF6B35) drop-shadow(0 0 26px #FF6B35);',
  '  双层：紧 4px 勾边 + 散 26px 光晕。',
  '',
  '**❌ 两条禁令（那 4 张难看的图就是犯了这两条）**',
  '  ❌ SVG <text> 写了 stroke 但**没写 paint-order="stroke"**',
  '     ⇒ 描边压在字形上 ⇒ 像"笔画中间划了一道线"',
  '  ❌ stroke-width **小于字号的 5%**（如 120px 字只给 2px）',
  '     ⇒ 看起来是"划线"，不是"围边"',
].join('\n')

const STICKER_RULES = [
  '【贴纸化 · 把任何元素变成"贴纸"】',
  '',
  '    .sticker {',
  '      border-radius: 18px; overflow: hidden;',
  '      box-shadow:',
  '        0 0 0 9px #FFFFFF,                    /* ★白描边 8~10px（最关键）*/',
  '        0 18px 36px rgba(60,74,90,.28),       /* 远投影 */',
  '        0 3px 8px rgba(60,74,90,.16);         /* 近投影（接触阴影）*/',
  '    }',
  '',
  '⇒ 判据：把图缩到 30%，如果还能看出"一圈白边" ⇒ 合格。',
  '⇒ 白边低于 6px 会被缩略图吞掉，高于 12px 会像"画框"。',
].join('\n')

const TOOL_RULES = [
  '【可用工具（你手里有什么，以及怎么用）】',
  '',
  '**动效（按优先级）**',
  '  1. CSS（transform / opacity / filter）—— 简单过渡，最省',
  '  2. 原生 JS（var(--p) 驱动）—— 我们的时间轴本来就是这套，**优先用它**',
  '  3. GSAP —— 多动作按时间线排布（⚠️ 需外链，**本项目禁止外链**，别用）',
  '  4. motion —— 自动计算布局变化（⚠️ 需 npm + 外链，**用不了**）',
  '',
  '**画面呈现**',
  '  1. canvas 2D —— 二维动效 / 粒子 / 图表，**完全可用**（原生支持，无需外链）',
  '  2. three.js —— 真 3D（正交相机 / 自由视角 / 灯光 / 阴影）',
  '     ⚠️ **必须内联**：把 three 打包成 IIFE 单文件（约 714KB）内嵌进 HTML，',
  '        不能写 import ... from "three"（独立 HTML 没有打包器）',
  '     ✅ 只有在「必须真 3D」时才用（成本大、文件大）',
  '',
  '**绝对禁止**：任何 <script src="https://..."> 外链（渲染器会失败）',
].join('\n')

const QUALITY_GATES = [
  '【交付前三道闸（不过就重做）】',
  '',
  '① **首帧不空**：t = 0 时必须已有内容（大字/大图/形状），不能是纯底色',
  '② **主体够大**：主体占画面**短边 40~65%**',
  '   判据：把截图缩到 **25%**，主体还认得出吗？认不出 ⇒ 太小',
  '   （这条我犯过 3 次：火柴 / 液滴 / 塔）',
  '③ **每段至少 3 类装饰**：背景纹理 / 徽章 / 小装饰 / 三层描边 / 贴纸 / 圆角',
  '   判据：每段单独看，能不能说出"这段有哪 3 样装饰"',
].join('\n')

/* ══════════════════════════════════════════════════════════════════════
   ★★ 导演宣言（2026-11-01 · 用户指出 clean 被理解错了）
   原文："A clean, template-looking result is a fail."
   我原来把 clean 和 template 当成两件事，其实是一个意思：
   **"干净得像模板" = 双重否定**
   clean 在这里不是"整洁"，是"没有任何质感"（Adobe 默认预设那种）
   ══════════════════════════════════════════════════════════════════════ */
const DIRECTOR_STATEMENT = [
  '【你是导演，不是执行器】',
  '',
  '你是这一部动态设计影片的**导演、动画设计师、工程师、声音设计师**。',
  '',
  '目标：这个风格**最经典、也最令人惊叹**的形式 —— 入围奖项 / 高端商业品质。',
  '基准（你的对手）：Buck、ManvsMachine、Ordinary Folk、Giant Ant、',
  '  Territory Studio、Apple keynote 动态设计、Pentagram 动态标识、',
  '  Behance / Motionographer 顶级作品、抖音 B 站顶级设计师账号。',
  '',
  '⚠️ **"干净、像模板"的结果 = 不合格。**',
  '   "干净"在这里不是"整洁"，是**没有任何质感**：',
  '   没有颗粒、没有暗角、没有光晕、没有色偏、没有手作痕迹。',
  '   ⇒ 这种"Adobe 默认预设"的干净，一眼就能看出"没有人碰过"。',
  '',
  '⇒ 判据：把成片给人看，对方说"挺干净的" ⇒ **失败**；',
  '       对方问"这是谁做的" ⇒ **及格**。',
].join('\n')

/* ★★ 质感清单 —— 每个片子至少要有一样"脏" */
const TEXTURE_RULES = [
  '【质感 · 至少选一样"脏"的层次】',
  '',
  '原片没有一个是"干净"的，全都是"打磨过的脏"。逐个证据：',
  '  · 03-isometric：带色暗角 mix(c, c*vec3(.78,.74,.95), .22) + 胶片颗粒 .022 + dither',
  '  · 10-synthwave：VHS 扫描线 + RGB 偏移',
  '  · 05-cel-boil：纸纹 multiply .13 + 线条每 1/12 秒抖动',
  '  · 12-aurora-glass：3.5% 噪点（防 banding）',
  '  · 04-3d-render：shadow.radius 7 软阴影（有重量）',
  '',
  '**你必须至少用上一样**（6 选 1 或更多）：',
  '  ① 胶片颗粒：SVG feTurbulence 当背景，opacity .02~.04，mix-blend-mode: overlay',
  '  ② 带色暗角：radial-gradient 边缘压 .18~.25，颜色**带色相**（不要纯黑）',
  '  ③ 扫描线：repeating-linear-gradient(180deg, rgba(0,0,0,.12) 0 1px, transparent 1px 3px)',
  '  ④ 噪点（防渐变 banding）：feTurbulence baseFrequency .9，opacity .03',
  '  ⑤ 纸纹 / 布纹：feTurbulence baseFrequency .04，mix-blend-mode: multiply',
  '  ⑥ 发光溢出：drop-shadow 紧 4px + 散 30px（让亮的东西"漏出来"）',
  '',
  '❌ 反例：整屏纯色 + 干净渐变 + 锐利投影 ⇒ 这是 PPT，不是影片。',
].join('\n')

/* ★★ 禁止偷懒 —— 6 条实测出来的"它总选省事的那条路" */
const NO_LAZY_RULES = [
  '【禁止偷懒 · 6 条实测禁令】',
  '',
  '这 6 条都是我从生成结果里统计出来的"它总选省事的那条路"，逐条禁掉：',
  '',
  '① **必须用 SVG**（不许全靠 div + background-image 拼）',
  '   实测：6 个结果 <svg> 出现 **0 次** ⇒ 所以没有描边字、没有图标、没有图表。',
  '   ⇒ 描边字、图标、数据图表、引线标签，**一律用 SVG 做**。',
  '',
  '② **不许用"压暗图片"代替"给文字做围边"**',
  '   实测：4/6 结果用 brightness(0.32~0.9) 压暗 ⇒ 图片被毁。',
  '   ⇒ 文字看不清时，**先加围边**，围边不够再垫局部色块。',
  '',
  '③ **不许抄英文的负字距**',
  '   实测：每版都有 letter-spacing -0.02~-0.06em + 字号 300~420px。',
  '   中文是满格方块，收紧就碰。**安全范围 [-0.02em, +0.06em]**。',
  '',
  '④ **不许只用 CSS 一种工具**',
  '   实测：canvas 用 0 次、three.js 用 0 次。',
  '   ⇒ 二维粒子/图表用 canvas；真 3D（需要转视角/灯光）用 three.js 内联。',
  '',
  '⑤ **不许把元素做得太小**',
  '   实测：我犯过 3 次（火柴/液滴/塔），AI 也犯。',
  '   ⇒ 主体占画面**短边 40~65%**。判据：缩到 25% 还认得出吗？',
  '',
  '⑥ **不许"每段长得一样"**',
  '   实测：多数片子的段落都是"满幅图 + 大字压在上面"。',
  '   ⇒ 相邻三段不许同类型；8 种视觉类型至少用 5 种。',
  '',
  '⑦ **"多图错落"必须是同一主体**',
  '   实测 gen_002：它把"虚化背景" + "牛肉" + "白盘" 三块拼在一起，',
  '   用户看到的是"切片还原完全对不上"。',
  '   ⇒ 多图必须满足：**同一主体、不同角度/不同细节**（例如都是这盘肉：全景 + 特写 + 局部）。',
  '   ⇒ ❌ 不许把"不相干的两张图"并排当"错落"。',
  '   ⇒ 如果只有一张图，**用同一张图裁不同区域**（`background-position` 不同），不要拼两张。',
].join('\n')

/* ══════════════════════════════════════════════════════════════════════
   ★★ 排版硬底线（2026-11-02 · 用户指出"字还是连在一起"）
   实测 012~015：
     line-height 0.78~0.92 **13 处**   ← 主因（我上轮只禁了 letter-spacing，漏了）
     letter-spacing -0.01~-0.05em **18 处**
   ══════════════════════════════════════════════════════════════════════ */
const TYPO_RULES = [
  '【排版硬底线 · 中文不是英文】',
  '',
  '❌ **line-height 必须 ≥ 0.95**（多行大标题用 1.0 ~ 1.1）',
  '   英文可以用 0.78（字母上下有留白），**中文字形占满行高** ⇒ 小于 1 就上下重叠。',
  '   实测 gen_015：font-size 320px + line-height 0.78 ⇒ 行高 250px ⇒ **重叠 70px**。',
  '',
  '❌ **letter-spacing 安全范围 [-0.02em, +0.06em]**',
  '   超 -0.02em 开始碰，超 -0.05em 明显粘连。',
  '',
  '❌ **文字安全区**：大字覆盖的区域**不许放任何其他文字**（小字 / 旁白 / 说明）。',
  '   实测 gen_013：大字"两只猫一只枕"压住了小字"365天里，有314天"。',
  '   ⇒ 大字落位后，把它的包围盒标出来，小字只能放在盒外。',
  '',
  '✅ 判据：把画面缩到 **30%**，如果两行字看起来"连成一块" ⇒ 违规。',
].join('\n')

/* ★★ SVG 必须真的写字（实测：<svg> 有 2~4 个，但 <text> 全是 0） */
const SVG_TEXT_RULE = [
  '【SVG 必须真的写字】',
  '',
  '实测 012~015：`<svg>` 有 2~4 个，但 **`<text>` 全是 0**',
  '⇒ 它拿 SVG 只画矩形 / 圆圈 / 线条，**文字还是用 div + text-shadow**',
  '⇒ 所以"围边"永远做不出来（div 做不出外轮廓描边）',
  '',
  '**要求**：凡是「描边字 / 三层花字 / 数据图表 / 引线标签」，**必须用 `<svg><text>`**：',
  '  <svg viewBox="0 0 720 300">',
  '    <text x="360" y="200" text-anchor="middle" font-size="120" font-weight="900"',
  '      paint-order="stroke" stroke="#FF3D8B" stroke-width="42"',
  '      stroke-linejoin="round" fill="#FF3D8B">鲜切!!</text>',
  '    <text ... stroke="#FFFFFF" stroke-width="20" ... fill="#FFFFFF">鲜切!!</text>',
  '    <text ... fill="url(#gradGold)">鲜切!!</text>',
  '  </svg>',
  '',
  '⇒ 判据：如果全片 `<text>` 数量 = 0 ⇒ **围边一定做错了**。',
].join('\n')

/* ★★ 思考面板必须可见（2026-11-02 · 用户："我要看到它怎么想的"） */
const TRACE_VISIBLE_RULE = [
  '【思考日志必须"看得见"，不能只藏在源码里】',
  '',
  '除了在 `</body>` 前写 `<script type="application/json" id="__trace">…</script>`，',
  '**还要在页面右下角渲染一个可见面板**（不影响 `__seek` 截图）：',
  '',
  '  <div id="__tracePanel" style="position:fixed;right:8px;bottom:40px;width:300px;',
  '    max-height:50vh;overflow:auto;overscroll-behavior:contain;',
  '    background:rgba(10,14,20,.9);color:#C8D8E8;',
  '    font:10px/1.5 monospace;padding:9px;border-radius:8px;',
  '    border:1px solid rgba(120,180,255,.3);z-index:99998;display:none;',
  '    backdrop-filter:blur(6px)">',
  '    <div style="color:#7CF;font-weight:700;margin-bottom:6px">AI 思考日志</div>',
  '    <pre id="__traceBody" style="white-space:pre-wrap;word-break:break-all;margin:0"></pre>',
  '  </div>',
  '  <button id="__traceBtn" title="看 AI 怎么想的" style="position:fixed;right:8px;bottom:8px;',
  '    z-index:99999;width:24px;height:24px;padding:0;line-height:1;',
  '    background:rgba(27,74,122,.75);color:#BFE3FF;border:1px solid rgba(58,124,184,.7);',
  '    border-radius:6px;font:11px system-ui;cursor:pointer;opacity:.7">i</button>',
  '  <script>',
  '    document.getElementById("__traceBtn").onclick = function(){',
  '      var p = document.getElementById("__tracePanel");',
  '      var on = p.style.display === "block";',
  '      p.style.display = on ? "none" : "block";',
  '      if (!on) {',
  '        var raw = document.getElementById("__trace");',
  '        try { document.getElementById("__traceBody").textContent =',
  '          JSON.stringify(JSON.parse(raw.textContent), null, 2) }',
  '        catch(e) { document.getElementById("__traceBody").textContent = raw.textContent }',
  '      }',
  '    };',
  '  </script>',
  '',
  '⚠️ 面板和按钮**不影响画面内容**（`__seek` 截图时会拍到右下角一个小按钮，可接受）。',
].join('\n')

/** 组装 */
export function renderHardRules(): string {
  return [
    DIRECTOR_STATEMENT, '',
    TEXTURE_RULES, '',
    NO_LAZY_RULES, '',
    TYPO_RULES, '',
    SVG_TEXT_RULE, '',
    IMAGE_RULES, '',
    TEXT_STROKE_RULES, '',
    STICKER_RULES, '',
    TOOL_RULES, '',
    QUALITY_GATES, '',
    TRACE_VISIBLE_RULE,
  ].join('\n')
}
