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
/* ★VF_DAILY_BGM_V1（2026-10-23 用户「把 HTML 成片线的音乐抄过来」）：
   背景音乐是**可选**的：`--bgm <本地音频路径>` + `--bgm-vol <-18>`（dB，负数是压低）。
   不给 `--bgm` ⇒ **完全走原来的混音路径**（一行都不变）⇒ 零回归风险。
   给了 BGM ⇒ 走 filter_complex 把「配音 + BGM」先混好，再（可选）叠字幕一起编码。
   为什么用 `-stream_loop -1`：BGM 通常比片子短，不循环就会中途静音。 */
const BGM_PATH = String(arg('bgm', '') || '').trim()
const BGM_VOL = Number(arg('bgm-vol', '-18')) || -18
const useBgm = !!BGM_PATH && fs.existsSync(BGM_PATH)
if (BGM_PATH && !useBgm) console.log('  ⚠ BGM 文件不存在，已忽略：' + BGM_PATH)
if (useBgm) console.log('  混入背景音乐：' + path.basename(BGM_PATH) + '（音量 ' + BGM_VOL + ' dB）')
const MIN_DUR = 2.2                       // 段时长下限（与 film-voice 同口径）
const SUB_FONT = String(arg('sub-font', 'Microsoft YaHei'))
const SUB_SIZE = String(arg('sub-size', '10'))
/* ★VF_SUBPOS_V1（2026-10-23 用户实测「竖屏字幕贴底会被抖音 UI 挡住，很多账号把字幕放在画面 1/4 处」）：
   病灶：原来 `MarginV` 默认 **6**（libass 单位，相对 PlayResY=288）⇒ 换算成像素只有 ~27px ⇒ **几乎贴底**，
        在抖音里会被「@用户名 / 文案 / 音乐名 / 进度条」整块盖住。
   现口径：用**语义化参数** `--sub-pos` 指定"字幕距底部多少"，工具内部换算成 libass 单位：
     · `bottom` = 40px   （纯播放器场景，如视频号导出）
     · `lower`  = 320px  （**默认**，抖音/快手：正好落在平台 UI 上方）
     · `mid`    = 560px  （纯文字片 / 无 UI 遮挡）
   换算：libass 的 MarginV 单位 = 像素 / (视频高 1280 / PlayResY 288) = 像素 / 4.444
   仍支持 `--sub-margin` 直接给原始 libass 单位（给了就以它为准，兼容老调用）。 */
const SUB_POS = String(arg('sub-pos', 'lower'))
/* ★VF_ASPECT_STEP1_V1：字幕换算原来写死"视频高 1280" ⇒ 横屏（720）时换算错 1.8 倍、字幕跑到画面中间。
   现口径：按 `--h`（不传 = 1280，行为完全不变）换算。
   另外横屏时"距底 320px"太高（720 高的片子里那已经接近中间）⇒ 横屏按比例的 0.18 折算。 */
const VID_H = Math.max(240, Number(arg('h', '1280')) || 1280)
const _posPxBase = { bottom: 40, lower: 320, mid: 560 }[SUB_POS] ?? 320
const POS_PX = VID_H >= 1000 ? _posPxBase : Math.round(VID_H * (_posPxBase / 1280) * 1.6)
const SUB_MARGIN_RAW = arg('sub-margin', '')
const SUB_MARGIN = SUB_MARGIN_RAW
  ? String(SUB_MARGIN_RAW)
  : String(Math.round(POS_PX / (VID_H / 288)))
/* 旧的 `--sub-margin` 默认值 6（≈27px，贴底）已被上面的 `--sub-pos` 取代，见 SUB_POS 注释 */
const TTS_NODE = path.join(TOOLS, 'tts-node.mjs')

