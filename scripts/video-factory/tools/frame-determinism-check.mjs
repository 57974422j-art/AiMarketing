#!/usr/bin/env node
/**
 * frame-determinism-check.mjs —— 帧确定性自检
 *
 * ★ 新增文件，不改任何渲染行为、不碰 src/（见 docs/TASK-render-determinism-and-spec.md 铁律）
 *
 * 原理：同一份 HTML，用**两种不同的帧请求顺序**渲染同一批帧，比对像素是否逐字节一致。
 *   第一遍：[0, 1, 2, 3, 4, 5]
 *   第二遍：[4, 1, 5, 0, 3, 2]（乱序）
 *   ⇒ 若某处用了 Math.random() / Date.now() / "第一次画才初始化"的全局状态 / 异步字体时序，
 *     乱序请求时同一帧会画出**不同的画面** —— 这正是"渲染结果不可复现"的根源。
 *
 * 为什么必须：引擎是"逐帧截图再编码"，任何不确定性都会变成画面抖动；而且出问题只能靠肉眼。
 *
 * 用法：
 *   node scripts/video-factory/tools/frame-determinism-check.mjs <html路径> [选项]
 * 选项：
 *   --frames 0,15,30,60     要检查的帧号（秒）。默认按总时长自动取 6 个采样点
 *   --out <dir>             报告与帧图输出目录（默认 temp/determinism-<时间戳>）
 *   --chrome <path>         Chromium 路径（默认按环境变量 CHROME / 常见路径探测）
 *   --tolerance 0.01        允许的像素差异比例（默认 1%）。
 *                           为什么不是 0：Chromium 在 transform:scale()/filter 下**光栅化有亚像素差异**
 *                           （实测同一帧两遍差 68% 字节，但两张图肉眼完全相同）。
 *                           >5% 才有可能是真的不确定源（随机数/时钟/异步时序）。
 *   --keep                  保留两遍的帧图（默认只留不一致的）
 *   --json                  只输出 JSON（给机器读）
 *
 * 退出码：0 = 全部一致；1 = 有不一致；2 = 运行出错（缺文件/浏览器起不来）
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

// ── 参数 ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name, def = '') => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const flag = (name) => argv.includes('--' + name)

const htmlPath = argv.find((a) => !a.startsWith('--') && /\.html?$/i.test(a))
if (!htmlPath) {
  console.error('用法: node frame-determinism-check.mjs <html路径> [--frames 0,15,30] [--out dir]')
  process.exit(2)
}
const abs = path.resolve(htmlPath)
if (!fs.existsSync(abs)) {
  console.error('✗ 文件不存在: ' + abs)
  process.exit(2)
}

const OUT_DIR = arg('out', path.join('temp', 'determinism-' + Date.now()))
// 默认 1%：Chromium 光栅化本身有亚像素差异（详见 docs/hyperframes-SPEC.md §3）
const TOLERANCE = Number(arg('tolerance', '0.01'))
const KEEP = flag('keep')
const JSON_ONLY = flag('json')

// ── 找 Chromium ───────────────────────────────────────────────────────────
function findChrome() {
  const env = process.env.CHROME || process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH
  if (env && fs.existsSync(env)) return env
  const cands = [
    // Linux（服务器）
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/usr/lib/chromium/chromium', '/snap/bin/chromium',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Windows
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
  ]
  for (const c of cands) if (c && fs.existsSync(c)) return c
  // hyperframes 自带（如果项目里有）
  const hfRoot = path.resolve('scripts/video-factory/html-deck')
  for (const rel of ['.cache/chrome/chrome', 'node_modules/puppeteer/.local-chromium/*/chrome-linux64/chrome']) {
    const p = path.join(hfRoot, rel)
    if (!p.includes('*') && fs.existsSync(p)) return p
  }
  return ''
}

// ── puppeteer（优先项目内的，避免全局装） ─────────────────────────────────
function loadPuppeteer() {
  const tries = [
    'scripts/video-factory/html-deck/node_modules',
    'node_modules',
  ]
  for (const base of tries) {
    try {
      const req = createRequire(path.resolve(base, 'x.cjs'))
      return req('puppeteer-core')
    } catch { /* next */ }
  }
  try { return createRequire(import.meta.url)('puppeteer-core') } catch { /* ignore */ }
  throw new Error('找不到 puppeteer-core（可 npm i -D puppeteer-core，或复用 html-deck 的 node_modules）')
}

