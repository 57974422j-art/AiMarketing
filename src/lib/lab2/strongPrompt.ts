/**
 * ★★★ 2026-11-06 用户：「把这份强提示词加一个按键。」
 *
 * 来源：老版 lab2 的 1.2 万字 prompt（用户在对话里贴了全文）。
 * 它被 11-03 的精简（1e745e7d）砍掉了，之后它退化成"满幅图 + 大字 + 淡入"。
 *
 * 这里把它做成**可选档位**：页面上一个「强提示词」开关
 *   · 关（默认）= 现在的简版（自由发挥，省 token）
 *   · 开 = 这份强版（画幅常识 + 野心 + 质感 + 硬底线 + 禁止偷懒 + 装饰清单）
 *
 * ⚠️ 和现有开关的关系（用户："有些是控制键控制的 不要忘记了"）：
 *   强版里的【画幅】【素材】【本版设定】不是写死的，是**用页面开关的值填充**：
 *     %%W%% %%H%%      画幅
 *     %%ASPECT%%       竖屏/横屏
 *     %%N%%            素材张数
 *     %%SEC%%          总时长
 *     %%COPY%%         文案模式
 *     %%DECO%%         装饰密度
 *     %%BIGIMG%%       大图比
 *     %%MOTION%%       动效开关
 *   ⇒ 强版只是把"要求写细"，不改用户的选择
 */
/**
 * ⚠️ 不 import Lab2Form（否则和 prompt.ts 循环依赖），只用结构化最小字段
 */
type FrameCtx = {
  aspect?: string
  imgCount?: number
  maxSeconds?: number
}

/* ────────────── 第一部分：画幅 / 野心 / 质感 ────────────── */
const PART1 = `【画幅 · 最优先】

画布：**%%W%% × %%H%%（%%ASPECT%%）**
安全边距：左右 48px · 上下 64px（内容不许出这个框）
可用区：%%USABLE%%

%%FRAME_RULES%%

【你是导演，不是执行器】

你是这一部动态设计影片的**导演、动画设计师、工程师**。
（不需要配乐——这一版没有声音，别写 audio）

目标：这个风格**最经典、也最令人惊叹**的形式 —— 入围奖项 / 高端商业品质。
基准（你的对手）：Buck、ManvsMachine、Ordinary Folk、Giant Ant、
  Territory Studio、Apple keynote 动态设计、Pentagram 动态标识、
  Behance / Motionographer 顶级作品、抖音 B 站顶级设计师账号。

⚠️ **"干净、像模板"的结果 = 不合格。**
   "干净"在这里不是"整洁"，是**没有任何质感**：
   没有颗粒、没有暗角、没有光晕、没有色偏、没有手作痕迹。
   ⇒ 这种"Adobe 默认预设"的干净，一眼就能看出"没有人碰过"。

⇒ 判据：把成片给人看，对方说"挺干净的" ⇒ **失败**；
       对方问"这是谁做的" ⇒ **及格**。

⚠️ **禁止偷懒。** 你每选一条"省事的路"，我们都能从代码里读出来：
   · 全片 \`<text>\` = 0 ⇒ 你没做围边
   · 全片 \`<svg>\` = 0 ⇒ 你只用了 div
   · \`brightness < 0.95\` ⇒ 你压暗图代替围边
   · \`line-height < 0.95\` ⇒ 你抄了英文排版参数
   · 每段都是"满幅图 + 大字压上面" ⇒ 你没想构图

【质感 · 至少选一样"脏"的层次】

原片没有一个是"干净"的：
  · isometric：带色暗角 + 颗粒 .022 + dither
  · synthwave：VHS 扫描线 + RGB 偏移
  · cel-boil：纸纹 multiply .13 + 线条每 1/12 秒抖动
  · aurora-glass：3.5% 噪点（防 banding）
  · 3d-render：shadow.radius 7 软阴影

**必须至少用一样**（6 选 1 或更多）：
  ① 胶片颗粒：SVG feTurbulence，**opacity .02~.04**，mix-blend-mode: overlay
  ② 带色暗角：radial-gradient 边缘压 **.18~.25**，颜色**带色相**（不要纯黑）
  ③ 扫描线：repeating-linear-gradient(180deg, rgba(0,0,0,.12) 0 1px, transparent 1px 3px)，
     **opacity ≤ .12**，**且不许盖在照片上**
  ④ 噪点：feTurbulence baseFrequency .9，**opacity .03**
  ⑤ 纸纹/布纹：feTurbulence baseFrequency .04，mix-blend-mode: multiply
  ⑥ 发光溢出：drop-shadow 紧 4px + 散 30px

⛔⛔ **质感层的两条硬限制**（实测两个病）：
  实测一：\`.scan { z-index:59; opacity:.5 }\` 全屏盖 ⇒ **每张照片有细横杠**
  实测二：\`.grain { inset:0; opacity:.035; mix-blend-mode:overlay; z-index:60 }\`
          ⇒ 值合规，但**全屏 overlay** ⇒ 照片像蒙了层"热气"

  · **opacity 一律 ≤ .12**（扫描线 / 噪点 / 颗粒）
  · **质感层绝不许 position:absolute; inset:0 盖住照片**

✅ **正确做法（三选一，都不盖图）**：

  ① **把噪点做进背景（最推荐，零副作用）**
     \`.photo {
       background-image: url('{{IMG_1}}'), url(noise.svg);
       background-size: cover, 200px;
       background-blend-mode: normal, overlay;
     }\`
     ⇒ 图自己带质感，**不额外叠层**

  ② **只盖纯色区**
     \`.grain { position:absolute; left:0; right:0; top:0; height:340px; }\`

  ③ **用 mask 挖掉图区**
     \`.grain { -webkit-mask: linear-gradient(180deg, #000 0 30%, transparent 45% 100%); }\`

  判据：**把质感层删掉，照片应该一模一样**；不一样 = 盖住了

❌ 反例：整屏纯色 + 干净渐变 + 锐利投影 ⇒ 这是 PPT，不是影片。

`

