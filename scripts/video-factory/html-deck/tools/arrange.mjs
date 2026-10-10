#!/usr/bin/env node
/**
 * ★VF_ARRANGE_V1 —— 「自动编排」：素材 + 风格包 → 一条片的结构（film.json）
 * =============================================================================
 * 用户的活只有两件：**给素材**、**选风格**。编排不让他做 —— 由这里按规则生成，
 * 他可以在页面上微调（删段/改文案），但不必须懂"什么结构配什么素材"。
 *
 * 编排规则（v0.1，6 段 ≈ 30 秒；素材不够就把该段的素材留空 —— 纯图形段也成立）：
 *   ① 开场      opening-hero     4.0s  素材 ×1（斜置卡）
 *   ② 作品墙    works-wall       5.0s  素材 ×3 错落
 *   ③ 数据卡    glass-product    5.0s  纯图形
 *   ④ 数据大屏  data-dashboard   5.0s  纯图形
 *   ⑤ 全屏满幅  fullbleed        5.5s  素材 ×1（Ken Burns + 遮罩大字）
 *   ⑥ 四宫格    grid-2x2         5.5s  素材 ×4
 *   素材按顺序轮转分配（不够则重复、多了会用完为止）。
 * 用法（CLI）：node tools/arrange.mjs --media a.jpg,b.jpg --title "AI 营销" --title2 "一次生成" --out films/auto.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// ★VF_ARRANGE_V2（2026-10-09 用户实测两条硬伤，全部来自下面这个 DEF）：
//   ① **文案全是产品自夸**（AI 营销系统 / 一次成型 / 数据驱动增长 / 实时投放监控 / 从文案到成片…）
//      ⇒ 用户拍的火锅素材配上这套词，片子等于"文不对题"（用户原话："它做8个镜头，几个纯PPT"）。
//   ② **写死的示例数字**（value 78.5 / 45、加上渲染层 kpi 12.4万/4.8%/3.2千）
//      ⇒ 直接违反反 AI 味②「不许编造数据」。
//   现口径：**DEF 全清空**（文案只来自调用方 `slots`，没给就留空 —— 空比编造好）；
//   数字类一律不写默认。场景编排也改成**素材驱动**（见下面 arrange 里 VF_ARRANGE_V2 那段）：
//   段数与结构按素材张数决定，**所有素材必须出镜**。
const DEF = {
  eyebrow: '', title1: '', title2: '', sub: '',
  wallTitle: '', wallSub: '', rows: [],
  glassTitle: '', glassSub: '',
  dashTitle: '', dashSub: '',
  fullTitle: '', fullSub: '', chips: [],
  plateTitle: '', plateSub: '',   // ★VF_ARRANGE_V3：完整大图页的文案（没给就空，交给 AI 填）
  gridTitle: '', gridSub: '',
  tail: '', foot: '',
}

/** 编排：media = 素材文件名数组（**相对 film.json 所在目录**，如 'media/a.jpg'） */
export function arrange(opts = {}) {
  const o = Object.assign({}, DEF, opts.slots || {})
  const M = (opts.media || []).filter(Boolean)
  const on = opts.structures && opts.structures.length ? new Set(opts.structures) : null
  const want = (id) => !on || on.has(id)
  // ══ ★VF_RATIO_V1（2026-10-10 用户定案）：**大图 : 填图 比例**由用户/AI 给（默认 5:5）══
  //   为什么要它：用户原话「图片素材越多，越能解决相似度；这样也能减少 AI 绘图的压力」
  //     ⇒ 与其让 AI 不停发明新版面，不如**用更多素材填更多页**、并用比例条控制"完整大图页"的密度。
  //   口径：`opts.plateRatio`（0~1）= 完整大图页占**素材张数**的比例；越界夹回并打印（不静默）。
  //   ⚠️ 与旧硬口径（每 10 张 3~4 张）的关系：那条被这条**取代** —— 见 render-film 的
  //      "声明比例 vs 实测"校验（AI/用户声明多少，机器就核对多少）。
  const RATIO_RAW = Number(opts.plateRatio)
  const RATIO = Number.isFinite(RATIO_RAW) ? Math.min(1, Math.max(0, RATIO_RAW)) : 0.5
  if (Number.isFinite(RATIO_RAW) && RATIO_RAW !== RATIO) console.log('[arrange] plateRatio=' + RATIO_RAW + ' 越界 ⇒ 夹回 ' + RATIO)
  // ★VF_SPEC_V1（声明驱动编排）：spec.image.complete=false 才允许用 fullbleed（满屏**裁切**）；
  //   默认（true）= 声明"图片保证完整" ⇒ 剩 1~2 张的零头**并入完整大图**，不留裁切页。
  //   为什么这么做而不是放宽闸门：**AI 声明了什么，编排就得照做**（这正是"AI 自己规划 + 机器验收"）。
  const COMPLETE = !(opts.spec && opts.spec.image && opts.spec.image.complete === false)

  // ══ ★VF_ARRANGE_V2（2026-10-09 用户实测「我选 17 个它做 8 个镜头」）══
  //   旧实现**固定 6 段、只用 9 张**（take 分配 1+3+0+0+1+4，注释里写"多了会用完为止"但代码没实现）。
  //   现口径：**素材驱动** —— 段数与结构按素材张数决定，**每张素材都必须出镜且只出一次**：
  //     开场封面 ×1  →  满幅 ×2（气势段）  →  之后 四宫格(4) / 作品墙(3) 交替  →  不够再补满幅 ×1
  //     结尾再加一张"无图结尾卡"（**不带任何编造数字**：value/kpi 一律不写）
  //   实测 17 张 = 开场1 + 满幅2 + 墙3 + 格4 + 墙3 + 格4 + 结尾卡 = 8 段、17 张全部出镜 ✓
  // ══ ★VF_ARRANGE_V3（2026-10-10 用户定案「每 10 张图必须有 3~4 张**完整大图**」）══
  //   先看清 V2 排出来的是什么（用户在成片里实测到的病）：
  //     开场1 + 满幅2 + 墙3 + 格4 + 墙3 + 格4 + 结尾卡 —— 满幅是**裁切满屏**、墙/格是**小图**
  //     ⇒ 完整大图 **0 张**，而且"每帧 3 个图去填充、页页一个模子"。
  //   现口径（确定性、素材不重排、每张只出一次）：
  //     ① 开场 opening-hero ×1
  //     ② 完整大图 p 张：p = round((n-1) × 0.35) ⇒ 占比落 30%~40%（**每 10 张 3~4 张**）；
  //        两种构图 plate-top / plate-bottom **交替** ⇒ 有大图配额、又不会页页同构；
  //     ③ 余下素材填多图页：先 grid-2x2(4) 再 works-wall(3)；零头 1~2 张走 fullbleed(满屏)；
  //     ④ **交错**：多图页后跟 1~2 张完整大图 ⇒ 相邻两页页型必然不同（治"前片一律"）。
  const n = M.length
  const scenes = []
  let i = 0
  const PLATE = ['plate-top', 'plate-bottom']
  const canPlate = want('plate-top') && want('plate-bottom')
  const plateSt = (k) => PLATE[k % 2]
  const plateSlots = () => ({ eyebrow: o.eyebrow, title: o.plateTitle, sub: o.plateSub, chips: o.chips, foot: o.foot })
  if (i < n && want('opening-hero')) {
    scenes.push({ shotgroup: 'sg-opening-tiltcard', structure: 'opening-hero', dur: 4.0,
      slots: { eyebrow: o.eyebrow, title1: o.title1, title2: o.title2, sub: o.sub, foot: o.foot }, media: M.slice(i, i + 1) })
    i += 1
  }
  // ② 完整大图张数：把"1/2/5 这种排不满多图页"的零头并进完整大图（宁可多一张完整大图，也别留残页）
  // ★VF_RATIO_V1：比例取代旧的写死 0.35（=每 10 张 3~4 张）；比例 0 ⇒ 真的 0 张（不硬塞）
  let p = canPlate ? Math.max(RATIO > 0 ? 1 : 0, Math.round((n - i) * RATIO)) : 0
  if (canPlate) {
    let rest = (n - i) - p
    while (rest === 1 || rest === 2 || rest === 5) { p += 1; rest = (n - i) - p }
  }
  // ③ 多图页清单（★VF_RATIO_V1：**交替**吃 4 张/3 张/1 张 —— 不再"先排满四宫格"）
  //   为什么改：比例条拖到 0（全填图）时，老写法会连排 4 页四宫格 ⇒ 被排版闸门判定
  //   "连续 3 页同页型"而拒渲（闸门是对的：那正是"页页一个模子"）。交替后页型天然错开。
  const multi = []
  let left = (n - i) - p
  while (left > 0) {
    const last = multi.length ? multi[multi.length - 1].structure : ''
    const canG = left >= 4 && want('grid-2x2')
    const canW = left >= 3 && want('works-wall')
    if (canG && last !== 'grid-2x2') { multi.push({ structure: 'grid-2x2', take: 4 }); left -= 4; continue }
    if (canW && last !== 'works-wall') { multi.push({ structure: 'works-wall', take: 3 }); left -= 3; continue }
    // ★VF_SPEC_V1：只有声明"允许裁切"（complete=false）才准走满屏；否则满屏**必裁**会与声明打架
    if (left >= 1 && want('fullbleed') && !COMPLETE) { multi.push({ structure: 'fullbleed', take: 1 }); left -= 1; continue }
    if (canG) { multi.push({ structure: 'grid-2x2', take: 4 }); left -= 4; continue }
    if (canW) { multi.push({ structure: 'works-wall', take: 3 }); left -= 3; continue }
    break   // 结构被限死且排不下 ⇒ 停（绝不重复素材）
  }
  // 零头（通常 1~2 张）：声明"保证完整"且有完整大图能力 ⇒ **并入完整大图**（不留填不满的残页，
  //   也不出现裁切页）；否则退回满屏（声明允许裁切时才是正解）。
  if (left > 0) {
    if (canPlate && COMPLETE) { p += left; left = 0 }
    else if (want('fullbleed')) { while (left > 0) { multi.push({ structure: 'fullbleed', take: 1 }); left -= 1 } }
  }
  // ④ 交错：每个多图页后面跟 1~2 张完整大图（完整大图用完就把剩下的多图页接着排）
  const perMulti = multi.length ? Math.ceil(p / multi.length) : 0
  let pi = 0
  const pushMulti = (m) => {
    const st = m.structure
    if (st === 'grid-2x2') {
      scenes.push({ shotgroup: 'sg-grid-4', structure: st, dur: 5.0,
        slots: { title: o.gridTitle, sub: o.gridSub, nums: ['01', '02', '03', '04'], tail: o.tail, foot: o.foot }, media: M.slice(i, i + 4) })
    } else if (st === 'works-wall') {
      scenes.push({ shotgroup: 'sg-works-wall', structure: st, dur: 4.5,
        slots: { title: o.wallTitle, sub: o.wallSub, rows: o.rows, foot: o.foot }, media: M.slice(i, i + 3) })
    } else {
      scenes.push({ shotgroup: 'sg-fullbleed-caption', structure: st, dur: 4.0,
        slots: { eyebrow: o.eyebrow, title: o.fullTitle, sub: o.fullSub, chips: o.chips, foot: o.foot }, media: M.slice(i, i + 1) })
    }
    i += m.take
  }
  const pushPlate = () => {
    scenes.push({ shotgroup: plateSt(pi) === 'plate-top' ? 'sg-plate-top' : 'sg-plate-bottom',
      structure: plateSt(pi), dur: 4.2, slots: plateSlots(), media: M.slice(i, i + 1) })
    i += 1; pi += 1
  }
  for (const m of multi) {
    if (!canPlate) { pushMulti(m); continue }
    // 交错：多图页 → 完整大图×k（k = 平均分配，保证相邻页型不同）
    const start = scenes.length
    pushMulti(m)
    let put = 0
    while (put < perMulti && pi < p) { pushPlate(); put += 1 }
    // 极端情况（只写 1 个多图页）也不会让两页同构：pushMulti 与 pushPlate 天然不同类型
    void start
  }
  while (pi < p) pushPlate()   // 完整大图没用完（多图页不够）⇒ 全补在尾巴上（仍与前一页不同型）
  if (!canPlate) {
    // 不许用完整大图（结构被限死）⇒ 退回老画法：剩下的素材继续按多图页/满屏铺
    while (i < n) {
      const rest = n - i
      if (rest >= 4 && want('grid-2x2')) { pushMulti({ structure: 'grid-2x2', take: 4 }); continue }
      if (rest >= 3 && want('works-wall')) { pushMulti({ structure: 'works-wall', take: 3 }); continue }
      if (want('fullbleed')) { pushMulti({ structure: 'fullbleed', take: 1 }); continue }
      break   // 结构被限死且排不下 ⇒ 停（绝不重复素材）
    }
  }
  // ★VF_FILMTRANS_V1：给每段定转场（4 种循环 ⇒ 相邻必然不同）
  //   ⚠️ 必须**排在结尾卡之后**调用 —— 否则结尾卡（glass-product）没有 trans，
  //   下游会打一行"有 1 段没带 trans"（用户实测看到过这行，会以为是故障）。
  const TRS = ['fade', 'wipe', 'cut', 'push']
  const applyTrans = () => { scenes.forEach((s, k) => { s.trans = s.trans || TRS[k % TRS.length] }) }
  // 结尾卡：只有调用方给了文案才写；数字类一律不写（★不再 default 78.5%/45%）
  if (want('glass-product')) {
    const closeSlots = { eyebrow: o.eyebrow, title: o.glassTitle, sub: o.glassSub }
    if (o.value) closeSlots.value = o.value
    if (o.unit) closeSlots.unit = o.unit
    if (Array.isArray(o.kpi) && o.kpi.length >= 3) closeSlots.kpi = o.kpi
    scenes.push({ shotgroup: 'sg-glass-cards', structure: 'glass-product', dur: 4.0, slots: closeSlots, media: [] })
  }
  applyTrans()   // ★VF_FILMTRANS_V1：**最后统一**给每一段（含结尾卡）定转场

  const total = +scenes.reduce((a, s) => a + s.dur, 0).toFixed(2)
  const used = scenes.reduce((a, s) => a + (s.media || []).length, 0)
  // ★VF_ARRANGE_V3：把"完整大图配额"作为**可校验的声明**写进片子里 ——
  //   render-film 见到 requirePlate=true 就会**真去数**（每 10 张要有 3~4 张完整大图），
  //   不达标直接拒渲（不许再出现"整片没一张完整大图"的排版）。老片子没这个字段 ⇒ 不受影响。
  const plateCount = scenes.filter((s) => /^plate-/.test(String(s.structure))).length
  return { id: opts.id || 'auto-' + Date.now(), name: opts.name || 'HTML成片（自动编排）', pack: opts.pack || 'reel-showcase',
    fps: 25,
    requirePlate: !!canPlate && n >= 10,
    // ★VF_LAYOUTGATE_V1（2026-10-10 · P4）：同时声明"排版纪律"硬口径 ——
    //   render-film 会去数：相邻页型不得相同 / 页型 ≥3 种 / 图数 ≥2 种且不连三页同图数 /
    //   转场 ≥2 种且不连三页同转场。本编排器**按构造满足**这些（交错 + 转场轮换），
    //   声明它是为了让"手写死结构"的片子被拦下来。
    requireLayout: n >= 8,
    plateCount, imageCount: used,
    // ★VF_RATIO_V1：**把"大图:填图"比例声明出去** —— 出片时 render-film 按"声明 vs 实测"核对
    //   （容差 ±1 张），不再是旧的"每 10 张 3~4 张"写死区间。
    plateRatio: RATIO,
    // ★VF_SPEC_V1：风格语法（L1 构图 / L2 动效 / L3 文本形态）原样带进 film.json，
    //   由 tools/film-to-page.mjs 的语法层解释（本文件只负责"排版纪律与配额"）。
    spec: opts.spec || undefined,
    note: '由 tools/arrange.mjs 自动编排（★VF_ARRANGE_V3 + ★VF_RATIO_V1：素材驱动 · 大图:填图 = '
      + Math.round(RATIO * 10) + ':' + (10 - Math.round(RATIO * 10)) + ' · 完整大图 ' + plateCount + '/' + used
      + '，' + used + '/' + M.length + ' 张出镜）；可手工微调 scenes。',
    total, scenes }
}

/* CLI */
const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isCli) {
  const args = process.argv.slice(2)
  const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
  const media = (arg('media', '') || '').split(',').map((x) => x.trim()).filter(Boolean)
  const film = arrange({
    pack: arg('pack', 'reel-showcase'),
    id: arg('id', 'auto'),
    media,
    // ★VF_RATIO_V1：--plate-ratio 0~1（大图:填图）；不给 ⇒ 默认 5:5
    plateRatio: arg('plate-ratio', '') === '' ? undefined : Number(arg('plate-ratio', '')),
    slots: { title1: arg('title', DEF.title1), title2: arg('title2', DEF.title2), sub: arg('sub', DEF.sub) },
  })
  const out = arg('out', '')
  if (out) { fs.writeFileSync(out, JSON.stringify(film, null, 2) + '\n', 'utf8'); console.log('已写：' + out) }
  console.log(`编排：${film.scenes.length} 段 · ${film.total}s · 风格包 ${film.pack}`);
  film.scenes.forEach((s, i) => console.log(`  ${i + 1}. ${s.structure.padEnd(16)} ${s.dur}s  素材×${(s.media || []).length}`))
}
