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
  const want = Math.min(8, Math.max(3, n))
  return [
    '你是「日报落地页」的排版编排员。用户挑好了 ' + n + ' 张素材图（下面按顺序编号 1..' + n + '），主题是「' + (topic || '（未给）') + '」。',
    '请**先看图**，再给一份分段方案（JSON）。',
    '',
    '硬约束（违反即作废）：',
    '1. segments 数组 3~8 段（这批素材建议 ' + want + ' 段）；**每张图至少出现一次**；单段最多 2 张图（"imgs" 写 1..' + n + ' 的编号）。',
    '2. 第一段 kind="cover"，最后一段 kind="end"，中间 kind="feature"。',
    '3. 每段 title = **两行短句**（每行 ≤12 个汉字），像报纸小标题；不要长句、不要感叹号堆砌。',
    '4. 每段 points 最多 3 组、每组两个短词（各 ≤8 字），如 ["手切现片","立盘不掉"]；**只写你在图里真看到的东西**，不许编门店名/评分/价格/销量。',
    '5. kicker = 段上的小标签（≤20 字，如「后厨 · 手作」）；只有封面给 stamp（≤10 字，如「封面故事」）。',
    '6. form 取值 "overlay"（文字压大图）| "sticker"（贴纸式标题）| "vertical"（竖排标题）；place 取值 "cover" | "mat"；相邻段不要连续相同。',
    '7. 简体中文，不用 emoji。',
    '',
    '只输出 JSON（不要解释、不要 markdown 代码块）：',
    '{"motion":"calm|normal|lively","segments":[{"kind":"cover","kicker":"...","stamp":"...","title":["第一行","第二行"],"imgs":[1],"points":[["短词","短词"]],"form":"overlay","place":"cover"}]}',
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
export function normSegs(raw: any, n: number, topic: string): { segs: any[]; added: number } {
  const list = Array.isArray(raw?.segments) ? raw.segments : (Array.isArray(raw) ? raw : [])
  const out: any[] = []
  for (const it of list) {
    if (!it || typeof it !== 'object') continue
    const imgs = Array.from(new Set((Array.isArray(it.imgs) ? it.imgs : [])
      .map((x: any) => parseInt(x, 10))
      .filter((x: number) => x >= 1 && x <= n))).slice(0, 2)
    if (!imgs.length) continue
    const k0 = String(it.kind || '')
    const kind = ['cover', 'feature', 'end'].indexOf(k0) >= 0 ? k0 : 'feature'
    let title = (Array.isArray(it.title) ? it.title : [it.title]).map((x: any) => clip(x, 12)).filter(Boolean).slice(0, 2)
    if (!title.length) title = ['现场记录', `${out.length + 1} / ${n}`]
    const pts = (Array.isArray(it.points) ? it.points : [])
      .map((p: any) => (Array.isArray(p) ? [clip(p[0], 8), clip(p[1], 8)] : [clip(p, 8), '']))
      .filter((p: string[]) => !!p[0]).slice(0, 3)
    const form = PLAN_FORMS.indexOf(String(it.form)) >= 0 ? String(it.form) : 'overlay'
    const place = PLAN_PLACES.indexOf(String(it.place)) >= 0 ? String(it.place) : 'cover'
    out.push({
      kind,
      kicker: clip(it.kicker, 20) || `日报 · ${topic || '素材记录'}`,
      stamp: kind === 'cover' ? clip(it.stamp, 10) : '',
      title, imgs, points: pts, form, place,
    })
  }
  if (!out.length) return { segs: [], added: 0 }
  // ⚠️ 先补漏图、**最后**才钉首尾 —— 顺序反了会出事：只有 1 段时 out[0] 先被设成 cover、
  //    紧接着"末段=end"又把它改成 end（单段方案首尾同段，首段必须是封面）。
  const used = new Set<number>()
  out.forEach((s) => (s.imgs || []).forEach((x: number) => used.add(x)))
  let added = 0
  for (let k = 1; k <= n && out.length < 10; k++) {
    if (used.has(k)) continue
    out.push({
      kind: 'feature', kicker: `日报 · ${topic || '素材记录'}`, stamp: '',
      title: ['现场一张', `${k} / ${n}`], imgs: [k], points: [], form: 'overlay', place: 'cover',
    })
    added++
  }
  out[0].kind = 'cover'
  out[0].stamp = out[0].stamp || '封面故事'
  if (out.length > 1) out[out.length - 1].kind = 'end'
  return { segs: out, added }
}

/** 把段数组组装成引擎配置（风格固定 = DAILY_STYLE） */
export function buildPlanFromSegs(segs: any[], topicRaw: string, motion = 'normal'): any {
  const topic = String(topicRaw || '').trim().slice(0, 24)
  return {
    meta: { issue: '第 01 期', accent: DAILY_STYLE.accent, paper: DAILY_STYLE.paper, title: `日报落地页 · ${topic || '素材记录'}` },
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
    return {
      kind,
      kicker: `日报 · ${topic || '素材记录'} · 其${CN[i] || i + 1}`,
      stamp: kind === 'cover' ? '第 01 期' : '',
      title: [t1, t2],
      imgs: [i + 1],
      points: [['实拍', '原图'], ['细节', '特写'], ['现场', '记录']],
      place: 'cover',
      form: i === 0 ? 'overlay' : (i === 1 ? 'sticker' : 'vertical'),
      src: [nm],    // 只在生成时用来记录对应素材（不进 HTML）；**统一是数组**（与 attachSrc 同形）
    }
  })
  return buildPlanFromSegs(segs, topic)
}

/* ─────────────── 给人看的方案清单（风格/页数/排版/文字） ─────────────── */

export function layoutLabel(s: any): string {
  const k = s.kind === 'cover' ? '封面' : (s.kind === 'end' ? '结尾' : '正片')
  const f = (s.imgs || []).length >= 2 ? '双图并排' : '单图通栏'
  return `${k} · ${f}`
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
  L.push('📄「日报落地页」第 3 步 / 共 4 步 · **方案确认**')
  L.push('')
  L.push(`风格：**${DAILY_STYLE.name}**（本轮唯一风格，先定型）｜动效档：${plan?.motion || 'normal'}`)
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
  L.push('（生成后下载 HTML，把你选的图**按上面「用图」的编号**命名成 `1.jpg…N.jpg` 放进同目录 `images/` 文件夹即为真图）')
  return L.join('\n')
}
