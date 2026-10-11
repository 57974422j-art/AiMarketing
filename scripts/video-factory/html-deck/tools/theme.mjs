/**
 * ★VF_PACKHEALTH_V1（2026-10-11 用户定案「不管手动自动 都要会选，并且选了能用不出错」+
 *   「有的我试过 直接就一个墨绿底色简直没法看」）
 * =============================================================================
 * 这个文件是**唯一的颜色体检口径**，三处共用同一套阈值（都能脱离模型跑）：
 *   ① tools/check-style-packs.mjs —— 51 个风格包逐个体检 → styles/health.json
 *   ② tools/orchestrate.mjs       —— 自动挑包时**跳过**体检不过的（不让坏包被自动选中）
 *   ③ tools/film-to-page.mjs      —— AI 自定配色（theme）也过同一道闸，不过就**丢弃并退回风格包**
 *
 * 为什么必须有它（实测根因）：
 *   · 母版派生的包只把 **tokens（配色/字体/圆角）** 带进 HTML 成片；它的 `elements`
 *     （bg-gradient-linear / grid-fine / 装饰）与 `structure`（pipeline-process 是 **PPT 结构名**）
 *     HTML 侧**根本不吃**（pack-to-page.mjs 才吃，见 :239/:309/:346）。
 *   · 于是"深底 + 深字"或"深底 + 同色强调"的配色，在成片里就**整片一坨同色** —— 用户说的"墨绿一坨"。
 *   体检就是把这一类**拦住**：读不清字、看不出强调的包，不允许被自动选中、也不允许 AI 选它。
 *
 * ⚠️ 本文件是**纯函数**（不读盘、不依赖模型）—— 判据必须能单测（temp/_spec/pack-ai.mjs）。
 */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const CKEYS = ['bg', 'bg2', 'ink', 'dim', 'faint', 'accent', 'accentText']

export function isHex(h) { return HEX.test(String(h == null ? '' : h).trim()) }

