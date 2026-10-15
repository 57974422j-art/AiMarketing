#!/usr/bin/env node
/**
 * ★VF_DAILYVOICE_V2 —— 日报落地页「配音 + 字幕」：
 *   逐段 TTS → 用实测时长回填时间轴 → 写 SRT → 渲染 → 混音 + 烧字幕
 * =============================================================================
 * 为什么**另写一份**而不复用 film-voice.mjs：那个吃 film.json（成片线的数据模型），
 *   而日报线的产物是**已经烤好的 HTML**（文字/图/版式全在里面）⇒ 这里只做一件事：
 *   **把每段时长按配音实测值回填进页面**（画面本身一个字都不改）。
 *   方法论**照搬**它（这正是本项目纪律：同一件事不两处发明，只把已验证的方法论换个对象）：
 *     · audio-first：段时长 = TTS **实测**时长 + 尾巴 gap（不靠字数猜）
 *     · 字幕按**音频区间**写 SRT（不是按估算）
 *     · 音轨每段 apad 补静音到该段时长再 concat ⇒ 音画严格对齐
 *     · 混音 + 烧字幕交给 ffmpeg，缺 libass/libx264 就**降级并如实告知**（绝不假装成功）
 *     · 每一步都校验"产物非 0 字节"（ffmpeg 有"先把输出建出来再报错"的恶习，0 字节曾被当成功传上 OSS）
 *
 * ⚠️ 时间轴有**两处**，必须一起改（只改一处 = 段内动画全错位）：
 *   ① 每个 section 的 data-start / data-duration（引擎按它排片）
 *   ② script 里的 var SECS 数组（页面自己的 __seek 按它找"当前是第几段"）
 *
 * 用法：
 *   node tools/daily-voice.mjs <gen_xxx.html> --voices <voices.json> --outdir <dir>
 *     [--fps 25] [--quality looks] [--gap 0.5] [--voice Cherry] [--no-sub]
 *   voices.json = { "voice": ["第一段口播", "第二段口播", ...] }（与成片线旁白文件同格式）
 *   字幕风格沿用 ★VF_SUBCUE_V1（小字号 + 贴底安全条，避免压住画面文字）：
 *     --sub-size 10   --sub-margin 6   --sub-font "Microsoft YaHei"   --sub-max-chars 13
 * 退出码：0 成功 · 1 失败（stdout 里有 stage=... 说明挂在哪一步） · 2 用法错
 * 成功时 stdout 打一行 FINAL_MP4:<绝对路径>
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')   // html-deck/
const TOOLS = path.join(HERE, 'tools')
const PROJECT = path.resolve(HERE, '..', '..', '..')

const run = (cmd, argv, opts) => spawnSync(cmd, argv, Object.assign({ encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, opts || {}))
const sizeOf = (f) => { try { return fs.statSync(f).size } catch { return -1 } }
const okFile = (f, min) => sizeOf(f) >= (min || 512)
const rmQuiet = (f) => { try { fs.unlinkSync(f) } catch { /* 本来就没有 */ } }
const ffDur = (f) => {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])
  return parseFloat(String(r.stdout || '').trim()) || 0
}
/** 失败即退出（stdout 带 stage=，上层据此判断挂在哪一步 —— 别让调用方猜） */
function fail(msg) { console.log(msg); process.exit(1) }

