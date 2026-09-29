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
  `✓ 对比卡文字要短：left 与 right 各 ≤8 字，leftDesc 与 rightDesc 各 ≤14 字（写长了画面不得不缩小字号）\n` +
  // ★VF_AI_PICK_V1（2026-09-29 用户定案 P1「挑一些模版给 AI 套」）：让 AI 敢写、写对
  //   主题/版式/动效 —— 值必须落在白名单里（服务端与 render.py 都会再兜一层，写了非法值等于白写）。
  `\n【可选：主题 / 版式 / 动效】（想让画面更统一、更有设计感时才写；不写就用默认 —— **别堆砌**）\n` +
  `· theme（**整片统一**：要么每镜都写同一个值、要么一镜都别写 —— 混着写会让整片花掉；不写就用用户在设置卡选的主题）：dark 深蓝墨(默认) / blue 深蓝科技 / tech 深青科技 / mint 清新薄荷 / light 浅色纸感 / journal 手账暖色 / vivid 高饱和电商 / mono 杂志黑白\n` +
  `· variant（版式；**只对这三类卡有效**，写在别的卡上会被丢掉）：title → center 居中(默认) / left 左对齐 / chip 色块标签；list → steps 逐条揭示(默认) / stack 整板清单；compare → split 左右分栏(默认) / bar 条形对比\n` +
  `· motion（入场动效；**只挑 2~3 个重点镜写**，不要整片都动）：fade 淡入(默认) / slide 上滑淡入 / typewriter 逐字浮现（只对 title 卡有效）\n` +
  `· transition（转场，一般人不用写）：soft 柔和淡入淡出(默认) / cut 硬切 / fade 柔化溶解\n` +
  `· ⚠️ 只写上面列出的词 —— 白名单外的值服务端会**直接删掉**（回默认渲染），写了等于没写。\n`

/* ══════════ ★VF_AI_PICK_V1（2026-09-29 用户定案 P1）：AI 自选「主题 / 版式 / 动效」的白名单 ══════════
 * 唯一真相源是渲染层 scripts/video-factory/render.py（TITLE_VARIANTS / LIST_VARIANTS /
 * COMPARE_VARIANTS / MOTIONS / transition 白名单），本文件保持一致；
 * scripts/vf-i2v-selftest.ts 会**逐项对账**（两边不一致直接报错）—— 改渲染层请同步改这里。 */
export const VF_THEMES = ['dark', 'blue', 'tech', 'mint', 'light', 'journal', 'vivid', 'mono']
/** 版式：只有这三类卡有 variant，键=卡型、值=合法版式（渲染层不认识的值会回默认） */
export const VF_VARIANTS: Record<string, string[]> = {
  title: ['center', 'left', 'chip'],
  list: ['steps', 'stack'],
  compare: ['split', 'bar'],
}
export const VF_MOTIONS = ['fade', 'slide', 'typewriter']
export const VF_TRANSITIONS = ['soft', 'cut', 'fade']

/** ★VF_AI_PICK_V1：AI 自选的"设计字段"——归一化时必须**原样透传**，否则白名单无从校验 */
export const PICK_DESIGN_KEYS = ['theme', 'variant', 'motion', 'transition'] as const

/** 从 AI 给的镜里挑出设计字段（只收非空字符串；值是否合法交给 sanitizeAntiAiShots 白名单判）
 *  为什么单独一个小函数：分镜出口有两处（vf-video.ts 与 chat/route.ts 的 genVideoShots），
 *  两边的 `bgimage` 分支都是**显式造对象**（不是 {...s}）→ 不显式带上就会把 theme/variant/motion 丢掉。 */
export function pickDesignFields(s: any): Record<string, string> {
  const o: Record<string, string> = {}
  for (const k of PICK_DESIGN_KEYS) {
    const v = s?.[k]
    if (typeof v === 'string' && v.trim()) o[k] = v.trim().slice(0, 20)
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
    return s
  })
  if (emojiHits) notes.push(`清掉 emoji/符号 ${emojiHits} 处（画面文字只留中文/数字）`)
  if (cmpShort) notes.push(`对比卡 ${cmpShort} 处文字超长已截短（左右 ≤8 字 / 说明 ≤14 字）`)
  if (numDrop) notes.push(`数字/图表卡 ${numDrop} 镜因【文案里没有数字】→ 已降级为标题卡（不编造数据）`)
  if (badDesign) notes.push(`主题/版式/动效 非法值已删 ${badDesign} 处（${badDesignSample.join('、')}…）→ 回默认渲染`)
  return { shots: out, notes }
}
