/**
 * ★VF_ANTIAI_V1（2026-09-29 用户定案「按建议顺序执行」）——「反 AI 味清单」第一层：**服务端代码级**
 *
 * 由来：规划文档《待办与规划-20260928》4.2/4.3/4.4 的 **P0 ②**：
 *   「反 AI 味清单」出自 garden-skills 的 web-video-presentation，黑名单是——
 *     ✗ 紫粉渐变背景  ✗ 圆角卡片配彩色描边  ✗ 渐变药丸标签
 *     ✗ emoji 当图标  ✗ 假数据      ✗ 每步都挂 ken burns  ✗ 右下角角标
 *   原文把这一条判为「**全靠提示词自觉**」——本文件就是把它变成【代码级】：提示词只能"请求"，
 *   这里负责"兜住"：AI 写了 emoji / 编了数据 / 对比卡写太长，**在成片之前**就被清掉。
 *
 * 三层落地（分工，别搞混）：
 *   ① 提示词层：ANTI_AI_PROMPT —— 两个分镜 prompt（vf-video.ts 与 chat/route.ts）都拼它；
 *   ② 服务端校验层：本文件的 sanitizeAntiAiShots() —— 归一化之后、出片之前跑；
 *   ③ 渲染前校验层：render.py 的 anti_ai_check()（emoji / 连续同卡型）——最后一道网，只告警。
 *
 * 设计原则：**只做减法和降级，绝不"脑补"**。
 *   宁可这一镜朴素（标题卡、字数短一点），也不要 AI 味（emoji 图标 / 编出来的数据）。
 */