// ── ffmpeg 能力探测（缺什么在日志里直接写明，别等出事再猜）────────────────────
const CAPS = (() => {
  const r = run('ffmpeg', ['-hide_banner', '-encoders'])
  const t = String(r.stdout || '') + String(r.stderr || '')
  const rf = run('ffmpeg', ['-hide_banner', '-filters'])
  const tf = String(rf.stdout || '')
  return { lame: / libmp3lame /.test(t), x264: / libx264 /.test(t), libass: / subtitles /.test(tf) }
})()
// 没有 libmp3lame 就退 aac（服务端常是精简 ffmpeg；忽略它会让整条音轨全空）
const AUDIO = CAPS.lame ? { enc: 'libmp3lame', ext: '.mp3' } : { enc: 'aac', ext: '.m4a' }
const capsLine = () => '音轨编码=' + AUDIO.enc
  + ' libmp3lame=' + (CAPS.lame ? '有' : '无') + ' libx264=' + (CAPS.x264 ? '有' : '无') + ' libass=' + (CAPS.libass ? '有' : '无')

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const has = (k) => argv.includes('--' + k)
const src = argv[0]
if (!src || src.startsWith('--')) {
  console.log('用法：node tools/daily-voice.mjs <gen_xxx.html> --voices <voices.json> --outdir <dir> [--fps 25] [--quality looks] [--gap 0.5] [--voice Cherry] [--no-sub]')
  process.exit(2)
}
const srcHtml = path.resolve(src)
if (!fs.existsSync(srcHtml)) fail('✗ 文件不存在：' + srcHtml)
const voicesPath = path.resolve(arg('voices', ''))
if (!arg('voices') || !fs.existsSync(voicesPath)) fail('✗ 缺 --voices <voices.json>（{ "voice": ["逐段口播", ...] }）')
const outDir = path.resolve(arg('outdir', path.join(path.dirname(srcHtml), 'voice-out')))
const fps = String(arg('fps', '25'))
const quality = String(arg('quality', 'looks'))
const gap = Number(arg('gap', '0.5'))
const VOICE = String(arg('voice', ''))
const MIN_DUR = 2.2                       // 段时长下限（与 film-voice 同口径）
const SUB_FONT = String(arg('sub-font', 'Microsoft YaHei'))
const SUB_SIZE = String(arg('sub-size', '10'))
const SUB_MARGIN = String(arg('sub-margin', '6'))
const TTS_NODE = path.join(TOOLS, 'tts-node.mjs')

// ── ① 读页面 + 口播，逐段 TTS 拿实测时长 ─────────────────────────────────────
let html = fs.readFileSync(srcHtml, 'utf8')
const secs = html.match(/<section class="sec"[\s\S]*?<\/section>/g) || []
if (!secs.length) fail('stage=html ✗ 这不是日报落地页（没找到 .sec 段）')
let voices = []
try {
  const j = JSON.parse(fs.readFileSync(voicesPath, 'utf8'))
  voices = (Array.isArray(j?.voice) ? j.voice : (Array.isArray(j) ? j : [])).map((x) => String(x == null ? '' : x).trim())
} catch (e) {
  fail('stage=voice ✗ 口播文件读不了：' + String(e && e.message || e).slice(0, 160))
}
if (voices.length !== secs.length) {
  // 时间轴是一格一格排的 ⇒ 数量不一致必然整片错位，**宁可拒绝也不猜**
  fail('stage=voice ✗ 口播 ' + voices.length + ' 段 ≠ 画面 ' + secs.length + ' 段 —— 回配音稿卡重新提交')
}

const build = path.join(outDir, 'build')
const renderDir = path.join(outDir, 'render')
fs.mkdirSync(build, { recursive: true })
fs.mkdirSync(renderDir, { recursive: true })

/** 逐段 TTS（纯 Node 后端 tts-node.mjs；失败换 python 兜底，全失败则该段静音）—— 返回实测秒数 */
const ttsOne = (i, text, out) => {
  const tries = [['node', () => run(process.execPath, [TTS_NODE, '--text', text, '--out', out].concat(VOICE ? ['--voice', VOICE] : []), { cwd: HERE })]]
  for (const [tag, go] of tries) {
    const r = go()
    if (okFile(out, 512)) {
      if (i === 0) console.log('  TTS 后端 = ' + tag + '（tts-node.mjs · 纯 Node）' + (VOICE ? ' 音色=' + VOICE : ''))
      return ffDur(out)
    }
    console.log('  ⚠ 第 ' + (i + 1) + ' 段 ' + tag + ' 后端失败：' + String(r && (r.stderr || r.stdout) || '').replace(/\s+/g, ' ').slice(-140))
  }
  return 0
}

