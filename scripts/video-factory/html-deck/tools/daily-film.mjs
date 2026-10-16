#!/usr/bin/env node
/**
 * ★VF_DAILYFILM_V1（2026-10-14 用户定案「算了风险太大。还是独立设计吧。多几步算了」）——
 *   **日报落地页 → 视频**。独立出片：**不碰 HTML成片线**。
 * =============================================================================
 * 为什么不走成片线复用（这是有意的取舍，别改）：
 *   两条线的"页"是两套结构（日报 8 种 layout vs 成片 8 种 structure）。若在 film.json 层复用，
 *   成片线会用**它自己的页型**重新生成 HTML ⇒ 日报的版式与 AI 自写段**全被吃掉** ——
 *   那正是用户开这条线要摆脱的"模板化"。所以**只借引擎，不借页面**。
 *
 * 链路（4 步，已用 gen_20261014_048 在本机跑通一次完整 41.8s 成片）：
 *   ① 打包：日报**单文件**HTML → 引擎可渲染目录
 *      （补 4 样：#stage[data-composition-id] / .sec→.clip[data-track-index] /
 *        window.__timelines.main.seek 接到日报页的 __seek / hyperframes.json）
 *   ② 闸门A 用字表：check-page-fonts.mjs（表外字 ⇒ 服务器会渲成豆腐块）
 *   ③ 闸门B 引擎校验：hyperframes check（对比度 / 重叠 / 遮挡 / 资源）
 *   ④ 渲染：hyperframes render **-q looks**
 *      ⚠️ 档位不能省成默认 standard —— 实测 standard 只有 **3.39 Mbps**，720×1280 下照片纹理
 *         被抹掉（用户原话「感觉图片像素变低了」）。looks 是成片线在用的档（render-film.mjs:233）。
 *
 * 已知两条"日报页特有的坑"，这里都堵了：
 *   · **抖动**：preview 的 rAF 循环按真实时间写 `--sp`，会与引擎 seek 抢同一个变量。
 *     源头修在 daily-page.mjs（__seek 先 stop + film 模式不启循环）；这里再对**旧产物**兜底
 *     （把文件尾 `else start()` 改成"film 模式不启动"）。
 *   · **像素**：见上，强制 `-q looks`。
 *
 * 用法：node tools/daily-film.mjs <gen_xxx.html> --outdir <dir> [--fps 25] [--quality looks] [--skip-check]
 * 退出码：0 成功 · 1 被闸门/渲染拦（stdout 里有 stage=...） · 2 用法错
 * 成功时 stdout 打一行 `FINAL_MP4:<绝对路径>`（与 film-voice.mjs 同约定，便于调用方解析）
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')   // html-deck/
const HF = path.join(HERE, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs')

function run(cmd, argv, opts) {
  return spawnSync(cmd, argv, Object.assign({ cwd: HERE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, opts || {}))
}

const argv = process.argv.slice(2)
const src = argv[0]
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
if (!src || src.startsWith('--')) {
  console.log('用法：node tools/daily-film.mjs <gen_xxx.html> --outdir <dir> [--fps 25] [--quality looks] [--skip-check]')
  process.exit(2)
}
const abs = path.resolve(src)
if (!fs.existsSync(abs)) { console.log('✗ 文件不存在：' + abs); process.exit(2) }
const outDir = path.resolve(opt('outdir', path.join(path.dirname(abs), 'film-out')))
const fps = String(opt('fps', '25'))
const quality = String(opt('quality', 'looks'))
// ★worker 数：引擎默认 auto（本机判成 4），每个 worker 一个独立 Chrome（~256MB）。
//   日报单文件版的图是 **base64 内嵌** ⇒ **每个 worker 都要完整加载一份同样大的页面**，
//   实测 4 worker 会直接把渲染进程打崩（native crash，stderr 只剩一个 Windows 异常地址）。
// ★VF_DAILY_V27（2026-10-16 素材上限 10→20）：页面会明显变大（20 张内嵌）⇒ **按页面体积自动降**，
//   不要写死 2 —— 写死就会在"图更多"时重演那次 crash。可用 --workers 覆盖。
// ★VF_DAILY_V38（2026-10-16 修 V27 引入的 bug）：这里原来写的是 **`srcHtml`** —— 那个变量**根本不存在**
//   ⇒ `fs.statSync(undefined)` 抛错、被 catch 吞掉 ⇒ **永远返回 7** ⇒ "按页面体积自动降 worker"**从来没生效过**
//   （一直恒等于 2，侥幸没出事）。正确变量是上面 resolve 过的 `abs`。
//   ⚠️ 教训：`try/catch + 兜底值` 会把"写错变量名"这种硬错误变成**静默的错误行为** ——
//      这类兜底要么**打日志**，要么就别吞（这里现在改成"出错就明说"）。
const htmlMB = (() => {
  try { return fs.statSync(abs).size / 1024 / 1024 } catch (e) {
    console.log('[警告] 量页面体积失败（' + String((e && e.message) || e).slice(0, 80) + '）⇒ 按 7MB 估')
    return 7
  }
})()
const autoWorkers = htmlMB > 8 ? '1' : (htmlMB > 4 ? '2' : '3')
const workers = String(opt('workers', autoWorkers))
const skipCheck = argv.includes('--skip-check')

// ── ① 读输入 + 体检 ────────────────────────────────────────────────────────────
let html = fs.readFileSync(abs, 'utf8')
// ⚠️ 用**前缀**匹配 `class="sec` —— 打包过一次的副本里是 `class="sec clip"`，
//    写死 `class="sec"` 会把合法输入误判成"不是日报页"（2026-10-14 自测时就这么误报的）。
if (!/<section class="sec/.test(html)) { console.log('stage=html ✗ 这不是日报落地页（没找到 .sec 段）'); process.exit(1) }
/* ★VF_DAILY_V39（2026-10-16 **本地复现后**改）：
   原来这里**明确拒绝**"配图版"（注释理由：*服务端本来就能出单文件版*）。
   但本地复现证明那条理由已经不成立 —— **单文件版（7MB 就够）会让浏览器在 `page.goto` 阶段直接崩**
   （`exit=134`，日志停在 `[initSession:screenshot] page.goto start`）：
   一个 HTML 里塞几十兆 base64 ⇒ **加载时就炸**，跟内存大小、跟正则都无关。
   ⇒ 现在**接受配图版**（图作为旁边的小文件）；打包阶段会把 `images/` 一起搬过去。
   ⚠️ 若这份页面**两种引用都没有**（既没内嵌也没外部图）⇒ 仍然报出来（不静默）。 */