/** 拼进分镜提示词的「反 AI 味硬规矩」（两个 prompt 共用，免得两处走偏） */
export const ANTI_AI_PROMPT =
  `\n【反 AI 味硬规矩】（用户实测定过，违反即返工）\n` +
  `✗ 不许用 emoji 或符号当图标（👍✨🔥👉⭐ 之类）——画面文字只能是中文/数字/常用标点\n` +
  `✗ 不许编造数据：只有【文案里本来就出现的数字】才能做数字卡/图表卡；文案里没有数字，\n` +
  `   就【不许】用 number / chart 卡，改用 title / list / bgimage（宁可朴素，不要假数据）\n` +
  `✗ 不许"紫粉渐变背景 / 圆角卡片配彩色描边 / 渐变药丸标签"这类一眼 AI 的默认审美\n` +
  `✗ 不要每镜都用同一种运动（不要每镜都推近）——镜与镜之间要有静有动\n` +
  `✗ 不要在画面角落挂角标、水印、英文小字\n` +
  `✓ 卡型换着来：同一个卡型【不要连续超过 3 镜】（图 / 标题 / 列表 / 对比 交替出现）\n` +
  // ★VF_INFOCARD_V1（2026-09-30 用户实测「我就是单独做的文字页都很空洞配色单一」）：
  //   实测留档：19 镜里 17 张素材图 + 2 张标题卡 —— list/number/compare/chart 一张都没出，
  //   于是整片就是"图片 + 一行字"的轮播，用户的原话是"很空洞"。这条把它变成硬规矩。
  `✓ 【必须插信息卡】每 4~5 镜里至少插 1 张【独立信息卡】（list 列表 / number 大数字 / compare 对比 / chart 图表 / title 标题）\n` +
  `   ——不要整片都是"素材图 + 一行大字"（用户实测那样看着像图片轮播，很空洞）\n` +
  `✓ 对比卡文字要短：left 与 right 各 ≤8 字，leftDesc 与 rightDesc 各 ≤14 字（写长了画面不得不缩小字号）\n` +
  // ★VF_SUBSPLIT_V1（2026-09-30 用户实测「90 秒的片子字幕好像溢出了」）：把"每镜字幕上限"写给 AI。
  //   事故：留档 vf-20260930-140126-u1.json 的第 10 镜 subtitle 写了 **257 字** → 配音念了 60 秒，
  //   字幕铺满整屏，整片从计划的 49 秒被拉到 121.68 秒。服务端已有硬兜底（超长按句拆镜），
  //   但规矩要**同时**告诉 AI，免得它每次都把剩下的文案塞进最后一镜。
  `✓ 【每镜字幕 ≤ 60 字】多出来的内容必须【另起一镜】，**不许把剩下的文案全塞进最后一镜**\n` +
  `   ——塞进一镜会让那一镜念 1 分钟、字幕铺满整屏（实测：257 字塞进一镜 → 49 秒的片子被拉成 121.68 秒）。\n` +
  `   多少字配多长：中文口播 ≈ 4.3 字/秒，所以长约 5 秒的镜 ≈ 20~22 字；文案长就【多排几镜】，别写爆最后一镜。\n` +
  // ★VF_AI_PICK_V1（2026-09-29 用户定案 P1「挑一些模版给 AI 套」）：让 AI 敢写、写对
  //   主题/版式/动效 —— 值必须落在白名单里（服务端与 render.py 都会再兜一层，写了非法值等于白写）。
  `\n【可选：主题 / 版式 / 动效】（想让画面更统一、更有设计感时才写；不写就用默认 —— **别堆砌**）\n` +
  // ★VF_THEMELOCK_V1（2026-09-30 用户定案「1 确定同意」= 主题由用户定死、AI 不许改）：
  //   用户实测事故：选了浅色主题（文字近黑）→ 压在深色素材上"基本看不见"。用户原话：
  //   「可能是**我选模版**的问题字是黑灰色的，在图片上基本看不见」+「1 确定同意。用户不选就默认，
  //     后期我们根据用户习惯和通过上下文和信息收集 让 AI 自己调整。」
  //   → 现在阶段：**用户选的说了算**，AI 写 theme 一律忽略（服务端 lockUserTheme 会删掉）。
  `· theme（**不要写**：整片主题由用户在设置卡里决定，AI 写了也会被忽略 —— 除非用户完全没选，那时才允许你自选；改配色会让用户"选的和出的不一样"）\n` +
  // ★VF_STYLE_V1（2026-09-30 用户定案「先固定新闻资讯和科技数据」+「告诉 AI 怎么做」）：
  //   用户给了 5 张博主视频截图当学习样本，要求"风格固定 + 但要让 AI 知道每套怎么做"。
  //   规则与渲染层实现一一对应（themes.py 的 news/data + render.py 的编辑风分支）：
  `\n【成片风格规则 · 用户已定两套编辑风】（用 news 或 data 时才遵守；用户没选主题就不必管）\n` +
  `1. 资讯/报道/时事/观点/事件/人物 → theme="news"（深蓝底 + 蓝底白字小标签条 + 白色信息卡 + 黑色横条）\n` +
  `2. 数据/榜单/效率/对比/参数/技术/增长 → theme="data"（近黑青底 + 青色强调 + 超大数字与细线）\n` +
  `3. 同一条片只准用一套，不许混用；一套片里的卡型要换着来（别连续 3 镜同一种卡）。\n` +
  `4. title 卡：text 主标题 ≤8 字；有栏目/出处就填 kicker（≤8 字，会渲染成蓝底小标签条）；英文副标填 en。\n` +
  `5. en 字段只写英文名词短语（≤5 个词、全大写、不带标点、不写中文），例：SUPPLY CHAIN CRISIS。\n` +
  `6. list 卡：items 每条 ≤10 字（渲染成超大编号 + 黑色横条，默认逐条插入）；title 当这组的小标签 ≤6 字。\n` +
  `7. number 卡：value 填数字、suffix 填单位/百分号（单位会渲染成同色系小字）、label ≤8 字。\n` +
  `8. end 卡：text 主标语 + cta（≤6 字）+ en 英文副标。\n` +
  `9. **一层信息只用一个"壳"**：标题给 title、清单给 list、数据给 number/chart —— 不要把全部文字塞进一张卡。\n` +
  `10. 不要为了"看得清"去改主题配色：字压在深色素材上时，渲染层会自动换成亮字 + 深底衬。\n` +
  `11. 中文字体排中文、英文字体排英文（渲染层已内置，你不用管字体）。\n` +
  `· variant（版式；**只对这三类卡有效**，写在别的卡上会被丢掉）：title → center 居中(默认) / left 左对齐 / chip 色块标签；list → steps 逐条揭示(默认) / stack 整板清单；compare → split 左右分栏(默认) / bar 条形对比\n` +
  `· motion（入场动效；**只挑 2~3 个重点镜写**，不要整片都动）：fade 淡入(默认) / slide 上滑淡入 / typewriter 逐字浮现（只对 title 卡有效） / grow 强调条从左往右生长（只对 title/end 卡有效，默认关，写了才开）\n` +
  `· enter（整块版式的滑入方向；**默认已经有一点点从下往上归位**，一般不用写）：up 从下往上(默认) / left 从左往右 / none 这一镜不滑入\n` +
  `· transition（转场，一般人不用写）：soft 柔和淡入淡出(默认) / cut 硬切 / fade 柔化溶解\n` +
  `· ⚠️ 只写上面列出的词 —— 白名单外的值服务端会**直接删掉**（回默认渲染），写了等于没写。\n`