// ── ① 读页面 + 口播，逐段 TTS 拿实测时长 ─────────────────────────────────────
let html = fs.readFileSync(srcHtml, 'utf8')
/* ★VF_DAIDESIGN_V1c（2026-10-17 用户实测「stage=html ✗ 段1 的 data-start/data-duration 没找到」）：
   **AI 自由档的页面没有 `data-seg`**（那是模板页 `daily-page.mjs` 才写的），而且属性顺序也不同
   （AI 常写 `<section id="s1" class="sec" data-start=…>`）⇒ 下面 ② 里"按 `data-seg` 定位"必然找不到。
   这里把段匹配放宽（class 不必紧跟 section），并把 ② 的回填改成"**按 section 出现顺序**"。 */
const secs = html.match(/<section\b[^>]*\bclass="[^"]*\bsec\b[^"]*"[\s\S]*?<\/section>/g) || []
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
/* ★VF_TTS_RETRY_V1（2026-10-19 **实测实锤**：用户那条 60.7s 的片子里
   28.13~31.03s / 38.71~41.63s 各有 **约 2.9 秒静音**（正好 = MIN_DUR 2.2 + gap）
   ⇒ 段 8、段 11 的 TTS **单次失败就被静音兜底**，而这里原来 **只试 1 次、不重试**。
   现口径：**每段最多试 3 次**（间隔 400ms）——TTS 失败绝大多数是偶发（网络/限流），再试一次基本就过。
   仍失败则返回 0（该段静音），由下面的 `ttsFail` 汇总**明确报出来**（不再只是悄悄降级）。 */
const ttsOne = (i, text, out) => {
  const tag = 'node'
  let lastErr = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    rmQuiet(out)
    const r = run(process.execPath, [TTS_NODE, '--text', text, '--out', out].concat(VOICE ? ['--voice', VOICE] : []), { cwd: HERE })
    if (okFile(out, 512)) {
      if (i === 0) console.log('  TTS 后端 = ' + tag + '（tts-node.mjs · 纯 Node）' + (VOICE ? ' 音色=' + VOICE : ''))
      if (attempt > 1) console.log('  ✓ 第 ' + (i + 1) + ' 段第 ' + attempt + ' 次重试成功')
      return ffDur(out)
    }
    lastErr = String(r && (r.stderr || r.stdout) || '').replace(/\s+/g, ' ').slice(-140)
    if (attempt < 3) {
      console.log('  ⚠ 第 ' + (i + 1) + ' 段 ' + tag + ' 第 ' + attempt + ' 次失败（' + (400 * attempt) + 'ms 后重试）：' + lastErr)
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400 * attempt) } catch { /* ignore */ }
    } else {
      console.log('  ✗ 第 ' + (i + 1) + ' 段 ' + tag + ' **3 次都失败**（该段将静音）：' + lastErr)
    }
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
/* ★VF_TTS_RETRY_V1（2026-10-19 用户实测「有 2 段 TTS 和文案被删除」→ **音轨实测 28.1~31.0s / 38.7~41.6s 各 2.9 秒静音**）：
   原来这里**只打一行日志就继续出片** ⇒ 用户拿到一条"两段哑掉"的片子，事后才发现。
   现口径：**有任何一段配音失败 ⇒ 直接拦下、不出片**，并把失败段号列清楚。
   为什么必须拦：无声段对用户是**废片**（60 秒里哑 6 秒），重出一遍的成本远低于事后返工。
   （配合每段 3 次重试 —— 偶发失败基本会被救回来，只有真的持续失败才走到这里。） */
if (ttsFail) {
  const bad = timed.filter((t) => !t.audio).map((t) => t.i + 1).join('、')
  fail('stage=tts ✗ ' + ttsFail + '/' + secs.length + ' 段配音失败（第 ' + bad + ' 段）—— 已自动重试 3 次仍失败，'
    + '拒绝产出"部分无声"的片子。请重试一次；若持续失败，看上面的后端报错。')
}
console.log('   有配音 ' + withVoice + '/' + secs.length + ' 段 · ffmpeg 环境：' + capsLine())