const extRefs = html.match(/src="(?!data:)([^"]+\.(?:jpg|jpeg|png|webp))"/gi) || []
const hasInline = html.indexOf('src="data:image/') >= 0
if (extRefs.length) {
  console.log('[输入] 配图版：引用外部图 ' + extRefs.length + ' 处')
  if (!hasInline) console.log('[输入] 这份页面没有任何内嵌图 —— 走"页面 + 图文件"模式')
  // ★VF_DAILY_V39（本地实测踩到）：**必须把图搬到打包目录** —— 引擎读的是**打包产物**所在的目录，
  //   不是源文件旁边。不搬 ⇒ 校验报 `missing_local_asset: images/eNNN.jpg`（本地就是这条）。
  //   位置：`outDir` 在文件前部已 resolve（第 52 行附近）⇒ 这里就能用。
  const srcImgDir = path.join(path.dirname(abs), 'images')
  if (fs.existsSync(srcImgDir)) {
    const dstImgDir = path.join(outDir, 'images')
    fs.mkdirSync(dstImgDir, { recursive: true })
    let moved = 0
    for (const f of fs.readdirSync(srcImgDir)) {
      const a2 = path.join(srcImgDir, f)
      if (fs.statSync(a2).isFile()) { fs.copyFileSync(a2, path.join(dstImgDir, f)); moved++ }
    }
    console.log('[输入] 已搬图 ' + moved + ' 张 → ' + dstImgDir)
  } else {
    console.log('stage=media ✗ 页面引用了 images/ 里的图，但源目录里没有 images/（' + srcImgDir + '）')
    process.exit(1)
  }
} else if (!hasInline) {
  console.log('stage=media ✗ 这份页面既没有内嵌图、也没有外部图引用（不是正常的日报页产物）')
  process.exit(1)
}