console.log('① 逐段配音（audio-first：段时长将由**实测**时长决定）')
const timed = []
let ttsFail = 0
for (let i = 0; i < secs.length; i++) {
  const text = voices[i]
  const a = path.join(build, 's' + i + AUDIO.ext)
  rmQuiet(a)
  let dur = 0
  if (text) {
    dur = ttsOne(i, text, a)
    if (!dur) { ttsFail++; rmQuiet(a) }
  }
  const d = +Math.max(MIN_DUR, dur ? dur + gap : MIN_DUR).toFixed(2)
  timed.push({ i, text, a: dur ? a : '', audio: dur, dur: d })
}
const withVoice = timed.filter((t) => t.audio).length
if (!withVoice) fail('stage=tts ✗ ' + secs.length + ' 段配音**全部失败**（没有一条音频）—— 见上面的后端报错；拒绝产出无声假片')
if (ttsFail) console.log('  ⚠ ' + ttsFail + ' 段配音失败（已按静音处理，那几段只有画面）')
console.log('   有配音 ' + withVoice + '/' + secs.length + ' 段 · ffmpeg 环境：' + capsLine())

// ── ② 回填时间轴（两处一起改）────────────────────────────────────────────────
let acc = 0
const tl = timed.map((t) => { const o = { start: +acc.toFixed(2), dur: t.dur }; acc += t.dur; return o })
const total = +acc.toFixed(2)
for (const t of timed) {
  const n = t.i + 1
  const re = new RegExp('(<section[^>]*\\bdata-seg="' + n + '"[^>]*\\bdata-start=")[\\d.]+("[^>]*\\bdata-duration=")[\\d.]+(")')
  if (!re.test(html)) fail('stage=html ✗ 段' + n + ' 的 data-start/data-duration 没找到（页面结构变了？）')
  html = html.replace(re, '$1' + tl[t.i].start + '$2' + tl[t.i].dur + '$3')
}
const secsJson = JSON.stringify(tl.map((t) => ({ s: t.start, d: t.dur })))
const beforeSecs = html
html = html.replace(/var SECS = \[[^\]]*\]/, 'var SECS = ' + secsJson)
if (html === beforeSecs) fail('stage=html ✗ 没找到 var SECS 数组（页面时间轴结构变了？—— 只改 section 属性不改它，段内动画会全部错位）')
console.log('② 时间轴已按实测时长回填：' + secs.length + ' 段 · 总长 ' + total + 's（原 ' + gap + 's 尾巴/段）')

// ── ③ 写 SRT（按**音频区间**，不是按估算）────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0')
const srtTime = (t) => {
  const ms = Math.max(0, Math.round(t * 1000))
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), x = ms % 1000
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s) + ',' + String(x).padStart(3, '0')
}
const srtRows = []
timed.forEach((t) => {
  if (!t.text || !t.audio) return
  srtRows.push({ n: srtRows.length + 1, from: tl[t.i].start, to: +(tl[t.i].start + t.audio).toFixed(2), text: t.text })
})
fs.writeFileSync(path.join(build, 'subs.srt'),
  srtRows.map((s) => s.n + String.fromCharCode(10) + srtTime(s.from) + ' --> ' + srtTime(s.to)
    + String.fromCharCode(10) + s.text + String.fromCharCode(10)).join(String.fromCharCode(10)), 'utf8')
console.log('③ 字幕 ' + srtRows.length + ' 条（按音频区间）')