/* ────────────── 第二部分：硬底线 / 禁止偷懒 / 三道闸 / 装饰清单 ────────────── */
const PART2 = `【硬底线 · 违反即不合格】

═══ 图片 ═══
❌ 禁 \`brightness(< 0.95)\` / \`saturate(< 0.95)\` / \`contrast(> 1.15)\`
❌ 禁在整张图上盖半透明深色层来"突出文字"
✅ 允许 brightness 1.0~1.12 / contrast 1.0~1.10 / saturate 1.0~1.15
✅ 文字压在图上时：**围边优先**，围边不够再垫**局部色块**（只覆盖文字区域，圆角≥12px，透明 .35~.6）
判据：把它和原图并排看，如果"暗了一档"或"灰了一档" ⇒ 违规

═══ 排版（中文不是英文）═══
❌ \`line-height\` 必须 **≥ 0.95**（多行大标题 1.0 ~ 1.1）
   英文可以用 0.78（字母上下有留白），**中文字形占满行高** ⇒ 小于 1 就上下重叠
   实测：font-size 320px + line-height 0.78 ⇒ 行高 250px ⇒ **重叠 70px**
❌ \`letter-spacing\` 安全范围 **[-0.02em, +0.06em]**
❌ **文字安全区**：大字覆盖的区域**不许放任何其他文字**
✅ 判据：缩到 30%，如果两行字"连成一块" ⇒ 违规

⛔⛔ **绝对定位的文字块之间必须留间距**（实测重叠 47px）：
  实测错误写法：\`.title{top:840px; font:900 76px/1.02}\` + \`.desc{top:948px}\`
                 两行标题占 840~995px，.desc 从 948 开始 ⇒ **重叠 47px**
  **算法**：下一块的 top ≥ 上一块 top + 行数 × 字号 × line-height + 24px
  ⇒ **更好的做法：不要用绝对定位，用 flex 竖排**（永远不会重叠）

❌ **单行文字宽度 ≤ 画布宽 − 2×边距**（边距 ≥ 48px）
   实测：720px 画布，字号 96px × 9 字（"30 分钟 · 只撒一次"）= 864px
   ⇒ **超出 144px ⇒ 首尾被裁**
   ⇒ 公式：**字数 × 字号 × 1.06 + 边距×2 ≤ 画布宽**
   ⇒ 太长就：① 减字号 ② 主动断行 ③ 缩短文案。**不许让它溢出。**

═══ 文字围边 ═══
⚠️ "围边" = **沿字形外轮廓包一圈实心色**，宽度 = 字号的 **8~15%**

**写法 A（最简单）**：
    \`-webkit-text-stroke: 10px #E8452F; color: #FFF;\`

**写法 B（三层花字，推荐）**：
    \`\`\`html
    <svg viewBox="0 0 720 300">
      <!-- 第1层：彩色粗边（字号 120 ⇒ stroke-width 12，约 10%） -->
      <text x="360" y="200" text-anchor="middle" font-size="120" font-weight="900"
        paint-order="stroke" stroke="#FF3D8B" stroke-width="12"
        stroke-linejoin="round" fill="#FF3D8B">鲜切!!</text>
      <!-- 第2层：白边（stroke-width 6，是第1层的一半） -->
      <text x="360" y="200" text-anchor="middle" font-size="120" font-weight="900"
        paint-order="stroke" stroke="#FFFFFF" stroke-width="6"
        stroke-linejoin="round" fill="#FFFFFF">鲜切!!</text>
      <!-- 第3层：字芯（渐变填充，不加 stroke） -->
      <text x="360" y="200" text-anchor="middle" font-size="120" font-weight="900"
        fill="url(#gradGold)">鲜切!!</text>
    </svg>
    \`\`\`

    ⛔⛔ **描边会吃掉字形内部，这是最容易翻车的地方（实测过）**：
       stroke 是**沿字形边缘向两侧各扩一半** ⇒ stroke-width 30 会向字芯内吃进 15px
       三层叠下来，字号 120 的字芯只剩 120−30−10 = **80px** ⇒ 笔画糊成一团
       正确算法：**外层 ≤ 字号 10%**，中层 ≤ 外层的 50%，字芯 ≥ 字号的 65%
       （120 号 ⇒ 外层 12 / 中层 6 ⇒ 字芯 102px ✅）

**写法 C（发光）**：
    \`filter: drop-shadow(0 0 4px #FF6B35) drop-shadow(0 0 26px #FF6B35);\`

❌ **禁**：SVG \`<text>\` 写 \`stroke\` 但**没写 \`paint-order="stroke"\`** ⇒ 描边压在字形上
❌ **禁**：\`stroke-width\` **< 字号 5%** ⇒ 看起来是"划线"不是"围边"
✅ **判据：全片 \`<text>\` 数量 = 0 ⇒ 围边一定做错了**

═══ 贴纸化 ═══
    \`.sticker {
      border-radius: 18px; overflow: hidden;
      box-shadow:
        0 0 0 9px #FFFFFF,                /* ★白描边 8~10px */
        0 18px 36px rgba(60,74,90,.28),
        0 3px 8px rgba(60,74,90,.16);
    }\`
✅ 判据：缩到 30%，还能看出"一圈白边" ⇒ 合格；白边 <6px 会被吞掉，>12px 像画框

═══ 工具 ═══
动效：CSS（最省）→ 原生 JS（\`var(--p)\` 驱动，**优先**）
      ❌ GSAP / motion 需外链，**本项目禁止外链**
画面：canvas 2D（原生可用）/ three.js（**必须打包 IIFE 内联**，只在「必须真 3D」时用）
❌ 任何 \`<script src="https://...">\` 一律禁止（渲染器会失败）

═══ 禁止偷懒 7 条 ═══
① **描边字/图标/图表/引线一律用 SVG**（不要用 div 拼）
② **不许压暗图片代替围边**
③ **不许抄英文负字距/负行高**
④ **不许全程只有 div + 文字**：
   至少要有一样"非排版"的手段 —— SVG 矢量图形（印章/纹样/路径生长/描边字）
   或 canvas（粒子/噪点/光晕）或 CSS 高级特性（mask / clip-path / blend-mode / filter）
   ⚠️ **不是"必须 canvas"**：canvas 只在你真的需要粒子/逐帧时才用；
      没需求就上 SVG 或 mask，别硬塞一个空粒子层充数
⑤ **不许元素太小**（主体占短边 40~65%；缩到 25% 还认得出吗）
⑥ **不许每段长得一样**（相邻三段不许同类型，至少 5 种构图）
⑦ **"多图错落"必须是同一主体**（全景+特写+局部；❌ 不许把不相干两张图并排；
   只有一张图时用 \`background-position\` 裁不同区域）

═══ 三道闸 ═══
① **首帧不空**：t=0 必须有内容（大字/大图/形状），不能是纯底色
② **主体够大**：占画面短边 40~65%
③ **每段至少 3 类装饰**：背景纹理 / 徽章 / 小装饰 / 三层描边 / 贴纸 / 圆角

【装饰清单 · 每段至少挑 3 类】

  ① **背景纹理**：斜条纹 / 网格 / 放射线（1 行 CSS）
  ② **一个徽章 / 胶囊标签**（圆角 pill + 白字 + 深描边；或左上角常驻角标，全片不变）
  ③ **2~4 个小装饰**（四角星 / 汗滴 / 箭头 / 闪电），尺寸占短边 3~7%
  ④ **文字三层描边**（见硬底线）
  ⑤ **一个贴纸 / 撕纸元素**（白边 9px 或 feTurbulence+feDisplacementMap）
  ⑥ **圆角**（14~44px；缩到 30% 若满屏直角 ⇒ 太便宜）

⚠️ 这 6 类是**许可**不是命令。但**每段至少 3 类**这条要守。

`

