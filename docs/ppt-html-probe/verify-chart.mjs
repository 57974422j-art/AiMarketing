#!/usr/bin/env node
/**
 * verify-chart.mjs —— 用**抽帧**证明"图上数值 = 输入数据"（柱状图）
 *
 * 与 render-deck.mjs 的 chartCheck 分工：
 *   chartCheck   读**生成的 HTML**，从几何属性反推数值 → 证明"代码把数据写对了"
 *   本脚本       读**渲染出的像素**，逐柱量实际高度 → 证明"画面上真的画成了那样、没被裁掉/没画错"
 * 两者都过，才算"图表真画了且数值对得上"。
 *
 * 几何来源：<workdir>/chart-meta.json（由生成器写出，避免在验证器里重复 PLOT 常量造成两处漂移）
 *
 * 用法: node verify-chart.mjs <workdir> [--tol 4]
 * 退出码: 0 = 全部在容差内; 1 = 有超标
 */
import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const ti = args.indexOf('--tol')
const TOL = ti >= 0 ? parseFloat(args[ti + 1]) : 4
const workdir = resolve(args.find((a) => !a.startsWith('--')) || '.')
const PAGE = 3                         // 单页时长，与生成器一致

if (!existsSync(join(workdir, 'chart-meta.json'))) {
  console.error(`✗ ${workdir} 下没有 chart-meta.json（该 deck 没有图表页，或未生成）`)
  process.exit(1)
}
const M = JSON.parse(readFileSync(join(workdir, 'chart-meta.json'), 'utf8'))
const mp4 = readdirSync(workdir).find((f) => /^output-.*\.mp4$/.test(f))
if (!mp4) { console.error(`✗ ${workdir} 下没有 output-*.mp4（先渲染）`); process.exit(1) }
const mp4Path = join(workdir, mp4)

const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mp4Path], { encoding: 'utf8' })
const [FW, FH] = (probe.stdout || '').trim().split(',').map(Number)
if (!FW || !FH) { console.error('✗ 无法取到帧尺寸'); process.exit(1) }

const { plot: PL, padBox: PB, pad, plotTop } = M
const y0 = PB.t, y1 = PL.h - PB.b
const plotH = y1 - y0

console.log(`\n=== 图表像素反推校验（抽帧）===`)
console.log(`mp4: ${mp4}  ${FW}×${FH}   绘图区: ${PL.w}×${PL.h} @ (page x=${pad}, y=${plotTop})`)
console.log(`判定: 从每根柱底向上扫，取"柱色像素"连续段长度 = 实际柱高；与 期望柱高 = v/span×${plotH}px 比，容差 ±${TOL}px\n`)
console.log('  页  柱  输入值     期望高(px)  实测高(px)  差  结论')

let fail = 0, checked = 0
for (const pg of M.pages) {
  if (pg.kind !== 'bar') {
    console.log(`  ${pg.index}   ——  ${pg.kind}：本脚本只量柱状图（折线/占比由 chartCheck 在 HTML 层验证）`)
    continue
  }
  const t = pg.index * PAGE + 2.85
  const raw = join(workdir, `_probe_${pg.index}.raw`)
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', mp4Path,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw])
  if (r.status !== 0 || !existsSync(raw)) { console.log(`  ${pg.index}   抽帧失败`); fail++; continue }
  const buf = readFileSync(raw)

  const s = pg.series
  const maxV = Math.max(...s), minV = Math.min(0, ...s)
  const span = (maxV - minV) || 1

  s.forEach((v, i) => {
    const mark = pg.meta.marks[i]
    const px = Math.round(pad + mark.cx)
    const bottom = Math.round(plotTop + y1) - 1          // 从轴线上方一格起扫
    let measured = 0
    for (let y = bottom; y >= 0; y--) {
      if (px < 0 || px >= FW) break
      const o = (y * FW + px) * 3
      if (buf[o] > 70) measured++                        // 柱色（暖金 50% 叠深底 ≈ R 110）远亮于底(≈20)
      else break
    }
    const expected = +((v - minV) / span * plotH).toFixed(1)
    const d = +(measured - expected).toFixed(1)
    const ok = Math.abs(d) <= TOL
    if (!ok) fail++
    checked++
    console.log(`  ${String(pg.index).padEnd(3)} ${String(i + 1).padEnd(3)} ${String(v).padEnd(9)} ${String(expected).padEnd(11)} ${String(measured).padEnd(11)} ${String(d).padEnd(4)} ${ok ? '✓' : '✗ 超容差'}`)
  })
  unlinkSync(raw)
}

console.log(`\n结论: 量了 ${checked} 根柱，${fail === 0 ? 'PASS（图上柱高 = 输入数据，容差内）' : `FAIL（${fail} 根超容差）`}`)
process.exit(fail === 0 ? 0 : 1)
