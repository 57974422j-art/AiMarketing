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
  gridTitle: '', gridSub: '',
  tail: '', foot: '',
}

/** 编排：media = 素材文件名数组（**相对 film.json 所在目录**，如 'media/a.jpg'） */
export function arrange(opts = {}) {
  const o = Object.assign({}, DEF, opts.slots || {})
  const M = (opts.media || []).filter(Boolean)
  const on = opts.structures && opts.structures.length ? new Set(opts.structures) : null
  const want = (id) => !on || on.has(id)

  // ══ ★VF_ARRANGE_V2（2026-10-09 用户实测「我选 17 个它做 8 个镜头」）══
  //   旧实现**固定 6 段、只用 9 张**（take 分配 1+3+0+0+1+4，注释里写"多了会用完为止"但代码没实现）。
  //   现口径：**素材驱动** —— 段数与结构按素材张数决定，**每张素材都必须出镜且只出一次**：
  //     开场封面 ×1  →  满幅 ×2（气势段）  →  之后 四宫格(4) / 作品墙(3) 交替  →  不够再补满幅 ×1
  //     结尾再加一张"无图结尾卡"（**不带任何编造数字**：value/kpi 一律不写）
  //   实测 17 张 = 开场1 + 满幅2 + 墙3 + 格4 + 墙3 + 格4 + 结尾卡 = 8 段、17 张全部出镜 ✓
  const scenes = []
  let i = 0
  if (i < M.length && want('opening-hero')) {
    scenes.push({ shotgroup: 'sg-opening-tiltcard', structure: 'opening-hero', dur: 4.0,
      slots: { eyebrow: o.eyebrow, title1: o.title1, title2: o.title2, sub: o.sub, foot: o.foot }, media: M.slice(i, i + 1) })
    i += 1
  }
  let lead = 0   // 前两段做成满幅（开场后有气势；也保证"大图"占比）
  while (i < M.length) {
    const left = M.length - i
    if (lead < 2 && want('fullbleed')) {
      scenes.push({ shotgroup: 'sg-fullbleed-caption', structure: 'fullbleed', dur: 4.5,
        slots: { eyebrow: o.eyebrow, title: o.fullTitle, sub: o.fullSub, chips: o.chips, foot: o.foot }, media: M.slice(i, i + 1) })
      i += 1; lead += 1; continue
    }
    const useGrid = scenes.length % 2 === 0
    if (left >= 4 && useGrid && want('grid-2x2')) {
      scenes.push({ shotgroup: 'sg-grid-4', structure: 'grid-2x2', dur: 5.0,
        slots: { title: o.gridTitle, sub: o.gridSub, nums: ['01', '02', '03', '04'], tail: o.tail, foot: o.foot }, media: M.slice(i, i + 4) })
      i += 4; continue
    }
    if (left >= 3 && want('works-wall')) {
      scenes.push({ shotgroup: 'sg-works-wall', structure: 'works-wall', dur: 4.5,
        slots: { title: o.wallTitle, sub: o.wallSub, rows: o.rows, foot: o.foot }, media: M.slice(i, i + 3) })
      i += 3; continue
    }
    if (left >= 4 && want('grid-2x2')) {
      scenes.push({ shotgroup: 'sg-grid-4', structure: 'grid-2x2', dur: 5.0,
        slots: { title: o.gridTitle, sub: o.gridSub, nums: ['01', '02', '03', '04'], tail: o.tail, foot: o.foot }, media: M.slice(i, i + 4) })
      i += 4; continue
    }
    if (want('fullbleed')) {
      scenes.push({ shotgroup: 'sg-fullbleed-caption', structure: 'fullbleed', dur: 4.0,
        slots: { eyebrow: o.eyebrow, title: o.fullTitle, sub: o.fullSub, chips: o.chips, foot: o.foot }, media: M.slice(i, i + 1) })
      i += 1; continue
    }
    break   // 结构被限死且排不下 ⇒ 停（绝不重复素材）
  }
  // 结尾卡：只有调用方给了文案才写；数字类一律不写（★不再 default 78.5%/45%）
  if (want('glass-product')) {
    const closeSlots = { eyebrow: o.eyebrow, title: o.glassTitle, sub: o.glassSub }
    if (o.value) closeSlots.value = o.value
    if (o.unit) closeSlots.unit = o.unit
    if (Array.isArray(o.kpi) && o.kpi.length >= 3) closeSlots.kpi = o.kpi
    scenes.push({ shotgroup: 'sg-glass-cards', structure: 'glass-product', dur: 4.0, slots: closeSlots, media: [] })
  }

  const total = +scenes.reduce((a, s) => a + s.dur, 0).toFixed(2)
  const used = scenes.reduce((a, s) => a + (s.media || []).length, 0)
  return { id: opts.id || 'auto-' + Date.now(), name: opts.name || 'HTML成片（自动编排）', pack: opts.pack || 'reel-showcase',
    fps: 25, note: '由 tools/arrange.mjs 自动编排（★VF_ARRANGE_V2：素材驱动，' + used + '/' + M.length + ' 张出镜）；可手工微调 scenes。',
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
    slots: { title1: arg('title', DEF.title1), title2: arg('title2', DEF.title2), sub: arg('sub', DEF.sub) },
  })
  const out = arg('out', '')
  if (out) { fs.writeFileSync(out, JSON.stringify(film, null, 2) + '\n', 'utf8'); console.log('已写：' + out) }
  console.log(`编排：${film.scenes.length} 段 · ${film.total}s · 风格包 ${film.pack}`);
  film.scenes.forEach((s, i) => console.log(`  ${i + 1}. ${s.structure.padEnd(16)} ${s.dur}s  素材×${(s.media || []).length}`))
}
