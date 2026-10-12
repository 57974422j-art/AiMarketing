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

/** 段级排版可选值（引擎 data-form / data-place 的白名单） */
export const PLAN_FORMS = ['overlay', 'sticker', 'vertical']
export const PLAN_PLACES = ['cover', 'mat']

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

/** 给 AI 的任务书（看图前排段；纯字符串，可单测"约束有没有写进提示词"） */
export function aiPrompt(n: number, topic: string): string {
  const cat = PLAN_LAYOUTS
    .map((l) => `  · ${l.id}（${l.name}，${l.minImg === l.maxImg ? l.minImg : l.minImg + '~' + l.maxImg} 张图）：${l.look}`)
    .join('\n')
  return [
    '你是「日报落地页」的排版编排员。用户挑好了 ' + n + ' 张素材图（下面按顺序编号 1..' + n + '），主题是「' + (topic || '（未给）') + '」。',
    '请**先看图**，再给一份分段方案（JSON）。**每一段都要从下面的结构库里挑一个 `layout`** —— 整份要有变化，别 8 段一个样。',
    '',
    '【段结构库】（`layout` 只能取这些 id；**每段的图数必须与该结构匹配**）',
    cat,
    '',
    '【皮肤库】（**按素材气质挑一个**放进 `theme`；不挑就用 paper-daily）',
    PLAN_THEMES.map((t) => `  · ${t.id}（${t.name}）：${t.look}`).join('\n'),
    '  也可以给 `custom` 自定配色（4 个 hex：paper 底 / ink 正文 / dim 次要 / accent 点缀）——',
    '  系统会做对比度体检（正文/底 ≥4.5、次要 ≥3.0、强调 ≥2.0），不达标会自动换回预设皮肤。',
    '',
    '硬约束（违反即作废）：',
    '1. segments 数组 2~8 段；**每张图至少用一次**（可以重复用）；单段图数必须等于所选结构允许的张数。',
    '2. 首段当封面（用 hero / sticker / split / vertical 之一），末段建议用 quote 或 hero 收尾。',
    '3. **至少用到 3 种不同 layout，且相邻两段 layout 不能相同**（这是"看起来不重样"的关键）。',
    '4. 每段 title = **两行短句**（每行 ≤12 个汉字），像报纸小标题；不要长句、不要感叹号堆砌。',
    '5. 每段 points 最多 3 组、每组两个短词（各 ≤8 字），如 ["手切现片","立盘不掉"]；**只写你在图里真看到的东西**，不许编门店名/评分/价格/销量。',
    '6. kicker = 段上的小标签（≤20 字，如「后厨 · 手作」）；封面可给 stamp（≤10 字，如「封面故事」）。'
    + ' place 取 "cover"（图铺满）或 "mat"（相纸留边）。',
    '7. 简体中文，不用 emoji。',
    '',
    '只输出 JSON（不要解释、不要 markdown 代码块）：',
    '{"theme":"night-gold","motion":"calm|normal|lively","segments":[{"layout":"hero","kicker":"...","stamp":"...","title":["第一行","第二行"],"imgs":[1],"points":[["短词","短词"]],"place":"cover"}]}',
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
    out.push({
      kind, layout, form,
      kicker: clip(it.kicker, 20) || `日报 · ${topic || '素材记录'}`,
      stamp: kind === 'cover' ? clip(it.stamp, 10) : '',
      title, imgs, points: pts, place,
    })
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
  return { segs: out, added, fixes }
}

/** 把段数组组装成引擎配置（★L4：皮肤由 AI 挑，`theme` / `custom` 透传给引擎做对比度体检） */
export function buildPlanFromSegs(segs: any[], topicRaw: string, motion = 'normal', theme?: string, custom?: any): any {
  const topic = String(topicRaw || '').trim().slice(0, 24)
  const meta: any = {
    issue: '第 01 期',
    accent: DAILY_STYLE.accent, paper: DAILY_STYLE.paper,   // 老字段留着（兼容），实际色值由引擎按 theme 定
    title: `日报落地页 · ${topic || '素材记录'}`,
    theme: String(theme || 'paper-daily'),
  }
  if (custom && typeof custom === 'object') meta.custom = custom
  return {
    meta,
    motion: normMotion(motion),
    imageDir: 'images',
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
  const mat = String(s.place) === 'mat' ? ' · 相纸留边' : ''
  return `${k} · ${f}${mat}`
}
export function durOf(kind: string): number { return kind === 'cover' ? 3.4 : 3.2 }
export function planDuration(plan: any): number {
  const segs: any[] = Array.isArray(plan?.segments) ? plan.segments : []
  return segs.reduce((a, s) => a + durOf(String(s.kind)), 0)
}

export function formatDailyPlan(plan: any, o: { topic: string; picks: PlanPick[]; by: 'ai' | 'fallback'; note?: string }): string {
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
    : `（⚠️ AI 这轮没排出方案${o.note ? '：' + o.note : ''} → 用的是**系统保底版式**）`)
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
  picks: PlanPick[]; by: 'ai' | 'fallback'; note?: string; hintExtra?: string; topic?: string
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
      title: Array.isArray(s.title) ? s.title.map((x: any) => String(x)) : [String(s.title || '')],
      points: (Array.isArray(s.points) ? s.points : []).map((p: any) => (Array.isArray(p) ? p.filter(Boolean).join('·') : String(p))),
      imgs: Array.isArray(s.imgs) ? s.imgs : [],
      src: Array.isArray(s.src) ? s.src : [],
    })),
  }
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
  m = /^改\s*第?\s*(\d+)\s*段?\s*(标题|标签|角标|信息点|用图|版式|结构|类型)\s*[=:：]\s*([\s\S]+)$/.exec(s)
  if (!m) return { matched: false, ok: false, msg: '' }
  const i = parseInt(m[1], 10) - 1
  const field = m[2]
  const val = String(m[3] || '').trim()
  if (!(i >= 0 && i < segCount)) return { matched: true, ok: false, msg: `没有第 ${m[1]} 段（本方案 ${segCount} 段）` }
  const seg = segs[i]
  const head = `已改：第 ${i + 1} 段`

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
