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
//   日报单文件版的图是 **base64 内嵌**（一份 7MB 的页面 × N 个 worker）⇒ 实测 4 worker 会
//   直接把渲染进程打崩（native crash，stderr 只剩一个 Windows 异常地址）。默认压到 2，可用 --workers 调。
const workers = String(opt('workers', '2'))
const skipCheck = argv.includes('--skip-check')

// ── ① 读输入 + 体检 ────────────────────────────────────────────────────────────
let html = fs.readFileSync(abs, 'utf8')
// ⚠️ 用**前缀**匹配 `class="sec` —— 打包过一次的副本里是 `class="sec clip"`，
//    写死 `class="sec"` 会把合法输入误判成"不是日报页"（2026-10-14 自测时就这么误报的）。
if (!/<section class="sec/.test(html)) { console.log('stage=html ✗ 这不是日报落地页（没找到 .sec 段）'); process.exit(1) }
// 出片只吃**单文件版**（图 base64 内嵌）：配图版的图在同级目录，打包时还要搬图/改引用，
// 而服务端本来就能出单文件版 ⇒ 不支持它，**明确报出来**（不静默截断成"图片全丢"）。
const extRefs = html.match(/src="(?!data:)([^"]+\.(?:jpg|jpeg|png|webp))"/gi) || []
if (extRefs.length) {
  console.log('stage=media ✗ 这份是**配图版**（引用外部图 ' + extRefs.length + ' 处，例：' + extRefs[0].slice(0, 50) + '…）')
  console.log('  出片需要**单文件版**（图 base64 内嵌）—— 请先出单文件版再出片。**没有出片**。')
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
const r = run(process.execPath, [HF, 'render', outDir, '-o', mp4, '-f', fps, '-q', quality, '-w', workers], { timeout: 60 * 60 * 1000 })
if (r.status !== 0 || !fs.existsSync(mp4)) {
  // 崩溃时 stderr 可能只有一个 Windows 异常地址 ⇒ 把 stdout 的**尾部**也带出来，别让调用方只看到一串十六进制
  const tail = String(r.stdout || '').split('\n').filter((l) => l.trim()).slice(-6).join(' | ')
  console.log('stage=render ✗ exit=' + r.status + ' ' + String(r.stderr || '').slice(-200))
  if (tail) console.log('   stdout 尾部：' + tail.slice(0, 500))
  process.exit(1)
}
const size = (fs.statSync(mp4).size / 1024 / 1024).toFixed(1)
console.log('④ 渲染 OK：' + size + ' MB · ' + total + 's · ' + ((Date.now() - t0) / 1000).toFixed(0) + 's（' + quality + ' 档）')
console.log('FINAL_MP4:' + mp4)
