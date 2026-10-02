#!/usr/bin/env node
/**
 * verify-image.mjs —— 图片页的**像素级证据**（四件事）
 *
 *   ① 素材真上屏：按 `object-fit: cover` 的几何映射，把**源图**上的探针点算到屏幕坐标，逐点比色
 *   ② 素材没被偷偷加滤镜：探针点覆盖源图多个色相象限 ⇒ 若被去色/压暗（如封面那套 --photo-dim），色差立刻超标
 *   ③ 全幅压字的对比度：按 **WCAG 相对亮度**（含 sRGB 线性化）算 文字 vs 最坏背景，要求 ≥ 4.5:1
 *      —— 校验的是"渐隐底衬"这条规矩真的够用，而不是靠肉眼说好看
 *   ④ 版式矩形正确：left/right 版式下，面板**外侧**的点必须是底色（证明媒体区确实只占该矩形）
 *
 * 几何真源：<workdir>/image-meta.json（生成器按**当前母版**写出，与母版 CSS 的 .p9--* 一致）
 * 用法: node verify-image.mjs <workdir> [--tol 28] [--min-contrast 4.5] [--full-top 0.34]
 */
import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const numArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? parseFloat(args[i + 1]) : d }
const TOL = numArg('--tol', 28)
const MIN_CONTRAST = numArg('--min-contrast', 4.5)
const FULL_TOP = numArg('--full-top', 0.34)     // 全幅版式只在上部（无渐隐底衬遮挡）做素材比色
const workdir = resolve(args.find((a) => !a.startsWith('--')) || '.')
const PAGE = 3

if (!existsSync(join(workdir, 'image-meta.json'))) {
  console.log(`\n（${workdir} 下没有 image-meta.json —— 该 deck 没有图片页，跳过）`)
  process.exit(0)
}
const M = JSON.parse(readFileSync(join(workdir, 'image-meta.json'), 'utf8'))
const mp4 = readdirSync(workdir).find((f) => /^output-.*\.mp4$/.test(f))
if (!mp4) { console.error(`✗ ${workdir} 下没有 output-*.mp4（先渲染）`); process.exit(1) }
const mp4Path = join(workdir, mp4)

const pr = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mp4Path], { encoding: 'utf8' })
const [FW, FH] = (pr.stdout || '').trim().split(',').map(Number)
if (!FW || !FH) { console.error('✗ 无法取到帧尺寸'); process.exit(1) }

const hex2rgb = (h) => { const s = String(h).replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) }
const BG = hex2rgb(M.bg || '#000000')                 // 母版底色（判"媒体区外是不是底"用，浅色母版也成立）
const toLin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const relLum = ([r, g, b]) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b)
const contrast = (a, b) => { const [x, y] = a > b ? [a, b] : [b, a]; return (x + 0.05) / (y + 0.05) }
const dist3 = (p, q) => Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]))

function rawRGB(file, args2) {
  const out = join(workdir, `_img_${Math.random().toString(36).slice(2)}.raw`)
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args2, '-f', 'rawvideo', '-pix_fmt', 'rgb24', out])
  if (r.status !== 0 || !existsSync(out)) throw new Error(`ffmpeg 解码失败: ${file}`)
  const buf = readFileSync(out)
  unlinkSync(out)
  return buf
}
const framePx = (buf, w, x, y) => {
  const xi = Math.round(x), yi = Math.round(y)
  if (xi < 0 || xi >= FW || yi < 0 || yi >= FH) return null
  const o = (yi * FW + xi) * 3
  return [buf[o], buf[o + 1], buf[o + 2]]
}
const srcPx = (buf, sw, x, y) => {
  const xi = Math.min(sw - 1, Math.max(0, Math.round(x))), yi = Math.max(0, Math.round(y))
  const o = (yi * sw + xi) * 3
  return [buf[o], buf[o + 1], buf[o + 2]]
}

console.log(`\n=== 图片页像素验证 ===`)
console.log(`母版: ${M.masterId}   mp4: ${mp4}  ${FW}×${FH}   容差 ±${TOL}/通道   对比度下限 ${MIN_CONTRAST}:1`)