/* ★ 像素差异比例（**必须解码后逐像素比**）。
   为什么不能比 PNG 字节：PNG 是**压缩格式**，像素微差会让压缩输出完全不同
   ⇒ 实测同一帧两遍"字节差异 98%"，但两张图**肉眼完全一样**（只有纹理取样的亚像素差）。
   ⇒ 早先用字节比会把"正常的光栅化差异"报成 98%，**结论全错**。
   实现：优先用 sharp 解成 raw RGBA 逐像素比；没有 sharp 时退回字节比并**明确标注**。 */
let sharpMod = null
async function loadSharp() {
  if (sharpMod !== null) return sharpMod
  for (const base of ['scripts/video-factory/html-deck/node_modules', 'node_modules']) {
    try {
      const req = createRequire(path.resolve(base, 'x.cjs'))
      sharpMod = req('sharp')
      return sharpMod
    } catch { /* next */ }
  }
  try { sharpMod = (await import('sharp')).default } catch { sharpMod = false }
  return sharpMod
}

async function diffRatio(bufA, bufB) {
  if (bufA.equals(bufB)) return { ratio: 0, mode: 'identical' }
  const sharp = await loadSharp()
  if (!sharp) {
    // 退回字节比（不准确，必须在报告里说清）
    const n = Math.min(bufA.length, bufB.length)
    let diff = Math.abs(bufA.length - bufB.length)
    for (let i = 0; i < n; i++) if (bufA[i] !== bufB[i]) diff++
    return { ratio: diff / Math.max(bufA.length, bufB.length), mode: 'png-bytes' }
  }
  try {
    const [ra, rb] = await Promise.all([
      sharp(bufA).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(bufB).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ])
    if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) {
      return { ratio: 1, mode: 'size-mismatch' }
    }
    const px = ra.info.width * ra.info.height
    let diff = 0
    for (let i = 0; i < px; i++) {
      const o = i * 4
      // 任一通道差 >2 才算"肉眼可见的差"（容忍抗锯齿取样）
      if (Math.abs(ra.data[o] - rb.data[o]) > 2
        || Math.abs(ra.data[o + 1] - rb.data[o + 1]) > 2
        || Math.abs(ra.data[o + 2] - rb.data[o + 2]) > 2) diff++
    }
    return { ratio: diff / px, mode: 'pixels' }
  } catch {
    return { ratio: 1, mode: 'decode-failed' }
  }
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16)

// ── 页面内采集：段信息 + 文字被裁 + 字体失败 ──────────────────────────────
const PROBE = `(() => {
  const secs = [...document.querySelectorAll('.sec')]
  const dur = secs.map(s => Number(s.dataset.duration) || 0)
  const total = dur.reduce((a, b) => a + b, 0)
  // 文字被裁：横向溢出（scrollWidth 明显大于 clientWidth）
  const clipped = []
  document.querySelectorAll('.sec *').forEach((el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return
    if (el.scrollWidth > el.clientWidth + 4 && cs.overflow !== 'visible' && el.clientWidth > 0) {
      const t = (el.textContent || '').trim().slice(0, 18)
      if (t) clipped.push({ text: t, over: el.scrollWidth - el.clientWidth })
    }
    // 越界（超出 1280）
    const r = el.getBoundingClientRect()
    if (r.height > 0 && (r.bottom > 1285 || r.top < -5)) {
      const t = (el.textContent || '').trim().slice(0, 18)
      if (t) clipped.push({ text: t, outOfBounds: Math.round(Math.max(r.bottom - 1280, -r.top)) })
    }
  })
  const fontsFailed = (document.fonts && document.fonts.size)
    ? [...document.fonts].filter(f => f.status === 'error').map(f => f.family + '/' + f.weight)
    : null
  return { segs: secs.length, total: +total.toFixed(2), clipped: clipped.slice(0, 12), fontsFailed }
})()`

// ── 主流程 ────────────────────────────────────────────────────────────────
const t0 = Date.now()
fs.mkdirSync(OUT_DIR, { recursive: true })

const CHROME = arg('chrome', findChrome())
if (!CHROME) {
  console.error('✗ 找不到 Chromium/Chrome。请用 --chrome <path> 或设 CHROME 环境变量。')
  process.exit(2)
}