function rgb(hex) {
  let s = String(hex).trim().slice(1)
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
  const n = parseInt(s, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** WCAG 相对亮度 */
export function lum(hex) {
  const { r, g, b } = rgb(hex)
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG 对比度（1~21） */
export function contrast(a, b) {
  const l1 = lum(a), l2 = lum(b)
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/** 阈值只有这一处（改这里 = 三处同时改口径） */
export const LIMITS = {
  inkBg: 4.5,      // 正文/标题：必须 ≥ 4.5（WCAG AA）
  dimBg: 3.0,      // 副文：≥ 3.0
  accentBg: 2.0,   // 强调色：≥ 2.0（低于此 = 强调完全看不出）
}

/** 允许 AI 自定 theme 的键（与 tokens 同形制；渲染器只认这些） */
export const THEME_KEYS = ['bg', 'bg2', 'ink', 'dim', 'faint', 'accent', 'accentText', 'font', 'radius', 'density', 'grain']

/**
 * 体检一套 tokens / theme。
 * 返回 { ok, problems（致命，会让包不可用 / theme 被丢弃）, warns（提醒，不影响可用）, metrics }
 */
export function checkTokens(t) {
  const o = t && typeof t === 'object' ? t : {}
  const problems = [], warns = [], metrics = {}
  for (const k of ['bg', 'ink', 'accent']) {
    const v = o[k]
    if (v === undefined || v === null || v === '') { problems.push('缺 ' + k); continue }
    if (!isHex(v)) problems.push(k + '=' + String(v) + ' 不是 #rgb/#rrggbb')
  }
  for (const k of CKEYS) {
    const v = o[k]
    if (v === undefined || v === null || v === '') continue
    if (!isHex(v)) problems.push(k + '=' + String(v) + ' 不是十六进制色')
  }
  const fine = (k) => isHex(o[k])
  if (fine('bg') && fine('ink')) {
    const c = contrast(o.bg, o.ink)
    metrics.inkBg = Number(c.toFixed(2))
    if (c < LIMITS.inkBg) problems.push('字/底对比 ' + metrics.inkBg + ' < ' + LIMITS.inkBg + '（字读不清）')
  }
  if (fine('bg') && fine('accent')) {
    const c = contrast(o.bg, o.accent)
    metrics.accentBg = Number(c.toFixed(2))
    if (c < LIMITS.accentBg) problems.push('强调/底对比 ' + metrics.accentBg + ' < ' + LIMITS.accentBg + '（强调看不出来，整片一坨同色）')
  }
  if (fine('accentText') && fine('bg')) {
    const c = contrast(o.bg, o.accentText)
    metrics.accentTextBg = Number(c.toFixed(2))
    if (c < LIMITS.accentBg) warns.push('accentText/底对比 ' + metrics.accentTextBg + ' 偏低（强调文字可能发灰）')
  }
  if (!o.dim) warns.push('没给 dim（副文会直接用主字色）')
  else if (fine('dim') && fine('bg')) {
    const c = contrast(o.bg, o.dim)
    metrics.dimBg = Number(c.toFixed(2))
    if (c < LIMITS.dimBg) warns.push('副文/底对比 ' + metrics.dimBg + ' < ' + LIMITS.dimBg + '（副文偏淡）')
  }
  // 纯色底（无第二层）⇒ 成片会显"平"。不是致命，但要让人知道这是它设计的边界。
  if (fine('bg') && (!o.bg2 || String(o.bg2).toLowerCase() === String(o.bg).toLowerCase())) {
    warns.push('纯色底（bg2 与 bg 相同 / 未给）⇒ 成片没有第二层，其它层次靠 HTML 结构')
  }
  if (!o.font) warns.push('没给 font（会用 sans-900）')
  return { ok: problems.length === 0, problems, warns, metrics }
}

/**
 * 校验 AI 自定的 theme（"AI 完全自主"模式）。
 * 口径：**至少给 bg + ink**（要全自主就得把底和字定下来），且必须过对比闸。
 * 不过 ⇒ { ok:false, theme:null, problems } ⇒ 渲染器**丢弃并退回风格包配色**（宁可退回，不出"没法看"）。
 */
/** 两色混合（t=0 ⇒ a，t=1 ⇒ b）—— 用于"补第二层 / 提亮光斑" */
export function mix(a, b, t) {
  if (!isHex(a) || !isHex(b)) return a
  const A = rgb(a), B = rgb(b), k = Math.max(0, Math.min(1, Number(t) || 0))
  const ch = (x, y) => Math.round(x + (y - x) * k).toString(16).padStart(2, '0')
  return '#' + ch(A.r, B.r) + ch(A.g, B.g) + ch(A.b, B.b)
}

/**
 * ★VF_FLATFIX_V1：把"一坨纯色"补出层次（**最小必要修正**，不改设计气质）。
 * 用户原话：「有的我试过 直接就一个墨绿底色简直没法看」——根因是两层叠加：
 *   ① 母版包的 elements（渐变/网格/装饰）HTML 成片不吃 ⇒ 只剩 tokens.bg 一层底色；
 *   ② runtime/film.js 会在背景上画**两坨 accent 光斑**（:43-44），深底 + 深强调 ⇒ 两坨同色糊满屏。
 * 口径（都可解释、都打印）：
 *   ① bg2 缺失或与 bg 相同 ⇒ 用 **accent 混 6~10%** 造同色系第二层（保留原配色，只是不再死平）；
 *   ② 强调与底对比 < 2.5 ⇒ 给光斑一个**提亮版 accent**（T.blob），并把 accent 本身提 25%，
 *      否则"点了看不见"（这正是"一坨"的观感来源）。
 * 返回 { tokens, notes }
 */
export function fixTokens(T) {
  const tokens = Object.assign({}, T || {})
  const notes = []
  if (isHex(tokens.bg) && isHex(tokens.accent)) {
    const dark = lum(tokens.bg) < 0.35
    const same = !tokens.bg2 || String(tokens.bg2).toLowerCase() === String(tokens.bg).toLowerCase()
    if (same) {
      tokens.bg2 = mix(tokens.bg, tokens.accent, dark ? 0.10 : 0.06)
      notes.push('原包是纯色底 ⇒ 补同色系第二层 ' + tokens.bg2)
    }
    const c = contrast(tokens.bg, tokens.accent)
    if (c < 2.5) {
      const toward = dark ? '#ffffff' : '#000000'
      tokens.blob = mix(tokens.accent, toward, 0.45)
      tokens.accent = mix(tokens.accent, toward, 0.25)
      notes.push('强调与底太近（对比 ' + c.toFixed(2) + ' < 2.5）⇒ 光斑提亮为 ' + tokens.blob + '、强调提亮为 ' + tokens.accent)
    }
  }
  return { tokens, notes }
}

/**
 * 校验 AI 自定的 theme（"AI 完全自主"模式）。
 * 口径：**至少给 bg + ink**（要全自主就得把底和字定下来），且必须过对比闸。
 * 不过 ⇒ { ok:false, theme:null, problems } ⇒ 渲染器**丢弃并退回风格包配色**（宁可退回，不出"没法看"）。
 */
export function normTheme(theme) {
  const src = theme && typeof theme === 'object' && !Array.isArray(theme) ? theme : null
  if (!src) return { ok: false, theme: null, problems: ['没有 theme'] }
  const out = {}
  for (const k of THEME_KEYS) if (src[k] !== undefined && src[k] !== null && src[k] !== '') out[k] = src[k]
  const problems = []
  for (const k of ['bg', 'ink']) {
    if (!isHex(out[k])) problems.push('theme.' + k + ' 必需且得是十六进制色（现在=' + String(out[k]) + '）')
  }
  if (problems.length) return { ok: false, theme: null, problems }
  const chk = checkTokens(out)
  // theme 只要"字能读 + 强调能看出"两条硬线（dim/font 缺失只算提醒）
  const hard = (chk.problems || []).filter((p) => /对比|不是十六进制|缺 bg|缺 ink|缺 accent/.test(p) && !/缺 accent/.test(p))
  if (hard.length) return { ok: false, theme: null, problems: hard }
  return { ok: true, theme: out, problems: [] }
}
