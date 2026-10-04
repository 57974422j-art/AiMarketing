#!/usr/bin/env node
/**
 * verify-chart.mjs —— 用**抽帧**证明"图上数值 = 输入数据"（bar / line / donut 三种都量）
 *
 * 与 render-deck.mjs 的 chartCheck 分工：
 *   chartCheck   读**生成的 HTML**，从几何属性反推数值 → 证明"代码把数据写对了"
 *   本脚本       读**渲染出的像素** → 证明"画面上真的画成了那样、没被裁掉/没画错"
 * 两者都过，才算"图表真画了且数值对得上"。
 *
 * 三种图各自量什么：
 *   bar   → 每根柱的**柱高**（从柱底向上扫连续"非底色"像素）
 *   line  → 每个折线**顶点的 y**（顶点处有个 r=4.5 的实心圆点，取其连续段中心）
 *   donut → 每个扇片的**扇区角**（沿环心半径 rr 扫 360°，按三档明度分类，量同类连续段角度）
 *
 * 几何/颜色来源：<workdir>/chart-meta.json（生成器按**当前母版**写出）——
 *   ★ 颜色判定**自适应**：底色/柱色/不透明度/占比环明度档都由母版给出，
 *     阈值 = 0.5 × 柱色离底距离。跨母版（深底亮柱 ⇄ 亮底深柱）无需改脚本，
 *     也不会因写死 "R>70" 在浅色母版上全判错。
 *
 * 用法: node verify-chart.mjs <workdir> [--tol 4] [--tol-deg 3]
 */
import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
/* ★ K17-ff 清扫：媒体工具解析走**唯一实现**（本文件此前裸 `ffmpeg`/`ffprobe`） */
import { resolveFfmpeg, resolveFfprobe } from './engine-bin.mjs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const numArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? parseFloat(args[i + 1]) : d }
const TOL = numArg('--tol', 4)          // 柱高/顶点 y 的像素容差
const TOL_DEG = numArg('--tol-deg', 3)  // 扇区角容差（度）
const workdir = resolve(args.find((a) => !a.startsWith('--')) || '.')
const PAGE = 3                          // 单页时长，与母版 manifest 的 page 一致

if (!existsSync(join(workdir, 'chart-meta.json'))) {
  console.error(`✗ ${workdir} 下没有 chart-meta.json（该 deck 没有图表页，或未生成）`)
  process.exit(1)
}
const M = JSON.parse(readFileSync(join(workdir, 'chart-meta.json'), 'utf8'))
const mp4 = readdirSync(workdir).find((f) => /^output-.*\.mp4$/.test(f))
if (!mp4) { console.error(`✗ ${workdir} 下没有 output-*.mp4（先渲染）`); process.exit(1) }
const mp4Path = join(workdir, mp4)

const pr = spawnSync(resolveFfprobe().p, ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mp4Path], { encoding: 'utf8' })
const [FW, FH] = (pr.stdout || '').trim().split(',').map(Number)
if (!FW || !FH) { console.error('✗ 无法取到帧尺寸'); process.exit(1) }

import { hex2rgbTrusted as hex2rgb } from './color.mjs'   /* ★ 颜色工具**唯一实现**（此前本文件是 5 份副本之一；用别名 ⇒ **零调用点改动**） */
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])

const { plot: PL, padBox: PB, pad, plotTop } = M
const y0 = PB.t, y1 = PL.h - PB.b
const plotH = y1 - y0

const BG = hex2rgb(M.bg)
const BC = String(M.barColor || '255,255,255').split(',').map(Number)
const ALPHA = M.barAlpha === undefined ? 0.5 : M.barAlpha
const COMP = [0, 1, 2].map((i) => Math.round(ALPHA * BC[i] + (1 - ALPHA) * BG[i]))
const THRESH = 0.5 * dist(COMP, BG)