// ── ④ 渲染画面（复用出片工具：打包 → 用字闸门 → 引擎校验 → 渲染）──────────────
const voicedHtml = path.join(outDir, path.basename(srcHtml, path.extname(srcHtml)) + '.voiced.html')
fs.writeFileSync(voicedHtml, html, 'utf8')
console.log('④ 渲染画面（沿用 daily-film.mjs：打包 + 两道闸门 + hyperframes）')
// ★VF_DAILYVOICE_V3（2026-10-15 用户实测「跑了 332s 却判失败、报错还是空的」）—— 我上一版犯了两个错：
//   ① 读的是 **`rr.out`**，而 `spawnSync` 返回的字段叫 **`stdout`** ⇒ 永远 undefined ⇒
//      **无论渲染成没成，正则都不匹配 ⇒ 一律判失败**（用户那次极可能已经渲好了，白等 332s）；
//   ② 把渲染输出**往内存里收**（maxBuffer）—— 渲染日志很长，溢出会 kill 子进程、status 变非 0，
//      于是"渲染其实成功"也会被当成失败。
//   现口径：① 输出**直接重定向到文件**（内存零占用，日志留档好排查）；
//          ② 产物路径**从文件读**（`daily-film.mjs` 会写 `FINAL_MP4.txt`），拿不到才回退到日志正则；
//          ③ 失败时把**渲染日志的尾部**带出来 —— 真正的原因（Chrome/内存/字体）都打在那里。
const renderLog = path.join(outDir, 'render.log')
const renderArgs = [path.join(TOOLS, 'daily-film.mjs'), voicedHtml, '--outdir', renderDir, '--fps', fps, '--quality', quality]
const logFd = fs.openSync(renderLog, 'w')
const rr = spawnSync(process.execPath, renderArgs, { stdio: ['ignore', logFd, logFd], timeout: 60 * 60 * 1000 })
try { fs.closeSync(logFd) } catch { /* ignore */ }
let mp4p = ''
try { mp4p = String(fs.readFileSync(path.join(renderDir, 'FINAL_MP4.txt'), 'utf8')).trim().split(String.fromCharCode(10))[0].trim() } catch { /* 回退到日志 */ }
if (!mp4p) {
  try { mp4p = (String(fs.readFileSync(renderLog, 'utf8')).match(/FINAL_MP4:(.+)/) || [])[1] || '' } catch { /* ignore */ }
}
mp4p = String(mp4p || '').trim()
if (rr.status !== 0 || !mp4p || !fs.existsSync(mp4p)) {
  let tailTxt = ''
  try {
    const L = String(fs.readFileSync(renderLog, 'utf8')).split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean)
    const at = L.findIndex((l) => /stage=/.test(l))
    tailTxt = (at >= 0 ? L.slice(at, at + 6).join(' ⏎ ') : L.slice(-4).join(' ⏎ ')).slice(0, 400)
  } catch { /* ignore */ }
  fail('stage=render ✗ exit=' + rr.status + ' ' + (tailTxt || ('（渲染日志为空，见 ' + path.relative(PROJECT, renderLog) + '）')))
}
const mp4 = mp4p
if (!fs.existsSync(mp4) || !okFile(mp4, 20 * 1024)) fail('stage=render ✗ 引擎报了成品但文件不在或为空：' + mp4)