let fail = 0
for (const pg of M.pages) {
  const R = pg.region
  console.log(`\n  页 ${pg.index} · image · layout=${pg.layout}   媒体区 x=${R.x} y=${R.y} w=${R.w} h=${R.h}`)
  const frame = rawRGB(mp4Path, ['-ss', String(pg.index * PAGE + 2.70), '-i', mp4Path, '-frames:v', '1'])
  const sp = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0', pg.srcPath], { encoding: 'utf8' })
  const [SW, SH] = (sp.stdout || '').trim().split(',').map(Number)
  const src = rawRGB(pg.srcPath, ['-i', pg.srcPath])

  // object-fit: cover 的几何映射
  const scale = Math.max(R.w / SW, R.h / SH)
  const off = { x: (R.w - SW * scale) / 2, y: (R.h - SH * scale) / 2 }
  const toScreen = (sx, sy) => ({ x: R.x + off.x + sx * scale, y: R.y + off.y + sy * scale })

  // ① 素材真上屏：**在屏幕空间布探针**，再反查到源图坐标。
  //    为什么不是按源图比例布点：竖屏 full 的 cover 裁切很重（源 1280×720 → 画面 720×1280，scale≈1.78），
  //    按源图比例布的点会**几乎全部落在可视区之外**（实测：4 个 fx 全部越界 ⇒ 一个点都采不到）。
  //    屏幕空间布点能自适应任意版式/朝向。
  const toSrc = (px, py) => ({ x: (px - R.x - off.x) / scale, y: (py - R.y - off.y) / scale })
  /** 源图该点局部是否平坦：压缩会在**硬边界**处模糊 ⇒ 边界附近的点不可比色（这条让判据对真实照片也成立） */
  const srcFlat = (sx, sy) => {
    const mn = [255, 255, 255], mx = [0, 0, 0]
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const c = srcPx(src, SW, sx + dx, sy + dy); if (!c) continue
        for (let k = 0; k < 3; k++) { if (c[k] < mn[k]) mn[k] = c[k]; if (c[k] > mx[k]) mx[k] = c[k] }
      }
    }
    return Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) <= 40
  }

  const deltas = []
  let worst = null, skipped = 0
  const GX = 7, GY = 5
  for (let gi = 0; gi < GX; gi++) {
    for (let gj = 0; gj < GY; gj++) {
      const px = R.x + R.w * (gi + 0.5) / GX
      const py = R.y + R.h * (gj + 0.5) / GY
      if (px < 1 || px > FW - 2 || py < 1 || py > FH - 2) continue
      if (pg.layout === 'full' && py > FH * FULL_TOP) continue     // 全幅：下部有渐隐底衬遮挡，不参与素材比色
      const s = toSrc(px, py)
      if (s.x < 2 || s.x > SW - 3 || s.y < 2 || s.y > SH - 3) continue   // 被 cover 裁掉了
      if (!srcFlat(s.x, s.y)) { skipped++; continue }
      const a = framePx(frame, FW, px, py), b = srcPx(src, SW, s.x, s.y)
      if (!a || !b) continue
      const d = dist3(a, b)
      deltas.push(d)
      if (!worst || d > worst.d) worst = { d, a, b, px, py }
    }
  }
  // ★ 判据用**中位数 + 达标比例**，而不是"最大差"：个别落在色界上的点会因压缩模糊偏大，用最大值判会假阳性；
  //   而"整张图被换掉 / 被加滤镜"会让**几乎所有点**都超标 ⇒ 比例判据依然很硬。
  const sorted = deltas.slice().sort((x, y) => x - y)
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 999
  const inTol = deltas.filter((d) => d <= TOL).length
  const ratio = deltas.length ? inTol / deltas.length : 0
  const n = deltas.length
  const ok1 = n >= 8 && ratio >= 0.8 && med <= TOL
  if (!ok1) fail++
  console.log(`    ① 素材真上屏：${n} 个探针点（屏幕空间布点，已剔除源图边界点 ${skipped} 个）· 中位差 ${med} · 达标 ${inTol}/${n} (${(ratio * 100).toFixed(0)}%) · 最大差 ${worst ? worst.d : '-'}${worst ? `（屏幕(${Math.round(worst.px)},${Math.round(worst.py)}) 实测[${worst.a}] vs 源[${worst.b}]）` : ''}  ${ok1 ? '✓' : '✗ 超标/点太少'}`)

  // ④ 左/右版式：媒体区外侧必须是**母版底色**（★ 不能写"必须是暗的" —— 浅色母版的底是亮的）
  //    横屏：媒体在左/右 → 判"旁侧"；竖屏：媒体是**整宽顶带** → 判"下侧"（旁侧已被媒体占满，取不到样）
  if (pg.layout === 'left' || pg.layout === 'right') {
    const wide = R.w >= FW * 0.95
    const probes = wide
      ? [0.25, 0.5, 0.75].map((fx) => ({ x: R.x + R.w * fx, y: R.y + R.h + 10, at: `媒体区下 y=${Math.round(R.y + R.h + 10)}` }))
      : [0.25, 0.5, 0.75].map((fy) => ({ x: pg.layout === 'left' ? R.x + R.w + 10 : R.x - 10, y: R.y + R.h * fy, at: `媒体区外 x=${Math.round(pg.layout === 'left' ? R.x + R.w + 10 : R.x - 10)}` }))
    const samples = probes.map((q) => framePx(frame, FW, q.x, q.y)).filter(Boolean)
    const ds = samples.map((c) => dist3(c, BG))
    const okBg = samples.length > 0 && ds.every((d) => d <= 40)
    if (!okBg) fail++
    console.log(`    ④ 版式矩形：${probes[0].at} 采样 [${samples.map((c) => c.join(',')).join(' | ')}] 与母版底色[${BG}] 距离 [${ds.join(',')}]  ${okBg ? '✓（是底色）' : '✗ 不是底色'}`)
  }

  // ③ 全幅压字对比度（WCAG 相对亮度）
  // ★ 判据难点：文字的抗锯齿边缘会把"背景亮度"估高（边缘像素介于底与字之间）。
  //   解法：**瓦片中值法** —— 把带内切成 40×40 瓦片取中值；笔画细 ⇒ 任何瓦片的中值都≈背景（除非整片被字盖住，
  //   这种片的中值≈文字亮度，用"< 0.6×文字亮度"的条件排除掉）。最坏背景 = 这些瓦片中值里的最大值。
  if (pg.layout === 'full') {
    const y0 = Math.round(FH * (1 - FULL_TOP))                       // 只看下部（渐隐底衬区）
    // 逐行最亮值 → 找"文字行"（强制浅色字 ⇒ 行内必有一批很亮的像素）
    const rowMax = []
    for (let y = y0; y < FH; y++) {
      let m = 0
      for (let x = R.x; x < R.x + R.w; x++) { const c = framePx(frame, FW, x, y); if (c) { const l = relLum(c); if (l > m) m = l } }
      rowMax.push({ y, m })
    }
    const isT = rowMax.map((r) => r.m > 0.72)
    const bands = []
    let s = -1
    for (let i = 0; i <= isT.length; i++) {
      const cur = i < isT.length ? isT[i] : false
      if (cur && s < 0) s = i
      else if (!cur && s >= 0) { if (i - s >= 6) bands.push({ y0: rowMax[s].y, y1: rowMax[i - 1].y, n: i - s }); s = -1 }
    }
    if (!bands.length) { console.log('    ③ 全幅压字对比度：✗ 找不到文字行（浅色文字没渲出来？）'); fail++ }
    for (const b of bands) {
      let Lt = 0, LtRGB = null
      for (let y = b.y0; y <= b.y1; y++) for (let x = R.x; x < R.x + R.w; x++) {
        const c = framePx(frame, FW, x, y); if (!c) continue
        const l = relLum(c); if (l > Lt) { Lt = l; LtRGB = c }
      }
      // ★ 背景取样：只取"该文字块里**没有文字的列**"（并排除文字列左右各 1 列）。
      //   为什么不用形态学腐蚀/瓦片中值：笔画密集处窗口仍落在字内，会把背景估高（实测把 0.14 估成 0.35 → 假失败）。
      //   "无文字的列"完全避开字形与抗锯齿边缘；背景（渐隐底衬+图）在 x 方向变化缓慢，取同 y 的旁列是**保守且无偏**的估计。
      const TH = b.y1 - b.y0 + 1
      const colHasText = new Array(R.w).fill(false)
      const colVals = Array.from({ length: R.w }, () => [])
      for (let x = R.x; x < R.x + R.w; x++) {
        const vals = colVals[x - R.x]
        for (let y = b.y0; y <= b.y1; y++) {
          const c = framePx(frame, FW, x, y); if (!c) continue
          const l = relLum(c)
          vals.push(l)
          if (l > 0.72) colHasText[x - R.x] = true
        }
      }
      const bgCols = []
      for (let i = 0; i < R.w; i++) {
        if (colHasText[i] || colHasText[i - 1] || colHasText[i + 1]) continue
        const v = colVals[i].slice().sort((a, b2) => a - b2)
        if (v.length) bgCols.push(v[Math.floor(v.length / 2)])      // 每列取中值（抗单点噪声）
      }
      bgCols.sort((a, b2) => a - b2)
      const LbWorst = bgCols.length ? bgCols[bgCols.length - 1] : null
      const medAll = bgCols.length ? bgCols[Math.floor(bgCols.length / 2)] : null
      if (LbWorst === null) { console.log(`    ③ 文字块 y=${b.y0}..${b.y1}：**文字占满整行，背景无法测量** ✗`); fail++; continue }
      console.log(`       （无文字列 ${bgCols.length} 列参与背景估计）`)
      // ★ WCAG 门槛按字号分：块高 ≥30px 视为大字（标题 42px）→ 3:1；否则按正文（图注 19px）→ 4.5:1
      const thr = TH >= 30 ? 3.0 : MIN_CONTRAST
      const cTyp = contrast(Lt, medAll), cWorst = contrast(Lt, LbWorst)
      const ok = cWorst >= thr
      if (!ok) fail++
      console.log(`    ③ 文字块 y=${b.y0}..${b.y1}（高 ${TH}px → 门槛 ${thr}:1）字色 [${LtRGB}] L=${Lt.toFixed(3)}`)
      console.log(`       背景（瓦片中值）${medAll.toFixed(3)} → ${cTyp.toFixed(2)}:1；最坏背景 ${LbWorst.toFixed(3)} → ${cWorst.toFixed(2)}:1   ${ok ? '✓' : '✗ 低于 ' + thr + ':1'}`)
    }
  }
}

console.log(`\n结论: ${fail === 0 ? 'PASS（素材真上屏 · 无异常滤镜 · 全幅压字对比度达标 · 版式矩形正确）' : `FAIL（${fail} 项）`}`)
process.exit(fail === 0 ? 0 : 1)