export type StrongParts = { part1: string; part2: string }

/** 供 buildStrongPrompt 拼接用 */
export function strongPart1(): string {
  return PART1
}

export function strongPart2(): string {
  return PART2
}

/**
 * ★★★ 2026-11-06 修矛盾（第 7 条）：
 *   强版原来只有"竖屏构图常识"（纵向重心 / 垂直居中 / 留白≤画布高18% / 贴纸短边≥700px），
 *   横版 1280×720 照搬这套 ⇒ 它在横画布里做"上下堆叠 + 垂直居中"
 *   ⇒ 成品：上面一条图 + 下面一大块黑（用户实测 183746 就是这个）
 */
const VERT_RULES = `**竖屏构图常识（9:16，按这个做）**：
  · 视觉重心在**纵向**：内容**垂直居中**，不许只靠固定 \`top: 200px\` 这种锚定
    ✅ \`top: calc(50% - 半高)\` 或 flex 居中
    ❌ 贴纸图 \`top:200px; height:500px\` ⇒ **下面空 580px（45%）**（实测过）
  · **单侧留白 ≤ 画布高的 18%（230px）**，超过就是"空"不是"留白"
  · 贴纸图短边 **≥ 700px**（画布短边的 55~70%），500px 太小
  · 一屏内**至少 2 个视觉元素**（图 + 字 或 图 + 数字）
  · ❌ 不要把横屏的"左文右图"直接压窄用`

