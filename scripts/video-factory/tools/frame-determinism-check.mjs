#!/usr/bin/env node
/**
 * frame-determinism-check.mjs —— 帧确定性自检（v2：走 hyperframes snapshot）
 *
 * ★ 新增文件，不改任何渲染行为、不碰 src/（见 docs/TASK-render-determinism-and-spec.md 铁律）
 *
 * 原理：同一份页面，用**两种不同的帧请求顺序**各抽一次图，按时间点配对后逐像素比对。
 *   第一遍：--at 0,8,16,24,32      → frame-00-at-0s.png / frame-01-at-8s.png / …
 *   第二遍：--at 8,16,32,0,24      → frame-00-at-8s.png / frame-01-at-16s.png / …
 *   ⇒ 若某处用了 Math.random() / Date.now() / "第一次画才初始化"的全局状态 / 异步字体时序，
 *     乱序请求时同一时刻会画出**不同的画面** —— 这正是"渲染结果不可复现"的根源。
 *
 * 为什么不用 puppeteer 自己起浏览器（v1 的做法）：
 *   服务器上**找不到 chrome 可执行文件**（缓存为空、系统也没装），但 `hyperframes` 内部能找到。
 *   所以 v2 直接调用 `npx hyperframes snapshot`：**同一个渲染引擎**，测出来才有意义，也不依赖路径。
 *
 * 用法：
 *   node scripts/video-factory/tools/frame-determinism-check.mjs <html文件 | 已打包的项目目录> [选项]
 * 选项：
 *   --frames 0,8,16,24,32   要检查的时间点（秒）。默认按总时长自动取 6 个
 *   --out <dir>             报告与帧图输出目录（默认 temp/determinism-<时间戳>）
 *   --tolerance 0.01        允许的像素差异比例（默认 1%）
 *   --keep                  保留两遍的所有帧图（默认只保留不一致的）
 *   --json                  只输出 JSON
 *   --no-gpu                不传 --no-browser-gpu（默认传，强制 SwiftShader 软件渲染以保确定性）
 *
 * 退出码：0 = 全部一致；1 = 有不一致；2 = 运行出错
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

// ── 参数 ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name, def = '') => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const flag = (name) => argv.includes('--' + name)

const target = argv.find((a) => !a.startsWith('--'))
if (!target) {
  console.error('用法: node frame-determinism-check.mjs <html文件 | 项目目录> [--frames 0,8,16] [--out dir] [--tolerance 0.01]')
  process.exit(2)
}
const absTarget = path.resolve(target)
if (!fs.existsSync(absTarget)) {
  console.error('✗ 路径不存在: ' + absTarget)
  process.exit(2)
}

/* 默认输出到**系统临时目录**（Linux: /tmp，Windows: %TEMP%），不落在项目盘上。
   为什么：这个工具每次产出 10~50MB（打包项目 + 帧图），落在项目 temp/ 里会一直堆、
   而且部署脚本不会清它（服务器实测磁盘只剩 800MB 就是这类东西堆出来的）。
   /tmp 由系统定期清理，不占业务盘。需要保留时用 --out 指定路径。 */
const OUT_DIR = path.resolve(arg('out', path.join(os.tmpdir(), 'determinism-' + Date.now())))
const TOLERANCE = Number(arg('tolerance', '0.01'))
const KEEP = flag('keep')
const JSON_ONLY = flag('json')
const USE_NO_GPU = !flag('no-gpu')

const HF_DIR = path.resolve('scripts/video-factory/html-deck')
/* 跨平台启动方式：**不用 .bin/hyperframes**（Windows 上是 .cmd，spawnSync 会 EINVAL），
   而是读它 package.json 里的 bin 指向的 JS 文件，用 `node <entry>` 跑 —— Linux/Windows 都一样。 */