// ── ② 回填时间轴（两处一起改）────────────────────────────────────────────────
let acc = 0
/* ★VF_TAIL_HOLD_V1（2026-10-26 用户「最后一个字没说出来 视频结束了」「结尾稍微给它预留1秒吧 忽然就没了好奇怪」）：
   病因有两层：① 每段 dur = 语音时长 + gap，最后一段没有额外余量 ⇒ 话音刚落就切；
            ② 合成时的 `-shortest` 会**按较短的流截断**（AAC 逐段对齐累积少约 0.2s）⇒ 连那点 gap 也被吃掉。
   现口径：**最后一段额外 +1 秒**（画面停在最终状态、音频补静音），并把 `-shortest` 换成显式 `-t total`。 */
/* ★VF_TAIL_HOLD_V1b：**整片末尾**留 1 秒（而不是只加在最后一段的 data-duration 上）——
   因为画面定格由打包侧统一处理（root duration = total + 1），这里只要把**音频**补到同样长度即可。 */
const TAIL_HOLD = 1.0
const tl = timed.map((t) => { const o = { start: +acc.toFixed(2), dur: t.dur }; acc += t.dur; return o })
const total = +acc.toFixed(2)
/* ★VF_DAIDESIGN_V1c：**不靠 `data-seg`**，按"第几个 .sec 段"回填 —— AI 页没有 `data-seg`，
   而且属性顺序任意（`<section id="s1" class="sec" data-start=…>`）⇒ 老写法必挂（用户实测就是这条）。
   缺属性就补上，绝不因"属性顺序不同"失败。 */
let secIdx = 0
html = html.replace(/<section\b[^>]*>/g, (tag) => {
  if (!/\bclass="[^"]*\bsec\b/.test(tag)) return tag           // 不是段标签 ⇒ 不动
  const i = secIdx++
  if (i >= tl.length) return tag                               // 口播只覆盖前 N 段 ⇒ 后面的段保持原时长
  let t = tag
  t = /\bdata-start="-?[\d.]+"/.test(t)
    ? t.replace(/\bdata-start="-?[\d.]+"/, 'data-start="' + tl[i].start + '"')
    : t.replace(/<section\b/, '<section data-start="' + tl[i].start + '"')
  t = /\bdata-duration="[\d.]+"/.test(t)
    ? t.replace(/\bdata-duration="[\d.]+"/, 'data-duration="' + tl[i].dur + '"')
    : t.replace(/<section\b/, '<section data-duration="' + tl[i].dur + '"')
  return t
})
if (!secIdx) fail('stage=html ✗ 段1 的 data-start/data-duration 没找到（页面结构变了？）')
const secsJson = JSON.stringify(tl.map((t) => ({ s: t.start, d: t.dur })))
const beforeSecs = html
html = html.replace(/var SECS = \[[^\]]*\]/, 'var SECS = ' + secsJson)
if (html === beforeSecs) {
  /* ★VF_DAIDESIGN_V1c：**AI 自由档没有 `var SECS`** —— 它的 `__seek` 直接遍历 `.sec` 读
     `data-start`/`data-duration` ⇒ 属性回填完就对了。所以不再一律 fail：
     只有"确实是模板页（含 `data-seg`）却找不到 SECS"才判结构异常。 */
  if (/\bdata-seg=/.test(html)) fail('stage=html ✗ 没找到 var SECS 数组（页面时间轴结构变了？—— 只改 section 属性不改它，段内动画会全部错位）')
  console.log('   （这份页面没有 var SECS —— 由 .sec 的 data-start/data-duration 驱动，跳过）')
}
console.log('② 时间轴已按实测时长回填：' + secs.length + ' 段 · 总长 ' + total + 's（原 ' + gap + 's 尾巴/段）')

