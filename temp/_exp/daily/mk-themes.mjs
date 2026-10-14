#!/usr/bin/env node
/**
 * temp/_exp/daily/mk-themes.mjs —— ★VF_DAILY_V23（B 路线：扩皮肤库）的**配方台**。
 * 干三件事（全部离线、可复现）：
 *   ① 候选皮肤（按 Pro Max 的 67 风格名当纲，色值我们自己配）逐个跑**引擎同一套 WCAG 公式**，
 *      不达标的不进库（免得写进去之后被体检回落，等于白加）；
 *   ② 占位渐变按 `mix(paper,ink/accent)` 规则派生（引擎侧同一个规则），保证 20 套风格一致；
 *   ③ 直接吐出两段**可粘贴**的代码（引擎 THEMES 条目 / 计划层 PLAN_THEMES 条目）。
 * 跑法：node temp/_exp/daily/mk-themes.mjs [--dump]
 */
const DUMP = process.argv.includes('--dump')

const hex2rgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!m) return null; const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255] }
const lum = (rgb) => { const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]) }
const contrast = (a, b) => { const A = hex2rgb(a), B = hex2rgb(b); if (!A || !B) return 0; const la = lum(A), lb = lum(B); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }
const mix = (a, b, t) => {
  const A = hex2rgb(a) || [0, 0, 0], B = hex2rgb(b) || [0, 0, 0]
  const c = A.map((x, i) => Math.round(x + (B[i] - x) * t))
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('')
}
/** 占位渐变派生（引擎用同一规则）：3 条只是角度/幅度微差，色相由 paper/ink/accent 决定 */
const grad = (p, i, a) => [
  `linear-gradient(152deg,${mix(p, i, 0.42)} 0%,${mix(a, i, 0.28)} 52%,${mix(a, p, 0.52)} 100%)`,
  `linear-gradient(168deg,${mix(p, i, 0.34)} 0%,${mix(a, i, 0.18)} 55%,${mix(a, p, 0.62)} 100%)`,
  `linear-gradient(138deg,${mix(p, i, 0.50)} 0%,${mix(a, i, 0.36)} 58%,${mix(a, p, 0.44)} 100%)`,
]

/** 候选（id/name/font/四色/look）。色值按"纸-墨-次-点缀"的角色自己配，风格名参照 Pro Max 的分类。 */
const CAND = [
  // ── 餐饮/热食（3 套，与既有 paper-daily/coral-warm 区分）──
  { id: 'copper-pot', name: '铜锅炭火', font: 'serif', paper: '#211813', ink: '#F4E8D8', dim: '#C2AB90', accent: '#D2703A', look: '炭褐底 + 铜橙点缀 + 衬线（火锅/烧烤/夜宵，压得住热气）' },
  { id: 'amber-cafe', name: '琥珀咖啡', font: 'serif', paper: '#F6EFE3', ink: '#2A1F17', dim: '#7B6650', accent: '#9A5B2A', look: '奶油纸 + 琥珀棕（咖啡/烘焙/正餐，温润）' },
  { id: 'wine-red', name: '酒红宴席', font: 'serif', paper: '#1E1216', ink: '#F4E9E4', dim: '#C0A79F', accent: '#B3403F', look: '酒红底 + 暗金红点缀（宴席/私房菜/年节）' },
  // ── 夜/高端 ──
  { id: 'late-night', name: '深夜食堂', font: 'sans', paper: '#14171C', ink: '#F0EADC', dim: '#ACB2B2', accent: '#E0B23C', look: '墨蓝夜底 + 暖黄灯色（深夜食堂/居酒屋）' },
  { id: 'cinema-noir', name: '胶片黑', font: 'sans', paper: '#141414', ink: '#EDEDEA', dim: '#A8A8A2', accent: '#C9A227', look: '近黑底 + 银灰 + 香槟金（电影感/纪实/高端）' },
  { id: 'forest-ink', name: '墨绿松林', font: 'serif', paper: '#16211C', ink: '#EDEFE7', dim: '#A9B5A5', accent: '#C8A96A', look: '松墨绿底 + 米金（茶室/自然/静物）' },
  // ── 清雅/中式 ──
  { id: 'jiangnan', name: '江南宣纸', font: 'serif', paper: '#F3F0E6', ink: '#22242A', dim: '#6E6A5E', accent: '#4E7A6A', look: '宣纸米 + 淡青点缀（江南/茶点/文气）' },
  { id: 'bamboo', name: '竹青', font: 'serif', paper: '#EFF3EC', ink: '#1E2A22', dim: '#64705F', accent: '#4C7A46', look: '竹青浅底 + 深绿（素食/茶/清爽）' },
  { id: 'sand-dune', name: '沙丘暖沙', font: 'serif', paper: '#F4EADA', ink: '#2B2116', dim: '#7A6449', accent: '#8A5A22', look: '暖沙底 + 陶土（面点/烘焙/西北菜）' },
  // ── 冷调/办公/科技 ──
  { id: 'mist-blue', name: '雾蓝书页', font: 'sans', paper: '#EEF1F3', ink: '#1A222A', dim: '#62707A', accent: '#3A6E8F', look: '雾蓝底 + 深蓝（数码/办公/说明型）' },
  { id: 'graphite', name: '石墨办公', font: 'sans', paper: '#F1F1EF', ink: '#1C1C1C', dim: '#6B6B68', accent: '#3F7A6E', look: '中性灰 + 松石绿点缀（数据/工具/中性）' },
  { id: 'nordic', name: '北欧冷白', font: 'sans', paper: '#F4F5F6', ink: '#1D2327', dim: '#68727A', accent: '#4A6B8A', look: '冷白 + 石板蓝（极简/北欧/产品）' },
  // ── 活泼/甜品 ──
  { id: 'rose-milk', name: '草莓奶昔', font: 'sans', paper: '#FDF1F0', ink: '#2C1E20', dim: '#7A5F60', accent: '#B02A4C', look: '奶粉底 + 莓红点缀（甜品/饮品/少女）' },
  { id: 'morandi', name: '莫兰迪灰粉', font: 'sans', paper: '#F2EDEA', ink: '#2A2624', dim: '#6F645E', accent: '#8A4F45', look: '莫兰迪灰粉 + 砖红（生活/家居/温柔）' },
]