function resolveHyperframesEntry() {
  const pkgPath = path.join(HF_DIR, 'node_modules', 'hyperframes', 'package.json')
  if (!fs.existsSync(pkgPath)) return ''
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin && pkg.bin.hyperframes)
    if (!bin) return ''
    const p = path.join(path.dirname(pkgPath), bin)
    return fs.existsSync(p) ? p : ''
  } catch { return '' }
}
const HF_ENTRY = resolveHyperframesEntry()
if (!HF_ENTRY) {
  console.error('✗ 找不到 hyperframes 入口（node_modules/hyperframes/package.json 的 bin）')
  console.error('  先执行: cd scripts/video-factory/html-deck && npm install')
  process.exit(2)
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const t0 = Date.now()
const notes = []

// ── ① 拿到项目目录（HTML 就先打包） ───────────────────────────────────────
let projDir = ''
let packedBy = 'given'
if (fs.statSync(absTarget).isFile()) {
  // 用 daily-film.mjs 打包（它会做 media/fonts 检查并生成标准项目目录）
  const packOut = path.join(OUT_DIR, 'packed')
  const filmTool = path.resolve('scripts/video-factory/html-deck/tools/daily-film.mjs')
  const r = spawnSync(process.execPath, [filmTool, absTarget, '--outdir', packOut, '--check-only'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 300000,
  })
  const out = String(r.stdout || '') + String(r.stderr || '')
  if (!fs.existsSync(path.join(packOut, 'hyperframes.json'))) {
    console.error('✗ 打包失败（没生成 hyperframes.json）：')
    console.error(out.split('\n').filter((l) => l.trim()).slice(-6).map((l) => '  ' + l).join('\n'))
    process.exit(2)
  }
  projDir = packOut
  packedBy = 'daily-film.mjs'
  const badLine = out.split('\n').find((l) => /^stage=\w+\s*✗/.test(l.trim()))
  if (badLine) notes.push('打包阶段有告警：' + badLine.trim().slice(0, 160))
} else {
  projDir = absTarget
  if (!fs.existsSync(path.join(projDir, 'hyperframes.json'))) {
    console.error('✗ 这个目录里没有 hyperframes.json，不是 hyperframes 项目: ' + projDir)
    process.exit(2)
  }
}

// ── ② 决定采样时间点 ──────────────────────────────────────────────────────
function totalDuration(dir) {
  try {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
    const durs = [...html.matchAll(/data-duration="([\d.]+)"/g)].map((m) => Number(m[1]))
    if (durs.length) return durs.reduce((a, b) => a + b, 0)
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'hyperframes.json'), 'utf8'))
    return Number(j?.duration || j?.timeline?.duration || 0)
  } catch { return 0 }
}
let frames
{
  const given = arg('frames', '')
  if (given) {
    frames = given.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x >= 0)
  } else {
    const total = totalDuration(projDir) || 6
    frames = [0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => +(r * Math.max(0.1, total - 0.1)).toFixed(2))
  }
}
if (!frames.length) frames = [0]

/* 第二遍顺序：**确定性洗牌**（固定种子，跑多少次都一样，便于复现）。
   不能用 Math.random()，否则这个工具自己就不确定了。 */
function seededShuffle(arr) {
  const a = [...arr]
  let s = 20261022
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}
let orderB = seededShuffle(frames)
if (orderB.join(',') === frames.join(',')) orderB = [...frames].reverse()

// ── ③ 调 hyperframes snapshot ─────────────────────────────────────────────
function snapshot(times, outSub, tag) {
  const out = path.join(OUT_DIR, outSub)
  fs.mkdirSync(out, { recursive: true })
  const args = [HF_ENTRY, 'snapshot', projDir, '--at', times.join(','), '--no-end', '-o', out, '--timeout', '20000']
  if (USE_NO_GPU) args.push('--no-browser-gpu')
  const r = spawnSync(process.execPath, args, { cwd: HF_DIR, encoding: 'utf8', timeout: 600000 })
  const log = String(r.stdout || '') + String(r.stderr || '')
  if (r.error) throw new Error(tag + ' 启动失败：' + r.error.message)
  const files = fs.existsSync(out) ? fs.readdirSync(out).filter((f) => /^frame-\d+-at-[\d.]+s\.png$/i.test(f)) : []
  if (!files.length) {
    throw new Error(tag + ' 没有产出任何帧。日志尾部：\n' + log.split('\n').filter((l) => l.trim()).slice(-8).join('\n'))
  }
  // 按文件名里的 at 时间建索引（不依赖顺序）
  const map = new Map()
  for (const f of files) {
    const m = /^frame-\d+-at-([\d.]+)s\.png$/i.exec(f)
    if (m) map.set(Number(m[1]), path.join(out, f))
  }
  return { map, log, dir: out }
}

let snapA, snapB
try {
  snapA = snapshot(frames, 'passA', '第一遍')
  snapB = snapshot(orderB, 'passB', '第二遍')
} catch (e) {
  console.error('✗ ' + String(e.message || e))
  process.exit(2)
}
if (/browserGpuMode probe/.test(snapA.log)) {
  const m = /browserGpuMode probe → (\w+)/.exec(snapA.log)
  if (m) notes.push('浏览器 GPU 模式：' + m[1])
}

// ── ④ 像素比对 ────────────────────────────────────────────────────────────
let sharpMod = null
async function loadSharp() {
  if (sharpMod !== null) return sharpMod
  for (const base of [path.join(HF_DIR, 'node_modules'), 'node_modules']) {
    try { sharpMod = createRequire(path.resolve(base, 'x.cjs'))('sharp'); return sharpMod } catch { /* next */ }
  }
  try { sharpMod = (await import('sharp')).default } catch { sharpMod = false }
  return sharpMod
}

async function pixelDiff(fileA, fileB) {
  const a = fs.readFileSync(fileA)
  const b = fs.readFileSync(fileB)
  if (a.equals(b)) return { ratio: 0, mode: 'identical' }
  const sharp = await loadSharp()
  if (!sharp) {
    const n = Math.min(a.length, b.length)
    let d = Math.abs(a.length - b.length)
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++
    return { ratio: d / Math.max(a.length, b.length), mode: 'png-bytes(fallback)' }
  }
  try {
    const [ra, rb] = await Promise.all([
      sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ])
    if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) return { ratio: 1, mode: 'size-mismatch' }
    const px = ra.info.width * ra.info.height
    let diff = 0
    for (let i = 0; i < px; i++) {
      const o = i * 4
      if (Math.abs(ra.data[o] - rb.data[o]) > 2
        || Math.abs(ra.data[o + 1] - rb.data[o + 1]) > 2
        || Math.abs(ra.data[o + 2] - rb.data[o + 2]) > 2) diff++
    }
    return { ratio: diff / px, mode: 'pixels' }
  } catch { return { ratio: 1, mode: 'decode-failed' } }
}