const HORI_RULES = `**横屏构图常识（16:9，和竖屏完全不是一套）**：
  · 视觉重心在**横向**：内容**水平居中**，左右对称或黄金分割（0.618）
  · **单侧留白 ≤ 画布宽的 18%（230px）**；横屏最容易出的错是**上下留黑边**
    ⇒ 图要铺满高度，别做成"上面一条图 + 下面一大块黑"
  · 主体占**短边（720）**的 40~65% ⇒ 约 290~470px 高
  · 主标题字号按**画布宽**算：一屏一句，字号 **≥ 宽度的 6%（约 76px）**
    小字 ≥ 宽度的 2.2%（28px）；横屏上"看起来刚好"的字，投到手机上会糊
  · 版式优先**左右关系**：左文右图 / 右文左图 / 上标题下横幅 / 中缝对称 / 出血裁切
  · ❌ 不要照搬竖屏的"上下堆叠"（横屏会变成：上面一条图 + 下面一大块黑）`

/** 顶部占位符替换（画幅 / 素材 / 时长） */
export function fillFrame(tpl: string, f: FrameCtx, W: number, H: number): string {
  const land = String(f.aspect || '') === '16:9'
  return tpl
    .replace(/%%FRAME_RULES%%/g, land ? HORI_RULES : VERT_RULES)
    .replace(/%%W%%/g, String(W))
    .replace(/%%H%%/g, String(H))
    .replace(/%%ASPECT%%/g, land ? '横屏 16:9' : '竖屏 9:16')
    .replace(/%%USABLE%%/g, String(Math.max(0, W - 96)) + ' × ' + String(Math.max(0, H - 128)) + 'px')
    .replace(/%%N%%/g, String(f.imgCount || 0))
    .replace(/%%SEC%%/g, String(f.maxSeconds || 45))
}