// ── ③ 写 SRT（按**音频区间**，不是按估算）────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0')
const srtTime = (t) => {
  const ms = Math.max(0, Math.round(t * 1000))
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), x = ms % 1000
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s) + ',' + String(x).padStart(3, '0')
}
/* ★VF_SUB_WRAP_V1（2026-10-27 用户「字幕支持双排，就是怕它写长了」）：
   背景：口播字数**放开了**（通顺优先，不再硬卡 22 字）⇒ 长句会变多 ⇒ 字幕必须能优雅换行。
   病灶：原来整句原样塞进 SRT，交给 libass **按宽度硬折** ⇒ 会把词劈开
        （「铜锅里的清汤一滚，老北」/「京味道就出来了」）。
   现口径：**写 SRT 时先按标点断行**（逗号、顿号、分号、句号、问叹优先），断不了才按字数硬切；
          每排约 **14 字**（按 FontSize=10 ⇒ 实际 44px、可用宽 645px 算出来的）；
          **最多 3 排**（字幕在距底 320px，3 排约 200px 高，不会压到画面主体）。
   ⚠️ 只影响"字幕怎么排"，不动 TTS、不动时长、不动画面。 */
const NL = String.fromCharCode(10)
const SUB_MAX_CHARS = 16   // 每排字数上限（≈ 645px / 44px，中文标点占半角，实际能到 15~16）
const SUB_MAX_LINES = 3    // 最多几排
const BREAK_CHARS = '，、；：:'
/**
 * 字幕断行：**先按标点切块，再贪心合并到每排 ≤16 字**。
 * 实测对比（见 temp/_daily/test-wrap.mjs）：
 *   · "吃到后半场，" + "来一杯酸奶把嘴里的油润收住。"（6+15）⇒ **两排，断在逗号**✅
 *   · "锅一开白汽升起来，" + "几个人边涮肉边聊天，" + "谁都不愿意先放下筷子。"（9+10+11）⇒ **三排，每排都断在逗号**✅
 * 为什么不用"按均分硬切"：均分会把"酸奶"劈成"酸 / 奶"（实测过，很难看）。
 * 只有**整块本身超过 16 字**（没有标点）时才按字数硬切。
 */
function wrapSubtitle(text) {
  const s = String(text || '').trim()
  if (!s) return s
  if (s.length <= SUB_MAX_CHARS) return s
  // ① 按标点切块（标点留在块尾；句末的 。！？ 已在最后，不单独切）
  const parts = []
  let cur = ''
  for (const ch of s) {
    cur += ch
    if (BREAK_CHARS.indexOf(ch) >= 0) { parts.push(cur); cur = '' }
  }
  if (cur) parts.push(cur)
  // ② 贪心合并
  const lines = []
  let line = ''
  for (const p of parts) {
    if ((line + p).length <= SUB_MAX_CHARS) { line += p; continue }
    if (line) { lines.push(line); line = '' }
    let rest = p
    while (rest.length > SUB_MAX_CHARS) { lines.push(rest.slice(0, SUB_MAX_CHARS)); rest = rest.slice(SUB_MAX_CHARS) }
    line = rest
  }
  if (line) lines.push(line)
  // ③ 超过 3 排：把尾巴并到最后一行（libass 会再折，总比 5 排好看）
  if (lines.length > SUB_MAX_LINES) {
    const head = lines.slice(0, SUB_MAX_LINES - 1)
    head.push(lines.slice(SUB_MAX_LINES - 1).join(''))
    return head.join(NL)
  }
  // ④ 末排只剩 1~3 字（"孤字"）时，从上一排挪几个字下来，避免一行只有两个字
  if (lines.length > 1 && lines[lines.length - 1].length < 4) {
    const last = lines.pop()
    const prev = lines.pop()
    const move = Math.min(3, prev.length - 4)
    if (move > 0) {
      lines.push(prev.slice(0, prev.length - move))
      lines.push(prev.slice(prev.length - move) + last)
    } else {
      lines.push(prev)
      lines.push(last)
    }
  }
  return lines.join(NL)
}