// ── ⑤ 音轨：每段补静音到该段时长再拼（与画面严格对齐）────────────────────────
console.log('⑤ 音轨对齐（每段补静音到段时长）+ 混音' + (CAPS.libass && !has('no-sub') ? ' + 烧字幕' : ''))
const listFile = path.join(build, 'concat.txt')
const listLines = []
const badAudio = []
timed.forEach((t) => {
  const p = path.join(build, 'p' + t.i + AUDIO.ext)
  rmQuiet(p)
  const a = t.a
    ? ['-y', '-v', 'error', '-i', t.a, '-af', 'apad', '-t', String(t.dur), '-c:a', AUDIO.enc, '-ar', '44100', '-ac', '2', p]
    : ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(t.dur), '-c:a', AUDIO.enc, p]
  const r2 = run('ffmpeg', a)
  if (r2.status !== 0 || !okFile(p, 512)) {
    badAudio.push('段' + (t.i + 1) + '（' + (r2.status === 0 ? '空文件' : 'exit=' + r2.status) + '）')
    rmQuiet(p)
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-t', String(t.dur), '-c:a', AUDIO.enc, p])   // 兜底：宁可这一段静音，也不要整条音轨作废
  }
  listLines.push("file '" + p.replace(/\\/g, '/') + "'")
})
fs.writeFileSync(listFile, listLines.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8')
const voiceTrack = path.join(build, 'voice' + AUDIO.ext)
rmQuiet(voiceTrack)
const cr = run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', voiceTrack])
if (cr.status !== 0 || !okFile(voiceTrack, 4096)) {
  fail('stage=audio ✗ 音轨合成失败' + (badAudio.length ? '（异常段 ' + badAudio.slice(0, 4).join(', ') + '）' : '')
    + '：' + String(cr.stderr || cr.stdout || '').replace(/\s+/g, ' ').slice(-260) + ' ｜ ffmpeg 环境：' + capsLine())
}
if (badAudio.length) console.log('   ⚠ ' + badAudio.length + ' 段音轨异常（已按静音补齐）：' + badAudio.slice(0, 4).join(', '))

// 混音 + 烧字幕：字幕用**相对名 + cwd=renderDir**（这样绕开 Windows 的盘符转义坑）
fs.copyFileSync(path.join(build, 'subs.srt'), path.join(renderDir, 'subs.srt'))
const finalMp4 = path.join(outDir, path.basename(srcHtml, path.extname(srcHtml)) + '-voiced.mp4')
const base = ['-y', '-v', 'error', '-i', path.basename(mp4), '-i', voiceTrack]
const venc = CAPS.x264
  ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p']   // 只有重编码才能烧字幕
  : ['-c:v', 'copy']
let vvf = null
if (!has('no-sub') && CAPS.libass) {
  vvf = "subtitles=subs.srt:force_style='FontName=" + SUB_FONT + ",FontSize=" + SUB_SIZE
    + ",PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=" + SUB_MARGIN + "'"
}
// ★faststart 必须加：不加的话 moov 被推到文件尾 ⇒ 网页 video 要下完整个文件才能播（实测踩过）
const AMIX = ['-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', finalMp4]
const tries = []
if (vvf) tries.push({ tag: '混音 + 烧字幕', vf: vvf, enc: venc })
if (CAPS.x264) tries.push({ tag: '混音（不烧字幕）', vf: null, enc: venc })
tries.push({ tag: '只换音轨（不重编码）', vf: null, enc: ['-c:v', 'copy'] })
let used = null
let lastErr = ''
for (const t of tries) {
  rmQuiet(finalMp4)   // 关键：每次先把上一次的 0 字节残骸删掉（否则 existsSync 会骗人）
  const fr = run('ffmpeg', base.concat(t.vf ? ['-vf', t.vf] : []).concat(t.enc, AMIX), { cwd: renderDir })
  const szNow = sizeOf(finalMp4)
  if (fr.status === 0 && szNow >= 20 * 1024 && ffDur(finalMp4) > 0.5) { used = t; break }
  lastErr = String(fr.stderr || fr.stdout || '').replace(/\s+/g, ' ').slice(-300)
  console.log('    ⚠ ' + t.tag + ' 失败（' + (fr.status !== 0 ? 'exit=' + fr.status : (szNow < 20 * 1024 ? '产物为空 ' + szNow + 'B' : '时长读不出')) + '）'
    + (lastErr ? '：' + lastErr.slice(-160) : ''))
}
if (!used) {
  rmQuiet(finalMp4)
  fail('stage=mix ✗ 混音全部降级尝试都失败（末次原因）：' + lastErr + ' ｜ ffmpeg 环境：' + capsLine())
}
console.log('   ✓ 成片（含配音' + (used.vf ? ' + 烧字幕' : '，字幕为旁挂 SRT') + '）：'
  + path.relative(PROJECT, finalMp4).replace(/\\/g, '/') + '  ' + Math.round(sizeOf(finalMp4) / 1024) + ' KB  ' + total + 's')
if (!used.vf) {
  console.log('    ⚠ 这次**没烧字幕**（' + (CAPS.libass && !has('no-sub') ? '已降级，见上面失败行' : '本机 ffmpeg 没有 libass 的 subtitles 滤镜')
    + '），字幕留在：' + path.relative(PROJECT, path.join(build, 'subs.srt')).replace(/\\/g, '/') + '（可外挂）')
}
console.log('FINAL_MP4:' + finalMp4)