/* ══════════ ★VF_AI_PICK_V1（2026-09-29 用户定案 P1）：AI 自选「主题 / 版式 / 动效」的白名单 ══════════
 * 唯一真相源是渲染层 scripts/video-factory/render.py（TITLE_VARIANTS / LIST_VARIANTS /
 * COMPARE_VARIANTS / MOTIONS / transition 白名单），本文件保持一致；
 * scripts/vf-i2v-selftest.ts 会**逐项对账**（两边不一致直接报错）—— 改渲染层请同步改这里。 */
// ★VF_STYLE_V1（2026-09-30 用户定案「先固定新闻资讯和科技数据」）：新增两套**编辑风**。
//   用户原话：「我发了几个博主的视频截图……文字配色和每个都有渐进效果 分段插入」「2 是学还是告诉 AI
//   每次去发挥……先固定新闻资讯和科技数据」「3 那种更高级你用那种」（= 英文小字用无衬线）。
//   ⚠️ 与渲染层 scripts/video-factory/themes.py 必须**逐项一致**（vf-i2v-selftest 有对账断言）→ 改一边必须改另一边。
export const VF_THEMES = ['dark', 'blue', 'tech', 'mint', 'light', 'journal', 'vivid', 'mono', 'news', 'data']
/** 版式：只有这三类卡有 variant，键=卡型、值=合法版式（渲染层不认识的值会回默认） */
export const VF_VARIANTS: Record<string, string[]> = {
  title: ['center', 'left', 'chip'],
  list: ['steps', 'stack'],
  compare: ['split', 'bar'],
}
// ★VF_MOTIONPPT_V1（2026-09-30 用户定案「动态 PPT 立项」）：motion 新增 `grow`（强调条从左往右生长）。
//   ⚠️ 与 render.py 的 MOTIONS 必须逐项一致（vf-i2v-selftest 会**对账**，不一致直接红）——
//   这一条今天真的红了（渲染层先加、TS 没同步），说明那道闸门有用。
export const VF_MOTIONS = ['fade', 'slide', 'typewriter', 'grow']
/** ★VF_MOTIONPPT_V1：整块版式滑入方向（render.py 的 enter）—— up=从下往上归位(默认) / left=从左往右归位 / none=本镜不滑入
 *  注：渲染层用 `pad`+`crop` 实现，crop 窗口不能为负 → **做不到"从右滑入"**，所以只有 up/left/none 三种。 */
export const VF_ENTERS = ['up', 'left', 'none']
export const VF_TRANSITIONS = ['soft', 'cut', 'fade']

/** ★VF_AI_PICK_V1：AI 自选的"设计字段"——归一化时必须**原样透传**，否则白名单无从校验 */
// ★VF_STYLE_V1（2026-09-30）：「编辑风」（news/data）的两个**专属字段**也必须原样透传 ——
//   kicker = 栏目/出处小标签条（≤8 字）；en = 英文副标（全大写、无衬线、字距加宽）。
//   为什么必须加在这里：两条线的归一化都是"显式造对象 + ...pickDesignFields(s)"，
//   不列进这张表 → AI 写的 kicker/en 会被**静默丢掉**（theme/variant 当初就是这么踩的坑）。
export const PICK_DESIGN_KEYS = ['theme', 'variant', 'motion', 'transition', 'kicker', 'en', 'enter'] as const