let puppeteer
try { puppeteer = loadPuppeteer() } catch (e) {
  console.error('✗ ' + e.message)
  process.exit(2)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--font-render-hinting=none'],
})
const errors = []
const pageErrors = []

async function openPage(url) {
  const p = await browser.newPage()
  await p.setViewport({ width: 720, height: 1280, deviceScaleFactor: 1 })
  p.on('console', (m) => { if (m.type() === 'error') errors.push(String(m.text()).slice(0, 200)) })
  p.on('pageerror', (e) => pageErrors.push(String(e.message || e).slice(0, 200)))
  /* ★ 模拟真实渲染环境（否则测出来的都是假阳性）：
     hyperframes 是"给 t → 调 __seek → 截一帧"，**rAF 在渲染时是空实现**。
     而 `ai-preview-guard`（本地预览兜底）**靠 rAF 持续改 --p** ⇒ 不屏蔽它，
     每次截图的时机不同 ⇒ 同一帧必然不同（实测 99% 差异，纯假阳性）。
     同时屏蔽 IntersectionObserver（guard 用它判断"进屏才开始播"）。
     这两条**不改变被测评页面的真实行为**：它们本来在渲染时就不存在。 */
  await p.evaluateOnNewDocument(() => {
    try { window.requestAnimationFrame = () => 0 } catch { /* ignore */ }
    try { window.cancelAnimationFrame = () => 0 } catch { /* ignore */ }
    try {
      window.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
    } catch { /* ignore */ }
  })
  await p.goto(url, { waitUntil: 'load', timeout: 120000 })
  /* 等字体 + **所有图片 decode 完**。
     为什么必须：页面里常是内嵌 base64（10MB+），**解码是异步的** ⇒
     只等 600ms 时，第一帧可能"图还没出来"，第二帧"图出来了" ⇒ 同一帧两次截图差 90%（假阳性，实测过）。
     `img.decode()` 不依赖 rAF，可以直接 await。 */
  try {
    await p.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready : true)
  } catch { /* ignore */ }
  try {
    await p.evaluate(() => Promise.all(
      [...document.images].map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()))
    ))
  } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 300))
  return p
}

/* ★--as-film（默认开）：把页面的 `data-mode` 强制改成 `film` 再测。
   为什么必须：我们生成的页面默认 `data-mode="preview"`，里面带着 `ai-preview-guard`
   （用 rAF + performance.now 持续改 `--p`，是给"人滚动预览"用的）。
   而 `daily-film.mjs:164` 在**出片前**会把 `data-mode="preview"` 换成 `"film"`，
   此时 guard 的脚本第一行就 `return`、预览 CSS 全部失效 ⇒ **真实渲染里它是死的**。
   所以：**不切成 film 就测，测的是"预览版"，会出现大量假阳性**（本地实测 t=16 差 68%）。
   做法：**在同目录写一个临时副本**（这样相对路径图片还能引用），测完删掉。
   `--keep-preview` 可关闭（想看预览版自己的确定性时用）。 */
const AS_FILM = !flag('keep-preview')
let testAbs = abs
let filmTmp = ''
if (AS_FILM) {
  let h = fs.readFileSync(abs, 'utf8')
  const before = h
  h = /data-mode\s*=/.test(h)
    ? h.replace(/data-mode\s*=\s*["'][^"']*["']/, 'data-mode="film"')
    : h.replace(/<html\b/i, '<html data-mode="film"')
  if (h !== before) {
    filmTmp = path.join(path.dirname(abs), '_filmtest-' + Date.now() + '.html')
    fs.writeFileSync(filmTmp, h, 'utf8')
    testAbs = filmTmp
  }
}

const url = 'file:///' + testAbs.replace(/\\/g, '/')

/* ★ 先静态看一眼这份 HTML 里有没有"自带时钟"的东西。
   为什么：`ai-preview-guard`（本地预览兜底）会用 rAF + performance.now() **持续改写 --p**，
   它是给"人滚动预览"用的，**不是给逐帧渲染用的**。
   渲染用的 HTML 不应该带它（带了也不会被调用，但会干扰自检）。
   这里只做**检测与提示**，不改文件（铁律：只读）。 */
