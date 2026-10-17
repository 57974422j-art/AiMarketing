/**
 * ★VF_DAILY_V2 纯函数层：「日报落地页」的 **AI 输出 → 引擎配置 → 给人看的清单** 这一段。
 * =============================================================================
 * 为什么单独一个文件：`daily.ts` 那套状态机要 prisma + OSS + AI 才能跑，单测很贵；
 * 而"**AI 吐出来的 JSON 能不能被引擎吃**"是这条线最容易出事的一段（段数/图号/字数/漏图）。
 * ⇒ 这一段做成**零 import 纯函数**，可 tsc 单文件编译后直接 node 测：`temp/_exp/daily/test-plan.mjs`。
 *   （与 `src/lib/repo-naming.ts` 同款套路：纯函数单独放、可证伪。）
 *
 * ⚠️ 本文件**不允许 import 任何东西**（要能 `tsc` 单文件编译后直接 node 跑测试）。
 */

/**
 * ★风格定型（用户原话「设计风格只有一个先定型」）：
 *   本轮唯一风格 = 暖纸日报（暖纸底 + 朱红点缀），对应引擎 meta.accent / meta.paper。
 *   想做第二种风格再回来改这里（那时才谈"风格选择"）。
 */
export const DAILY_STYLE = { id: 'paper-daily', name: '暖纸日报', accent: '#C6392B', paper: '#F5F1E8' }

/**
 * ★VF_DAILY_V12：方案来源三档 —— 用户要能一眼分辨"这份是谁排的"。
 *   `ai`       = AI 看素材后编排（最佳）
 *   `captions` = AI 没排出（超时/截断），但**看图这一步成功了** ⇒ 按"看图摘要"重排（有真内容）
 *   `fallback` = 连看图都没有 ⇒ 系统保底版式（占位文案）
 */
export type PlanBy = 'ai' | 'captions' | 'fallback'
export function byLabel(by: any): string {
  return by === 'ai' ? 'AI 看素材编排'
    : (by === 'captions' ? '按看图摘要排（AI 未产出）' : '系统保底版式')
}

/** 段级排版可选值（引擎 data-form / data-place 的白名单） */
export const PLAN_FORMS = ['overlay', 'sticker', 'vertical']
// ★VF_DAILY_V12（2026-10-13 用户：「主题明确的图不怕遮挡、完全可以显示全图」）：
//   `contain` = **整张不裁**（留纸色边）——白底产品图/主体集中时用；`mat` = 铺满+相纸白边；`cover` = 铺满裁切。
export const PLAN_PLACES = ['cover', 'mat', 'contain']

/**
 * ★VF_DAILY_L4（2026-10-12 用户「说 L4 大胆试」）：**皮肤库** —— 与引擎
 * `tools/daily-page.mjs` 的 `THEMES` **必须逐字一致**（两处白名单）。
 * 用户病灶原话的另一半：「两份产物 `<style>` 连 md5 都一样」⇒ 结构能变、皮肤永远一套。
 * 现在 AI 按素材气质挑皮肤；也可给 `custom` 自定 hex 配色（引擎会做对比度体检，不达标自动回落）。
 */
export const PLAN_THEMES: Array<{ id: string; name: string; look: string }> = [
  { id: 'paper-daily', name: '暖纸日报', look: '暖米纸 + 朱红点缀 + 衬线（默认，适合餐饮热食/市井）' },
  { id: 'night-gold',  name: '夜宴金',   look: '深墨底 + 金点缀 + 衬线（夜景/酒吧/高端）' },
  { id: 'tea-green',   name: '青瓷茶绿', look: '豆绿纸 + 墨绿点缀 + 衬线（茶/素食/清雅）' },
  { id: 'blue-print',  name: '蓝图冷调', look: '冷白纸 + 蓝点缀 + 无衬线（数码/办公/科技感）' },
  { id: 'coral-warm',  name: '柿橙暖场', look: '奶橘纸 + 柿橙点缀 + 无衬线（甜品/果汁/活泼）' },
  { id: 'mono-print',  name: '素黑白',   look: '白纸 + 黑点缀 + 无衬线（极简/纪实/严肃）' },
  /* ═══ ★VF_DAILY_V23（2026-10-14 用户定案「先 B 吧」= 把设计字典抽成皮肤库）：6 → 20 套 ═══
     纲目参照开源 UI 设计 Skill（UI/UX Pro Max 的 67 风格分类：E-Ink/Editorial、Dark Mode OLED、
     Organic/Biophilic、Vintage Analog、Morandi 这类**风格名**）—— 它的色值放在 data/*.csv、README 没给，
     所以**配色是我们自己配的**，但每套都过引擎同一套 WCAG 体检（正文≥4.5 / 次要≥3.0 / 强调≥2.0 / 反白≥4.5）。
     配方台：temp/_exp/daily/mk-themes.mjs（离线筛完再入库）；回归：temp/_exp/daily/test-themes.mjs。
     与引擎 `daily-page.mjs` 的 `THEMES` **必须同名同数**（有单测卡住这条，防两处漂移）。 */
  { id: 'copper-pot', name: '铜锅炭火', look: '炭褐底 + 铜橙点缀 + 衬线（火锅/烧烤/夜宵，压得住热气）' },
  { id: 'amber-cafe', name: '琥珀咖啡', look: '奶油纸 + 琥珀棕 + 衬线（咖啡/烘焙/正餐，温润）' },
  { id: 'wine-red',   name: '酒红宴席', look: '酒红底 + 深红点缀 + 衬线（宴席/私房菜/年节）' },
  { id: 'late-night', name: '深夜食堂', look: '墨蓝夜底 + 暖黄灯色 + 无衬线（深夜食堂/居酒屋）' },
  { id: 'cinema-noir', name: '胶片黑',  look: '近黑底 + 银灰 + 香槟金 + 无衬线（电影感/纪实/高端）' },
  { id: 'forest-ink', name: '墨绿松林', look: '松墨绿底 + 米金 + 衬线（茶室/自然/静物）' },
  { id: 'jiangnan',   name: '江南宣纸', look: '宣纸米 + 淡青点缀 + 衬线（江南/茶点/文气）' },
  { id: 'bamboo',     name: '竹青',     look: '竹青浅底 + 深绿 + 衬线（素食/茶/清爽）' },
  { id: 'sand-dune',  name: '沙丘暖沙', look: '暖沙底 + 陶土点缀 + 衬线（面点/烘焙/西北菜）' },
  { id: 'mist-blue',  name: '雾蓝书页', look: '雾蓝底 + 深蓝 + 无衬线（数码/办公/说明型）' },
  { id: 'graphite',   name: '石墨办公', look: '中性灰 + 松石绿点缀 + 无衬线（数据/工具/中性）' },
  { id: 'nordic',     name: '北欧冷白', look: '冷白 + 石板蓝 + 无衬线（极简/北欧/产品）' },
  { id: 'rose-milk',  name: '草莓奶昔', look: '奶粉底 + 莓红点缀 + 无衬线（甜品/饮品/活泼）' },
  { id: 'morandi',    name: '莫兰迪灰粉', look: '莫兰迪灰粉 + 砖红点缀 + 无衬线（生活/家居/温柔）' },
]
const THEME_IDS = PLAN_THEMES.map((x) => x.id)
/** 皮肤名（清单/卡头用；不认识的 id 回落默认名） */
export function themeName(id: any): string {
  const t = PLAN_THEMES.filter((x) => x.id === String(id || ''))[0]
  return t ? t.name : PLAN_THEMES[0].name
}
/** 抽 AI 的皮肤选择：白名单 + 自定配色必须是 4 个 hex（不合规就丢掉并记进 fixes） */
export function normTheme(raw: any): { theme: string; custom?: { paper: string; ink: string; dim: string; accent: string }; fixes: string[] } {
  const fixes: string[] = []
  const want = String(raw?.theme || '')
  let theme = THEME_IDS.indexOf(want) >= 0 ? want : ''
  if (want && !theme) fixes.push(`AI 要的皮肤「${want}」不在库里 ⇒ 用默认「${PLAN_THEMES[0].name}」`)
  const c = raw?.custom && typeof raw.custom === 'object' ? raw.custom : null
  if (c) {
    const ok = ['paper', 'ink', 'dim', 'accent'].every((k) => /^#[0-9a-fA-F]{6}$/.test(String(c[k] || '')))
    if (ok) return { theme: theme || 'custom', custom: { paper: c.paper, ink: c.ink, dim: c.dim, accent: c.accent }, fixes }
    fixes.push('AI 自定配色里有非 hex 值 ⇒ 已忽略（用预设皮肤）')
  }
  return { theme: theme || THEME_IDS[0], fixes }
}

/**
 * ★VF_DAILY_L2（2026-10-12 用户「说 L2 大胆试」）：**段结构库** —— 与引擎
 * `scripts/video-factory/html-deck/tools/daily-page.mjs` 里的 `LAYOUTS` **必须逐字一致**（两处白名单）。
 * 用户病灶原话：「你是不是把设计说的很死，我看它设计跟你的一模一样」—— 老实现只有一套骨架，
 * 两份产物连 `<style>` 都字节相同；现在 AI 可以按素材在这 8 种里挑（图数必须与结构匹配，见 normSegs）。
 */
export const PLAN_LAYOUTS: Array<{ id: string; name: string; minImg: number; maxImg: number; look: string }> = [
  { id: 'hero',     name: '满幅压字', minImg: 1, maxImg: 1, look: '图吃满整段，文字贴在下沿深色衬带上（气势型，适合环境/门头/全景）' },
  { id: 'sticker',  name: '贴纸标题', minImg: 1, maxImg: 1, look: '标题做成纸色贴纸块，图在下方（手作感，适合细节/单品）' },
  { id: 'vertical', name: '竖排标题', minImg: 1, maxImg: 1, look: '标题竖排占右侧一列，图在左（报纸感，标题要短）' },
  { id: 'split',    name: '图文左右', minImg: 1, maxImg: 1, look: '字左图右左右分栏（说明型，适合要讲清一件事的图）' },
  { id: 'stack2',   name: '上下双图', minImg: 2, maxImg: 2, look: '两张图上下叠（横屏自动变左右并排），一组对照/前后' },
  { id: 'grid3',    name: '三图拼版', minImg: 3, maxImg: 3, look: '一主两辅：1 张大图 + 2 张小图（适合菜品/产品一组）' },
  { id: 'grid4',    name: '四宫格',   minImg: 4, maxImg: 4, look: '四张等分 2×2（适合把一批素材一次给足，节奏快）' },
  { id: 'quote',    name: '引文页',   minImg: 0, maxImg: 1, look: '无图或一张窄条图，字很大居中（适合金句/落款/收尾）' },
]
const LAYOUT_IDS = PLAN_LAYOUTS.map((x) => x.id)
/** 图数 → 最合适的基础结构（AI 没给 / 给错时的兜底） */
export function layoutForCount(n: number): string {
  if (n >= 4) return 'grid4'
  if (n === 3) return 'grid3'
  if (n === 2) return 'stack2'
  return 'hero'
}

export interface PlanPick { name: string }

/** 短字段清洗：去空白 + 截断（AI 爱写长句） */
export function clip(s: any, n: number): string {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n)
}

/** 去 markdown 代码块围栏（模型爱包 ```json … ```） */
function stripFence(s: string): string {
  return s.replace(/^\s*```[a-zA-Z0-9_-]*\s*/, '').replace(/```[\s\S]*$/, '')
}
/** 修尾随逗号（`,}` / `,]`） */
function fixTrailingCommas(s: string): string {
  return s.replace(/,\s*([}\]])/g, '$1')
}
/** 全角标点归一（**只在解析失败时才用**；会把中文标点变成 ASCII，属于最后手段） */
function normalizeFullWidth(s: string): string {
  return s.replace(/，/g, ',').replace(/：/g, ':').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
}
/** 截断修复：扫括号栈 → 回退到最后一个"安全位置"（顶层逗号/闭合括号）→ 补齐未闭合的括号 */
function closeTruncated(s: string): string {
  const st: string[] = []
  let inStr = false, esc = false, cut = -1
  for (let k = 0; k < s.length; k++) {
    const c = s[k]
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
    if (c === '"') { inStr = true; continue }
    if (c === '{' || c === '[') st.push(c)
    else if (c === '}' || c === ']') { st.pop(); cut = k + 1 }
    else if (c === ',' && st.length) cut = k
  }
  if (!st.length && !inStr) return s
  const t = cut > 0 ? s.slice(0, cut) : s
  const st2: string[] = []
  let inStr2 = false, esc2 = false
  for (const c of t) {
    if (inStr2) { if (esc2) esc2 = false; else if (c === '\\') esc2 = true; else if (c === '"') inStr2 = false; continue }
    if (c === '"') { inStr2 = true; continue }
    if (c === '{' || c === '[') st2.push(c)
    else if (c === '}' || c === ']') st2.pop()
  }
  let out = t
  if (inStr2) out += '"'
  for (let k = st2.length - 1; k >= 0; k--) out += st2[k] === '{' ? '}' : ']'
  return out
}
/**
 * ★VF_DAILY_V25b（2026-10-14 用户实测：「AI 这轮没排出方案（AI 没吐出可解析的 JSON（重试也没成功））」）：
 *   老实现 = "首个 `{` 到最后一个 `}`" + `JSON.parse` ⇒ 一碰就碎。模型最常见的五种废输出**全都当场失败**：
 *     ① 被 maxTokens **截断**（最后那个 `}` 是内层的 ⇒ 括号不闭合）；
 *     ② **尾随逗号**（`,}` / `,]`）；
 *     ③ **全角标点**当分隔符（`，` `：` `“”`）；
 *     ④ **代码块围栏**、JSON 前后夹解释文字；
 *     ⑤ 多个 JSON 片段连写。
 *   现口径：**逐级放宽**（原文 → 去围栏 → 修尾逗号 → 全角归一 → 截断修复），任一级成功即返回，
 *   并把"是哪一级修好的"如实报出来（上层写日志，别静默）。仍只吃 JSON —— 不用 eval、不执行任何东西。
 *   为什么要报 `how`：这条报错以前只留一句"没吐出可解析的 JSON"，**连原文都没记** ⇒ 只能猜（这轮就是）。
 */
export function extractJsonEx(txt: string): { value: any | null; how: string } {
  const raw0 = String(txt || '').replace(/^\uFEFF/, '')
  if (!raw0.trim()) return { value: null, how: '空响应' }
  const i = raw0.indexOf('{'), j = raw0.lastIndexOf('}')
  const heads: string[] = [raw0]
  if (i >= 0 && j > i) heads.push(raw0.slice(i, j + 1))
  if (i >= 0) heads.push(raw0.slice(i))
  const steps: Array<[string, (x: string) => string]> = [
    ['原文', (x) => x],
    ['去围栏', stripFence],
    ['修尾逗号', (x) => fixTrailingCommas(stripFence(x))],
    ['全角归一', (x) => normalizeFullWidth(fixTrailingCommas(stripFence(x)))],
    ['截断修复', (x) => closeTruncated(normalizeFullWidth(fixTrailingCommas(stripFence(x))))],
  ]
  for (const h of heads) {
    for (const [name, fn] of steps) {
      try {
        const v = JSON.parse(fn(h))
        // ⚠️ `{}` 也算"解析成功"会把后面拖成更含糊的报错（"分段不合规"），所以要求**非空对象**：
        //   单测里"纯解释 + 半个花括号"那例就暴露了这个 —— 截断修复会把它修成 `{}`。
        if (v && typeof v === 'object' && Object.keys(v).length > 0) {
          return { value: v, how: name === '原文' ? '直接解析' : '修补后解析（' + name + '）' }
        }
      } catch { /* 下一级 */ }
    }
  }
  return {
    value: null,
    how: '五级都失败（响应 ' + raw0.length + ' 字；开头 ' + JSON.stringify(raw0.slice(0, 70))
      + '；结尾 ' + JSON.stringify(raw0.slice(-70)) + '）',
  }
}
/** 抽 JSON（兼容老调用：只要值） */
export function extractJson(txt: string): any | null {
  return extractJsonEx(txt).value
}

/**
 * ★VF_DAILY_V9（2026-10-13 用户原话「感觉没什么区别」）：
 *   **皮肤轮换**决策（纯函数 ⇒ 可单测）。
 *   病灶：两份产物的 `<style>` 里纸色/点缀/字体**逐字节相同** —— AI 每次都挑（或回落）默认的暖纸日报。
 *   口径：
 *     · AI 给了 `custom` 自定配色 ⇒ **不动**（本身就是"不一样"）；
 *     · AI 挑的皮肤 ≠ 上一次用的 ⇒ 用它（尊重 AI 的判断）；
 *     · 没挑 / 挑的还是上一次那套 ⇒ **换一个**（优先排除最近 2 次用过的，按 seed 稳定选 ⇒ 同输入同结果）。
 *   `from` = 被换掉的那套（回话里要如实说"上次是它、这次换了"，用户才看得见变化）。
 */