// ── ② 打包 ────────────────────────────────────────────────────────────────────
const secRe = /<section class="sec"[\s\S]*?<\/section>/g
const secs = html.match(secRe) || []
let total = 0
secs.forEach((s) => {
  const a = Number((s.match(/data-start="([\d.]+)"/) || [])[1] || 0)
  const d = Number((s.match(/data-duration="([\d.]+)"/) || [])[1] || 0)
  total = Math.max(total, a + d)
})
if (!(total > 0)) { console.log('stage=html ✗ 算不出总时长（data-start/data-duration 缺失）'); process.exit(1) }

// 抖动兜底（旧产物）：见文件头。找不到 `else start()` 就不动（新产物已自带 stop()，打印即可）。
const patched = html.replace(/else start\(\)/, "else if (document.documentElement.dataset.mode !== 'film') start()")
const loopFallback = patched !== html
html = patched

// ★去非确定性（引擎 check 明令禁止，实测就是"播放时轻微抖动"的真凶）：
//   ✗ non_deterministic_code        —— `performance.now()` 逐帧/逐次渲染结果会不同
//   ✗ requestanimationframe_in_composition —— rAF 按**墙钟时间**跑、不与帧捕获同步
//     （引擎原话：will cause flickering or missed frames during rendering）
//   出片副本**不需要 preview 自动播放**（那是给人打开网页看的），所以把这两个字面量换成惰性替身：
//   代码结构保持原样（避免正则切段切坏），行为上"循环永不推进" ⇒ 唯一的驱动只剩引擎的 seek。
//   ⚠️ 替身必须在**页面脚本之前**定义（原 IIFE 在 </body> 前就跑）⇒ 注到 </head> 前。
const noopDef = '<script>window.__noopNow=function(){return 0};window.__noopRaf=function(){return 0};</script>'
html = html.replace(/performance\.now/g, 'window.__noopNow')
html = html.replace(/requestAnimationFrame/g, 'window.__noopRaf')
html = html.replace('</head>', noopDef + '\n</head>')
html = html.replace(/class="sec"/g, 'class="sec clip" data-track-index="1"')
html = html.replace('data-mode="preview"', 'data-mode="film"')

const first = html.indexOf('<section class="sec clip"')
const lastEnd = html.lastIndexOf('</section>') + '</section>'.length
if (first < 0 || lastEnd <= first) { console.log('stage=html ✗ 段包裹失败（.sec 结构异常）'); process.exit(1) }
html = html.slice(0, first)
  + '<div id="stage" data-composition-id="main" data-start="0" data-duration="' + total
  + '" data-fps="' + fps + '" data-width="720" data-height="1280">\n'
  + html.slice(first, lastEnd) + '\n</div>' + html.slice(lastEnd)

html = html.replace('</body>', '<script>\n'
  + '/* ★VF_DAILYFILM_V2：把 __seek 包一层 —— 写 CSS 变量是异步应用的，\n'
  + '   而引擎 seek 完就截图 ⇒ 可能截到上一帧的样式（表现为轻微抖）。这里补一次强制 flush。\n'
  + '   对**新产物**是冗余（daily-page.mjs 已在 __seek 里 flush），对**旧产物**是必需。 */\n'
  + '(function () {\n'
  + '  var o = window.__seek;\n'
  + '  if (typeof o === "function") {\n'
  + '    window.__seek = function (t) { o(t); void document.body.offsetHeight; };\n'
  + '  }\n'
  + '})();\n'
  + '</script>\n<script>\n'
  + '/* ★VF_DAILYFILM_V1 接缝：引擎按 window.__timelines[compId] 逐帧 seek；\n'
  + '   日报页的逐段进度在 __seek 里（写 --sp / data-live）⇒ 直接指过去。 */\n'
  + 'window.__timelines = window.__timelines || {};\n'
  + 'window.__timelines["main"] = {\n'
  + '  seek: function (t) { try { window.__seek(t) } catch (e) { /* 忽略 */ } },\n'
  + '  duration: function () { return ' + total + '; },\n'
  + '  pause: function () {}, play: function () {}\n'
  + '};\n</script>\n</body>')