/** 从 AI 给的镜里挑出设计字段（只收非空字符串；值是否合法交给 sanitizeAntiAiShots 白名单判）
 *  为什么单独一个小函数：分镜出口有两处（vf-video.ts 与 chat/route.ts 的 genVideoShots），
 *  两边的 `bgimage` 分支都是**显式造对象**（不是 {...s}）→ 不显式带上就会把 theme/variant/motion 丢掉。 */
export function pickDesignFields(s: any): Record<string, string> {
  const o: Record<string, string> = {}
  for (const k of PICK_DESIGN_KEYS) {
    const v = s?.[k]
    // ⚠️ 2026-09-30：上限从 20 提到 48 —— `en`（英文副标）常有 25~40 字符
    //   （如 "NORTH KOREA DEPLOYMENT CRISIS" = 29），20 会在中间截断成半句话。
    if (typeof v === 'string' && v.trim()) o[k] = v.trim().slice(0, 48)
  }
  return o
}

/** emoji / 装饰符号（不含 → ← 这类正文里常见的箭头） */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{2122}\u{2139}]/gu

/** 去掉 emoji 与装饰符号（画面文字只留中文/数字/常用标点） */
export function stripEmoji(v: any): string {
  const s = String(v == null ? '' : v)
  return EMOJI_RE.test(s) ? s.replace(EMOJI_RE, '') : s
}

/** 文案里有没有"数字证据"（阿拉伯数字或百分号 —— 中文数词太常见，故意不算，避免误判成"有数据"） */
export function hasNum(v: any): boolean {
  return /[0-9０-９%％]/.test(String(v == null ? '' : v))
}

/* ══════════ ★VF_THEMELOCK_V1（2026-09-30 用户定案「1 确定同意」）══════════
 * 一句话：**主题由用户在设置卡里定死，AI 不许改。**
 *
 * 为什么（真实事故，用户原话）：
 *   「我们本次输入可能是因为**我选模版**的问题字是黑灰色的，在图片上基本看不见」
 *   → 留档核实：那条片用的是 `light` 浅色纸感（文字 `0x1a1a1a` 近黑 + 底衬 `white@0.55` 白），
 *     压在深色素材上必然看不清。而 AI 还能在镜里写 theme（白名单允许）→ 整片配色被它带跑。
 * 用户定案：「1 确定同意。用户不选就默认，后期我们根据用户习惯和通过上下文和一些信息收集
 *           让 AI 自己调整。」→ 所以**现在**只做"用户说了算"；"AI 自适应"留给后期（那时改这里）。
 *
 * 做法：用户选了主题 → 删掉 AI 写的所有 theme 字段（含镜级）；用户没选 → 保持现状（允许 AI 自选）。
 * 返回处理说明，调用方写日志（便于回溯"AI 到底写了什么"）。
 */
export function lockUserTheme(shots: any[], userTheme?: string): { shots: any[]; notes: string[] } {
  const notes: string[] = []
  const u = String(userTheme || '').trim().toLowerCase()
  if (u && VF_THEMES.includes(u)) {
    let removed = 0
    for (const s of (Array.isArray(shots) ? shots : [])) {
      if (s && typeof s === 'object' && s.theme !== undefined) { delete s.theme; removed++ }
    }
    notes.push(removed
      ? `主题锁定：用户在设置卡选了「${u}」→ 已忽略 AI 在 ${removed} 个镜里写的主题（用户选的说了算）`
      : `主题锁定：用户在设置卡选了「${u}」（AI 未改写，一致）`)
  } else if (u) {
    notes.push(`主题：用户给的值「${u}」不在白名单 → 回默认主题；允许 AI 自选`)
  } else {
    notes.push('主题：用户未指定 → 允许 AI 自选（后期将按用户习惯/数据自适应）')
  }
  return { shots: Array.isArray(shots) ? shots : [], notes }
}

const TEXT_KEYS = ['text', 'title', 'left', 'right', 'leftDesc', 'rightDesc', 'label', 'cta', 'subtitle']

/**
 * 出片前的「反 AI 味」净化（**只减不增**）：
 *   ① 清 emoji/符号（text/title/left/right/说明/label/cta/items/subtitle）
 *   ② 对比卡限字数（left/right ≤8，说明 ≤14）——实测写长了渲染层只能把字号缩到 22px，观感差
 *   ③ 假数据兜底：number / chart 卡若【字幕里没有数字】，降级成 title 卡（不编造数据）
 *   ④ ★VF_AI_PICK_V1：AI 自选的 theme / variant / motion / transition 走白名单 —— 非法值直接删
 * 返回新数组 + 人类可读的处理说明（调用方写进日志，便于回溯"AI 到底写了什么"）。
 */