// 占比环：三档明度各自的合成色 → 用于把像素分类到"哪一档"
// ★ 注意合成链：扇片是画在 **.ch-donut-track** 之上的，不是直接叠底色。
//   所以 shade×accent 要叠在「rule 叠底色」的结果上，而不是叠在底色上。
//   （实测：v2 扇片 (118,146,190) == .58×accent over (215,217,220) —— 逐通道吻合；
//     若误按"叠底色"算期望值会偏 11~21，边界处的混合像素就会被判成第三档，凭空多出扇片边界。）
const SHADES = Array.isArray(M.donutShades) && M.donutShades.length ? M.donutShades : [1]
const parseColor = (s) => {
  const t = String(s || '').trim()
  if (t.startsWith('#')) return { rgb: hex2rgb(t), a: 1 }
  const m = t.match(/rgba?\(([^)]+)\)/)
  if (!m) return { rgb: [0, 0, 0], a: 0 }
  const p = m[1].split(',').map((x) => parseFloat(x))
  return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }
}
const over = (fg, a, bg) => fg.map((c, i) => Math.round(a * c + (1 - a) * bg[i]))
const RULE = parseColor(M.rule || 'rgba(0,0,0,0)')
const TRACK = over(RULE.rgb, RULE.a, BG)                      // .ch-donut-track 的实际颜色
const DONUT_COMPS = SHADES.map((sh) => over(BC, sh, TRACK))    // 扇片：shade×accent over track

console.log(`\n=== 图表像素反推校验（抽帧）===`)
console.log(`母版: ${M.masterId || '(?)'}   mp4: ${mp4}  ${FW}×${FH}`)
console.log(`绘图区: ${PL.w}×${PL.h} @ (page x=${pad}, y=${plotTop})   数据区高=${plotH}px`)
console.log(`底色=[${BG}]  强调色=[${BC}]  柱不透明度=${ALPHA} → 柱合成色=[${COMP}] 阈值=${THRESH.toFixed(1)}`)
console.log(`占比环: rule=${M.rule || '(未声明)'} over 底色 = 轨道色[${TRACK}]；明度档=[${SHADES}] → 扇片合成色 ${DONUT_COMPS.map((c) => `[${c}]`).join(' ')}`)

let fail = 0, checked = 0
const note = (s) => console.log(s)

