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

const DEF = {
  eyebrow: 'SHOWREEL 2026',
  title1: 'AI 营销系统',
  title2: '一次成型',
  sub: '30 秒看完它能做什么',
  wallTitle: '一次生成 · 全套素材',
  wallSub: '海报、文案、成片，出自同一套系统',
  rows: ['素材不动 · 动效层加信息', '同一份文案 · 每次换风格', '逐帧可复现 · 可验收'],
  glassTitle: '数据驱动增长',
  glassSub: '投放 · 素材 · 转化，一屏看清',
  dashTitle: '实时投放监控',
  dashSub: '每 5 分钟刷新一次',
  fullTitle: '从文案到成片',
  fullSub: '一句话，四步出片',
  chips: ['文案', '海报', '配音', '成片'],
  gridTitle: '四种风格 · 同一套流程',
  gridSub: '同一份素材，也能换个样子',
  tail: '一次生成，批量出片',
  foot: 'AiMarketing 视频工厂 · 2026 年 10 月',
}

/** 编排：media = 素材文件名数组（**相对 film.json 所在目录**，如 'media/a.jpg'） */
export function arrange(opts = {}) {
  const o = Object.assign({}, DEF, opts.slots || {})
  const M = (opts.media || []).filter(Boolean)
  const at = (i) => (M.length ? M[i % M.length] : '')
  const take = (from, n) => { const out = []; for (let k = 0; k < n; k++) { const m = at(from + k); if (m) out.push(m) } return out }
  const on = opts.structures && opts.structures.length ? new Set(opts.structures) : null
  const want = (id) => !on || on.has(id)

  const scenes = []
  if (want('opening-hero')) scenes.push({ shotgroup: 'sg-opening-tiltcard', structure: 'opening-hero', dur: 4.0,
    slots: { eyebrow: o.eyebrow, title1: o.title1, title2: o.title2, sub: o.sub, foot: o.foot }, media: take(0, 1) })
  if (want('works-wall')) scenes.push({ shotgroup: 'sg-works-wall', structure: 'works-wall', dur: 5.0,
    slots: { title: o.wallTitle, sub: o.wallSub, rows: o.rows, foot: o.foot }, media: take(1, 3) })
  if (want('glass-product')) scenes.push({ shotgroup: 'sg-glass-cards', structure: 'glass-product', dur: 5.0,
    slots: { eyebrow: 'PRODUCT ANALYTICS', title: o.glassTitle, sub: o.glassSub, value: o.value || '78.5', unit: o.unit || '%' }, media: [] })
  if (want('data-dashboard')) scenes.push({ shotgroup: 'sg-dashboard', structure: 'data-dashboard', dur: 5.0,
    slots: { eyebrow: 'LIVE DASHBOARD', title: o.dashTitle, sub: o.dashSub, value: o.dashValue || '45', unit: '%', foot: o.foot }, media: [] })
  if (want('fullbleed')) scenes.push({ shotgroup: 'sg-fullbleed-caption', structure: 'fullbleed', dur: 5.5,
    slots: { eyebrow: 'WORKFLOW', title: o.fullTitle, sub: o.fullSub, chips: o.chips, foot: o.foot }, media: take(4, 1) })
  if (want('grid-2x2')) scenes.push({ shotgroup: 'sg-grid-4', structure: 'grid-2x2', dur: 5.5,
    slots: { title: o.gridTitle, sub: o.gridSub, nums: ['01', '02', '03', '04'], tail: o.tail, foot: o.foot }, media: take(5, 4) })

  const total = +scenes.reduce((a, s) => a + s.dur, 0).toFixed(2)
  return { id: opts.id || 'auto-' + Date.now(), name: opts.name || '30 秒素材片（自动编排）', pack: opts.pack || 'reel-showcase',
    fps: 25, note: '由 tools/arrange.mjs 自动编排；可手工微调 scenes 顺序/时长/文案/素材。', total, scenes }
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
