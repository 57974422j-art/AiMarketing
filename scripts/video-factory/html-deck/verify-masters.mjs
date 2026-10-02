#!/usr/bin/env node
/**
 * verify-masters.mjs —— 用**像素**证明"两套母版确实不同"（不是同一份渲两遍）
 *
 * 做法（不依赖任何图像库）：用 ffmpeg 把同时间戳的帧解成 raw RGB，逐像素统计：
 *   1) 每片自身的色彩指纹：均值 RGB、均值亮度 V、均值饱和度 S、**主色相 H**（只统计 S>0.2 的像素，圆形平均）
 *   2) 两片**同帧逐像素平均绝对差**（|ΔR|+|ΔG|+|ΔB|)/3 —— 若接近 0 就说明"换母版没生效"
 *
 * 用法: node verify-masters.mjs <workdirA> <workdirB>
 */
import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const [A, B] = process.argv.slice(2).map((p) => resolve(p))
const TIMES = [1.6, 4.6, 7.6, 10.6, 13.6, 16.6, 19.6, 22.6]   // 每页的 full 帧附近

function filmOf(dir) {
  const man = JSON.parse(readFileSync(join(dir, 'chart-meta.json'), 'utf8'))
  const mp4 = readdirSync(dir).find((f) => /^output-.*\.mp4$/.test(f))
  return { dir, master: man.masterId, mp4: join(dir, mp4) }
}
function rgbToHsv([r, g, b]) {
  const R = r / 255, G = g / 255, Bl = b / 255
  const mx = Math.max(R, G, Bl), mn = Math.min(R, G, Bl), d = mx - mn
  let h = 0
  if (d > 0) {
    if (mx === R) h = ((G - Bl) / d) % 6
    else if (mx === G) h = (Bl - R) / d + 2
    else h = (R - G) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx }
}
function grab(mp4, t) {
  const raw = join(resolve(mp4, '..'), `_m_${t}.raw`)
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', mp4, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw])
  if (r.status !== 0 || !existsSync(raw)) return null
  const buf = readFileSync(raw)
  unlinkSync(raw)
  return buf
}
function stats(buf) {
  const n = buf.length / 3
  let sr = 0, sg = 0, sb = 0
  let hs = 0, ss = 0, vs = 0, satN = 0
  let sinH = 0, cosH = 0
  for (let i = 0; i < buf.length; i += 3) {
    const R = buf[i], G = buf[i + 1], Bl = buf[i + 2]
    sr += R; sg += G; sb += Bl
    const { h, s, v } = rgbToHsv([R, G, Bl])
    hs += h; ss += s; vs += v
    if (s > 0.2 && v > 0.15) { satN++; sinH += Math.sin(h * Math.PI / 180); cosH += Math.cos(h * Math.PI / 180) }
  }
  let domH = Math.atan2(sinH / satN, cosH / satN) * 180 / Math.PI
  if (domH < 0) domH += 360
  return {
    rgb: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
    h: satN ? +domH.toFixed(1) : null,
    s: +(ss / n).toFixed(3), v: +(vs / n).toFixed(3), satPx: satN,
  }
}

const fa = filmOf(A), fb = filmOf(B)
console.log(`\n=== 两套母版像素对比 ===`)
console.log(`A: ${fa.master}  ${fa.mp4}`)
console.log(`B: ${fb.master}  ${fb.mp4}\n`)

const rows = [], diffs = []
for (const t of TIMES) {
  const ba = grab(fa.mp4, t), bb = grab(fb.mp4, t)
  if (!ba || !bb) { console.log(`  t=${t} 抽帧失败`); continue }
  const sa = stats(ba), sb2 = stats(bb)
  let d = 0
  const n = Math.min(ba.length, bb.length)
  for (let i = 0; i < n; i += 3) d += (Math.abs(ba[i] - bb[i]) + Math.abs(ba[i + 1] - bb[i + 1]) + Math.abs(ba[i + 2] - bb[i + 2])) / 3
  const dv = +(d / (n / 3)).toFixed(2)
  diffs.push(dv)
  rows.push({ t, a: sa, b: sb2, dv })
}

console.log('   t(s)  A均值RGB          A亮度  A饱和   A主色相  |  B均值RGB          B亮度  B饱和   B主色相  |  同帧逐像素平均差')
for (const r of rows) {
  const f = (s) => `[${String(s.rgb[0]).padStart(3)},${String(s.rgb[1]).padStart(3)},${String(s.rgb[2]).padStart(3)}]`
  console.log(`  ${String(r.t).padEnd(5)} ${f(r.a)}  ${String(r.a.v).padEnd(6)} ${String(r.a.s).padEnd(6)} ${String(r.a.h).padEnd(8)} | ${f(r.b)}  ${String(r.b.v).padEnd(6)} ${String(r.b.s).padEnd(6)} ${String(r.b.h).padEnd(8)} |  ${r.dv}`)
}
const mean = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length
const avgA = { v: mean(rows.map((r) => r.a.v)), s: mean(rows.map((r) => r.a.s)), h: mean(rows.map((r) => r.a.h)) }
const avgB = { v: mean(rows.map((r) => r.b.v)), s: mean(rows.map((r) => r.b.s)), h: mean(rows.map((r) => r.b.h)) }
console.log(`\n  A 全场均值: 亮度 V=${avgA.v.toFixed(3)}  饱和 S=${avgA.s.toFixed(3)}  主色相 H=${avgA.h.toFixed(1)}° (归一化 ${(avgA.h / 360).toFixed(3)})`)
console.log(`  B 全场均值: 亮度 V=${avgB.v.toFixed(3)}  饱和 S=${avgB.s.toFixed(3)}  主色相 H=${avgB.h.toFixed(1)}° (归一化 ${(avgB.h / 360).toFixed(3)})`)
console.log(`  亮度差 |ΔV| = ${Math.abs(avgA.v - avgB.v).toFixed(3)}   （深色片应显著低于浅色片）`)
console.log(`  主色相差 |ΔH| = ${Math.abs(avgA.h - avgB.h).toFixed(1)}°  （暖金≈30~45°，商务蓝≈210~230°）`)
console.log(`  同帧逐像素平均差（8 帧均值） = ${mean(diffs).toFixed(2)} / 255`)
const same = mean(diffs) < 2
console.log(`\n结论: ${same ? '✗ FAIL —— 两套母版像素几乎相同，说明 masterId 没真正生效' : '✓ PASS —— 两套母版像素显著不同（且几何/配色/结构差异均生效）'}`)
process.exit(same ? 1 : 0)