export function sanitizeAntiAiShots(shots: any[]): { shots: any[]; notes: string[] } {
  const notes: string[] = []
  let emojiHits = 0
  let cmpShort = 0
  let numDrop = 0
  // ★VF_AI_PICK_V1：AI 自选的 主题/版式/动效 非法值计数（写进 notes，便于回溯"AI 到底写了什么"）
  let badDesign = 0
  const badDesignSample: string[] = []
  const out = (Array.isArray(shots) ? shots : []).map((s0: any) => {
    const s: any = { ...(s0 || {}) }
    // ① emoji / 符号
    for (const k of TEXT_KEYS) {
      if (typeof s[k] === 'string') {
        const nv = stripEmoji(s[k]).replace(/\s{2,}/g, ' ').trim()
        if (nv !== s[k]) { s[k] = nv; emojiHits++ }
      }
    }
    if (Array.isArray(s.items)) {
      s.items = s.items.map((it: any) => {
        if (it && typeof it === 'object') {
          const nv = typeof it.label === 'string' ? stripEmoji(it.label).trim() : it.label
          if (nv !== it.label) emojiHits++
          return { ...it, label: nv }
        }
        const nv = stripEmoji(it).trim()
        if (nv !== it) emojiHits++
        return nv
      })
    }
    // ② 对比卡限字数
    if (s.type === 'compare') {
      const cut = (v: any, n: number) => {
        const t = String(v == null ? '' : v).trim()
        if (t.length > n) { cmpShort++; return t.slice(0, n) }
        return v
      }
      s.left = cut(s.left, 8)
      s.right = cut(s.right, 8)
      s.leftDesc = cut(s.leftDesc, 14)
      s.rightDesc = cut(s.rightDesc, 14)
    }
    // ③ 假数据兜底（证据只认"字幕/标题里出现的数字"——AI 自己填的 value 不算证据）
    if (s.type === 'number' || s.type === 'chart') {
      if (!hasNum(s.subtitle) && !hasNum(s.title)) {
        numDrop++
        const t = String(s.label || s.title || s.text || '').slice(0, 12) || String(s.subtitle || '').slice(0, 10)
        s.type = 'title'
        s.text = t
        delete s.value
        delete s.suffix
        delete s.items
        delete s.chart
      }
    }
    // ④ ★VF_AI_PICK_V1：AI 自选的 主题/版式/动效 走**白名单** —— 不在表里的字段**直接删掉**（回默认渲染）。
    //   为什么"删"而不是"改"：AI 自造的值渲染层也不认，删掉最不容易出错（且渲染层自己还有一层白名单兜底）。
    //   ⚠️ variant 必须按【这一镜最终的卡型】判：number/chart 降级成 title 之后不再接受别卡的 variant。
    const _bad = (field: string, val: any) => {
      badDesign++
      if (badDesignSample.length < 3) badDesignSample.push(`${field}=${String(val == null ? '' : val).slice(0, 12) || '(空)'}`)
    }
    if (s.theme !== undefined) {
      const t = String(s.theme || '').trim().toLowerCase()
      if (VF_THEMES.includes(t)) s.theme = t
      else { delete s.theme; _bad('theme', s0?.theme) }
    }
    if (s.variant !== undefined) {
      const allow = VF_VARIANTS[String(s.type || '')] || []
      const v = String(s.variant || '').trim().toLowerCase()
      if (allow.includes(v)) s.variant = v
      else { delete s.variant; _bad('variant', s0?.variant) }
    }
    if (s.motion !== undefined) {
      const m = String(s.motion || '').trim().toLowerCase()
      if (VF_MOTIONS.includes(m)) s.motion = m
      else { delete s.motion; _bad('motion', s0?.motion) }
    }
    if (s.transition !== undefined) {
      const tr = String(s.transition || '').trim().toLowerCase()
      if (VF_TRANSITIONS.includes(tr)) s.transition = tr
      else { delete s.transition; _bad('transition', s0?.transition) }
    }
    // ★VF_MOTIONPPT_V1（2026-09-30）：整块版式的滑入方向（render.py 的 enter）—— 同样走白名单
    if (s.enter !== undefined) {
      const en2 = String(s.enter || '').trim().toLowerCase()
      if (VF_ENTERS.includes(en2)) s.enter = en2
      else { delete s.enter; _bad('enter', s0?.enter) }
    }
    return s
  })
  if (emojiHits) notes.push(`清掉 emoji/符号 ${emojiHits} 处（画面文字只留中文/数字）`)
  if (cmpShort) notes.push(`对比卡 ${cmpShort} 处文字超长已截短（左右 ≤8 字 / 说明 ≤14 字）`)
  if (numDrop) notes.push(`数字/图表卡 ${numDrop} 镜因【文案里没有数字】→ 已降级为标题卡（不编造数据）`)
  if (badDesign) notes.push(`主题/版式/动效 非法值已删 ${badDesign} 处（${badDesignSample.join('、')}…）→ 回默认渲染`)
  return { shots: out, notes }
}