const ok = [], bad = []
for (const c of CAND) {
  const cInk = contrast(c.ink, c.paper), cDim = contrast(c.dim, c.paper), cAcc = contrast(c.accent, c.paper)
  const onAccent = contrast(c.paper, c.accent) >= 4.5 ? c.paper : (contrast('#FFFFFF', c.accent) >= 4.5 ? '#FFFFFF' : c.ink)
  const cOn = contrast(onAccent, c.accent)
  const fail = []
  if (cInk < 4.5) fail.push(`正文 ${cInk.toFixed(2)}<4.5`)
  if (cDim < 3.0) fail.push(`次要 ${cDim.toFixed(2)}<3.0`)
  if (cAcc < 2.0) fail.push(`强调 ${cAcc.toFixed(2)}<2.0`)
  if (cOn < 4.5) fail.push(`反白 ${cOn.toFixed(2)}<4.5`)
  const row = { ...c, cInk, cDim, cAcc, cOn, onAccent, fail }
  if (fail.length) bad.push(row); else ok.push(row)
}

console.log(`  候选 ${CAND.length} 套 ⇒ 达标 ${ok.length} ／ 不达标 ${bad.length}`)
ok.forEach((r) => console.log(`   ✓ ${r.id.padEnd(13)} ${r.name.padEnd(6)} 正文 ${r.cInk.toFixed(1)} 次要 ${r.cDim.toFixed(1)} 强调 ${r.cAcc.toFixed(1)} 反白 ${r.cOn.toFixed(1)}`))
bad.forEach((r) => console.log(`   ✗ ${r.id.padEnd(13)} ${r.name.padEnd(6)} → ${r.fail.join(' / ')}`))

if (DUMP) {
  console.log('\n===== 引擎 THEMES 条目（粘贴用）=====')
  for (const r of ok) {
    console.log(`  '${r.id}': {`)
    console.log(`    name: '${r.name}', font: '${r.font}',`)
    console.log(`    paper: '${r.paper}', ink: '${r.ink}', dim: '${r.dim}', accent: '${r.accent}',`)
    const g = grad(r.paper, r.ink, r.accent)
    console.log(`    g: themeGrad('${r.paper}','${r.ink}','${r.accent}'),   // 派生：${g[0]}`)
    console.log(`  },`)
  }
  console.log('\n===== 计划层 PLAN_THEMES 条目（粘贴用）=====')
  for (const r of ok) console.log(`    { id: '${r.id}', name: '${r.name}', look: '${r.look.replace(/'/g, '"')}' },`)
}