/* ═══ ★VF_DAILYFILM_V8（2026-10-16 用户在服务器上 OOM 后定案）═══
   把页面里的 **base64 资源（内嵌图 + 内嵌字体）全部外置成旁边的小文件**，页面只留相对路径。
   **为什么必须做（这回是真因级的）**：用户服务器上那份单文件版 **8.3MB**（≈5.6MB 是 V40 内嵌的子集字体 + 2.4MB 图）
   跑到 **374s 被 OOM killer 杀掉** —— daily-voice 看到的是 `exit=null`（子进程被**信号**杀死，不是正常退出），
   日志尾部是 `V8_Fatal + Native stack trace`。而**同一份 12.7MB 页面本地外置后**：
   引擎要吞的字符串 **13035KB → 48KB**、**渲染耗时 128s → 59s**（快一倍多）、四道闸门全过 ⇒ 内存峰值大降。
   ⚠️ 外置**只作用于出片副本**：交付 / 客户端预览用的单文件版**一个字节都不动**（仍自包含，离机双击也能看）。
   实现口径（照 `temp/_daily/flatten-assets.mjs` 的已验证实现）：
     · 只扫 `"data:` 与 `(data:` 两种前缀，**全程 indexOf/slice，绝不用大正则处理长字符串**
       （V34 那次就是"大字符串 + 正则"把 Node 撑爆的）；
     · 资源写进 `<outDir>/images/`（借 V39 已有的整套搬图/校验口径），页面里改成 `images/xxx` 相对路径；
     · 认不出的 mime 原样保留（**不静默丢资源**）。 */
const flat = (() => {
  const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'font/woff2': 'woff2', 'font/ttf': 'ttf' }
  const imgDir = path.join(outDir, 'images')
  const s = html
  let i = 0, out = '', nImg = 0, nFont = 0, bytes = 0
  while (true) {
    const a = s.indexOf('"data:', i)
    const b = s.indexOf('(data:', i)
    let k = -1, quote = ''
    if (a >= 0 && (b < 0 || a < b)) { k = a; quote = '"' } else if (b >= 0) { k = b; quote = ')' }
    if (k < 0) { out += s.slice(i); break }
    const end = s.indexOf(quote, k + 1)
    if (end < 0) { out += s.slice(i); break }
    const uri = s.slice(k + 1, end)
    const comma = uri.indexOf(',')
    const head = comma > 0 ? uri.slice(5, comma) : ''
    const mime = head.split(';')[0].trim().toLowerCase()
    const ext = EXT[mime]
    if (!ext || head.indexOf('base64') < 0) { out += s.slice(i, end); i = end; continue }
    const isFont = mime.indexOf('font') === 0
    const name = isFont ? ('f' + (++nFont) + '.' + ext) : ('e' + String(++nImg).padStart(3, '0') + '.' + ext)
    const buf = Buffer.from(uri.slice(comma + 1), 'base64')
    fs.mkdirSync(imgDir, { recursive: true })
    fs.writeFileSync(path.join(imgDir, name), buf)
    bytes += buf.length
    out += s.slice(i, k + 1) + 'images/' + name   // 原引号/括号留给下一轮，别自己补（否则重复）
    i = end
  }
  return { html: out, n: nImg + nFont, bytes }
})()
if (flat.n) {
  console.log('   ★ 资源外置：' + flat.n + ' 个（' + (flat.bytes / 1048576).toFixed(1) + ' MB）→ ' + path.join(outDir, 'images')
    + ' · 引擎要吞的页面 ' + (Buffer.byteLength(html, 'utf8') / 1048576).toFixed(2) + ' MB → '
    + (Buffer.byteLength(flat.html, 'utf8') / 1024).toFixed(0) + ' KB')
  html = flat.html
}

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8')
fs.writeFileSync(path.join(outDir, 'hyperframes.json'), JSON.stringify({
  $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
  paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
  media: { autoProxy: true },
}, null, 2), 'utf8')
console.log('① 打包 OK：' + secs.length + ' 段 · ' + total + 's · ' + outDir
  + (loopFallback ? '（已给旧产物打抖动兜底补丁）' : ''))

