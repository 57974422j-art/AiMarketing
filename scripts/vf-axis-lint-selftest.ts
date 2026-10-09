// ★VF_AXIS_LINT_V1（2026-10-09）自检：分镜/字幕**体检器**（lintShots）
//
// 为什么需要它：2026-10-08 那条 102 秒成片里，文案被按镜数硬切成碎片（"给这桌美 / 味"）、
//   出现单字镜（"吃"/"味"/"暖"）、相邻重复（"起来"×2）——**没有任何报警**，只能等看成片才发现。
//   本自检把"硬伤必被修、其余只报告"这两件事钉死（用**片子里真实出现过的碎片**当用例）。
//
// 运行：npx tsx scripts/vf-axis-lint-selftest.ts
import { lintShots } from '../src/lib/agent/vf/anti-ai'

let bad = 0
const ok = (cond: boolean, label: string, extra = '') => {
  if (!cond) bad++
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
}
const mk = (arr: Array<[string, number]>) => arr.map(([subtitle, dur]) => ({ type: 'bgimage', subtitle, dur }))
const subsOf = (shots: any[]) => shots.map((s) => String(s.subtitle || ''))

// ── 用例：2026-10-08 那条片子里**真实出现过**的碎片
const shots = mk([
  ['剩下的交', 3],
  ['给这桌美', 3],
  ['味', 3],                 // ← 单字镜（用户说的"多数一个字"）
  ['记得带上', 3],
  ['一份好心', 3],
  ['情', 3],                 // ← 单字镜
  ['周末就约', 3],
  ['起来', 3],
  ['起来', 3],               // ← 相邻重复
  ['这桌火锅的夏天', 3],
])
const r = lintShots(shots)
console.log('  原文：', subsOf(shots).join(' | '))
console.log('  修复后：', subsOf(r.shots).join(' | '))
console.log('  自动修复：', r.changed.join('；') || '（无）')
console.log('  报告（未改）：', r.notes.join('；') || '（无）')
console.log('')

ok(r.shots.length < shots.length, '镜数变少了（碎片被合并，而不是留在片里）', `${shots.length} → ${r.shots.length}`)
ok(!subsOf(r.shots).some((t) => t.length > 0 && t.length < 6), '不再有任何 <6 字的单字/超短镜')
ok(!subsOf(r.shots).some((t, i, a) => i > 0 && t === a[i - 1]), '不再有相邻重复镜')
ok(r.shots.some((s: any) => String(s.subtitle).includes('味')), '内容没丢（被并入相邻行，字幕完整保留）')
ok(r.changed.length >= 3, '硬伤都记了账（changed 非空，可复盘）', `${r.changed.length} 处`)

// ── 只报告不修改：语速超限 / CTA 刷屏
const r2 = lintShots(mk([
  ['这是一句非常快的台词大概十五个字', 1],   // 15 字 / 1s = 15 字/秒 > 9
  ['立即咨询', 3],
  ['立即咨询', 3],
  ['立即咨询', 3],
]))
ok(r2.notes.some((n) => n.includes('语速偏快')), '语速超限 → 报告')
ok(r2.notes.some((n) => n.includes('CTA')), 'CTA 刷屏 → 报告')
ok(r2.shots.length === 4, '这两种都**没有**被改动（只报告）', `镜数仍 ${r2.shots.length}`)

// ── 正常片：一个字都不许动
const good = mk([['剩下的交给这桌美味', 3], ['记得带上好心情', 3], ['周末就约起来', 3]])
const r3 = lintShots(good)
ok(r3.changed.length === 0 && r3.notes.length === 0 && r3.shots.length === 3, '正常文案：零改动、零报告')

console.log(bad ? `===== ❌ ${bad} 项不符 =====` : '===== ✅ 全部通过 =====')
process.exit(bad ? 1 : 0)