/* ══════════ ★VF_SUBSPLIT_V1（2026-09-30）：单镜字幕上限 + 超长自动「按句拆镜」 ══════════
 * 用户实测原话：「看下错误，90 秒的样子 **AI 把字幕都放在一起**。为什么 30 秒的片子字幕不够用，
 *              90 秒的片子字幕好像**溢出了**。」
 * 事故数据（客户端留档 vf-20260930-140126-u1.json）：
 *   10 镜 / 计划 49.0 秒，但成片 **121.68 秒**；其中 **第 10 镜 subtitle = 257 字**
 *   （其余 9 镜只有 25~42 字）—— AI 把整段剩余文案全塞进了最后一镜。
 *   机制：tts.py 会把每镜 dur 改成「该镜真实配音时长 + 0.35」→ 257 字念完 ≈ 60 秒
 *        → 全片被拉长到 121.68 秒；字幕按整段烧进那一镜 → 257 字（每行 16 字 = 17 行）铺满整屏。
 *   为什么现有闸门没拦住：分镜的「覆盖文案 ≥80%」是按【总字数】算的 —— 257 字都在 → 覆盖 100% 通过。
 *
 * 阈值来源（都是**实测**，不是拍脑袋）：
 *   · 中文口播速度 ≈ **4.3 字/秒**（实测 21.1 秒念 90 字 = 4.27 字/秒，向上取 4.3）；
 *   · 单镜上限 = `min(60, ceil(dur × 4.3))` —— dur 短就按 dur 卡；dur 再长也**不超过 60 字**
 *     （60 字 ≈ 14 秒口播，比这还长就该拆镜了）。
 *
 * 三条铁律（本节的契约，自测 scripts/vf-subsplit-selftest.ts 逐条断言）：
 *   ① **一字不少**：拆分只做「原始文字的连续子串切分」，所有段拼回来 === 原文（含标点）；
 *   ② **标点优先**：先按 。！？；， 断句，再按「每段 ≤ 上限」贪心装箱；单句本身就超上限 → 按字数硬切；
 *   ③ **不许动无辜的镜**：未超上限的镜**原样返回**（type/画面 src/text/主题/版式等字段全不动）。
 */
export const VF_SUB_CPS = 4.3            // 中文口播速度（字/秒，实测）
export const VF_SUB_MAX = 60             // 单镜字幕硬上限（字）
export const VF_SUB_SHOT_MIN_SEC = 2     // 拆出来的每一镜最短时长（秒）
/** 中文断句标点（拆镜时的"句"边界；标点跟在前一段尾部，保证拼回来一字不差） */
const VF_SUB_PUNC = '。！？；，'

/** 单镜字幕上限 = min(60, ceil(dur × 4.3)) */
export function subCapFor(dur: any): number {
  const d = Math.max(1, Number(dur) || 1)
  return Math.max(1, Math.min(VF_SUB_MAX, Math.ceil(d * VF_SUB_CPS)))
}

/** 把一段文字按「每段 ≤ cap 字」切分（标点优先，切不出来再按字数硬切）。
 *  **返回值是原文的连续子串，`segs.join('') === 原文`**（一字不少，含标点）。 */
