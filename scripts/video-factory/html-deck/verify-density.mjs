#!/usr/bin/env node
/**
 * verify-density.mjs —— 用**像素**验证 `density` 真的改变了页边距，且**横屏/竖屏都成立**
 *
 * 为什么需要它：`density` 是契约里承诺的参数，但此前只验过"生成器算法 == CSS 算法"，
 * 没有像素证据。坑 17 的口子就在这里：**契约里承诺的每一个参数 × 每一种几何，都要有像素证据**。
 *
 * 量法（不依赖任何图像库）：取"要点页"整帧，找**最左的强色像素列** = 页边距 `--pad`。
 *   · `.rule` / `h2` / 列表项 / `.issuer` 都在 `left: var(--pad)`；`.rule` 是实心块、
 *     `transform-origin: left center` ⇒ 它的左缘**精确**等于 `--pad`（不像文字有 side bearing）。
 *   · 背景 `.tex` 纹理很淡 ⇒ 用「离底色距离 ≥ 0.5 × 强调色离底色距离」把噪声排除。
 *
 * 判据：
 *   ① 实测 pad == 该 dir 的 chart-meta.json 里的 pad（生成器说的与实际渲的一致）
 *   ② airy − normal == +12px、dense − normal == −12px（纯测量得出，不依赖生成器自报）
 *
 * 用法: node verify-density.mjs <normalDir> <airyDir> <denseDir> [--page 2] [--tol 2]
 */
import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
/* ★ K17-ff 清扫：媒体工具解析走**唯一实现**（本文件此前裸 `ffmpeg`/`ffprobe`） */
import { resolveFfmpeg, resolveFfprobe } from './engine-bin.mjs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const numArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? parseFloat(args[i + 1]) : d }
const TOL = numArg('--tol', 2)
const PAGE_IDX = numArg('--page', 2)                 // deck.types8 的 index 2 = 要点页
const dirs = args.filter((a) => !a.startsWith('--') && !/^\d+(\.\d+)?$/.test(a)).slice(0, 3).map((p) => resolve(p))
if (dirs.length < 3) { console.error('用法: node verify-density.mjs <normalDir> <airyDir> <denseDir> [--page 2] [--tol 2]'); process.exit(2) }

import { hex2rgbTrusted as hex2rgb } from './color.mjs'   /* ★ 颜色工具**唯一实现**（此前本文件是 5 份副本之一；用别名 ⇒ **零调用点改动**） */
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])

function measure(dir) {
  const M = JSON.parse(readFileSync(join(dir, 'chart-meta.json'), 'utf8'))
  const mp4 = readdirSync(dir).find((f) => /^output-.*\.mp4$/.test(f))
  const pr = spawnSync(resolveFfprobe().p, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0', join(dir, mp4)], { encoding: 'utf8' })
  const [FW, FH] = (pr.stdout || '').trim().split(',').map(Number)
  const raw = join(dir, `_dens_${PAGE_IDX}.raw`)
  const t = PAGE_IDX * 3 + 2.70      // 必须 < S+2.75（下一页淡入起点）
  const r = spawnSync(resolveFfmpeg().p, ['-v', 'error', '-y', '-ss', String(t), '-i', join(dir, mp4),
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw])
  if (r.status !== 0 || !existsSync(raw)) return { dir, err: '抽帧失败' }
  const buf = readFileSync(raw)
  unlinkSync(raw)
  const BG = hex2rgb(M.bg)
  const ACC = String(M.barColor).split(',').map(Number)
  const TH = 0.5 * dist(ACC, BG)
  let minX = Infinity, atY = -1
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      if (x >= minX) break                        // 已经比已知最左还靠右，整行可跳过
      const o = (y * FW + x) * 3
      if (dist([buf[o], buf[o + 1], buf[o + 2]], BG) >= TH) { minX = x; atY = y; break }
    }
  }
  return { dir, master: M.masterId, orient: M.orientation, density: M.density, claimed: M.pad, measured: minX, atY, FW, FH, th: +TH.toFixed(1) }
}

const res = dirs.map(measure)
console.log(`\n=== density 页边距像素验证（量"要点页整帧最左强色像素列"）===`)
console.log(`页索引 ${PAGE_IDX}（deck.types8 序列里是 bullets）· 容差 ±${TOL}px\n`)
console.log('  目录                                 母版        几何   density  声称pad  实测pad  在第几行  结论')
let fail = 0
for (const r of res) {
  if (r.err) { console.log(`  ${r.dir}  ${r.err}`); fail++; continue }
  const ok = Math.abs(r.measured - r.claimed) <= TOL
  if (!ok) fail++
  const nm = r.dir.replace(/\\/g, '/').split('/').slice(-2).join('/')
  console.log(`  ${nm.padEnd(36)} ${String(r.master).padEnd(11)} ${String(r.orient).padEnd(5)} ${String(r.density).padEnd(8)} ${String(r.claimed).padEnd(8)} ${String(r.measured).padEnd(8)} ${String(r.atY).padEnd(10)} ${ok ? '✓' : '✗ 与生成器声称不符'}`)
}

const [n, a, d] = res
if (!n.err && !a.err && !d.err) {
  const dA = a.measured - n.measured
  const dD = d.measured - n.measured
  console.log(`\n  纯测量交叉校验（不依赖生成器自报）：`)
  console.log(`    airy  − normal = ${dA >= 0 ? '+' : ''}${dA}px   （应为 +12）`)
  console.log(`    dense − normal = ${dD >= 0 ? '+' : ''}${dD}px   （应为 −12）`)
  console.log(`    几何 = ${n.orient}（母版 ${n.master}）`)
  const ok = Math.abs(dA - 12) <= TOL && Math.abs(dD + 12) <= TOL
  if (!ok) fail++
  console.log(`    → ${ok ? '✓ 增量方案在该几何上成立' : '✗ 增量不符'}`)
}
console.log(`\n结论: ${fail === 0 ? 'PASS（density 的页边距变化在像素上成立，且实测与生成器一致）' : `FAIL（${fail} 项）`}`)
process.exit(fail === 0 ? 0 : 1)