// ── ③ 两道闸门 ────────────────────────────────────────────────────────────────
if (!skipCheck) {
  const fp = run(process.execPath, [path.join(HERE, 'check-page-fonts.mjs'), outDir, '--json'])
  if (fp.status !== 0) {
    // ★VF_DAILYFILM_V4（2026-10-14 用户实测「stage=fonts ✗ …：」**冒号后面什么都没有**）：
    //   两层信息丢失，都要治 ——
    //   ① `check-page-fonts.mjs` 在 `--json` 下**只打 JSON、不打人话**（人话那支是 `if (!asJson)`）
    //      ⇒ 把 stdout 直接打出来只会得到一片 JSON；
    //   ② 上层（`src/lib/agent/daily-film.ts`）只挑含 `stage=` / `✗` 的行 ⇒ JSON 那些行**全被滤掉** ⇒ 报错成空。
    //   现口径：**解析 JSON 取 miss[].ch**，并把字**打在 stage= 那一行里**（一行带全，谁也滤不掉）。
    let chars = []
    try {
      // ⚠️ 别用"取最后一行"：那份 JSON 是 `JSON.stringify(..., null, 2)`（**美化过的多行**）
      //   ⇒ 最后一行只有 `}`，解析必然失败（2026-10-14 自测就卡在这，报错还是空的）。
      //   正确做法：从第一个 `{` 截到最后一个 `}` 再解析。
      const raw = String(fp.stdout || '').trim()
      const i0 = raw.indexOf('{'), i1 = raw.lastIndexOf('}')
      const j = JSON.parse(i0 >= 0 && i1 > i0 ? raw.slice(i0, i1 + 1) : '{}')
      chars = (j.results || []).flatMap((r) => (r.miss || []).map((m) => m.ch))
    } catch { /* 解析不了就走下面的原样打印 */ }
    chars = Array.from(new Set(chars.filter(Boolean)))
    if (chars.length) {
      console.log('stage=fonts ✗ 表外字 ' + chars.length + ' 个：' + chars.join('、')
        + ' —— 这几个字不在内嵌字体子集里（服务器会渲成豆腐块）⇒ 改文案避开即可')
    } else {
      const lines = String(fp.stdout || fp.stderr || '').split('\n').filter((l) => l.trim()).slice(0, 10)
      console.log('stage=fonts ✗ 用字闸门未过（解析不出具体字，原始输出如下）：')
      lines.forEach((l) => console.log('   ' + l.trim()))
    }
    process.exit(1)
  }
  console.log('② 用字闸门 OK')
  const ck = run(process.execPath, [HF, 'check', outDir])
  if (ck.status !== 0) {
    const lines = String(ck.stdout || '').split('\n').filter((l) => l.includes('✗')).slice(0, 8).join(' | ')
    console.log('stage=check ✗ 引擎校验未过：' + (lines.slice(0, 500) || 'check 未通过'))
    process.exit(1)
  }
  console.log('③ 引擎校验 OK')
}
// --check-only：只跑闸门（迭代时用，省掉几分钟渲染）
if (argv.includes('--check-only')) { console.log('（--check-only：闸门全过，未渲染）'); process.exit(0) }