export function rotateTheme(aiTheme: string, recent: string[], seed: string): { theme: string; rotated: boolean; from: string } {
  const want = String(aiTheme || '')
  const last = String(recent[0] || '')
  if (want === 'custom') return { theme: 'custom', rotated: false, from: '' }
  /* ★VF_DAILY_V44（2026-10-17 用户服务器**数据库实测**的皮肤序列定案）：
     病灶（原第 226 行）：`if (want && want !== last) return want` —— **只跟"上一次"比**，
     于是"AI 挑的皮肤只要 ≠ 上一次就无条件采纳"，**哪怕它 == 上上次** ⇒ 必然出现乒乓。
     用户库里的真实序列（新→旧）：`copper-pot, mono-print, copper-pot, amber-cafe, copper-pot, mono-print`
     ⇒ **A→B→A→C→A→B**：A 每隔一次就回来 ⇒ 用户「怎么改都看不出变化」的一半原因就在这
       （另一半是提示词把 align/scale 劝退了，见 aiPrompt）。
     现口径：`want` 必须**不在最近 2 条里**才采纳；否则把它与最近 2 条一起 ban，从池里按 seed 稳定挑。
     （`ban` 里那句 `ban.add(want)` 保留：want 为空串时靠 `last`/`recent` 兜底，行为与改动前一致。） */
  const ban = new Set(recent.slice(0, 2).filter(Boolean))
  if (want && !ban.has(want)) return { theme: want, rotated: false, from: '' }
  ban.add(want)
  let pool = PLAN_THEMES.map((t) => t.id).filter((id) => id !== 'custom' && !ban.has(id))
  if (!pool.length) pool = PLAN_THEMES.map((t) => t.id).filter((id) => id !== want && id !== 'custom')
  if (!pool.length) return { theme: want || PLAN_THEMES[0].id, rotated: false, from: '' }
  // 稳定散列（同 seed 同结果；不引第三方库）—— 让"这次挑哪套"看起来随机但可复现
  let h = 5381
  const s = String(seed || '')
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  const theme = pool[h % pool.length]
  return { theme, rotated: !!want || !!last, from: last || want }
}

/**
 * 给 AI 的任务书（看图前排段；纯字符串，可单测"约束有没有写进提示词"）
 *
 * ★VF_DAILY_V32（2026-10-16 用户定案「这个生成HTML 改成 2个 AI开关」「我要AI改的是 设计风格 不是纯套模版」）：
 *   方案卡上给两个开关，都**只改这一份提示词的措辞**（引擎、闸门、判据一行不动 ⇒ 零新机制、零风险）：
 *     · `aiLayout` **让 AI 放手排版** —— 默认它是保守的（只求"相邻两段别撞"），打开后鼓励它
 *       **大胆混搭**已经存在的那些维度（版式 × 叠法 × 对齐 × 文字层 × 字号 × 动效），
 *       目标是"同一份里出现明显不同的视觉气质"，而不是"每段都安全、看着像一套"。
 *     · `aiPickSkin` **皮肤也交给 AI 挑** —— 默认服务端会要求"这次必须换一个和上次不同的皮肤"
 *       （治"看着像同一套"的老办法）；打开后**解除那条约束**，让 AI 纯按本批素材气质挑。
 *   ⚠️ 为什么不做"AI 自由写整页 HTML"（那是"大"）：会绕不过引擎的结构校验 ⇒ 必须改**共用引擎**
 *     ⇒ 风险外溢到 HTML成片线；而且四道保障（排版体检/用字闸门/抖动修复/引擎校验）全建立在固定版式上。
 *     详见 ISSUES.md 的「③⑫⑬ 三阶段规划」。
 */
export function aiPrompt(n: number, topic: string, opts?: { lastTheme?: string; aiLayout?: boolean; aiPickSkin?: boolean }): string {
  const aiLayout = !!opts?.aiLayout
  const aiPickSkin = !!opts?.aiPickSkin
  const cat = PLAN_LAYOUTS
    .map((l) => `  · ${l.id}（${l.name}，${l.minImg === l.maxImg ? l.minImg : l.minImg + '~' + l.maxImg} 张图）：${l.look}`)
    .join('\n')
  // ★VF_DAILY_V11（2026-10-13 用户实测「本次只有 3 页，还没它 7 页规划的好；**页数多不是问题、少反而是问题**，
  //   这个是为了做视频用的」）：段数下限**按素材量算**（不再是"2~8 段"这种给 AI 留空子的写法）。
  const minSegs = Math.min(16, Math.max(6, Math.ceil(n * 1.5)))
  const last = String(opts?.lastTheme || '')
  return [
    '你是「日报落地页」的排版编排员。用户挑好了 ' + n + ' 张素材图（下面按顺序编号 1..' + n + '），主题是「' + (topic || '（未给）') + '」。',
    '请**先看图**，再给一份分段方案（JSON）。**每一段都要从下面的结构库里挑一个 `layout`** —— 整份要有变化，别 8 段一个样。',
    '',
    '【段结构库】（`layout` 只能取这些 id；**每段的图数必须与该结构匹配**）',
    cat,
    '',
    '【皮肤库】（**按素材气质挑一个**放进 `theme`）',
    PLAN_THEMES.map((t) => `  · ${t.id}（${t.name}）：${t.look}`).join('\n'),
    // ★VF_DAILY_V25（B2：皮肤×题材"选择示例句"）—— 库里 20 套，光看名字 AI 挑不准；
    //   给几组**典型题材 → 首选/备选**的对应，是把"挑皮肤"这件事从玄学变成查表。
    '【挑皮肤的对照（先看题材，再定配色）】：',
    '  · 火锅/烧烤/热食热菜 → copper-pot（铜锅炭火）或 paper-daily（暖纸日报）；',
    '  · 咖啡/烘焙/面点/正餐 → amber-cafe（琥珀咖啡）或 sand-dune（沙丘暖沙）；',
    '  · 酒/夜宵/居酒屋/夜场 → late-night（深夜食堂）或 night-gold（夜宴金）；',
    '  · 茶/素食/清淡/自然 → tea-green（青瓷茶绿）、bamboo（竹青）、forest-ink（墨绿松林）；',
    '  · 宴席/私房菜/年节 → wine-red（酒红宴席）；江南/茶点/文气 → jiangnan（江南宣纸）；',
    '  · 甜品/饮品/少女向 → rose-milk（草莓奶昔）、coral-warm（柿橙暖场）；',
    '  · 数码/办公/说明型 → blue-print（蓝图冷调）、mist-blue（雾蓝书页）、graphite（石墨办公）；',
    '  · 纪实/高端/极简/影像感 → cinema-noir（胶片黑）、mono-print（素黑白）、nordic（北欧冷白）、morandi（莫兰迪灰粉）。',
    // ★VF_DAILY_V25（B1：字体配对）—— 皮肤自带默认配对，这里给"想改字体时"的选项。
    '【字体配对】（可选，放进 `font`；**皮肤自带默认配对**，只有明显不搭才改）',
    PLAN_FONTS.map((f) => `  · ${f.id}（${f.name}）：${f.look}`).join('\n'),
    // ★VF_DAILY_V25（文字动效）—— 第四条去同质化轴：入场动作。
    '【文字动效】（可选，每段 `tm`；**相邻两段必须不同**，服务端会机器自检）',
    PLAN_TM.map((t) => `  · ${t.id}（${t.name}）：${t.look}`).join('\n'),
    '  留空则由服务端按段序轮换七种、并保证相邻不重复（不必自己排）。',
    // ★VF_DAILY_V25（B3）：矩阵实测过了 —— 没有"禁用组合"，所以这里给的是**气质偏好**而不是红线。
    '【皮肤明暗 × 结构（偏好，不是限制）】：',
    '  · 深底皮肤（夜宴金/铜锅炭火/深夜食堂/胶片黑/墨绿松林/酒红宴席）：适合 hero（满幅）、stack2、quote、grid4'
    + ' —— 压得住照片，静物与夜景更出彩；',
    '  · 浅底皮肤（暖纸日报/北欧冷白/江南宣纸/雾蓝书页…）：适合 split（图文左右）、grid3、vertical（竖排）、sticker'
    + ' —— 像报纸/画册，字和图各占一块，读起来最清楚。',
    '  · 实测口径（别当玄学）：4 皮肤 × 8 结构 = 32 组合的标题对比度全都 ≥4.5，且**文字从不压在照片上**'
    + '（结构会自带给文字用的衬带）⇒ 上面只是"更贴气质"的建议，**不会因为搭配而变得不可读**。',
    // ★VF_DAILY_V21（2026-10-14 用户「依然是文字排版同质化严重」）：**文字层**是新旋钮 ——
    //   结构决定"图怎么摆"，文字层决定"字怎么说话"；同一结构配不同文字层 = 完全不同的观感。
    '【文字层】（可选，每段 `type`；**这是"看着像同一套"的主要来源**，请把相邻段配成不同的）：',
    PLAN_TEXT_TYPES.map((t) => `  · ${t.id}（${t.name}）：${t.look}`).join('\n'),
    '  不确定就留空 —— 服务端会按段序自动轮换四种，保证一份里不只有一张脸。',
    '【字号档】（可选，每段 `scale`，只影响**这一段**标题/数字的大小）：' + PLAN_TSCALES.join(' | ')
    + '　（1 = 默认；想强调某段可用 1.15 / 1.3，想让它"退后"用 0.9。信息点字号有 22px 下限，不会变小到看不清）',
    // ★VF_DAILY_V31（2026-10-16 用户定案「开工吧 按你规划来」＝中间档：**骨架不动、把版面自由度交给 AI**）：
    //   摸底时发现引擎里**早就有**两个维度、白名单也一直透传，**只差提示词没告诉 AI 能用它们** ——
    //     ① `form`（图与字的**叠法**）与 `layout`（怎么摆图）是**两条独立的轴**，可以叠加：
    //        引擎侧是 `FORM_IDS[layout] || s.form` ⇒ hero/sticker/vertical 三类锁定同名（写了不生效），
    //        但 **split / grid3 / grid4 / quote 可以再叠 sticker 或 vertical** ⇒ 同一套图、同一版式，另一张脸。
    //     ② `motion`（整片动效档）决定**图推近幅度 + 文字错峰节奏**，三档差别明显。
    //   这两条是"**零代码风险**扩大差异"的机会（引擎已实现、闸门已覆盖，只是没人告诉 AI）。
    // ★VF_DAILY_V31：**文字对齐**（第一个新增的"版面自由度"）—— 它不动元素尺寸，所以最安全；
    //   也是"同一版式两张脸"最省力的手段（同一张图、同一套字，左对齐和右对齐完全两种气质）。
    '【文字对齐】（可选，每段 `align`）：`left`（左，默认最稳）｜`center`（居中，庄重）｜`right`（右，有设计感）。',
    '  · 一句话用法：**一页里有个"主视觉"就居中，想让它像海报/杂志就右对齐**；',
    '  · `stack2`（上下双图）与 `quote`（引文页）**本身居中就是版式特征** ⇒ 这两类别写（写了也不生效）。',
    '【图与字的叠法】（可选，每段 `form`；**它和 layout 是两条独立的轴，可以叠加**）：',
    PLAN_FORMS.map((f) => `  · ${f}（${FORM_LABEL[f] || f}）`).join('\n'),
    '  · `hero` / `sticker` / `vertical` 这**三类已固定同名**（写了也不生效，别浪费字符）；',
    '  · 但 **`split` / `grid3` / `grid4` / `quote` 可以叠加 `sticker`**（字变成贴上去的纸块）'
      + '或 **`vertical`**（字变成竖排条）—— 同一套图、同一版式，观感立刻不一样。',
    '【整片动效档】（顶层 `motion`，整份只有一个）：`calm`（稳，推近小、错峰慢）｜`normal`（正常）｜'
      + '`lively`（活泼，推近大、错峰快）。按素材气质挑：火锅/夜宵/热闹 → lively；茶席/器物/纪实 → calm。',
    // ★VF_DAILY_V22：借 oil-ui 的三条硬口径（去同质化 / 减法 / 首屏），改成我们段落级的说法
    '【去同质化·硬要求】（这条会被服务端**机器自检**，不合格自动错开并如实告知）：',
    '  · **相邻两段的"方向"最多只能共享一项** —— 方向 = ①摆图法(layout) ②文字层(type) ③取景(place) ④字号档(scale)；',
    '  · 说人话：**别连着两段同一个摆图法又同一个文字层**；看着像就换摆图法/文字层，**而不是只换颜色**。',
    '【减法·每段一个焦点】（"每页一个视觉焦点，删掉一切无助于理解的文案、线条和框"）：',
    '  · 每段只讲一件事（一张主图 或 一个大标题），**信息点能少不多**，别为了填满而塞；',
    '【首屏给谁看】（浏览/干活类页面首屏就是内容；**说服类才需要"开场版式"**）：',
    '  · 这份是**展示/说服**用 ⇒ 第 1 段（封面）要有开场版式：一句立得住的标题 + 一张最有力的图，**不要信息堆叠**。',
    // ★VF_DAILY_V32：开关②「皮肤也交给 AI 挑」打开时**解除"必须换一个"的约束** ——
    //   那条约束是老办法（治"两份产物看着像同一套"）；但用户要"AI 按本批素材定设计风格"时，
    //   强行换皮肤反而会挑到不贴素材的那套 ⇒ 这时应该让 AI 纯按气质说话。
    aiPickSkin
      ? (last
        ? `【皮肤：这一次**完全交给你按素材气质挑】** —— 上一次用的是「${themeName(last)}」，`
          + '但**不必刻意避开它**：如果这批素材的气质就是最适合它，直接用（贴素材 > 求不同）。'
        : '（首次做：按素材气质挑即可。）')
      : (last
        ? `⚠️ 上一次你交付用的是「${themeName(last)}」（${last}）—— **这次必须换一个不同的皮肤**，`
          + '否则两份产物看着像同一套（用户原话：「感觉没什么区别」）。除非这批素材的气质明显更适合它。'
        : '（首次做：按素材气质挑即可。）'),
    '  也可以给 `custom` 自定配色（4 个 hex：paper 底 / ink 正文 / dim 次要 / accent 点缀）——',
    '  系统会做对比度体检（正文/底 ≥4.5、次要 ≥3.0、强调 ≥2.0），不达标会自动换回预设皮肤。',
    '',
    // ★VF_DAILY_V25b：**能省就省** —— 用户实测"AI 没吐出可解析的 JSON"，长 JSON 被截断是最常见死因。
    '【省字段能救命】（响应越长越容易被截断，截断 = 整份白做）：',
    '  · **只写 `layout` + `title` + `imgs` 就能出片**；`points` 只在 split / vertical / quote 里有用，别的结构写了也不显示；',
    // ★VF_DAILY_V44（2026-10-17 用户实测「'放手排版'开关也看不出变化」后定案，**提示词自己打架**）：
    //   原来这里**无条件**说「`scale`/`form`/`place`… **都可省**」，而下面 `aiLayout` 段又**硬要求**
    //   "对齐/字号档/叠法/动效里至少三个排出 2 种以上" ⇒ 两句话互相抵消，而 AI 选择听"可省"那句。
    //   实测证据（用户三份真产物 018/038/057）：**`scale` 三份全是空**；038 连 `align` 也全空。
    //   现口径：**开了"放手排版"就不许省 `align` / `scale`** ——
    //   这两项**服务端不会替你轮换**（不像 `type` / `tm` 有 `assignTextLayer` / `assignTextMotion` 兜着），
    //   不写就等于这一维完全没用上，而它恰恰是"同一版式两张脸"最直观的两项。其余字段仍可省。
    //   没开开关时**逐字保持原文**（零回归）。
    aiLayout
      ? '  · ⚠️ **本份例外（用户已开"放手排版"）**：**`align` 与 `scale` 不许省** —— 这两项服务端**不会**'
        + '替你轮换（不像 `type`/`tm`），不写就等于整份没用上它们，而那正是"看着像同一套"的主因之一。'
        + '其余（`stamp`/`kicker`/`type`/`tm`/`font`/`form`/`place`）仍可省。'
      : '  · `scale` / `stamp` / `kicker` / `tm` / `font` / `form` / `place` **都可省**（服务端会补、会轮换）；',
    '  · 省下的字符留给"标题写准"，比堆字段有用得多。',
    // ★VF_DAILY_V32：开关①「让 AI 放手排版」—— 默认那句"相邻两段别撞"是**下限**，
    //   打开后把目标从"别撞"提到"要有明显不同的视觉气质"，并明确点出可以混搭哪几条轴。
    aiLayout
      ? '【★这一份：**放手排版**（用户已打开「让 AI 放手排版」）】\n'
        + '  · 上面那些"相邻不撞"的要求是**下限**，不是目标；**目标是整份看下来有明显不同的视觉气质**。\n'
        + '  · 请**大胆混搭**这些已经存在的维度：`layout`（怎么摆图）× `form`（图与字怎么叠）× `align`（左/中/右）'
        + '× `type`（文字层）× `scale`（字号档）× `tm`（文字动效）。\n'
        + '  · 特别鼓励：同一份里既有"满幅压字"的霸气页、也有"留白很多"的安静页；既有居中、也有右对齐；'
        + '既有大字、也有小字退后的段落。**别让每段都长一个样。**\n'
        // ★VF_DAILY_V33：把"鼓励"升成**硬要求**（用户实测"看不出差别"之后加的）——
        //   注意：这里**不写"会被机器自检"**，因为服务端确实还没做这项自检（不能给假承诺）；
        //   效果靠**卡片上的统计数字**如实呈现（用户自己就能看出 AI 有没有做到）。
        + '  · **硬要求**：「对齐 / 字号档 / 叠法 / 文字动效」这四个维度里，**至少三个**要排出 '
        + '**2 种以上**的不同取值（例：对齐既有左也有中；字号既有 1.3 也有 0.9；动效既有 wipe 也有 rise）。\n'
        + '  · 但**不牺牲可读性**：字号档不要连用两段 0.9（会显得整片没重点），信息点能少不多。'
      : '',
    '硬约束（违反即作废）：',
    '1. **段数是这份片的时长来源**：segments **至少 ' + minSegs + ' 段**、最多 16 段。'
    + '这是**给视频用的** —— 段数多不是问题，**段数少才是缺点**（片长不够、节奏干）。'
    + '**每张图至少用一次**（可重复用）；单段图数必须等于所选结构允许的张数。',
    '1b. **每段以 1~2 张图为主**；`grid3` / `grid4`（3~4 图拼版）整份**各最多用 1 次** ——'
    + '★常见错误：把 6 张图用 2 个拼版段塞完（就 3 段）⇒ 直接判不合格。'
    + '宁可多排几段、每段 1~2 张，也不要"少段 + 大拼版"。',
    '2. 首段当封面（用 hero / sticker / split / vertical 之一），末段建议用 quote 或 hero 收尾。',
    '3. **至少用到 3 种不同 layout，且相邻两段 layout 不能相同**（这是"看起来不重样"的关键）。',
    '4. 每段 title = **两行短句**（每行 ≤12 个汉字），像报纸小标题；不要长句、不要感叹号堆砌。',
    '5. 每段 points 最多 3 组、每组两个短词（各 ≤8 字），如 ["手切现片","立盘不掉"]；**只写你在图里真看到的东西**，不许编门店名/评分/价格/销量。',
    '6. kicker = 段上的小标签（≤20 字，如「后厨 · 手作」）；封面可给 stamp（≤10 字，如「封面故事」）。'
    + ' place 三选一：`"cover"` 图铺满（裁切，适合满幅实拍）｜`"mat"` 铺满+相纸白边｜'
    + '**`"contain"` 整张不裁**（留纸色边）—— ★**白底产品图 / 主体集中 / 主体靠边**的图**要用 contain**，'
    + '别裁掉主体；图文左右(split)与竖排(vertical)段也优先 contain。',
    '7. 简体中文，不用 emoji。',
    // ★VF_DAILYFONT_V1（2026-10-14 用户首次实跑出片被"用字闸门"拦下，而当时的报错看不出是哪个字）：
    //   成片的**画面文字**走**内嵌字体子集**（GB2312 一级常用字，约 3755 字）⇒ 生僻字/异体字/古字
    //   渲染出来是**豆腐块**，整片会被拦。所以**在写文案这一步就要避开** —— 前置约束比事后替换可靠。
    '8. **只用常用字**（GB2312 一级字范围内）：不要用生僻字、异体字、古字（例如 龘 / 犇 / 甪 / 氹 这类），'
      + '也不要自造词。菜名、地名若本身生僻，改用常见写法（例如生僻异体 → 通行简体）。',
    '',
    '【可选·★L3：你自己写某几段的 HTML（想自由发挥就写，不想写就只用 layout）】',
    '在某一段里加 `html`（该段内部片段）与 `css`（该段样式）两个字段即可，引擎会把它们放进这段，'
      + '并用**真浏览器逐段体检**（越界/溢出/字号/文字折行/压图）；**不合格的那一段会自动退回上面的结构模板**（其他段不受影响）。',
    '写 html/css 的硬契约（违反则该段被拒、退回模板）：',
    '  a. 只给**段内**片段，不要 `<html>/<body>/<section>/<style>` 标签、不要 `<script>`、不要任何 on* 事件；',
    '  b. CSS 每条选择器必须以 `.ai{N}-` 或 `.sec[data-seg="{N}"]` 开头（N=段号）——防止污染别段；',
    '  c. 动画只能用 CSS 变量 `--sp`（0→1 段内进度）：如 `transform:translateY(calc(16px*(1 - var(--sp,1))))`；'
      + '禁 JS / Math.random / Date.now / setTimeout / requestAnimationFrame；',
    '  d. 禁外链（http/https、@import、外部字体）；禁 `position:absolute`（排版用 grid/flex/百分比/clamp）；',
    '  e. 容器：外层 section 已有内边距与栅格 ⇒ 你的根元素用 `height:100%;box-sizing:border-box;min-height:0`，'
      + '**别写 100vh**、别给 `.sec[data-seg=N]` 设高度（实测会把整段撑到溢出）；',
    '  f. 颜色用主题变量：`var(--paper)`底 / `var(--ink)`正文 / `var(--dim)`次要 / `var(--rule)`点缀（写死颜色换皮肤时这段不跟着变）；',
    '  g. **竖屏 720×1280 为主**（横屏 1280×720 也要成立，可用 `@media (min-aspect-ratio:1/1)`）；'
      + '主标题 ≥40px、正文/标签 ≥22px；**短标签一律 `white-space:nowrap`**（不许为塞进去而折行/挤压）；'
      + '图片用 `<img src="images/N.jpg">` + `object-fit:cover`。',
    '',
    '只输出 JSON（不要解释、不要 markdown 代码块）：',
    '{"theme":"night-gold","motion":"calm|normal|lively","segments":[{"layout":"hero","type":"poster","scale":1.15,"kicker":"...","stamp":"...","title":["第一行","第二行"],"imgs":[1],"points":[["短词","短词"]],"place":"cover"}]}',
  ].join('\n')
}