for (const pg of M.pages) {
  const t = pg.index * PAGE + 2.70    // 必须 < S+2.75（下一页淡入起点），见 render-deck.mjs 的说明
  const raw = join(workdir, `_probe_${pg.index}.raw`)
  const r = spawnSync(resolveFfmpeg().p, ['-v', 'error', '-y', '-ss', String(t), '-i', mp4Path,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw])
  if (r.status !== 0 || !existsSync(raw)) { note(`  页 ${pg.index}  抽帧失败`); fail++; continue }
  const buf = readFileSync(raw)
  const at = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y)
    if (xi < 0 || xi >= FW || yi < 0 || yi >= FH) return null
    const o = (yi * FW + xi) * 3
    return [buf[o], buf[o + 1], buf[o + 2]]
  }
  const s = pg.series
  const maxV = Math.max(...s), minV = Math.min(0, ...s)
  const span = (maxV - minV) || 1

  // ---------------- bar ----------------
  if (pg.kind === 'bar') {
    note(`\n  页 ${pg.index} · bar   容差 ±${TOL}px`)
    note('   柱  输入值     期望高(px)  实测高(px)  差    结论')
    s.forEach((v, i) => {
      const px = Math.round(pad + pg.meta.marks[i].cx)
      const bottom = Math.round(plotTop + y1) - 1
      let measured = 0
      for (let y = bottom; y >= 0; y--) {
        const c = at(px, y)
        if (!c) break
        if (dist(c, BG) >= THRESH) measured++
        else break
      }
      const expected = +((v - minV) / span * plotH).toFixed(1)
      const d = +(measured - expected).toFixed(1)
      const ok = Math.abs(d) <= TOL
      if (!ok) fail++
      checked++
      note(`   ${String(i + 1).padEnd(3)} ${String(v).padEnd(9)} ${String(expected).padEnd(11)} ${String(measured).padEnd(11)} ${String(d).padEnd(5)} ${ok ? '✓' : '✗ 超容差'}`)
    })
  }

  // ---------------- line ----------------
  else if (pg.kind === 'line') {
    note(`\n  页 ${pg.index} · line   容差 ±${TOL}px`)
    note('   顶点  输入值     期望顶点y   实测顶点y   差(px)  反推值   差(值)   结论')
    s.forEach((v, i) => {
      const px = Math.round(pad + pg.meta.marks[i].cx)
      const yExpVb = pg.meta.marks[i].y                 // 视图坐标（生成器给的期望）
      // 只在期望附近 ±9px 找（避免把上方 11px 处的数值标签当成点）
      const lo = Math.round(plotTop + yExpVb) - 9, hi = Math.round(plotTop + yExpVb) + 9
      let best = null, run = null
      for (let y = lo; y <= hi; y++) {
        const c = at(px, y)
        const hit = c && dist(c, BG) >= THRESH
        if (hit) { if (!run) run = [y, y]; else run[1] = y }
        else if (run) { if (!best || (run[1] - run[0]) > (best[1] - best[0])) best = run; run = null }
      }
      if (run && (!best || (run[1] - run[0]) > (best[1] - best[0]))) best = run
      const measuredYvb = best ? (best[0] + best[1]) / 2 - plotTop : NaN
      const implied = +(((y1 - measuredYvb) / plotH) * span + minV).toFixed(2)
      const dPx = +(measuredYvb - yExpVb).toFixed(1)
      const dVal = +(implied - v).toFixed(2)
      const ok = Math.abs(dPx) <= TOL
      if (!ok) fail++
      checked++
      note(`   ${String(i + 1).padEnd(5)} ${String(v).padEnd(9)} ${String(yExpVb.toFixed(1)).padEnd(10)} ${String(measuredYvb.toFixed(1)).padEnd(11)} ${String(dPx).padEnd(6)} ${String(implied).padEnd(8)} ${String(dVal).padEnd(8)} ${ok ? '✓' : '✗ 超容差'}`)
    })
  }

  // ---------------- donut ----------------
  else if (pg.kind === 'donut') {
    const { rr, cx: dcx, cy: dcy, total } = pg.meta
    const STEP = 0.25
    const N = Math.round(360 / STEP)
    const cls = new Array(N)
    for (let k = 0; k < N; k++) {
      const th = (k * STEP) * Math.PI / 180
      // SVG 圆参：θ 从 +x 轴起、y 向下 ⇒ 与生成器的 rotate() 同一参数化
      const c = at(pad + dcx + rr * Math.cos(th), plotTop + dcy + rr * Math.sin(th))
      if (!c) { cls[k] = -1; continue }
      let bi = -1, bd = Infinity
      const cands = [BG, ...DONUT_COMPS]
      cands.forEach((q, qi) => { const d = dist(c, q); if (d < bd) { bd = d; bi = qi - 1 } })  // -1 = 底色
      cls[k] = bi
    }
    note(`\n  页 ${pg.index} · donut   半径 ${rr}px · 采样 ${STEP}° × ${N} · 容差 ±${TOL_DEG}°`)
    // ★ 不能"找某一档色的最长段"：三档明度循环时同一档会出现两次（5 片 → 0,1,2,0,1），
    //   按长度挑会挑到别的扇片。改为**按"类变化点"测扇区边界夹角** ——
    //   相邻扇片明度必然不同 ⇒ 类序列的变化点恰好就是扇片边界，与"是哪一档"无关。
    //   两步去噪：① 5 点循环中值滤波；② **短段合并**（<MINRUN 样本的类段视为混合/压缩噪声）。
    //   为什么需要②：两个相邻扇片的**混合像素色 ≈ 第三档色**（如 v2 的 (comp2+comp0)/2 ≈ comp1）
    //   → 边界处会凭空多出 1~2 个小段，边界数就会 > 扇片数（v1 因对比更大、混合带更窄而恰好没暴露）。
    const MINRUN = 30                                          // 30 样本 = 7.5°（最小扇片 32° 远大于它）
    const sm = new Array(N)
    for (let k = 0; k < N; k++) {
      const win = [-2, -1, 0, 1, 2].map((d) => cls[(k + d + N) % N]).sort((a, b) => a - b)
      sm[k] = win[2]
    }
    let st = 0
    while (st < N && sm[st] === sm[(st - 1 + N) % N]) st++      // 旋转到段起点，免得跨 0° 处理
    const rot = []
    for (let k = 0; k < N; k++) rot.push(sm[(st + k) % N])
    for (let pass = 0; pass < 60; pass++) {
      const runs = []
      let s0 = 0
      for (let k = 1; k <= rot.length; k++) if (k === rot.length || rot[k] !== rot[s0]) { runs.push([s0, k - 1]); s0 = k }
      if (runs.length <= 1) break
      const short = runs.find(([a, b]) => b - a + 1 < MINRUN)
      if (!short) break
      const prevCls = rot[(short[0] - 1 + rot.length) % rot.length]
      for (let k = short[0]; k <= short[1]; k++) rot[k] = prevCls
    }
    const bAng = []
    for (let k = 0; k < N; k++) if (rot[k] !== rot[(k - 1 + N) % N]) bAng.push(+(((st + k) % N) * STEP).toFixed(2))
    bAng.sort((a, b) => a - b)
    note(`   测得扇片边界 ${bAng.length} 个（应为 ${s.length} 个）: ${bAng.map((a) => a + '°').join(' · ')}`)
    note('   扇片  输入值     期望扇角°  实测扇角°  差(°)   反推值   差(值)   结论')
    const dist360 = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }
    let acc = 0
    s.forEach((v, i) => {
      const startFrac = acc / total
      acc += v
      const expStart = ((-90 + startFrac * 360) % 360 + 360) % 360
      const expDeg = +(360 * v / total).toFixed(2)
      // 把测得的边界配到"最接近期望起点"的那个，再取顺时针方向的下一个边界
      let bi = -1, bd = Infinity
      bAng.forEach((a, ai) => { const d = dist360(a, expStart); if (d < bd) { bd = d; bi = ai } })
      const next = bAng.length ? bAng[(bi + 1) % bAng.length] : NaN
      const measuredDeg = bAng.length ? +(((next - bAng[bi] + 360) % 360)).toFixed(2) : NaN
      const implied = +((measuredDeg / 360) * total).toFixed(2)
      const dDeg = +(measuredDeg - expDeg).toFixed(2)
      // 边界数必须与扇片数一致、起点要对得上，否则说明段配错了 → 不能算通过
      const ok = bAng.length === s.length && bd <= 6 && Math.abs(dDeg) <= TOL_DEG
      if (!ok) fail++
      checked++
      const why = bAng.length !== s.length ? '✗ 边界数不符' : (bd > 6 ? '✗ 起点配不上' : '✗ 超容差')
      note(`   ${String(i + 1).padEnd(5)} ${String(v).padEnd(9)} ${String(expDeg).padEnd(10)} ${String(measuredDeg).padEnd(10)} ${String(dDeg).padEnd(7)} ${String(implied).padEnd(8)} ${String(+(implied - v).toFixed(2)).padEnd(8)} ${ok ? '✓' : why}`)
    })
  } else {
    note(`  页 ${pg.index} · ${pg.kind}：未支持的图表类型`)
  }
  unlinkSync(raw)
}

console.log(`\n结论: 量了 ${checked} 个数据点（柱高 / 顶点y / 扇区角），${fail === 0 ? 'PASS（图上几何 = 输入数据，容差内）' : `FAIL（${fail} 个超容差）`}`)
process.exit(fail === 0 ? 0 : 1)