// ── ④ 渲染 ────────────────────────────────────────────────────────────────────
const mp4 = path.join(outDir, path.basename(abs, path.extname(abs)) + '.mp4')
const t0 = Date.now()
/* ★VF_DAILYFILM_V7（2026-10-16 用户要求"拿完整崩溃栈"）：
   原来渲染输出**收进内存**（`run()` 的 maxBuffer 64MB）⇒ 崩溃时 Node 被 kill / 输出被截断，
   上层只看到 `[initSession:screenshot] page.goto start` 这一条（约 25%），**栈尾巴全丢了**。
   照 `daily-voice.mjs`（V3/V34）的现成做法改：**直接重定向到文件**（内存零占用、日志留档）。
   失败时从日志里取**尾部**（Windows native crash 的真因都在最后几行）。
   ⚠️ 传了 stdio 数组后 spawnSync 的 `r.stdout/r.stderr` 必然是 null ⇒ 不许再读它们。 */
const renderLog = path.join(outDir, 'render.log')
let logFd = -1
try { logFd = fs.openSync(renderLog, 'w') } catch (e) {
  console.log('[警告] 渲染日志无法落盘（' + String((e && e.message) || e).slice(0, 80) + '）⇒ 输出仍收进内存')
}
const r = run(process.execPath, [HF, 'render', outDir, '-o', mp4, '-f', fps, '-q', quality, '-w', workers],
  { timeout: 60 * 60 * 1000, ...(logFd >= 0 ? { stdio: ['ignore', logFd, logFd] } : {}) })
try { if (logFd >= 0) fs.closeSync(logFd) } catch { /* ignore */ }
if (r.status !== 0 || !fs.existsSync(mp4)) {
  let lines = []
  try {
    lines = String(fs.readFileSync(renderLog, 'utf8')).split('\n').map((x) => x.replace(/\s+$/, '')).filter((l) => l.trim())
  } catch { lines = [] }
  console.log('stage=render ✗ exit=' + r.status
    + (lines.length ? '（完整日志 ' + lines.length + ' 行 → ' + path.relative(process.cwd(), renderLog) + '）' : '')
    + (logFd < 0 ? ' ' + String(r.stderr || '').slice(-200) : ''))
  // 崩溃真因（native crash / OOM / 字体）通常在**最后几行**；`page.goto start` 这种"卡在哪"的线索通常在**首次出现**处。
  // ★VF_DAILYFILM_V8（2026-10-16 用户实测「贴回来的只有 Native stack trace」）：
  //   **先抽关键行，再打尾部** —— 原来只打"最后 8 行"，而崩在 OOM 时最后 8 行**全是 Native stack trace**，
  //   真正有用的 `FATAL ERROR: … out of memory` / `Fetched … font face` 在**更前面** ⇒ 等于白留了日志。
  const KEY = /FATAL|out of memory|heap|V8_Fatal|RegExp|Fetched .*font face|Embedded system font|Starting browsers|page\.goto|Compiled composition|error\(s\)/i
  const key = lines.filter((l) => KEY.test(l)).slice(0, 10)
  if (key.length) console.log('   关键行：' + key.join(' | ').slice(0, 900))
  const tail = lines.slice(-6).join(' | ')
  if (tail) console.log('   日志尾部：' + tail.slice(0, 600))
  const at = lines.findIndex((l) => /page\.goto start|initSession/.test(l))
  if (at >= 0) console.log('   卡点附近：' + lines.slice(Math.max(0, at - 2), at + 4).join(' | ').slice(0, 600))
  process.exit(1)
}
const size = (fs.statSync(mp4).size / 1024 / 1024).toFixed(1)
console.log('④ 渲染 OK：' + size + ' MB · ' + total + 's · ' + ((Date.now() - t0) / 1000).toFixed(0) + 's（' + quality + ' 档）')
// ★VF_DAILYFILM_V5（2026-10-15 用户实测「渲染跑了 332s 却被判失败、报错还是空的」）：
//   产物路径**必须同时写进文件** —— 只靠 stdout 传递不可靠：调用方用 `spawnSync` 时
//   超长输出会触发 maxBuffer 溢出（子进程被 kill、status 非 0）或被截断 ⇒ 拿不到那一行
//   ⇒ **明明渲好了却判失败**。文件是最短最稳的通道。
fs.writeFileSync(path.join(outDir, 'FINAL_MP4.txt'), mp4 + String.fromCharCode(10), 'utf8')
console.log('FINAL_MP4:' + mp4)