/**
 * ★VF_DAIDESIGN_V1（2026-10-17 用户定案「先做阶段1」）：**让 AI 直接产出整页 HTML** ——
 *   "AI 自由档"，与现有"模板档（8 种 layout）"并存。
 *
 * 为什么要有它（用户原话）：「最大问题就是就 8 个框架，你怎么搞也就那样。框架不能放开，怎么改效果也就那样」
 *   —— 用户判断正确：8 种骨架是**闭集**，AI 只能选不能造，感知多样性 ≈ 骨架数量
 *   （实测：骨架池已用满 8 种，两两相似度仍达 43 分、最坏一对 73.7）。
 *
 * 可行性（2026-10-17 本地**端到端实测过**，不是设想）：
 *   按"高级审美 / 风格不限 / 图是主题"写出的页面，经 `adapt-ai-page.mjs` 做 3 条机械转换
 *   （图路径归一 / 字体名 → 自造名 / 注入 @font-face），**不改 AI 一个排版动效**，
 *   即可过四道闸门并渲出成片（9 段 41s / 20.8MB）。
 *   ⇒ 风险不在"能不能出片"，而在"AI 输出稳不稳" ⇒ 靠上层**失败重写循环**兜住。
 *
 * ⚠️ 提示词里只放**出片契约**（引擎/闸门的硬要求），**其余（配色/版式/动效创意）全部放开** ——
 *    这正是用户要的"没有条条框框"：框只框"能不能拍成视频"，不框"长什么样"。
 *
 * @param n 素材张数（页面里用 1.jpg ~ n.jpg）
 * @param topic 主题（可为空）
 * @param opts.failNote 上一版没过闸门时的报错（重写循环用；只让它改相关处）
 */
export function aiDesignPrompt(n: number, topic: string, opts?: { failNote?: string }): string {
  const fail = String(opts?.failNote || '').trim()
  return [
    '你是顶级视觉设计师兼前端工程师。请交付**一条竖屏 9:16 视频的页面**（720×1280），它会被**逐帧渲染成 mp4**（不是给人滚动浏览的网页）。',
    '素材是用户提供的 ' + n + ' 张实拍照片，文件名 1.jpg ~ ' + n + '.jpg（与 HTML 同目录）。主题：「' + (topic || '（未给，按素材自己判断）') + '」。',
    '**风格、版式、布局、动效创意完全由你决定**；只遵守下面「出片契约」。',
    '',
    '【出片契约 · 违反即返工】',
    '1) 页面按**时间播放**，不是滚动浏览：',
    '   · 禁止 IntersectionObserver / scroll 事件 / window.scrollY / requestAnimationFrame；',
    '   · 用若干 <section class="sec" data-start="秒" data-duration="秒"> 组成，总时长 **30~45 秒**，**首帧不能空白**；',
    '   · 必须**原样照抄**下面这段（唯一接口，别自己发明）：',
    '     <script>',
    '     window.__seek = function (t) {',
    '       document.querySelectorAll(".sec").forEach(function (sec) {',
    '         var s = Number(sec.dataset.start) || 0, d = Number(sec.dataset.duration) || 3;',
    '         sec.style.setProperty("--p", String(Math.min(1, Math.max(0, (t - s) / d))));',
    '       });',
    '     };',
    '     window.__seek(0);',
    '     </script>',
    '   · **所有动效都读 `var(--p)`**（0=刚入场，1=完全就位）。例：',
    '     opacity: clamp(0, calc(var(--p) * 3), 1); transform: translateY(calc((1 - clamp(0, calc(var(--p) * 3), 1)) * 34px));',
    '     逐行错峰就用位移：calc((var(--p) - 0.15) * 4)、0.30、0.45 …（后一行晚进场）',
    '2) **零外部资源**：禁止任何 http(s):// 引用；**禁止 Google Fonts 家族名**（Noto Serif SC / Noto Sans SC 会被渲染器整份拉取，直接爆内存）；',
    '   字体只许用这两个**占位族名**（我们随后替换成内嵌字体）：',
    '   :root { --font-serif: "TXT-Serif", serif; --font-sans: "TXT-Sans", sans-serif; }',
    '3) **能被拍成视频（排版安全）**：',
    '   · 画布 720×1280；安全区左右 56px、上下 96px（字幕会压下方，字别出去）；',
    '   · **一段 = 一件事**，每段图片 ≤4 张（单图 / 双联 / 三联 / 四宫格 / 错落双图都行）；',
    '   · 字号（视频会压缩，宁大不小）：主标题 **56~88px**、副题 22~30px、标签 ≥16px；标题每行 ≤14 字、最多 2 行；',
    '   · **文字对底色对比度 ≥4.5:1**；文字压在照片上时**必须加暗场/渐变遮罩（≥60% 不透明）**，',
    '     且**遮罩浓度要跟着素材明暗走** —— 素材本身很暗（夜景 / 树影 / 石雕）时遮罩要**减淡**，别把图吃掉；',
    '   · 禁止：emoji 当图标、紫蓝默认配色、圆角卡片阵列、渐变玻璃卡、无意义装饰球/星星、英文填充文案、编造数据。',
    '',
    '【内容要求】',
    '· ' + n + ' 张图**全部用上**（可重复）；',
    '· **图是主题**：文案只写画面里真看到的东西（主体 / 场景 / 质感 / 氛围），**不许套用别的题材**，不许编造门店名 / 评分 / 价格 / 销量 / 功效；',
    '· 文案克制、具体、有画面感；不用"惊艳味蕾""舌尖上的"这类套话。',
    '',
    '【完全自由】配色（黑金 / 宣纸墨 / 莫兰迪 / 撞色…）、版式（中轴对称 / 错位拼贴 / 自由网格 / 杂志分栏 / 竖排标题 / 大留白）、动效创意、段落节奏 —— 任你发挥。',
    '⚠️ 上面那些契约**只框"技术上能不能拍成视频"**（时间轴 / 零外链 / 安全区 / 字号 / 对比度）；',
    '   **不框长什么样**。请**不要收敛成"安全模板"** —— 越不像通用模板越好。',
    '',
    '【素材少的时候（很重要，用户特别关心这条）】',
    '· 素材少于 8 张时：**不要为了凑段数把同一张图反复用**；改用「**文字主导段**」撑结构 ——',
    '  大标题页 / 金句页 / 清单页（3~5 条要点）/ 数字页 / 收尾页；图片只在关键处出现。',
    '· 单张图最多重复 2 次，且**不要连续两段用同一张**；',
    '· 段数按"内容撑得住"定，**宁少不空**（总时长仍控制在 30~45 秒；文字页可以把节奏放慢，',
    '  用逐行浮现/错位进场撑住时间，不要靠同图重复填时长）。',
    '· 反过来，素材多（≥12 张）时也别硬塞每段 4 张 —— 一屏一件事，多出来的图用来做"细节特写页"。',
    '',
    fail ? ('【上一版没过闸门，请**只修相关处**，其余保持】\n' + fail + '\n') : '',
    '【输出】只输出一个完整 HTML 文件（<!DOCTYPE html> 到 </html>），CSS/JS 全部内联；不要解释、不要 markdown 围栏。',
  ].filter(Boolean).join('\n')
}

/* ═════════ ★VF_DAILYVOICE_V1（2026-10-14 用户定案「TTS 按你的 AI 写口播」「不要一次来和视频做，
   分 2 步，因为可能文案和时间戳字幕需要修改」）═════════
   为什么**必须分两步**：口播稿是**字幕 + 段时长**的唯一真相源（audio-first：段时长由配音**实测**时长决定，
   不靠字数猜），而它极可能需要人改（念着不顺 / 太书面 / 想让某段别说话）⇒ **先给人看、可改，再合成**。
   与成片线同源：产物形式沿用 `{ voice: [逐段一句] }` —— 这正是 `film-voice.mjs` 的旁白文件格式
   ⇒ 那条线验证过的方法论（逐段 TTS → 实测时长回填时间轴 → SRT → 渲染 → 混音烧字幕）可以照搬。 */
/** 每段口播字数上限（约 5 秒）。为什么必须有：口播长度**决定段时长**，
 *  一段写 60 字会把整片拖成"一段十几秒"，观感直接垮。超了**截断并如实记进 fixes**。 */
export const VOICE_MAX_CHARS = 22
/** 估算时长（秒）= 4.5 字/秒 —— 与成片线老口径一致。
 *  ⚠️ **只用于卡片上给个参考**；真正时长一律以 TTS 实测为准（本项目写死的纪律，别拿估算值去排时间轴）。 */
export function estimateSec(text: string): number {
  const n = [...String(text || '').replace(/\s/g, '')].length
  return n ? Math.max(1.2, Math.round((n / 4.5) * 10) / 10) : 0
}
/** 逐段口播提示词（纯函数 ⇒ 可单测；写法要点全在这段字符串里，改口径只改这里） */
export function voicePrompt(segs: any[], captions: string, topic = '', offset = 0): string {
  const list = Array.isArray(segs) ? segs : []
  const rows = list.map((s: any, i: number) => {
    const title = (Array.isArray(s?.title) ? s.title : [s?.title])
      .map((x: any) => String(x == null ? '' : x)).filter(Boolean).join(' / ')
    const pts = (Array.isArray(s?.points) ? s.points : [])
      .map((p: any) => (Array.isArray(p) ? p.filter(Boolean).join('·') : String(p))).filter(Boolean).join('、')
    return '  段' + (offset + i + 1) + '：画面字「' + title + '」' + (pts ? ' ＋ 信息点「' + pts + '」' : '')
  }).join('\n')
  return [
    '你在给一条**竖屏短视频**写**口播旁白**（这份片叫「日报落地页」，主题：' + (topic || '未指定') + '）。',
    '',
    '【每一段的画面】',
    rows,
    captions ? '\n【这些图实际拍的是什么（视觉模型逐张读出 —— **写旁白必须据此，不许编造**）】\n' + captions : '',
    '',
    '【怎么写】',
    '1. **一段一句**，共 ' + list.length + ' 句，顺序与上面完全一致；',
    '2. 每句 **不超过 ' + VOICE_MAX_CHARS + ' 个汉字**（硬上限：一句话的长短**决定这一段有多长**）；',
    '3. 像**旁边有人随口介绍**，用口语、别用书面语（不要"本店""致力于""为广大食客"这类词）；',
    '4. **不要复读画面上的字** —— 画面已经有标题和信息点了，旁白要**补充**它没说的（口感 / 场景 / 做法 / 氛围）；',
    '5. **只说你从图里真看到的**，不许编门店名 / 评分 / 价格 / 销量 / 历史；',
    '6. 简体中文、**不用 emoji**、不要感叹号堆砌、句尾不必都写句号；',
    // ⚠️ 别写"某段写空字符串"！2026-10-14 用户实测：模型（qwen3.8-flash）很可能把这句读成
    //    "整条留空" ⇒ 直接回一个**空响应**（三级链路全空、稳定复现）。改成让它写一个短横线当静音标记。
    '7. 某段实在没什么可说 ⇒ 这一句就写一个**短横线** -（表示那一段不配音），最多 2 段可以这样。',
    '',
    '只输出 JSON（不要解释、不要 markdown 代码块）：',
    '{"voice":["第一段的口播","第二段的口播","……"]}',
    '⚠️ voice 数组**必须逐段给全**（本批 ' + list.length + ' 条），**不要整个留空、不要只给一条**。',
  ].join('\n')
}