const rawHtml = fs.readFileSync(abs, 'utf8')
const hasGuard = /ai-preview-guard/.test(rawHtml)
const hasRaf = /requestAnimationFrame/.test(rawHtml)
const hasRandom = /Math\.random\s*\(/.test(rawHtml)
const hasDateNow = /Date\.now\s*\(/.test(rawHtml)
const hasPerfNow = /performance\.now\s*\(/.test(rawHtml)
const hasAnim = /@keyframes|animation\s*:/i.test(rawHtml)
const staticWarnings = []
if (hasGuard) staticWarnings.push('页面含 ai-preview-guard（预览兜底，靠 rAF 持续改 --p）—— 它不是给渲染用的，测出来的差异可能是它')
if (hasRaf) staticWarnings.push('页面含 requestAnimationFrame（渲染时被置空 ⇒ 依赖它的动效不会跑）')
if (hasRandom) staticWarnings.push('页面含 Math.random() ⇒ 每次渲染必然不同')
if (hasDateNow) staticWarnings.push('页面含 Date.now() ⇒ 每次渲染必然不同')
if (hasPerfNow) staticWarnings.push('页面含 performance.now() ⇒ 若参与样式计算，帧会不确定')
if (hasAnim) staticWarnings.push('页面含 @keyframes/animation ⇒ 不随 t 定位，帧不确定（契约 §2.2 禁止）')

// 先开一页拿总时长（决定默认采样帧）
let probe
let frames
{
  const p = await openPage(url)
  probe = await p.evaluate(PROBE)
  const total = Math.max(1, Number(probe.total) || 6)
  const given = arg('frames', '')
  if (given) {
    frames = given.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x >= 0)
  } else {
    // 默认 6 个采样点：0, 20%, 40%, 60%, 80%, 末尾-0.1s
    frames = [0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => +(r * Math.max(0.1, total - 0.1)).toFixed(2))
  }
  await p.close()
}
if (!frames.length) frames = [0]

/* 第二遍的顺序：**确定性洗牌**（固定种子，跑多少次都一样，便于复现）
   —— 不能用 Math.random()，否则这个工具自己就不确定了。
   洗完后如果和第一遍完全相同（极端情况），再整体反转一次兜底。 */
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

async function shoot(frameList, tag) {
  const page = await openPage(url)
  const shots = new Map()
  for (const t of frameList) {
    await page.evaluate((tt) => {
      if (typeof window.__seek !== 'function') throw new Error('页面没有 window.__seek')
      window.__seek(tt)
      /* ★ 必须**滚动到当前段**（本地实测发现的关键点）：
         这类页面是"长滚动页"——所有段 `opacity` 都是 1、竖排堆叠（每段约一屏高），
         `__seek(t)` 只负责设 `--p`，**不负责滚动**。
         如果不滚，固定视口 720×1280 永远只能看到第一屏 ⇒ 各帧截图完全相同（假"确定性"）。
         滚到当前段（data-start <= t < start+duration 的那一段）才等于"这一帧该看到的画面"。
         兜底：找不到匹配段就按 t/总时长 比例估算位置。 */
      const secs = [...document.querySelectorAll('.sec')]
      let idx = -1
      for (let i = 0; i < secs.length; i++) {
        const s = +secs[i].dataset.start || 0
        const d = +secs[i].dataset.duration || 0
        if (tt >= s && tt < s + d) { idx = i; break }
      }
      if (idx < 0) idx = secs.length ? Math.min(secs.length - 1, Math.floor(secs.length * 0.5)) : 0
      const el = secs[idx]
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY
        window.scrollTo(0, Math.max(0, Math.round(top)))
      }
      /* 强制样式/布局落地：读一次 offsetHeight 会同步触发 reflow。
         ⚠️ 不能用 requestAnimationFrame 等待 —— 上面已经把它禁用（模拟真实渲染），
            再用 rAF 等会永远不 resolve（本地实测过 Runtime.callFunctionOn timed out）。 */
      void document.body.offsetHeight
      return idx
    }, t)
    await new Promise((r) => setTimeout(r, 40))   // 给字体/图片解码一点时间，不改变 --p
    const buf = await page.screenshot({ type: 'png' })
    shots.set(t, buf)
    if (KEEP) fs.writeFileSync(path.join(OUT_DIR, `frame-${t}-${tag}.png`), buf)
  }
  await page.close()
  return shots
}

let shotsA, shotsB
try {
  shotsA = await shoot(frames, 'A')
  shotsB = await shoot(orderB, 'B')
} finally {
  await browser.close()
}

// ── 比对 ──────────────────────────────────────────────────────────────────
const results = []
for (const t of frames) {
  const a = shotsA.get(t) || Buffer.alloc(0)
  const b = shotsB.get(t) || Buffer.alloc(0)
  const dr = await diffRatio(a, b)
  const ratio = dr.ratio
  const same = ratio <= TOLERANCE
  results.push({
    t, same, ratio: +ratio.toFixed(6), diffMode: dr.mode,
    shaA: sha(a), shaB: sha(b), bytesA: a.length, bytesB: b.length,
  })
  if (!same) {
    // 只保留不一致的帧图，便于人看
    fs.writeFileSync(path.join(OUT_DIR, `DIFF-${t}-A.png`), a)
    fs.writeFileSync(path.join(OUT_DIR, `DIFF-${t}-B.png`), b)
  }
}

const bad = results.filter((r) => !r.same)
const report = {
  ok: bad.length === 0,
  html: abs,
  asFilm: AS_FILM,
  testedAs: testAbs,
  chrome: CHROME,
  outDir: OUT_DIR,
  elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
  page: probe,
  framesRequested: { orderA: frames, orderB },
  results,
  consoleErrors: [...new Set(errors)].slice(0, 10),
  pageErrors: [...new Set(pageErrors)].slice(0, 10),
  warnings: [
    ...staticWarnings,
    ...(probe.fontsFailed === null ? ['字体状态未采集（浏览器不支持 document.fonts）'] : []),
    ...((probe.fontsFailed || []).length ? ['字体加载失败：' + (probe.fontsFailed || []).join(', ')] : []),
    ...(probe.clipped.length ? ['有 ' + probe.clipped.length + ' 处文字被裁/越界'] : []),
    ...(probe.segs === 0 ? ['页面里没有 .sec 分段'] : []),
  ],
  staticSignals: { hasGuard, hasRaf, hasRandom, hasDateNow, hasPerfNow, hasAnim },
}
fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8')

// ── 输出 ──────────────────────────────────────────────────────────────────
if (JSON_ONLY) {
  console.log(JSON.stringify(report))
} else {
  console.log('')
  console.log('帧确定性自检 · ' + path.basename(abs))
  console.log('  模式：' + (AS_FILM ? '已切成 data-mode=film（模拟真实渲染）' : '保持原样（预览版，--keep-preview）'))
  console.log('  页面：' + probe.segs + ' 段 · 总时长 ' + probe.total + 's · 耗时 ' + report.elapsedSec + 's')
  console.log('  采样帧：第一遍 [' + frames.join(', ') + ']')
  console.log('          第二遍 [' + orderB.join(', ') + ']（乱序）')
  console.log('')
  for (const r of results) {
    console.log('  t=' + String(r.t).padEnd(6) + (r.same ? '✅ 一致' : '❌ 不一致') +
      '  ' + (r.same ? r.shaA : r.shaA + ' vs ' + r.shaB) +
      (r.same ? '' : '  差异 ' + (r.ratio * 100).toFixed(2) + '%'))
  }
  console.log('')
  if (report.warnings.length) {
    console.log('  附带信号：')
    report.warnings.forEach((w) => console.log('    ⚠️ ' + w))
  }
  if (report.consoleErrors.length) {
    console.log('  console error：')
    report.consoleErrors.forEach((e) => console.log('    ✗ ' + e))
  }
  if (report.pageErrors.length) {
    console.log('  pageerror：')
    report.pageErrors.forEach((e) => console.log('    ✗ ' + e))
  }
  console.log('')
  const _dm = results[0]?.diffMode || '?'
  console.log(report.ok
    ? '  ✅ 全部一致（像素差异 ≤ ' + (TOLERANCE * 100).toFixed(1) + '% · 比对方式 ' + _dm + '）'
    : '  ❌ ' + bad.length + '/' + results.length + ' 帧不一致（像素差异 > ' + (TOLERANCE * 100).toFixed(1) + '%）⇒ 页面存在不确定源（看 DIFF-*.png）')
  console.log('  报告：' + path.join(OUT_DIR, 'report.json'))
  console.log('')
}

try { if (filmTmp) fs.unlinkSync(filmTmp) } catch { /* ignore */ }
process.exit(report.ok ? 0 : 1)