const results = []
for (const t of frames) {
  const fa = snapA.map.get(t)
  const fb = snapB.map.get(t)
  if (!fa || !fb) {
    results.push({ t, same: false, ratio: 1, diffMode: 'missing', note: !fa ? '第一遍没这一帧' : '第二遍没这一帧' })
    continue
  }
  const dr = await pixelDiff(fa, fb)
  const same = dr.ratio <= TOLERANCE
  results.push({ t, same, ratio: +dr.ratio.toFixed(6), diffMode: dr.mode })
  if (!same) {
    fs.copyFileSync(fa, path.join(OUT_DIR, `DIFF-${t}-A.png`))
    fs.copyFileSync(fb, path.join(OUT_DIR, `DIFF-${t}-B.png`))
  } else if (!KEEP) {
    // 一致的帧默认删掉，只留不一致的，省空间
    try { fs.unlinkSync(fa) } catch { /* ignore */ }
    try { fs.unlinkSync(fb) } catch { /* ignore */ }
  }
}

// ── ⑤ 静态信号（只读，不改文件） ──────────────────────────────────────────
const idxPath = path.join(projDir, 'index.html')
const rawHtml = fs.existsSync(idxPath) ? fs.readFileSync(idxPath, 'utf8') : ''
const signals = {
  hasGuard: /ai-preview-guard/.test(rawHtml),
  hasRaf: /requestAnimationFrame/.test(rawHtml),
  hasRandom: /Math\.random\s*\(/.test(rawHtml),
  hasDateNow: /Date\.now\s*\(/.test(rawHtml),
  hasPerfNow: /performance\.now\s*\(/.test(rawHtml),
  hasAnim: /@keyframes|animation\s*:/i.test(rawHtml),
}
const staticWarnings = []
if (signals.hasRandom) staticWarnings.push('含 Math.random() ⇒ 每次渲染必然不同')
if (signals.hasDateNow) staticWarnings.push('含 Date.now() ⇒ 每次渲染必然不同')
if (signals.hasAnim) staticWarnings.push('含 @keyframes/animation ⇒ 不随 t 定位，帧不确定（SPEC §2.2 禁止）')
if (signals.hasRaf) staticWarnings.push('含 requestAnimationFrame ⇒ 渲染时被置空，依赖它的动效不会跑')
if (signals.hasPerfNow) staticWarnings.push('含 performance.now() ⇒ 若参与样式计算，帧会不确定')
if (signals.hasGuard) staticWarnings.push('含 ai-preview-guard（预览兜底）—— 渲染时应由 data-mode=film 关掉')

const bad = results.filter((r) => !r.same)
const report = {
  ok: bad.length === 0,
  target: absTarget,
  projectDir: projDir,
  packedBy,
  outDir: OUT_DIR,
  elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
  tolerance: TOLERANCE,
  framesRequested: { orderA: frames, orderB },
  results,
  signals,
  notes: [...notes, ...staticWarnings],
}
fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8')

// ── 输出 ──────────────────────────────────────────────────────────────────
if (JSON_ONLY) {
  console.log(JSON.stringify(report))
} else {
  console.log('')
  console.log('帧确定性自检 · ' + path.basename(absTarget))
  console.log('  项目目录：' + projDir + (packedBy === 'given' ? '（直接给定）' : '（本工具打包）'))
  console.log('  采样帧：第一遍 [' + frames.join(', ') + ']')
  console.log('          第二遍 [' + orderB.join(', ') + ']（乱序）')
  console.log('')
  for (const r of results) {
    const line = '  t=' + String(r.t).padEnd(6)
      + (r.same ? '✅ 一致' : '❌ 不一致') + '  像素差异 ' + (r.ratio * 100).toFixed(3) + '%'
      + '  (' + r.diffMode + ')' + (r.note ? '  ' + r.note : '')
    console.log(line)
  }
  console.log('')
  if (report.notes.length) {
    console.log('  附带信号：')
    report.notes.forEach((w) => console.log('    ⚠️ ' + w))
  }
  console.log('')
  console.log(report.ok
    ? '  ✅ 全部一致（像素差异 ≤ ' + (TOLERANCE * 100).toFixed(1) + '%）⇒ 页面是帧确定的'
    : '  ❌ ' + bad.length + '/' + results.length + ' 帧不一致（> ' + (TOLERANCE * 100).toFixed(1) + '%）⇒ 存在不确定源，看 DIFF-*.png')
  console.log('  报告：' + path.join(OUT_DIR, 'report.json'))
  console.log('  耗时：' + report.elapsedSec + 's')
  console.log('')
}

process.exit(report.ok ? 0 : 1)