/** ★VF_DAILYVOICE_V1c：**极简版**（第 2 次尝试用）—— 规则 / 看图摘要 / 格式说明全砍掉，
 *  只留"给这几段各写一句"。已排除的假设越多，越该把变量降到最少。
 *  （上一版第 2 次只是把同一段长 prompt 又说一遍 ⇒ **等于没换变量**，别重犯。） */
export function voicePromptStrict(segs: any[], captions: string, offset = 0): string {
  const list = Array.isArray(segs) ? segs : []
  return '给下面这几段文案，各写一句口播旁白（每句 ' + VOICE_MAX_CHARS + ' 字以内，口语，别重复画面上的字）。\n'
    + list.map((s: any, i: number) => {
      const t = (Array.isArray(s?.title) ? s.title : [s?.title])
        .map((x: any) => String(x == null ? '' : x)).filter(Boolean).join(' / ')
      return (offset + i + 1) + '. ' + t
    }).join('\n')
    + (captions ? '\n这些图实际拍的是：\n' + String(captions).slice(0, 600) : '')
    + '\n\n只回一个 JSON 对象：{"voice":["第1句","第2句"]} —— 必须给全 ' + list.length + ' 条，不要留空。'
}
/**
 * ★VF_DAILYVOICE_V6（2026-10-16 用户定案「6」：配音稿"换一单就失效"）：**画面指纹** ——
 * 用来判断"这份口播还算不算数"。
 * 病灶：口播稿的暂存键原来是**单文件版文件名**（每次重新生成都不同）⇒ 用户改了半天口播、
 *   回去微调一下版式重新生成 ⇒ 口播**全丢**，得重写一遍。
 * 现口径：指纹由**各段画面字 + 段数**算出来，**服务端算出后随卡片下发**（前端不自己算 ⇒ 零漂移），
 *   前端拿它当"本机暂存"的键、服务端拿它判"旧口播还能不能沿用"：
 *   · 画面字**没变**（只改了版式 / 字号 / 动效 / 配色）⇒ 指纹相同 ⇒ **口播自动沿用**（这正是要的效果）；
 *   · 画面字**变了**（改了标题 / 信息点 / 换了段）⇒ 指纹不同 ⇒ 旧口播**自动作废** ⇒
 *     **绝不会把上一版的口播错配到新画面上**（那比丢稿更糟：念的和看的不是一回事）。
 * ⚠️ **只看 title 是有意的**：口播的职责是"补充画面没说的"，画面标题就是它的对照物；
 *   若把 layout / scale 也算进来，那"只换个版式"就会丢掉全部口播 —— 恰恰是本条要修的痛点。
 */
export function voiceKeyOf(segs: any[]): string {
  const list = Array.isArray(segs) ? segs : []
  const s = list.map((x: any) => (Array.isArray(x?.title) ? x.title : [x?.title])
    .map((t: any) => String(t == null ? '' : t)).filter(Boolean).join('/')).join('|')
  const raw = s + '#' + list.length
  let h = 2166136261
  for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 16777619) }
  return 'v' + list.length + '-' + (h >>> 0).toString(36)
}

/** ★VF_DAILYVOICE_V1：**配音稿卡**（第 4 步）payload —— 每段一行、可改、可静音，末尾给"开始合成"。
 *  ⚠️ 卡片上给的是**估算**时长，且必须写明"以实际配音为准"——
 *     本项目纪律：时间轴的真值只能来自 TTS 实测（估算值只配用来给人一个量级感）。 */
export function buildVoiceCardPayload(o: {
  segs: any[]; lines: string[]; fixes?: string[]; theme?: string; by?: PlanBy
  name: string; note?: string; sawImages?: boolean; topic?: string
  /** ★VF_DAILYVOICE_V4（2026-10-15 用户「改了半天口播、刷新一下就白改」）：
   *  **草稿里上次提交过的口播** —— 卡片初始化时优先用它回填（其次才是本机暂存、最后是 AI 原稿）。
   *  为什么不能只靠前端暂存：换设备 / 换浏览器 / 清缓存就没了；草稿是跨设备的那一份。 */
  saved?: string[]
}): any {
  const segs = Array.isArray(o.segs) ? o.segs : []
  const lines = Array.isArray(o.lines) ? o.lines : []
  const rows = segs.map((s: any, i: number) => {
    const title = (Array.isArray(s?.title) ? s.title : [s?.title])
      .map((x: any) => String(x == null ? '' : x)).filter(Boolean).join(' / ')
    const text = String(lines[i] || '')
    return { i: i + 1, layout: String(s?.layout || ''), title, text, est: estimateSec(text) }
  })
  // 总时长估算 = 各段口播估时 + 每段 0.5s 尾巴（与 film-voice 的 gap 同口径）
  const totalEst = Math.round(rows.reduce((a, r) => a + (r.est || 0) + 0.5, 0) * 10) / 10
  const emptyN = rows.filter((r) => !r.text).length
  return {
    step: 'daily_voice',
    proto: 'VF_DAILY_FORM',
    hint: '第 4 步 / 共 5 步 · **配音稿**（先看文案；念着不顺就改，改完才合成）',
    name: o.name,
    rows,
    totalEst,
    emptyN,
    maxChars: VOICE_MAX_CHARS,
    fixes: o.fixes || [],
    note: o.note || '',
    sawImages: !!o.sawImages,
    topic: String(o.topic || ''),
    // ★VF_DAILYVOICE_V6：当前方案的**画面指纹** —— 前端拿它当本机暂存的键、服务端拿它判旧口播能否沿用
    voiceKey: voiceKeyOf(segs),
    // ★VF_DAILYVOICE_V4：上次提交过的口播（跨设备恢复用；长度与段数不符时前端会忽略它）
    saved: Array.isArray(o.saved) && o.saved.length === rows.length ? o.saved.map((x) => String(x == null ? '' : x)) : [],
    theme: themeName(o.theme),
    by: byLabel(o.by),
  }
}

/** ★VF_DAILYVOICE_V1b（2026-10-14 用户实测「口播没写出来：AI 没吐出可解析的 JSON：空响应」）：
 *  **按行兜底** —— 模型经常**无视"只回 JSON"的要求、直接一行一句**（成片线的 plan 也踩过同类）。
 *  所以 JSON 解析失败之后，再把它当"逐行口播"抽一次：抽得到就不算失败。
 *  口径：① 去行首序号/项目符号；② 去成对引号；③ **剔掉 JSON 外壳行**（{ } [ ] 与 "voice": 那类）；
 *  ④ 剩下至少 2 行"像人话"（≥2 字且不含结构字符）才认 —— **宁可不认，也不把一坨乱码当口播**。 */