export function splitTextByCap(text: any, cap: number): string[] {
  const s = String(text == null ? '' : text)
  const c = Math.max(1, Math.floor(Number(cap)) || 1)
  if (!s) return []
  if (s.length <= c) return [s]
  // ① 按句切：标点跟在前一段尾部（这样拼回来与原文字节级一致）
  const pieces: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    cur += ch
    if (VF_SUB_PUNC.includes(ch)) { pieces.push(cur); cur = '' }
  }
  if (cur) pieces.push(cur)
  // ② 贪心装箱（每段 ≤ c）；单句本身就超限 → 按字数硬切（在标点优先之后）
  const out: string[] = []
  let buf = ''
  for (const p of pieces) {
    if (p.length > c) {
      if (buf) { out.push(buf); buf = '' }
      for (let i = 0; i < p.length; i += c) out.push(p.slice(i, i + c))
      continue
    }
    if (buf.length + p.length <= c) buf += p
    else { if (buf) out.push(buf); buf = p }
  }
  if (buf) out.push(buf)
  return out
}

/** ★VF_SUBSPLIT_V1：把「字幕超长」的镜拆成多镜。
 *  · 继承原镜的一切（卡型 / 画面 src / 大字 text / 主题 / 版式…），**只换 subtitle + dur**；
 *  · dur 按各段字数比例分配，**每段 ≥ 2 秒**；若原 dur < 段数×2 → 该镜总时长抬到 段数×2
 *    （此时"总和 = 原 dur"不可能同时满足"每段 ≥2 秒"——优先保证每段能念完，且在日志里说明）；
 *    ⚠️ 上限一律按【原镜 dur】算：新镜的 dur 只是"tts 前的占位"（tts.py 会按真实配音回填 dur），
 *    拿新 dur（可能是 2 秒下限）反推上限会自相矛盾；成片时长本就由配音决定，不靠这里省时间；
 *  · 返回**新数组** + 处理说明（调用方写日志）。
 *  为什么放在服务端而不是渲染层：渲染层只能"别糊屏"，真正的内容治理（拆镜让配音/时长自然）
 *  必须在这里做。上限检查要放在「覆盖文案 ≥80%」闸门**之前**（拆完再算覆盖，避免"拆了反而被拒"）。
 */
export function splitLongSubtitles(shots: any[]): { shots: any[]; notes: string[] } {
  const notes: string[] = []
  const src = Array.isArray(shots) ? shots : []
  const out: any[] = []
  for (let i = 0; i < src.length; i++) {
    const sh: any = src[i] || {}
    const text = String(sh.subtitle == null ? '' : sh.subtitle)
    const cap = subCapFor(sh.dur)
    if (text.length <= cap) { out.push(sh); continue }
    const segs = splitTextByCap(text, cap)
    if (segs.length <= 1) { out.push(sh); continue }
    const totalLen = segs.reduce((a, s) => a + s.length, 0) || 1
    const origDur = Math.max(1, Number(sh.dur) || 3)
    const minTotal = segs.length * VF_SUB_SHOT_MIN_SEC
    const useTotal = Math.max(origDur, minTotal)
    // 用「厘秒」整数分配，保证各段之和**精确等于** useTotal（浮点累加会漂）
    const totalCs = Math.round(useTotal * 100)
    const minCs = VF_SUB_SHOT_MIN_SEC * 100
    const remainCs = Math.max(0, totalCs - segs.length * minCs)
    let acc = 0
    let prev = 0
    const durs: number[] = []
    for (const sg of segs) {
      acc += remainCs * (sg.length / totalLen)
      const add = Math.round(acc) - prev
      prev = Math.round(acc)
      durs.push((minCs + add) / 100)
    }
    for (let k = 0; k < segs.length; k++) {
      out.push({ ...sh, subtitle: segs[k], dur: durs[k] })
    }
    notes.push(
      `第 ${i + 1} 镜字幕 ${text.length} 字 → 按句拆成 ${segs.length} 镜（每镜 ≤ ${cap} 字，文案 0 丢失` +
      (useTotal > origDur
        ? `；每段 ≥${VF_SUB_SHOT_MIN_SEC} 秒 → 该镜总时长 ${origDur}s 抬到 ${Math.round(useTotal * 10) / 10}s`
        : '') +
      `）`
    )
  }
  return { shots: out, notes }
}
