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

/** 抽 JSON（模型爱包代码块/加解释 —— 取第一个 { 到最后一个 }） */
export function extractJson(txt: string): any | null {
  const s = String(txt || '')
  const i = s.indexOf('{'), j = s.lastIndexOf('}')
  if (i < 0 || j <= i) return null
  try { return JSON.parse(s.slice(i, j + 1)) } catch { return null }
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
  if (want && want !== last) return { theme: want, rotated: false, from: '' }
  const ban = new Set(recent.slice(0, 2).filter(Boolean))
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

/** 给 AI 的任务书（看图前排段；纯字符串，可单测"约束有没有写进提示词"） */
export function aiPrompt(n: number, topic: string, opts?: { lastTheme?: string }): string {
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
    // ★VF_DAILY_V21（2026-10-14 用户「依然是文字排版同质化严重」）：**文字层**是新旋钮 ——
    //   结构决定"图怎么摆"，文字层决定"字怎么说话"；同一结构配不同文字层 = 完全不同的观感。
    '【文字层】（可选，每段 `type`；**这是"看着像同一套"的主要来源**，请把相邻段配成不同的）：',
    PLAN_TEXT_TYPES.map((t) => `  · ${t.id}（${t.name}）：${t.look}`).join('\n'),
    '  不确定就留空 —— 服务端会按段序自动轮换四种，保证一份里不只有一张脸。',
    '【字号档】（可选，每段 `scale`，只影响**这一段**标题/数字的大小）：' + PLAN_TSCALES.join(' | ')
    + '　（1 = 默认；想强调某段可用 1.15 / 1.3，想让它"退后"用 0.9。信息点字号有 22px 下限，不会变小到看不清）',
    // ★VF_DAILY_V22：借 oil-ui 的三条硬口径（去同质化 / 减法 / 首屏），改成我们段落级的说法
    '【去同质化·硬要求】（这条会被服务端**机器自检**，不合格自动错开并如实告知）：',
    '  · **相邻两段的"方向"最多只能共享一项** —— 方向 = ①摆图法(layout) ②文字层(type) ③取景(place) ④字号档(scale)；',
    '  · 说人话：**别连着两段同一个摆图法又同一个文字层**；看着像就换摆图法/文字层，**而不是只换颜色**。',
    '【减法·每段一个焦点】（"每页一个视觉焦点，删掉一切无助于理解的文案、线条和框"）：',
    '  · 每段只讲一件事（一张主图 或 一个大标题），**信息点能少不多**，别为了填满而塞；',
    '【首屏给谁看】（浏览/干活类页面首屏就是内容；**说服类才需要"开场版式"**）：',
    '  · 这份是**展示/说服**用 ⇒ 第 1 段（封面）要有开场版式：一句立得住的标题 + 一张最有力的图，**不要信息堆叠**。',
    last
      ? `⚠️ 上一次你交付用的是「${themeName(last)}」（${last}）—— **这次必须换一个不同的皮肤**，`
        + '否则两份产物看着像同一套（用户原话：「感觉没什么区别」）。除非这批素材的气质明显更适合它。'
      : '（首次做：按素材气质挑即可。）',
    '  也可以给 `custom` 自定配色（4 个 hex：paper 底 / ink 正文 / dim 次要 / accent 点缀）——',
    '  系统会做对比度体检（正文/底 ≥4.5、次要 ≥3.0、强调 ≥2.0），不达标会自动换回预设皮肤。',
    '',
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
export function buildPlanFromSegs(segs: any[], topicRaw: string, motion = 'normal', theme?: string, custom?: any, imageNames?: string[]): any {
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