export function parseVoiceLines(txt: string): string[] | null {
  const rows = String(txt || '').split(/\r?\n/)
    .map((s) => s.replace(/^\s*(?:[-*•·]|\d+\s*[.)、:：])\s*/, '').trim())
    .map((s) => s.replace(/^["'「『]\s*|\s*["'」』]$/g, '').replace(/[,，]\s*$/, '').trim())
    .filter(Boolean)
    .filter((s) => !/^[\[{]/.test(s) && !/^["']?voice["']?\s*[:：]/i.test(s) && !/^[\]}]/.test(s))
  const good = rows.filter((s) => [...s].length >= 2 && !/[{}\[\]]/.test(s))
  return good.length >= 2 ? good : null
}

/** 规整模型返回的口播：**逐段一句、按上限截断、去 emoji/换行**（纯函数 ⇒ 可单测）
 *  口径：缺段补空、多段丢弃、超长截断 —— **一律如实记进 fixes**，绝不静默改。 */
export function normVoiceLines(raw: any, n: number): { lines: string[]; fixes: string[] } {
  const fixes: string[] = []
  const src = Array.isArray(raw?.voice) ? raw.voice : (Array.isArray(raw) ? raw : [])
  const lines: string[] = src
    .map((x: any) => String(x == null ? '' : x))
    .map((s: string) => s.replace(/[\r\n]+/g, ' ')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim())
    // ★VF_DAILYVOICE_V1c：**静音标记归一**成空串 —— 提示词里让模型"没什么可说就写个短横线"，
    //   但模型可能写成 — – 无 / 等等 ⇒ 这里统一收口（否则那些符号会被当成口播念出来）。
    .map((s: string) => (/^[-—–ー~]+$/.test(s) || s === '无' || s === '/' || s === '略' ? '' : s))
  while (lines.length < n) lines.push('')
  if (lines.length > n) {
    fixes.push('口播多出 ' + (lines.length - n) + ' 句（已丢弃）')
    lines.length = n
  }
  lines.forEach((s, i) => {
    const chars = [...s]
    if (chars.length > VOICE_MAX_CHARS) {
      lines[i] = chars.slice(0, VOICE_MAX_CHARS).join('')
      fixes.push('段' + (i + 1) + ' 口播 ' + chars.length + ' 字超上限 ' + VOICE_MAX_CHARS + ' ⇒ 已截断')
    }
  })
  const emptyN = lines.filter((s) => !s).length
  if (emptyN > 2) fixes.push('有 ' + emptyN + ' 段口播为空（静音上限 2 段）—— 合成时会按画面文字兜底念')
  return { lines, fixes }
}

/** 规整动效档（引擎只认这三档） */
export function normMotion(v: any): string {
  const s = String(v || '')
  return ['calm', 'normal', 'lively'].indexOf(s) >= 0 ? s : 'normal'
}

/**
 * 规整 AI 输出的段：把不合法字段**就地清掉/截断**（不静默丢整段，也不把违规值喂给引擎）。
 * · imgs 取 1..n 的整数、段内去重、单段最多 2 张；没图的段丢掉；
 * · 首段强制 cover（补封面角标）、末段强制 end；
 * · title ≤2 行 × ≤12 字；points ≤3 组 × 每项 ≤8 字；form/place 走白名单；
 * · **覆盖面兜底**：AI 漏掉的图各自补一段（宁可多一段，也不让用户挑的素材白挑）。
 * 段数上限 10（引擎是保底模板，段太多会拖时长）。
 */
export function normSegs(raw: any, n: number, topic: string): { segs: any[]; added: number; fixes: string[] } {
  const list = Array.isArray(raw?.segments) ? raw.segments : (Array.isArray(raw) ? raw : [])
  const out: any[] = []
  const fixes: string[] = []
  for (const it of list) {
    if (!it || typeof it !== 'object') continue
    // ★L2：单段最多 4 张图（grid4），越界/重复的先清掉
    const imgs = Array.from(new Set((Array.isArray(it.imgs) ? it.imgs : [])
      .map((x: any) => parseInt(x, 10))
      .filter((x: number) => x >= 1 && x <= n))).slice(0, 4)
    if (!imgs.length) continue
    const k0 = String(it.kind || '')
    const kind = ['cover', 'feature', 'end'].indexOf(k0) >= 0 ? k0 : 'feature'
    let title = (Array.isArray(it.title) ? it.title : [it.title]).map((x: any) => clip(x, 12)).filter(Boolean).slice(0, 2)
    if (!title.length) title = ['现场记录', `${out.length + 1} / ${n}`]
    const pts = (Array.isArray(it.points) ? it.points : [])
      .map((p: any) => (Array.isArray(p) ? [clip(p[0], 8), clip(p[1], 8)] : [clip(p, 8), '']))
      .filter((p: string[]) => !!p[0]).slice(0, 3)
    // ★L2：结构白名单 + **图数必须匹配** —— 不合规就换成"按图数最合适"的那个（不静默丢整段）
    const want = String(it.layout || '')
    const meta = PLAN_LAYOUTS.filter((x) => x.id === want)[0]
    let layout = ''
    if (meta && imgs.length >= meta.minImg && imgs.length <= meta.maxImg) {
      layout = meta.id
    } else {
      layout = layoutForCount(imgs.length)
      if (want) fixes.push(`段${out.length + 1}：AI 要「${meta ? meta.name : want}」但给了 ${imgs.length} 张图 ⇒ 改用「${(PLAN_LAYOUTS.filter((x) => x.id === layout)[0] || {}).name}」`)
      else fixes.push(`段${out.length + 1}：AI 没给结构 ⇒ 按 ${imgs.length} 张图用「${(PLAN_LAYOUTS.filter((x) => x.id === layout)[0] || {}).name}」`)
    }
    const form = ['hero', 'sticker', 'vertical'].indexOf(layout) >= 0
      ? (layout === 'hero' ? 'overlay' : layout)
      : (PLAN_FORMS.indexOf(String(it.form)) >= 0 ? String(it.form) : 'overlay')
    const place = PLAN_PLACES.indexOf(String(it.place)) >= 0 ? String(it.place) : 'cover'
    // ★V15（闸门②的"按构造消除"）：**空信息点的图文左右/竖排段 = 必然出现死空档**（用户截图那幅就是）。
    //   这里不硬塞假信息点，直接换成"贴纸标题"（单图居中，没有空列）——空档就不存在了，且如实记进 fixes。
    if (!pts.length && (layout === 'split' || layout === 'vertical')) {
      const oldN = (PLAN_LAYOUTS.filter((x) => x.id === layout)[0] || {}).name || layout
      layout = 'sticker'
      fixes.push(`段${out.length + 1}：「${oldN}」没有信息点 ⇒ 换「贴纸标题」（避免大片空档）`)
    }
    // ★L3：可选的"AI 自写段"（html/css）—— 只做体积截断，**合法性交给引擎的静态沙箱 + 真浏览器校验**
    const o: any = {
      kind, layout, form,
      kicker: clip(it.kicker, 20) || `日报 · ${topic || '素材记录'}`,
      stamp: kind === 'cover' ? clip(it.stamp, 10) : '',
      title, imgs, points: pts, place,
    }
    // ★V21：文字层与字号档 —— 白名单收口（AI 写错/写别的字眼 ⇒ 当没写，交给 assignTextLayer 兜底轮换）
    const ty = String(it.type || '').trim().toLowerCase()
    if (PLAN_TEXT_TYPES.some((x) => x.id === ty)) o.type = ty
    const sc = Number(it.scale)
    if (PLAN_TSCALES.some((x) => Math.abs(x - sc) < 0.001)) o.scale = sc
    // ★VF_DAILY_V31：文字对齐（白名单收口 —— AI 写别的字眼 ⇒ **当没写**，由引擎按版式默认走）
    const ag = String(it.align || '').trim().toLowerCase()
    if (PLAN_ALIGNS.indexOf(ag) >= 0) o.align = ag
    // ★V25：文字动效（AI 可给；白名单收口；没给则由 assignTextMotion 按种子轮换并保证相邻不同）
    const tmv = String(it.tm || '').trim().toLowerCase()
    if (PLAN_TM.some((x) => x.id === tmv)) o.tm = tmv
    if (typeof it.html === 'string' && it.html.trim()) {
      o.html = it.html.slice(0, 6000)
      if (typeof it.css === 'string' && it.css.trim()) o.css = it.css.slice(0, 6000)
    }
    out.push(o)
  }
  if (!out.length) return { segs: [], added: 0, fixes }
  // ⚠️ 先补漏图、**最后**才钉首尾 —— 顺序反了会出事：只有 1 段时 out[0] 先被设成 cover、
  //    紧接着"末段=end"又把它改成 end（单段方案首尾同段，首段必须是封面）。
  const used = new Set<number>()
  out.forEach((s) => (s.imgs || []).forEach((x: number) => used.add(x)))
  let added = 0
  for (let k = 1; k <= n && out.length < 10; k++) {
    if (used.has(k)) continue
    out.push({
      kind: 'feature', layout: 'hero', kicker: `日报 · ${topic || '素材记录'}`, stamp: '',
      title: ['现场一张', `${k} / ${n}`], imgs: [k], points: [], form: 'overlay', place: 'cover',
    })
    added++
  }
  // ★L2：**保证"看起来不重样"** —— 若整份只有 1~2 种结构，就把"单图段"按序轮换成不同结构。
  //   为什么在服务端做：AI 有时整份只给 hero（本地实测过），那样用户看到的就是"又一个同款"。
  const ROT = ['hero', 'sticker', 'vertical', 'split']
  const distinct = new Set(out.map((s) => String(s.layout)))
  if (distinct.size < 3 && out.length >= 3) {
    let r = 0
    for (let i = 0; i < out.length; i++) {
      const s = out[i]
      if ((s.imgs || []).length !== 1) continue
      let pk = ROT[r % ROT.length]
      r++
      if (i > 0 && String(out[i - 1].layout) === pk) { pk = ROT[r % ROT.length]; r++ }
      if (String(s.layout) !== pk) {
        s.layout = pk
        s.form = pk === 'hero' ? 'overlay' : pk
        distinct.add(pk)
      }
    }
    if (distinct.size >= 3) fixes.push('整份结构太单一 ⇒ 已把单图段轮换成不同结构（' + [...distinct].join(' / ') + '）')
  }
  out[0].kind = 'cover'
  out[0].stamp = out[0].stamp || '封面故事'
  if (out.length > 1) out[out.length - 1].kind = 'end'
  // ★VF_DAILY_V11：段数不够就**如实写进 fixes**（卡头会显示）—— 不闷着，
  //   也不硬塞"补段"（补出来的是空壳，反而更难看）：让用户一眼知道"这份片长偏短，可以重排"。
  const minSegs = Math.min(16, Math.max(6, Math.ceil(n * 1.5)))
  if (out.length < minSegs) {
    fixes.push(`AI 只排了 ${out.length} 段（${n} 张素材，期望 ≥${minSegs} 段）⇒ 这份片长会偏短，可回「重选」重排`)
  }
  return { segs: out, added, fixes }
}

/**
 * ★VF_DAILY_V12（2026-10-13 用户实测「⚠️ AI 这轮没排出方案…好像 AI 没排字，但还是做出来了」）：
 *   **看图摘要兜底** —— 文字模型超时 / 吐不出 JSON 时，拿**视觉模型逐图读出来的内容**直接排一份
 *   **有真内容**的方案（标题与信息点都来自"图里真看到了什么"），不再退回
 *   "现场记录 N / N" 那种空壳占位（用户一眼就看出"AI 没排字"）。
 *   纯函数（零依赖、可单测）＋确定性（同一份摘要 ⇒ 同一份方案，出片可复现）。
 *   摘要格式（aiPlanSegments 里就是这么要求的）：第一行总述；之后逐行 `N. 这张拍的是什么`。
 */
export function planFromCaptions(captions: string, n: number, topic = ''): { segments: any[]; used: number } {
  const lines = String(captions || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  let head = ''
  const caps: Record<number, string> = {}
  for (const ln of lines) {
    const m = /^(\d{1,2})\s*[.、)．:：]\s*(.+)$/.exec(ln)
    if (m) {
      const k = parseInt(m[1], 10)
      if (k >= 1 && k <= 60 && !caps[k]) caps[k] = clip(m[2], 24)
    } else if (!head) head = clip(ln, 24)
  }
  const kicker = clip(topic || head || '实拍记录', 20)
  const minSegs = Math.min(16, Math.max(6, Math.ceil(n * 1.5)))
  const total = Math.min(16, Math.max(minSegs, n))
  const ROT = ['hero', 'vertical', 'split', 'sticker']
  const segments: any[] = []
  for (let i = 0; i < total; i++) {
    const img = (i % Math.max(1, n)) + 1                 // 素材不够就循环用；相邻两段的图号必然不同
    const cap = caps[img] || `第 ${img} 张`
    const parts = cap.split(/[，,、·／/｜|；;：:\s]+/).filter(Boolean)
    const t1 = clip(parts[0] || cap, 10)
    const t2 = clip(parts.slice(1).join(''), 10) || clip(head || '实拍记录', 10)
    const pts: string[][] = []
    if (parts.length >= 2) pts.push([clip(parts[0], 8), clip(parts[1], 8)])
    if (parts.length >= 3) pts.push([clip(parts[2], 8), ''])
    const layout = ROT[i % ROT.length]
    segments.push({
      kind: i === 0 ? 'cover' : (i === total - 1 ? 'end' : 'feature'),
      layout,
      form: layout === 'hero' ? 'overlay' : layout,
      kicker, stamp: i === 0 ? '封面故事' : '',
      title: [t1, t2], imgs: [img],
      points: pts.filter((p) => p[0]),
      // ★V12：兜底件一律 **contain**（整张不裁）—— 宁可留纸色边，也不把主体裁掉（这是"AI 没看成图"时的保命口径）
      place: 'contain',
    })
  }
  return { segments, used: Object.keys(caps).length }
}

/**
 * ★VF_DAILY_V13（2026-10-13 用户：「我要的是**效果和多样性，低相似度**」）：
 *   把"多样性"做成**可判定 + 可自愈**的三件套（纯函数、可单测）：
 *     ① 效果序由服务端排（进计划 ⇒ 引擎照用，且能参与指纹）；
 *     ② 给每份产物算**指纹**（皮肤 + 结构序 + 效果序）；
 *     ③ 与**上一份**比相似度，太像就**重掷**（换效果序 / 换单图段结构 / 换皮肤），并如实告知。
 */
export const DAILY_FX = ['zout', 'zin', 'pan', 'wipe', 'slats', 'blinds', 'mosaic']
/**
 * ★VF_DAILY_V19（2026-10-13 用户定案「这个（切分型）不能大范围使用哦，10 个里面有一个就行。
 *   这一半都这样，视频最后做出来会很不好看」）：
 *   **效果分两组 + 名额制**：
 *     · 安静组 `zout/zin/pan`（回拉/推近/横移）—— 承担绝大多数段，观感稳、出片不花；
 *     · 切分型 `slats/blinds/mosaic`（条分/百叶/拼片）—— 成片里是"一块块往上贴"，
 *       ⇒ **整片最多 1 次**，且只允许落在**封面（第 1 段）或收尾（最后一段）**；段数 < 6 一次都不用。
 *   `offset` 仍是"每份不同"的种子：同一 offset 结果可复现（供相似度自检与重掷）。
 */
/**
 * ★VF_DAILY_V22（2026-10-14 用户定案「按 A 升级」—— 借鉴 oil-ui 的**去同质化硬规则**）：
 *   oil-ui（开源 UI 设计 Skill，1.4k⭐）把"看着像同一套"写成了一条**可判定**的规则：
 *   > 版式 / 字体 / 颜色 / 关键图像 —— 四个里，**任意两个方向最多只能共享一项**；
 *   > 预览并排摆，眯眼看明暗块面，**像就改版式，而不是只换颜色**。
 *   我们的对应物（每段一个"方向"四元组）：
 *     ① 摆图法 `layout`（8 种）  ② 字的说话方式 `type`（4 种）
 *     ③ 取景 `place`（cover 满幅 / mat 相纸边）  ④ 字的体量 `scale`（4 档）
 *   判据（相邻段最影响"像不像同一套"，所以先管相邻）：**相邻两段最多共享 1 项**。
 *   不满足 ⇒ `fixDiversity()` 从"最不易伤版面"的旋钮开始换（type → scale → place → layout），
 *   换到满足为止；换不动的如实报出（不硬凑、不静默）。
 */
export function segDirection(s: any): { layout: string; type: string; place: string; scale: string } {
  return {
    layout: String(s?.layout || 'hero'),
    type: String(s?.type || 'band'),
    place: String(s?.place || 'cover'),
    scale: String(Number(s?.scale) || 1),
  }
}
/** 两段共享了几项（0~4）—— 越小越"不像同一套" */
export function sharedDims(a: any, b: any): number {
  const x = segDirection(a)
  const y = segDirection(b)
  let n = 0
  if (x.layout === y.layout) n++
  if (x.type === y.type) n++
  if (x.place === y.place) n++
  if (x.scale === y.scale) n++
  return n
}
/** 全片自检：相邻段共享 ≤ maxShare（默认 1）；distinct = 全片出现过多少种"方向组合" */
export function checkDiversity(segs: any[], maxShare = 1): { ok: boolean; bad: Array<{ i: number; share: number }>; distinct: number; want: number } {
  const list = Array.isArray(segs) ? segs : []
  const bad: Array<{ i: number; share: number }> = []
  for (let i = 1; i < list.length; i++) {
    const sh = sharedDims(list[i - 1], list[i])
    if (sh > maxShare) bad.push({ i, share: sh })
  }
  const tuples = new Set(list.map((s) => {
    const d = segDirection(s)
    return d.layout + '|' + d.type + '|' + d.place + '|' + d.scale
  }))
  return { ok: !bad.length, bad, distinct: tuples.size, want: Math.min(8, Math.max(1, list.length)) }
}
/**
 * 就地校正（可单测）：对每个冲突段，按 **type → scale → place → layout** 的顺序试，
 * 取第一个"两侧都不冲突"的取值。layout 受图数约束，所以放最后、且用 `layoutForCount` 保证合法。
 * 返回：改了哪些（供如实报给用户），以及还剩几处没救（不硬凑）。
 */
export function fixDiversity(segs: any[], maxShare = 1): { fixed: number; left: number; msgs: string[] } {
  const list = Array.isArray(segs) ? segs : []
  const msgs: string[] = []
  let fixed = 0
  const okWith = (idx: number) => {
    const prev = idx > 0 ? sharedDims(list[idx - 1], list[idx]) : 0
    const next = idx + 1 < list.length ? sharedDims(list[idx], list[idx + 1]) : 0
    return prev <= maxShare && next <= maxShare
  }
  const types = PLAN_TEXT_TYPES.map((t) => t.id)
  const places = ['cover', 'mat']                       // 不动 contain（那是"整张不裁"的语义）
  const scales = PLAN_TSCALES.map((x) => String(x))
  const now = (s: any) => `段${list.indexOf(s) + 1}`
  // ⚠️ 踩过的坑：第一版"一次只拧一个旋钮"，遇到**相邻两段完全一样**时三个旋钮单独拧都不够
  //   （共享仍是 3），于是"救不动"。现口径：**枚举 类型×字号×取景 的组合（4×4×2=32）**，
  //   取"改动项数最少且能让两侧都不撞"的那个组合 ⇒ 一次就把方向岔开，且尽量少动（保持设计意图）。
  for (let i = 1; i < list.length; i++) {
    if (sharedDims(list[i - 1], list[i]) <= maxShare) continue
    const s = list[i]
    const base = segDirection(s)
    const typeOpts = [base.type, ...types.filter((x) => x !== base.type)]
    const scaleOpts = [base.scale, ...scales.filter((x) => x !== base.scale)]
    const placeOpts = places.indexOf(base.place) >= 0 ? [base.place, ...places.filter((x) => x !== base.place)] : places
    let best: { t: string; sc: string; pl: string; cost: number } | null = null
    for (const t of typeOpts) {
      for (const sc of scaleOpts) {
        for (const pl of placeOpts) {
          const cost = (t !== base.type ? 1 : 0) + (sc !== base.scale ? 1 : 0) + (pl !== base.place ? 1 : 0)
          if (!cost) continue
          if (best && cost >= best.cost) continue
          s.type = t; s.scale = Number(sc); s.place = pl
          if (okWith(i)) best = { t, sc, pl, cost }
        }
      }
    }
    if (best) {
      s.type = best.t; s.scale = Number(best.sc); s.place = best.pl
      fixed++
      msgs.push(`${now(s)} 方向已错开（改 ${best.cost} 项：${base.type}/${base.place}/×${base.scale} → ${best.t}/${best.pl}/×${best.sc}）`)
    } else {
      // 三旋钮都试遍仍不行的极端情况：才动 layout（受图数约束，用 layoutForCount 保证合法）
      s.type = base.type; s.scale = Number(base.scale); s.place = base.place
      const imgs = (s.imgs || []).length
      const lay = imgs ? layoutForCount(imgs) : ''
      if (lay && lay !== s.layout) {
        s.layout = lay
        if (okWith(i)) { fixed++; msgs.push(`${now(s)} 摆图法已换（${base.layout} → ${lay}）`) }
        else s.layout = base.layout
      }
    }
  }
  const left = checkDiversity(list, maxShare).bad.length
  return { fixed, left, msgs }
}

/**
 * ★VF_DAILY_V21（2026-10-14 用户原话「依然是文字排版同质化严重」「AI 自主设计这里卡得还是太死」）：
 *   **文字层参数化** —— 结构（8 种，怎么摆图）× 文字层（4 种，字怎么说话）× 字号档（4 档）。
 *   引擎侧有同一张单（`daily-page.mjs` 的 `TEXT_TYPES/TSCALES`），两处必须一致。
 */
export const PLAN_TEXT_TYPES = [
  { id: 'band', name: '衬带式', look: '标题压深色衬带（默认，最稳）' },
  { id: 'poster', name: '海报式', look: '标题紧排大字、信息点右下角标（有气势）' },
  { id: 'editorial', name: '杂志式', look: '抬头细线 + 段号、信息点两列小栏（像刊物）' },
  { id: 'list', name: '清单式', look: '标题收成小标、信息点当主体（菜品/清单类好用）' },
]
export const PLAN_TSCALES = [0.9, 1, 1.15, 1.3]
/**
 * ★VF_DAILY_V31（2026-10-16 用户定案「按你规划来」＝中间档）：**文字对齐** —— 第一个"版面自由度"参数。
 * 为什么先做它：它**只改对齐、不动任何元素的尺寸与外框** ⇒ 那三条最容易误报的判据
 *   （文字被裁 / 越界 / 折行）**照旧管用**，不必先动闸门标定。
 *   （对照 `imgShare`/`pad`：它们会缩窄内容列 ⇒ nowrap 标题溢出 ⇒ 直接触发裁切判据，
 *     也就是 V2 / CLIP_V2 / V3 反复踩的那个坑 ⇒ 要**先修 `titleCss` 的列宽标定**才能上。）
 * ⚠️ 与引擎侧**同一份口径**（`daily-page.mjs` 的 `data-align` 白名单）：两处必须一致。
 */
export const PLAN_ALIGNS = ['left', 'center', 'right']

/**
 * ★VF_DAILY_V33（2026-10-16 用户定案「剩下2条先做」→ 收口第 ③ 条「AI 参与和不参与完全分不出来」）：
 * **把"这次 AI 到底用了多少种"数出来，直接写在方案卡上**。
 * 为什么需要它：用户说"分不出来"，根子在于**没有可见读数** —— AI 是悄悄生效的，
 *   就算打开了"放手排版"也只是换了一段提示词，用户只能凭观感猜。
 * 口径：只数**真的影响观感**的那几个维度（版式 / 对齐 / 字号档 / 叠法 / 文字动效 / 取景），
 *   并且**只数明确字段**（空值不计数）—— 纯统计、不做判断，"数错不如不数"。
 */
export function layoutStats(segs: any[]): {
  layout: number; align: number; scale: number; form: number; tm: number; place: number; segs: number
} {
  const list = Array.isArray(segs) ? segs : []
  const uniq = (f: (s: any) => string) => {
    const set = new Set<string>()
    list.forEach((s) => { const v = String(f(s) == null ? '' : f(s)).trim(); if (v) set.add(v) })
    return set.size
  }
  return {
    segs: list.length,
    layout: uniq((s) => s?.layout),
    align: uniq((s) => s?.align),
    scale: uniq((s) => (s?.scale === undefined ? '' : s.scale)),
    form: uniq((s) => s?.form),
    tm: uniq((s) => s?.tm),
    place: uniq((s) => s?.place),
  }
}

/**
 * ★VF_DAILY_V25（B1 字体配对，2026-10-14 用户定案「B1+B2+B3，最大目的去同质化：文字/文字动效/配色/样式排版」）：
 *   "文字"这条轴原来只有 serif/sans 两种 ⇒ 20 套皮肤里字体其实只有 2 种。
 *   现在 2 个字体族 → 4 组配对，**皮肤自带默认配对**（见引擎 `PAIR_OF`），AI 可用 `font` 覆盖。
 *   ⚠️ 与引擎 `daily-page.mjs` 的 `FONT_PAIRS` **必须同名同数**（单测卡住，防两处漂移）。
 *
 *   ★V40（2026-10-16 用户定案「选 (a)：base64 内嵌；字体雷一起修」）：**删掉 kai-song / fang-hei / kai-hei 三组**
 *   （7 → 4）。原因见 `daily-page.mjs` 的 V40 说明：`kai` / `fang` 靠的是 Windows 系统**楷体/仿宋**，
 *   **服务器上没有** ⇒ 这三组在服务器上等于"宋/黑"，开发机却是楷/仿 ⇒ **假变体**（同一皮肤号两台机器两个样）。
 *   要真恢复这两档，得另做楷体/仿宋的子集 woff2（新字体资产 + 许可）⇒ 单独立项。
 */
export const PLAN_FONTS: Array<{ id: string; name: string; look: string }> = [
  { id: 'song-hei', name: '宋黑', look: '标题宋体 + 正文黑体（书名感，稳重；餐饮/日报最稳）' },
  { id: 'hei-song', name: '黑宋', look: '标题黑体 + 正文宋体（招牌感，硬朗；夜间/高端）' },
  { id: 'song-song', name: '全宋', look: '全宋体（书卷气，安静；茶/文气/纪录）' },
  { id: 'hei-hei', name: '全黑', look: '全黑体（现代、干净；数码/办公/中性）' },
]
/**
 * ★VF_DAILY_V25：**文字动效**（用户点名的第四条去同质化轴）。
 *   原来所有段落的文字只有"上滑淡入"一种动法 ⇒ 看三段就腻。
 *   七个变体都是**只用 transform/clip-path/filter**（不碰盒模型）⇒ 动画中途也不会折行/撑破版面。
 *   ⚠️ 与引擎 `daily-page.mjs` 的 `TM` **必须同名同数**（单测卡住）。
 */
export const PLAN_TM: Array<{ id: string; name: string; look: string }> = [
  { id: 'rise', name: '上滑', look: '从下方轻轻上浮淡入（最稳，任何题材都能用）' },
  { id: 'push', name: '推入', look: '从左侧横向推入（有速度感）' },
  { id: 'drift', name: '斜落', look: '从右上斜向落定（柔和、有方向）' },
  { id: 'zoom', name: '放大', look: '从 90% 放大淡入（强调，适合重点段）' },
  { id: 'wipe', name: '上擦', look: '像被一条线从上往下擦出来（利落）' },
  { id: 'curtain', name: '下揭', look: '自下向上揭开 + 两行错峰（有仪式感，适合收尾）' },
  { id: 'blur', name: '聚焦', look: '由虚到实（影像感，适合照片段）' },
]
/** 文字动效排布：与 `assignFx` 同思路（种子轮换 + **相邻必不同**）—— 相邻同动作最容易被看成同一页 */
export function assignTextMotion(segs: any[], offset = 0): void {
  const list = Array.isArray(segs) ? segs : []
  const ids = PLAN_TM.map((t) => t.id)
  const n = ids.length
  const off = Math.abs(offset)
  list.forEach((s, i) => {
    let id = ids[(((off + i) % n) + n) % n]
    const prev = i > 0 ? String(list[i - 1].tm || '') : ''
    let guard = 0
    while (id === prev && guard++ < n) id = ids[(ids.indexOf(id) + 1) % n]
    s.tm = id
  })
}
/**
 * ★VF_DAILY_V25（B3 皮肤 × 结构搭配矩阵）——**先量证据，再写规则**。
 *   证据（`temp/_exp/daily/probe-matrix.mjs` 真浏览器末态实测，2026-10-14）：
 *     · 4 皮肤（2 深 2 浅）× 8 结构 = 32 组合：标题对比度 **14.4~18.0 全部 ≥4.5**、
 *       横向溢出 0、**标题压照片面积一律 0%**（我们的结构把文字放在自己的"衬带"上，从不压在照片上）；
 *     · 7 种文字动效 × 4 结构 = 28 组合：同样全部达标、无溢出。
 *   ⇒ 结论：**没有"禁用组合"**（不用做硬限制），搭配是**气质偏好**问题。所以 B3 落成两层：
 *     ① `THEME_TONE`（深底/浅底，供提示词与"换皮肤"对照用；由单测对着引擎算出来的明暗**逐套核对**）；
 *     ② 提示词里的"深底/浅底 × 结构"偏好表（软建议，不是安全阈值）。
 */
export const THEME_TONE: Record<string, 'dark' | 'light'> = {
  'paper-daily': 'light', 'night-gold': 'dark', 'tea-green': 'light', 'blue-print': 'light',
  'coral-warm': 'light', 'mono-print': 'light',
  'copper-pot': 'dark', 'amber-cafe': 'light', 'wine-red': 'dark', 'late-night': 'dark',
  'cinema-noir': 'dark', 'forest-ink': 'dark', 'jiangnan': 'light', 'bamboo': 'light',
  'sand-dune': 'light', 'mist-blue': 'light', 'graphite': 'light', 'nordic': 'light',
  'rose-milk': 'light', 'morandi': 'light',
}
export function themeTone(id: any): 'dark' | 'light' {
  return THEME_TONE[String(id || '')] || 'light'
}
/** 皮肤明暗 → 结构偏好（**经验性建议**，矩阵实测里没有禁用组合） */
export function structureTip(id: any): { tone: 'dark' | 'light'; best: string[]; why: string } {
  const tone = themeTone(id)
  return tone === 'dark'
    ? { tone, best: ['hero', 'stack2', 'quote', 'grid4'], why: '深底皮肤压得住满幅/多图，静物与夜景更出彩' }
    : { tone, best: ['split', 'grid3', 'vertical', 'sticker'], why: '浅底皮肤像报纸/画册，图文左右与网格更清楚' }
}

/**
 * ★VF_DAILY_V25：**皮肤 → 默认字体配对**（与引擎 `daily-page.mjs` 的 `PAIR_OF` **必须一致**，单测卡住）。
 *   为什么要抄一份：服务端要判断"这份的字体是否和上一份同款"，而这要求它在**出片前**就知道
 *   皮肤会落到哪一组配对（引擎那边的默认值它拿不到）。抄 + 单测双向核对 = 可接受的重复。
 *   ★V40：原来指向 kai/fang 的 6 套已随引擎 `PAIR_OF` 一起重指（楷"文气"→全宋；仿"克制"→宋黑）——
 *   两处**必须逐字一致**，`temp/_spec` 的单测会双向核对。
 */
export const PLAN_SKIN_FONT: Record<string, string> = {
  'paper-daily': 'song-song', 'night-gold': 'song-song', 'tea-green': 'song-song',
  'blue-print': 'hei-hei', 'coral-warm': 'hei-hei', 'mono-print': 'hei-hei',
  'copper-pot': 'song-song', 'amber-cafe': 'song-hei', 'wine-red': 'hei-song',
  'late-night': 'hei-hei', 'cinema-noir': 'hei-song', 'forest-ink': 'song-song',
  'jiangnan': 'song-song', 'bamboo': 'song-hei', 'sand-dune': 'song-hei',
  'mist-blue': 'hei-song', 'graphite': 'song-hei', 'nordic': 'hei-hei',
  'rose-milk': 'song-hei', 'morandi': 'song-song',
}
/** 字体配对校验（AI 可挑；不合法就丢掉并如实记 fixes —— 引擎那边会用该皮肤的默认配对） */
export function normFont(raw: any): { font?: string; fixes: string[] } {
  const fixes: string[] = []
  const want = String(raw?.font || '')
  if (!want) return { fixes }
  if (PLAN_FONTS.some((f) => f.id === want)) return { font: want, fixes }
  fixes.push(`AI 要的字体配对「${want}」不在库里 ⇒ 已用该皮肤的默认配对`)
  return { fixes }
}
/**
 * ★VF_DAILY_V25：**挑字体配对**（B1 的去同质化那一半）。
 *   `probe-variance.mjs` 实测短板：字体只随皮肤走 ⇒ 皮肤一重复、字体就跟着重复（6 轮只有 3 种）。
 *   现在三层：① AI 指定（白名单）→ 直接用；② 与**上一份**的配对同款 ⇒ 按 seed 顺延一组；
 *   ③ 其余情况交给引擎用皮肤默认配对（不写 `font`，产物不变）。
 *   ⚠️ 字体只会改变文字宽度（会影响的只有"竖排/窄列"那类结构），矩阵探针已按（当时的）7 组配对 × 4 结构验过不溢出；
 *     ★V40 删到 **4 组** ⇒ 那条结论覆盖的是**超集**，仍然成立。
 */
export function pickFont(opts: { want?: any; themeId?: string; lastTheme?: string; recentThemes?: string[]; key?: number }): { font?: string; fixes: string[] } {
  const fixes: string[] = []
  const ids = PLAN_FONTS.map((f) => f.id)
  const want = String((opts.want && (opts.want.font || opts.want)) || '')
  if (want) {
    if (ids.indexOf(want) >= 0) return { font: want, fixes }
    fixes.push(`AI 要的字体配对「${want}」不在库里 ⇒ 已按皮肤默认/顺延处理`)
  }
  const mine = PLAN_SKIN_FONT[String(opts.themeId || '')] || ''
  // ⚠️ 只看"上一份"不够（体检实测：皮肤换了几份又转回来 ⇒ 字体跟着撞）。线上 `recentSkins` 本来
  //    就取最近 3 条 ⇒ 这里也看最近 3 份：只要其中任何一份的默认配对与本次相同，就顺延一组。
  const recent = (Array.isArray(opts.recentThemes) ? opts.recentThemes : (opts.lastTheme ? [opts.lastTheme] : []))
    .slice(0, 3).map((t) => String(t || ''))
  if (mine && recent.some((t) => PLAN_SKIN_FONT[t] === mine)) {
    const step = 1 + (Math.abs(Number(opts.key) || 0) % (ids.length - 1))
    const next = ids[(ids.indexOf(mine) + step) % ids.length]
    fixes.push(`最近 3 份里已经用过字体配对「${mine}」⇒ 本份顺延到「${next}」（字体这条轴不能只跟着皮肤走）`)
    return { font: next, fixes }
  }
  return { fixes }
}
export const TEXT_LAYER_ALIASES: Record<string, string> = {
  衬带: 'band', 衬带式: 'band', 默认: 'band', band: 'band',
  海报: 'poster', 海报式: 'poster', 大字: 'poster', poster: 'poster',
  杂志: 'editorial', 杂志式: 'editorial', 刊物: 'editorial', editorial: 'editorial',
  清单: 'list', 清单式: 'list', 列表: 'list', list: 'list',
}
/**
 * 给**没指定**文字层的段轮换填一个（服务端兜底）—— 这样即使 AI 什么都不说，一份里也不会只有一张脸。
 * 规则：按 seed 轮换 4 种，**相邻段必不同**；同 seed 同结果（可复现、可单测）；已指定过的段不动。
 */
export function assignTextLayer(segs: any[], offset = 0): void {
  const list = Array.isArray(segs) ? segs : []
  const ids = PLAN_TEXT_TYPES.map((t) => t.id)
  const off = Math.abs(offset)
  list.forEach((s, i) => {
    const cur = String(s.type || '')
    if (ids.indexOf(cur) >= 0) return
    let k = 0
    let id = ids[(off + i) % ids.length]
    const prev = i > 0 ? String(list[i - 1].type || '') : ''
    while (id === prev && k++ < ids.length) id = ids[(off + i + k) % ids.length]
    s.type = id
  })
}

export const DAILY_FX_QUIET = ['zout', 'zin', 'pan', 'wipe']
export const DAILY_FX_CUT = ['slats', 'blinds', 'mosaic']
/**
 * ★V13b（2026-10-13 用户实测 14 段的那份：「一次任务不要出现 2 次同一风格就没意思了」）：
 *   效果池 = **id × 变体**（同一 id 也有不同条数/方向/幅度）⇒ 12 个"看起来不一样"的入场。
 *   （V19 起分配走"安静组为主 + 切分型限 1 次"，此常量保留给"白名单校验/单测"用。）
 */
export const DAILY_FX_POOL = (() => {
  const out: string[] = []
  for (let v = 0; v < 2; v++) for (const id of DAILY_FX) out.push(id + '#' + v)
  return out
})()
/** 切分型的**唯一名额**落在哪一段：-1 = 本片不用；否则为段下标（0=封面 / n-1=收尾） */
export function fxCutSlot(n: number, offset = 0): number {
  const total = Number(n) || 0
  if (total < 6) return -1                      // 短片没有"呼吸空间"，一次都不用
  return (Math.abs(offset) % 2) ? total - 1 : 0
}
/** 按 offset 排效果序（安静组为主 + 切分型最多 1 次；相邻段 id 必不同；同 offset 同结果） */
export function assignFx(segs: any[], offset = 0): void {
  const list = Array.isArray(segs) ? segs : []
  const slot = fxCutSlot(list.length, offset)
  const off = Math.abs(offset)
  list.forEach((s, i) => {
    if (i === slot) {
      s.fx = DAILY_FX_CUT[off % DAILY_FX_CUT.length] + '#' + ((off >> 1) % 2)
      return
    }
    // 安静组轮换：id 相邻必不同（切分型 id 与安静组天然不同，所以不用额外避让）
    let k = i
    let id = DAILY_FX_QUIET[(((off + k) % DAILY_FX_QUIET.length) + DAILY_FX_QUIET.length) % DAILY_FX_QUIET.length]
    const prevId = i > 0 ? String(list[i - 1].fx || '').split('#')[0] : ''
    let guard = 0
    while (id === prevId && guard++ < DAILY_FX_QUIET.length) {
      k++
      id = DAILY_FX_QUIET[(((off + k) % DAILY_FX_QUIET.length) + DAILY_FX_QUIET.length) % DAILY_FX_QUIET.length]
    }
    s.fx = id + '#' + ((off + i) % 2)
  })
}
export function planFingerprint(plan: any, skin = ''): string {
  const segs: any[] = Array.isArray(plan?.segments) ? plan.segments : []
  return [
    String(skin || plan?.meta?.theme || ''),
    segs.map((s) => String(s.layout || '-')).join(','),
    segs.map((s) => String(s.fx || '-')).join(','),
  ].join('|')
}
/** 相似度 0~1（皮肤 20% / 结构序 50% / 效果序 30%）—— 只比"看得见的骨架"，不比文案 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  const pa = a.split('|'), pb = b.split('|')
  if (pa.length < 3 || pb.length < 3) return 0
  const same = (x: string, y: string) => (x && y && x === y ? 1 : 0)
  const seq = (x: string, y: string) => {
    const xs = x.split(','), ys = y.split(',')
    if (!xs.length || !ys.length) return 0
    let hit = 0
    for (let i = 0; i < Math.min(xs.length, ys.length); i++) if (xs[i] === ys[i]) hit++
    return hit / Math.max(xs.length, ys.length)
  }
  return 0.2 * same(pa[0], pb[0]) + 0.5 * seq(pa[1], pb[1]) + 0.3 * seq(pa[2], pb[2])
}
/** 重掷：换效果序偏移；单图段结构整体错位轮换（不动多图段，免得跟图数打架） */
export function rerollPlan(plan: any, attempt = 1): { shifted: string } {
  const segs: any[] = Array.isArray(plan?.segments) ? plan.segments : []
  assignFx(segs, attempt * 2 + 1)
  const ROT = ['hero', 'sticker', 'vertical', 'split']
  let r = attempt
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if ((s.imgs || []).length !== 1) continue
    const pk = ROT[(r++) % ROT.length]
    if (String(s.layout) !== pk) { s.layout = pk; s.form = pk === 'hero' ? 'overlay' : pk }
  }
  return { shifted: '效果序 + 单图段结构' }
}

/**
 * ★VF_DAILY_V15 · R5′（2026-10-13 用户定案「主题明确的图不怕遮挡、文字遮挡完全没关系」）：
 *   按素材**平均亮度**决定这一段的暗衬档（纯函数、可单测）：
 *     · 深色图（平均 <118）⇒ `none`：不加暗衬，白字靠**描边+阴影**（照片已经很深，再压暗就是把美食压黑）
 *     · 亮图 ⇒ `soft`：走渐隐暗衬（白字在亮底上确实看不清）
 *   ⚠️ 不是"随便允许压字"，而是**用数据换来的豁免**：亮度是服务端量出来的（ffmpeg 缩 1×1 灰度取字节），
 *      渲染体检也只在 `data-scrim="none"` **且文字带阴影**时放行。
 */
export function scrimFor(lums: number[]): 'none' | 'soft' {
  const v = (Array.isArray(lums) ? lums : []).filter((x) => typeof x === 'number' && x > 0)
  if (!v.length) return 'soft'                    // 没量到 ⇒ 保守（保留暗衬）
  const avg = v.reduce((a, b) => a + b, 0) / v.length
  return avg < 118 ? 'none' : 'soft'
}

/** 把段数组组装成引擎配置（★L4：皮肤由 AI 挑，`theme` / `custom` 透传给引擎做对比度体检）
 *  ★V19（A′）：`imageNames` = 图号 1..N 对应的**同级扁平图名**（`gen_..._p1.jpg`）。
 *  给了它就按它引用（HTML 里的图与页面同级、无子目录）；不给则沿用老口径 `images/N.jpg`。 */
export function buildPlanFromSegs(segs: any[], topicRaw: string, motion = 'normal', theme?: string, custom?: any, imageNames?: string[], font?: string): any {
  const topic = String(topicRaw || '').trim().slice(0, 24)
  const meta: any = {
    issue: '第 01 期',
    accent: DAILY_STYLE.accent, paper: DAILY_STYLE.paper,   // 老字段留着（兼容），实际色值由引擎按 theme 定
    title: `日报落地页 · ${topic || '素材记录'}`,
    theme: String(theme || 'paper-daily'),
  }
  if (custom && typeof custom === 'object') meta.custom = custom
  // ★L3：只要有一段带 html ⇒ 打开引擎的"AI 自写段"通道（方案级开关，不依赖服务器环境变量）
  if (segs.some((x: any) => x && typeof x.html === 'string' && x.html.trim())) meta.aiHtml = true
  return {
    meta,
    motion: normMotion(motion),
    imageDir: 'images',
    // ★V19（A′）：只在真的给了名字表时才写这一项 —— 免得旧链路（无图名表）产物发生变化
    ...(Array.isArray(imageNames) && imageNames.length ? { imageNames } : {}),
    // ★V25（B1）：字体配对（AI 挑的或用户改的；不给就由引擎用该皮肤的默认配对）——
    //   同样"只在真给了才写"，保证不改变旧链路的产物
    ...(font && PLAN_FONTS.some((f) => f.id === font) ? { font } : {}),
    segments: segs,
  }
}

const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

/**
 * 确定性保底版式（AI 失败时的兜底 —— 保证"永远有交付"）。
 * 每张图一段：首段封面 / 末段结尾，标题用主题切两行。
 */
export function buildDailyPlan(names: string[], topicRaw: string) {
  const topic = String(topicRaw || '').trim().slice(0, 24)
  const segs = names.map((nm, i) => {
    const kind = i === 0 ? 'cover' : (i === names.length - 1 ? 'end' : 'feature')
    const t1 = topic ? topic.slice(0, 6) : (kind === 'cover' ? '这几张' : '现场记录')
    const t2 = topic && topic.length > 6 ? topic.slice(6, 12) : (kind === 'cover' ? '值得一看' : `${i + 1} / ${names.length}`)
    // ★L2：保底版式也走**结构库**（单图段轮换 4 种结构）—— 免得"AI 挂了就整份一个样"
    const layout = i === 0 ? 'hero' : (['sticker', 'vertical', 'split'][i % 3])
    return {
      kind, layout,
      kicker: `日报 · ${topic || '素材记录'} · 其${CN[i] || i + 1}`,
      stamp: kind === 'cover' ? '第 01 期' : '',
      title: [t1, t2],
      imgs: [i + 1],
      points: [['实拍', '原图'], ['细节', '特写'], ['现场', '记录']],
      place: 'cover',
      form: layout === 'hero' ? 'overlay' : layout,
      src: [nm],    // 只在生成时用来记录对应素材（不进 HTML）；**统一是数组**（与 attachSrc 同形）
    }
  })
  return buildPlanFromSegs(segs, topic)
}

/* ─────────────── 给人看的方案清单（风格/页数/排版/文字） ─────────────── */

/** 段类型 / 版式的**人话名**（清单与 AI 提示词共用，避免两处说法不一致） */
export const KIND_LABEL: Record<string, string> = { cover: '封面', feature: '正片', end: '结尾' }
export const FORM_LABEL: Record<string, string> = { overlay: '满幅大图', sticker: '贴纸标题', vertical: '竖排标题' }
export const KIND_ALIASES: Record<string, string> = {
  封面: 'cover', cover: 'cover', 正片: 'feature', feature: 'feature', 中间: 'feature', 内容: 'feature', 结尾: 'end', 尾: 'end', end: 'end',
}
export const FORM_ALIASES: Record<string, string> = {
  满幅: 'overlay', 压字: 'overlay', 大图: 'overlay', 满幅大图: 'overlay', overlay: 'overlay',
  贴纸: 'sticker', 贴纸标题: 'sticker', sticker: 'sticker',
  竖排: 'vertical', 竖排标题: 'vertical', vertical: 'vertical',
}
/** ★L2：人话 → 结构 id（`改 3 版式=四宫格` 用；结构名与人话别名都收） */
export const LAYOUT_ALIASES: Record<string, string> = {
  满幅: 'hero', 压字: 'hero', 满幅压字: 'hero', 大图: 'hero', hero: 'hero',
  贴纸: 'sticker', 贴纸标题: 'sticker', sticker: 'sticker',
  竖排: 'vertical', 竖排标题: 'vertical', vertical: 'vertical',
  左右: 'split', 图文左右: 'split', split: 'split',
  双图: 'stack2', 上下双图: 'stack2', stack2: 'stack2',
  三图: 'grid3', 三图拼版: 'grid3', grid3: 'grid3',
  四宫格: 'grid4', 四图: 'grid4', grid4: 'grid4',
  引文: 'quote', 引文页: 'quote', quote: 'quote',
}
export const MOTION_ALIASES: Record<string, string> = {
  稳: 'calm', 慢: 'calm', 安静: 'calm', calm: 'calm',
  正常: 'normal', normal: 'normal',
  活泼: 'lively', 快: 'lively', 热闹: 'lively', lively: 'lively',
}

/** ★L2：清单里直接显示**结构名**（用户要能一眼看出"这份换了几种版式"） */
export function layoutLabel(s: any): string {
  const k = KIND_LABEL[String(s.kind)] || '正片'
  const meta = PLAN_LAYOUTS.filter((x) => x.id === String(s.layout))[0]
  const n = (s.imgs || []).length
  const f = meta ? `${meta.name}（${n} 图）` : (n >= 2 ? `双图并排（${n} 图）` : '单图通栏（1 图）')
  const mat = String(s.place) === 'mat' ? ' · 相纸留边'
    : (String(s.place) === 'contain' ? ' · 整张不裁' : '')
  return `${k} · ${f}${mat}`
}
export function durOf(kind: string): number { return kind === 'cover' ? 3.4 : 3.2 }
export function planDuration(plan: any): number {
  const segs: any[] = Array.isArray(plan?.segments) ? plan.segments : []
  return segs.reduce((a, s) => a + durOf(String(s.kind)), 0)
}

export function formatDailyPlan(plan: any, o: { topic: string; picks: PlanPick[]; by: PlanBy; note?: string }): string {
  const segs: any[] = Array.isArray(plan?.segments) ? plan.segments : []
  const total = planDuration(plan)
  const L: string[] = []
  L.push('📄「日报落地页」第 2 步 / 共 3 步 · **方案确认**')
  L.push('')
  // ★L4：皮肤不再是"唯一那一套" —— 由 AI 按素材挑（自定配色会过对比度体检，`notes` 写在卡上）
  L.push(`皮肤：**${themeName(plan?.meta?.theme)}**${plan?.meta?.custom ? '（AI 自定配色·已过对比度体检）' : ''}｜动效档：${plan?.motion || 'normal'}`)
  L.push(`主题：${o.topic || '（未给 → 中性占位文案）'}｜素材 ${o.picks.length} 张｜共 **${segs.length} 段** · 约 ${total.toFixed(1)} 秒`)
  L.push('')
  L.push('—'.repeat(28))
  segs.forEach((s, i) => {
    L.push(`${i + 1}. ${layoutLabel(s)} · 用图 ${(s.imgs || []).join('+')}`)
    L.push(`   标题：「${(s.title || []).join(' / ')}」`)
    const meta: string[] = []
    if (s.kicker) meta.push('标签 ' + s.kicker)
    if (s.stamp) meta.push('角标 ' + s.stamp)
    if (meta.length) L.push('   ' + meta.join('　'))
    if ((s.points || []).length) L.push('   信息点：' + s.points.map((p: any) => p.join(' · ')).join('　｜　'))
    // src 统一按数组处理（历史上保底版式给过字符串 —— 这里防御式兜住，免得整段回复炸掉）
    const srcArr = Array.isArray(s.src) ? s.src : (s.src ? [String(s.src)] : [])
    if (srcArr.length) L.push('   对应素材：' + srcArr.join('、'))
    L.push('')
  })
  L.push('—'.repeat(28))
  L.push(o.by === 'ai'
    ? '（本方案由 **AI 看素材后编排**）'
    : (o.by === 'captions'
      ? `（⚠️ AI 这轮没排出方案${o.note ? '（' + o.note + '）' : ''} → 已按**看图摘要**重排：标题与信息点都来自读图，不是占位）`
      : `（⚠️ AI 这轮没排出方案${o.note ? '：' + o.note : ''} → 用的是**系统保底版式**）`))
  L.push('')
  L.push('回 `确认` 我就**生成 HTML 文件**；回 `重选` 重新挑素材；回 `取消` 退出。')
  L.push('微调（改完我重列一遍方案）：`改 3 标题=刀起刀落/薄如纸片`　`改 3 版式=竖排`　`改 3 用图=2,4`　'
    + '`改 3 信息点=甲,乙;丙,丁`　`改 3 类型=结尾`　`动效=活泼`　`删 3`')
  L.push('（生成后下载 HTML，把你选的图**按上面「用图」的编号**命名成 `1.jpg…N.jpg` 放进同目录 `images/` 文件夹即为真图）')
  return L.join('\n')
}

/**
 * ★VF_DAILY_V6（2026-10-12 用户实测「第二步 怎么回的是文字…没有前台卡片了？」）：
 *   方案确认这一步也出**卡**（与第 1 步素材卡一致）。这里是卡的载荷（纯函数 ⇒ 可单测）；
 *   前端 `VfDailyPlanCard` 按 `step:'daily_plan'` 渲染，按钮发 `VF_DAILY_FORM:{at:'go'|'back_mat'}`。
 */
export function buildPlanCardPayload(plan: any, o: {
  picks: PlanPick[]; by: PlanBy; note?: string; hintExtra?: string; topic?: string
  /** ★VF_DAILY_V32：两个 AI 开关的**当前值**（回显到卡片上，用户切过要看得见） */
  aiLayout?: boolean; aiPickSkin?: boolean
}): any {
  const segs: any[] = Array.isArray(plan?.segments) ? plan.segments : []
  const dur = planDuration(plan)
  return {
    step: 'daily_plan',
    proto: 'VF_DAILY_FORM',
    hint: `第 2 步 / 共 3 步 · 方案确认（${segs.length} 段 · 约 ${dur.toFixed(1)} 秒 · 皮肤 ${themeName(plan?.meta?.theme)}）`
      + (o.hintExtra ? ' · ' + o.hintExtra : ''),
    topic: o.topic || '',
    by: o.by,
    note: o.note || '',
    // ★VF_DAILY_V32：两个 AI 开关回显（前端按它渲染复选框状态）
    aiLayout: !!o.aiLayout,
    aiPickSkin: !!o.aiPickSkin,
    // ★VF_DAILY_V33：**把"这次用了多少种"写在卡上** —— 让"AI 有没有放手"变成可读的数字，
    //   而不是让用户凭观感猜（他原话：「AI 参与和不参与完全分不出来」）。
    stats: layoutStats(segs),
    segs: segs.map((s, i) => ({
      i: i + 1,
      label: layoutLabel(s),
      // ★VF_DAILY_V20（2026-10-13 用户「加一个编辑键，点了可编辑文字、可以删除」）：
      //   卡片上的"编辑"面板要**回填**这三个字段（不然用户改版式/类型时不知道现在是什么）
      kind: String(s.kind || ''),
      layout: String(s.layout || ''),
      // ★V21：编辑面板要回填文字层与字号档
      type: String(s.type || 'band'),
      scale: Number(s.scale) || 1,
      title: Array.isArray(s.title) ? s.title.map((x: any) => String(x)) : [String(s.title || '')],
      points: (Array.isArray(s.points) ? s.points : []).map((p: any) => (Array.isArray(p) ? p.filter(Boolean).join('·') : String(p))),
      imgs: Array.isArray(s.imgs) ? s.imgs : [],
      src: Array.isArray(s.src) ? s.src : [],
    })),
  }
}

/**
 * ★VF_DAILY_V8（2026-10-13 用户原话「纯 HTML 打开都看不到图片 是否需要一个文件夹包才可以」）：
 *   把生成好的 HTML 里 `images/N.jpg` 引用**换成内嵌 data URI** ⇒ **单文件双击即看真图**，
 *   不用再建 `images/` 文件夹、发人也只用发一个文件。
 *   纯字符串替换（零依赖、可单测）；带总量上限（超预算的图**不嵌**，保持原相对路径 ⇒ 部分内嵌也是好的，
 *   只是这层事实由调用方如实报给用户）。
 */
export function embedImages(
  html: string,
  imgs: Array<{ n: number; mime: string; b64: string; bytes?: number; ref?: string }>,
  cap = 12 * 1024 * 1024,
  refOf?: (im: { n: number; ref?: string }) => string,
): { html: string; embedded: number; skipped: number } {
  let out = String(html || '')
  let used = 0
  let embedded = 0
  let skipped = 0
  for (const im of imgs) {
    // ★V19（A′）：引用名可能是**同级扁平名**（`gen_..._p1.jpg`）⇒ 优先用 im.ref，
    //   其次用调用方给的 refOf，最后才是老口径 `images/N.jpg`（旧档照旧能嵌）。
    const ref = String(im.ref || (refOf ? refOf(im) : '') || `images/${im.n}.jpg`)
    if (!out.includes(ref)) { skipped++; continue }
    const size = typeof im.bytes === 'number' ? im.bytes : Math.floor((im.b64.length * 3) / 4)
    if (used + size > cap) { skipped++; continue }
    used += size
    out = out.split(ref).join(`data:${im.mime};base64,${im.b64}`)
    embedded++
  }
  return { html: out, embedded, skipped }
}

/**
 * ★VF_DAILY_V7（2026-10-13 用户原话「不是第二步都是文字，是最后一步都是文字，而且▶ **打开预览**…这个也是下载 并不是展示」）：
 *   交付这一步（第 3 步）也出**卡**（同族：素材卡 → 方案卡 → **交付卡**）。
 *   卡里带：预览地址（浏览器直接渲染）/ 下载地址 / 真图命名对照 / 事实行（段数·皮肤·结构·体检）。
 *   纯函数 ⇒ 可单测；前端 `VfDailyDoneCard` 按 `step:'daily_done'` 渲染。
 */
export function buildDoneCardPayload(o: {
  name: string; viewUrl: string; dlUrl?: string
  segs: number; skin: string; by: PlanBy
  aiSegs?: number; structures?: number; note?: string; dropped?: string[]; ordered?: string[]
  expiresDays?: number
  /** ★VF_DAILY_V8：单文件版（图已内嵌）—— `plainUrl` 是"配图版"（需 images/ 文件夹） */
  singleName?: string; singleUrl?: string; singleDlUrl?: string; plainUrl?: string
  /** ★VF_DAILYFILM_V3（2026-10-14 用户实测「刚生成的却提示『需重新生成一份』」）：
   *  **有没有单文件版** —— 这个标志**刻意不依赖短链是否生成成功**。
   *  病灶：前端原来拿 `embedded` 当判据，而 `embedded` 在服务端是 `singleOk ? embedded : 0`，
   *  而 `singleOk` 又要求**短链也生成成功** ⇒ 一旦 `fileLinkPath` 拿不到（链接失败），
   *  "有单文件版"就被算成"没有" ⇒ 出片按钮**误置灰**（服务端明明能出片）。
   *  现口径：出片只认"**单文件版存在**"这一件事。 */
  hasSingle?: boolean
  imgCount?: number; embedded?: number
  /** ★V19（A′）：这批图的**同级扁平仓库名**（客户端拿它把图一起镜像到本地同一文件夹） */
  imgNames?: string[]
  /** ★V20：精简段表（卡片上的"✏️ 编辑"面板回填用：段号/版式/类型/标题/信息点/图号） */
  segsBrief?: any[]
  /** ★VF_HTMLVIEW_V1（2026-10-13）：**站内预览**两条同源出口（不再依赖外链/客户端行为）——
   *  `apiView` = `/api/storage/file?…`（HTML 流式 inline 直出，卡内 iframe 用）；
   *  `previewPath` = `/preview/repo?…`（整页预览，给"新窗口打开"）。 */
  apiView?: string; previewPath?: string
}): any {
  const days = o.expiresDays || 7
  const facts: string[] = [o.segs + ' 段', '皮肤 ' + o.skin,
    byLabel(o.by)]
  if (o.aiSegs) facts.push('AI 自写 ' + o.aiSegs + ' 段')
  if (o.structures) facts.push('结构 ' + o.structures + ' 种')
  if (o.note) facts.push(String(o.note).trim())
  const total = Number(o.imgCount || 0)
  const emb = Number(o.embedded || 0)
  const pub = Array.isArray(o.imgNames) ? o.imgNames.filter(Boolean).length : 0
  let imgMsg = ''
  // ★V19（A′，用户 2026-10-13 定案「A 执行」）：图**与页面同级**存在你的个人仓库里
  //   ⇒ 客户端会自动把它们镜像到同一个平铺文件夹（打开就是真图、离线也能看、不用建 images/）。
  if (pub && total && pub >= total) imgMsg = '真图已随件入库（与页面同级）· 客户端自动镜像到本地同一文件夹'
  else if (pub) imgMsg = `真图入库 ${pub}/${total} 张（其余仍是占位色块）`
  else if (emb && total && emb >= total) imgMsg = '真图已内嵌（单文件即看）'
  else if (emb) imgMsg = `真图内嵌 ${emb}/${total} 张`
  else if (total) imgMsg = '未取到真图（预览里是占位色块）'
  return {
    step: 'daily_done',
    proto: 'VF_DAILY_FORM',
    hint: '第 3 步 / 共 3 步 · 已生成并交付',
    name: o.singleName || o.name,
    // ★VF_DAILYFILM_V3：**出片按钮的判据**（不看 `embedded` —— 它会被"短链没生成成功"带偏）
    hasSingle: !!o.hasSingle,
    plainName: o.name,
    viewUrl: o.singleUrl || o.viewUrl,
    dlUrl: o.singleDlUrl || o.dlUrl || '',
    plainUrl: o.singleUrl ? o.viewUrl : '',
    plainDlUrl: o.singleUrl ? (o.dlUrl || '') : '',
    apiView: o.apiView || '',
    previewPath: o.previewPath || '',
    facts: facts.join(' · '),
    imgMsg,
    imgNames: Array.isArray(o.imgNames) ? o.imgNames : [],
    segsBrief: Array.isArray(o.segsBrief) ? o.segsBrief : [],
    dropped: Array.isArray(o.dropped) ? o.dropped : [],
    ordered: Array.isArray(o.ordered) ? o.ordered : [],
    expiresDays: days,
    note: '链接 ' + days + ' 天有效，可以发给别人；过期后再说一次「日报落地页」重做就有新链接。'
      + ' 页面与它用的图**同级**存在你的**个人仓库 · 生成素材组**，客户端会自动镜像到本地同一个文件夹'
      + '（打开就是真图，不用再建 images/ 文件夹）。',
  }
}

/**
 * ★VF_DAILY_V20（2026-10-13 用户原话「加一个编辑键，可以点了以后可编辑文字，可以删除，但卡片可以做到吗？」）：
 *   **卡片上的"编辑"面板 → 命令串** 的拼装口（纯函数，前后端共用一份口径 ⇒ 不会两处写法漂移）。
 *   设计取舍：不做富文本编辑器，而是**复用已有的 `applyDailyEdit` 命令词**（`改 <n> 字段=值` / `删 <n>`），
 *   所以服务端解析器一行都不用改；面板只管把"用户改了什么"翻译成这几条命令。
 */
export function cmdOf(n: number, field: '标题' | '标签' | '角标' | '信息点' | '用图' | '版式' | '类型' | '文字层' | '字号', value: string): string {
  return `改 ${Number(n)} ${field}=${String(value == null ? '' : value).trim()}`
}
export function cmdDel(n: number): string { return `删 ${Number(n)}` }
export function cmdMotion(v: string): string { return `动效=${String(v || '').trim()}` }

/**
 * ★VF_DAILY_V20：**一次给多条编辑命令**（卡片上的编辑面板就是这么发的 —— 用户可能同时改了 3 段的标题 + 又删了 1 段）。
 *   · 按 换行 / `;` / `；` 拆开，**顺序执行**（后一条基于前一条的结果）；
 *   · 全部成功 ⇒ 只**重列一次**方案（msg 汇总改了哪些），不发一堆卡；
 *   · 有一条没看懂/不合法 ⇒ `ok:false` 并点名那条（**不半途静默改一半**，免得用户以为没生效）；
 *   · 一条都没匹配上 ⇒ `matched:false`（交回主流程，本线不吞消息）。
 */
export function applyEditBatch(plan: any, raw: string, picks: PlanPick[] = []): { matched: boolean; ok: boolean; msg: string; plan?: any } {
  // ⚠️ 拆命令的**唯一正确口径**（用户 2026-10-14 实测「编辑后保存可能有问题…感觉漏」）：
  //   信息点命令里 `;` 是**分组符**（`改 3 信息点=甲,乙;丙,丁`）—— 第一版把 `;` 也当命令分隔符 ⇒
  //   第 6 段那种"两组信息点"被劈成两条，后半条不像命令 ⇒ **第二组被吞**（复现见 temp/_exp/daily/check-edit.mjs）。
  //   现口径：**只按换行拆**；`;`/`；` 后面**只有当紧跟"改/删/动效"**时才算命令分隔（两者兼顾）。
  const cmds = String(raw || '')
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/(?<=[;；])(?=\s*(?:改|删|动效))/))
    .map((x) => x.trim()).filter(Boolean)
  if (!cmds.length) return { matched: false, ok: false, msg: '' }
  let cur = plan
  const done: string[] = []
  for (const c of cmds) {
    const ed = applyDailyEdit(cur, c, picks)
    if (!ed.matched) {
      if (!done.length) return { matched: false, ok: false, msg: '' }   // 完全不像命令 ⇒ 交回主流程
      // 已经改了几条 ⇒ **保留已生效的**，但把"这条没生效"明说（绝不静默改一半）
      return { matched: true, ok: true, msg: done.join('；') + '；⚠️ 这条没生效（没看懂）：' + c, plan: cur }
    }
    if (!ed.ok) {
      if (!done.length) return { matched: true, ok: false, msg: ed.msg }   // 第一条就不合法 ⇒ 整批不执行
      return { matched: true, ok: true, msg: done.join('；') + '；⚠️ 这条没生效：' + ed.msg, plan: cur }
    }
    cur = ed.plan
    done.push(ed.msg)
  }
  return { matched: true, ok: true, msg: done.join('；'), plan: cur }
}

/**
 * ★逐段微调（用户 2026-10-12 定案后补做）：把一句人话改成方案的局部手术。
 * 支持（`第`/`段` 可省）：
 *   `改 <n> 标题=行1/行2` · `改 <n> 标签=后厨 · 手作` · `改 <n> 角标=封面故事`
 *   `改 <n> 信息点=甲,乙;丙,丁` · `改 <n> 用图=2,4` · `改 <n> 版式=满幅|贴纸|竖排`
 *   `改 <n> 类型=封面|正片|结尾` · `动效=稳|正常|活泼` · `删 <n>`
 * 返回 matched=true 表示"这句话是本线在改方案"（哪怕参数写错 ⇒ ok=false 并给出人话原因，
 * 由调用方决定是回显错误还是当成普通消息）。**不改用户原对象**（深拷贝后再动）。
 */
export function applyDailyEdit(plan: any, raw: string, picks: PlanPick[] = []): { matched: boolean; ok: boolean; msg: string; plan?: any } {
  const s = String(raw || '').trim()
  const src: any[] = Array.isArray(plan?.segments) ? plan.segments : []
  if (!src.length) return { matched: false, ok: false, msg: '' }
  const segs: any[] = src.map((x: any) => ({
    ...x,
    title: [...(Array.isArray(x.title) ? x.title : [])],
    imgs: [...(Array.isArray(x.imgs) ? x.imgs : [])],
    points: (Array.isArray(x.points) ? x.points : []).map((p: any) => [...p]),
    src: [...(Array.isArray(x.src) ? x.src : [])],
  }))
  const next: any = { ...plan, segments: segs }
  const segCount = segs.length
  const maxImg = picks.length || Math.max(0, ...segs.flatMap((x: any) => x.imgs))

  // ① 动效档
  let m = /^(?:动效|节奏)\s*[=:：]\s*(\S+)\s*$/.exec(s)
  if (m) {
    const v = MOTION_ALIASES[m[1]]
    if (!v) return { matched: true, ok: false, msg: `不认识的动效档「${m[1]}」—— 可选：稳 / 正常 / 活泼` }
    next.motion = v
    return { matched: true, ok: true, msg: `已改：动效档 → ${m[1]}`, plan: next }
  }

  // ★VF_DAILY_V21（2026-10-14 用户「模块可以拖拽能调整」）：**重排整段顺序**。
  //   口径：`排序=3,1,2` —— 值是**执行到这条命令时**的段号，必须 1..N 的一个排列（不重不漏）。
  //   为什么不做"拖拽 ID"：段本身没有稳定 id（就是数组下标），用排列表达最直白，也最好校验。
  //   卡片上的拖拽把这条放在**最后一条**命令（改/删都做完之后再排），语义不会打架。
  m = /^排序\s*[=:：]\s*([\d,，\s]+)$/.exec(s)
  if (m) {
    const nums = String(m[1]).split(/[,，\s]+/).map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x) && x > 0)
    const n = src.length
    const want = Array.from({ length: n }, (_, i) => i + 1)
    const same = nums.length === n && want.every((v) => nums.includes(v))
    if (!same) {
      return { matched: true, ok: false, msg: `排序要写全 ${n} 段的段号（1..${n}，不重不漏），例如 \`排序=` + want.join(',') + '`' }
    }
    if (nums.every((v, i) => v === i + 1)) return { matched: true, ok: true, msg: '顺序没变（无需重排）', plan: { ...plan, segments: src } }
    // 位置语义跟着走：第一段=封面、最后一段=结尾（与删段后"新首段顶上当封面"同一口径）
    const next = nums.map((v, i) => ({
      ...src[v - 1],
      kind: i === 0 ? 'cover' : (i === nums.length - 1 ? 'end' : 'feature'),
    }))
    return { matched: true, ok: true, msg: '段序已按你的拖拽重排：' + nums.join(' → '), plan: { ...plan, segments: next } }
  }
  // ② 删第 n 段
  m = /^删\s*第?\s*(\d+)\s*段?\s*$/.exec(s)
  if (m) {
    const i = parseInt(m[1], 10) - 1
    if (!(i >= 0 && i < segCount)) return { matched: true, ok: false, msg: `没有第 ${m[1]} 段（本方案 ${segCount} 段）` }
    if (segCount <= 2) return { matched: true, ok: false, msg: '至少要留 2 段（想整体重来就回 `重选`）' }
    const gone = segs.splice(i, 1)[0]
    if (i === 0) segs[0].kind = 'cover'                    // 删掉封面 ⇒ 新首段顶上当封面
    if (i >= segs.length) segs[segs.length - 1].kind = 'end'
    return { matched: true, ok: true, msg: `已删掉第 ${m[1]} 段（原「${(gone.title || []).join(' / ')}」）`, plan: next }
  }

  // ③ 改第 n 段的某个字段
  m = /^改\s*第?\s*(\d+)\s*段?\s*(标题|标签|角标|信息点|用图|版式|结构|类型|文字层|字号)\s*[=:：]\s*([\s\S]+)$/.exec(s)
  if (!m) return { matched: false, ok: false, msg: '' }
  const i = parseInt(m[1], 10) - 1
  const field = m[2]
  const val = String(m[3] || '').trim()
  if (!(i >= 0 && i < segCount)) return { matched: true, ok: false, msg: `没有第 ${m[1]} 段（本方案 ${segCount} 段）` }
  const seg = segs[i]
  const head = `已改：第 ${i + 1} 段`

  // ★VF_DAILY_V21：文字层（治"同质化"的两个新旋钮）—— 只动排版，不动结构
  if (field === '文字层') {
    const id = TEXT_LAYER_ALIASES[val] || TEXT_LAYER_ALIASES[val.toLowerCase()] || ''
    if (!id) {
      return { matched: true, ok: false, msg: `不认识的文字层「${val}」—— 可选：` + PLAN_TEXT_TYPES.map((t) => `${t.name}(${t.id})`).join(' / ') }
    }
    seg.type = id
    return { matched: true, ok: true, msg: `${head}文字层 → ${(PLAN_TEXT_TYPES.find((t) => t.id === id) || {}).name || id}`, plan: next }
  }
  if (field === '字号') {
    const v = Number(val.replace(/[×xX倍]/g, ''))
    const hit = PLAN_TSCALES.find((x) => Math.abs(x - v) < 0.001)
    if (!hit) return { matched: true, ok: false, msg: `字号档只能给 ${PLAN_TSCALES.join(' / ')}（1 = 默认；只影响这一段标题的大小）` }
    seg.scale = hit
    return { matched: true, ok: true, msg: `${head}字号档 → ${hit}`, plan: next }
  }

  if (field === '标题') {
    const lines = val.split(/[/｜|]/).map((x) => clip(x, 12)).filter(Boolean).slice(0, 2)
    if (!lines.length) return { matched: true, ok: false, msg: '标题要写点字，例如 `改 1 标题=凌晨四点/第一锅汤`（斜杠分行）' }
    seg.title = lines.length === 1 ? [lines[0], (seg.title || [])[1] || ''].filter(Boolean) : lines
    return { matched: true, ok: true, msg: `${head}标题 → ${seg.title.join(' / ')}`, plan: next }
  }
  if (field === '标签') {
    seg.kicker = clip(val, 20)
    return { matched: true, ok: true, msg: `${head}标签 → ${seg.kicker}`, plan: next }
  }
  if (field === '角标') {
    seg.stamp = clip(val, 10)
    return { matched: true, ok: true, msg: `${head}角标 → ${seg.stamp}`, plan: next }
  }
  if (field === '信息点') {
    const pts = val.split(/[;；]/)
      .map((g) => g.split(/[,，、]/).map((x) => clip(x, 8)).filter(Boolean))
      .filter((g) => g.length).slice(0, 3)
      .map((g) => [g[0], g[1] || ''])
    seg.points = pts
    return { matched: true, ok: true, msg: `${head}信息点 → ${pts.map((p) => p.join('·')).join(' ｜ ') || '（清空）'}`, plan: next }
  }
  if (field === '用图') {
    // ★L2：单段最多 4 张（grid4）；图数变了 ⇒ 结构自动跟着换（免得图数与结构打架）
    const nums = Array.from(new Set((val.match(/\d+/g) || []).map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= maxImg))).slice(0, 4)
    if (!nums.length) return { matched: true, ok: false, msg: `图号要写在 1~${maxImg} 之间（本方案共 ${maxImg} 张素材）` }
    seg.imgs = nums
    seg.src = picks.length ? nums.map((x) => picks[x - 1]?.name || '').filter(Boolean) : seg.src
    const meta = PLAN_LAYOUTS.filter((x) => x.id === String(seg.layout))[0]
    let extra = ''
    if (!meta || nums.length < meta.minImg || nums.length > meta.maxImg) {
      const lid = layoutForCount(nums.length)
      seg.layout = lid
      seg.form = lid === 'hero' ? 'overlay' : (['sticker', 'vertical'].indexOf(lid) >= 0 ? lid : 'overlay')
      extra = `（图数变了 ⇒ 结构自动换成「${(PLAN_LAYOUTS.filter((x) => x.id === lid)[0] || {}).name}」）`
    }
    return { matched: true, ok: true, msg: `${head}用图 → ${nums.join('+')}${extra}`, plan: next }
  }
  if (field === '版式' || field === '结构') {
    const key = val.replace(/\s+/g, '')
    const lid = LAYOUT_ALIASES[key]
    if (lid) {
      const meta = PLAN_LAYOUTS.filter((x) => x.id === lid)[0]!
      const have = (seg.imgs || []).length
      if (have < meta.minImg || have > meta.maxImg) {
        const need = meta.minImg === meta.maxImg ? String(meta.minImg) : (meta.minImg + '~' + meta.maxImg)
        return { matched: true, ok: false, msg: `「${meta.name}」要 ${need} 张图，这段现在是 ${have} 张 —— 先用 \`改 ${i + 1} 用图=…\` 把图配好` }
      }
      seg.layout = lid
      seg.form = lid === 'hero' ? 'overlay' : (['sticker', 'vertical'].indexOf(lid) >= 0 ? lid : 'overlay')
      return { matched: true, ok: true, msg: `${head}结构 → ${meta.name}`, plan: next }
    }
    const fid = FORM_ALIASES[key]
    if (fid) {
      seg.form = fid
      seg.layout = fid === 'overlay' ? 'hero' : fid
      return { matched: true, ok: true, msg: `${head}版式 → ${FORM_LABEL[fid]}`, plan: next }
    }
    return { matched: true, ok: false, msg: `不认识的版式/结构「${val}」—— 可选：${PLAN_LAYOUTS.map((x) => x.name).join(' / ')}` }
  }
  if (field === '类型') {
    const k = KIND_ALIASES[val.replace(/\s+/g, '')]
    if (!k) return { matched: true, ok: false, msg: `不认识的类型「${val}」—— 可选：封面 / 正片 / 结尾` }
    seg.kind = k
    return { matched: true, ok: true, msg: `${head}类型 → ${KIND_LABEL[k]}`, plan: next }
  }
  return { matched: true, ok: false, msg: '这条改法没看懂' }
}