const srtRows = []
let wrappedN = 0
timed.forEach((t) => {
  if (!t.text || !t.audio) return
  const wrapped = wrapSubtitle(t.text)
  if (wrapped.indexOf(NL) >= 0) wrappedN++
  srtRows.push({ n: srtRows.length + 1, from: tl[t.i].start, to: +(tl[t.i].start + t.audio).toFixed(2), text: wrapped })
})
if (wrappedN) console.log('   字幕换行：' + wrappedN + '/' + srtRows.length + ' 条折成多排（按标点断，每排约 ' + SUB_MAX_CHARS + ' 字）')
fs.writeFileSync(path.join(build, 'subs.srt'),
  srtRows.map((s) => s.n + String.fromCharCode(10) + srtTime(s.from) + ' --> ' + srtTime(s.to)
    + String.fromCharCode(10) + s.text + String.fromCharCode(10)).join(String.fromCharCode(10)), 'utf8')
console.log('③ 字幕 ' + srtRows.length + ' 条（按音频区间）')

// ── ④ 渲染画面（复用出片工具：打包 → 用字闸门 → 引擎校验 → 渲染）──────────────
const voicedHtml = path.join(outDir, path.basename(srcHtml, path.extname(srcHtml)) + '.voiced.html')
/* ★VF_DAILYVOICE_V7（2026-10-16 实测补的缺口）：**配图版**页面（图是 `images/xxx.jpg` 外链）也要能走配音链路 ——
   把**源 HTML 同级的 `images/`** 拷到 outDir（voiced.html 的旁边），否则内层 `daily-film.mjs` 的 V39 搬图逻辑
   只在 voiced.html 同级找 `images/` ⇒ 直接报
   `stage=media ✗ 页面引用了 images/ 里的图，但源目录里没有 images/`（本地用配图版跑配音链路时实测撞到）。
   ⚠️ 单文件版（图已内嵌 base64）没有 images/ 目录 ⇒ 这里直接跳过，**生产主路径零影响**。 */
const srcImages = path.join(path.dirname(srcHtml), 'images')
if (fs.existsSync(srcImages)) {
  const dstImages = path.join(outDir, 'images')
  fs.mkdirSync(dstImages, { recursive: true })
  let movedImg = 0
  for (const f of fs.readdirSync(srcImages)) {
    const a = path.join(srcImages, f)
    if (fs.statSync(a).isFile()) { fs.copyFileSync(a, path.join(dstImages, f)); movedImg++ }
  }
  console.log('   （配图版：源 images/ 的 ' + movedImg + ' 张图已拷到 ' + dstImages + '）')
}
fs.mkdirSync(outDir, { recursive: true })
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
/* ★VF_ASPECT_STEP1_V1b（2026-10-25 实测：用户选了横屏、草稿 aspect="16:9" 也对，
   但成片 ffprobe 出来是 **720×1280 竖屏**，画面内容横着排在上半部、下面一大块黑）。
   根因：成片带配音 ⇒ 走本脚本 ⇒ 本脚本再调 `daily-film.mjs` 渲染，但**没有把 `--w/--h` 传下去**
        ⇒ 内层用默认 720×1280 ⇒ 输出永远是竖屏。
   现口径：本脚本收到 `--w`/`--h` 就**原样透传**；没收到就不加（内层走默认，老行为不变）。 */
const _wArg = arg('w', '')
const _hArg = arg('h', '')
const renderArgs = [path.join(TOOLS, 'daily-film.mjs'), voicedHtml, '--outdir', renderDir, '--fps', fps, '--quality', quality]
if (_wArg && _hArg) renderArgs.push('--w', String(_wArg), '--h', String(_hArg))
console.log('  画面尺寸：' + (_wArg && _hArg ? _wArg + '×' + _hArg + '（透传给渲染器）' : '720×1280（默认）'))
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
if (useBgm) base.push('-stream_loop', '-1', '-i', path.resolve(BGM_PATH))

/* ★VF_DAILY_BGM_V1：给了 BGM 时，用 filter_complex **一次**完成「配音+BGM 混音 +（可选）烧字幕」。
   为什么不分开做：`-vf` 与 `-filter_complex` 不能同时用，硬拆会多一次重编码（画质白降一档）。
   ⚠️ 只在 useBgm 为真时走这里 ⇒ 不选 BGM 的路径**完全不经过这段**。 */
function bgmFilter(vf) {
  const gain = Math.pow(10, BGM_VOL / 20).toFixed(3)   // dB → 线性
  const fc = []
  fc.push('[1:a]volume=1.0[a1]')
  fc.push('[2:a]volume=' + gain + '[a2]')
  fc.push('[a1][a2]amix=inputs=2:duration=first:dropout_transition=0[aout]')
  const maps = ['-map', '[aout]']
  if (vf) {
    fc.push('[0:v]' + vf + '[vout]')
    maps.unshift('-map', '[vout]')
  } else {
    maps.unshift('-map', '0:v:0')
  }
  return { fc: fc.join(';'), maps }
}
// ★VF_DAILY_V33（2026-10-16 用户定案「剩下2条先做」→ 第 ⑪ 条「码率偏低」）：
//   实测带配音的成片码率 **0.81 Mbps**（无配音那版 3.39）—— 差在"要烧字幕就必须重编码"，
//   而 CRF 20 对"画面变化小 + 有大片纯色区域"的片子压得太狠。CRF **18 是视觉无损档**，
//   代价只是文件大一些（本项目竖屏 720×1280 的片，增长通常几十个百分点，可接受）。
const venc = CAPS.x264
  ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p']   // 只有重编码才能烧字幕
  : ['-c:v', 'copy']
let vvf = null
if (!has('no-sub') && CAPS.libass) {
  vvf = "subtitles=subs.srt:force_style='FontName=" + SUB_FONT + ",FontSize=" + SUB_SIZE
    + ",PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=" + SUB_MARGIN + "'"
}
// ★faststart 必须加：不加的话 moov 被推到文件尾 ⇒ 网页 video 要下完整个文件才能播（实测踩过）
/* ★VF_TAIL_HOLD_V1：`-shortest` 改成 `-t total` —— 原来按**较短的流**截断（配音轨因 AAC 逐段对齐
   会比画面短 0.1~0.3s）⇒ 最后一句话的尾音被切掉。现在**以画面总长为唯一标准**。 */
/* ★VF_TAIL_HOLD_V1b：`apad` 把音频补静音 + `-t` 按「总长 +1 秒」截断。
   原来用 `-shortest` ⇒ 按**较短的流**截断（配音轨比画面短 0.1~0.3s）⇒ 最后一句尾音被切。 */
const AMIX = ['-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-t', String(+(total + TAIL_HOLD).toFixed(2)), '-movflags', '+faststart', finalMp4]
const tries = []
if (vvf) tries.push({ tag: '混音 + 烧字幕', vf: vvf, enc: venc })
if (CAPS.x264) tries.push({ tag: '混音（不烧字幕）', vf: null, enc: venc })
tries.push({ tag: '只换音轨（不重编码）', vf: null, enc: ['-c:v', 'copy'] })
let used = null
let lastErr = ''
for (const t of tries) {
  rmQuiet(finalMp4)   // 关键：每次先把上一次的 0 字节残骸删掉（否则 existsSync 会骗人）
  /* ★VF_DAILY_BGM_V1：有 BGM ⇒ 必须用 filter_complex（一次完成混音 + 字幕）；
     没有 BGM ⇒ 走原来那条 `-vf` 路径（一字不改，零回归）。 */
  const ffArgs = useBgm
    ? base.concat(
      (() => { const g = bgmFilter(t.vf); return ['-filter_complex', g.fc].concat(g.maps) })(),
      t.enc, AMIX,
    )
    : base.concat(t.vf ? ['-vf', t.vf] : []).concat(t.enc, AMIX)
  const fr = run('ffmpeg', ffArgs, { cwd: renderDir })
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
