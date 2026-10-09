#!/usr/bin/env node
/**
 * ★VF_FILMVOICE_V1（2026-10-09 用户实测：「本次制作还是没有字幕 TTS，只有图片」）
 * =============================================================================
 * 给 film 线（HTML 逐帧短片）补上**配音 + 字幕**，并且把"镜头时长"从**估算**改成**实测**。
 *
 * 为什么（用户原话就是这个方法论）：
 *   「是让他们先确认文案长度再做 TTS，TTS 再分析视频长度安排分镜吗？如果这是最佳方法就开始做。」
 *   ⇒ 是的，这就是**audio-first（音画对位）**，也是本项目里 tts.py 文件头写的"唯一真相源"：
 *      **镜头时长由配音真实时长决定，不靠字数猜。**
 *   对比：
 *     · 估算法（老口径）：文案 ÷ 4.5 字/秒 → 一定有几帧~几秒偏差（人念得快/慢就不同步）；
 *     · 本工具：先 TTS 拿**真实 mp3 时长** → 镜头 dur = 音频 + 尾巴 gap → 字幕直接按音频区间写 SRT。
 *
 * 流水线（五步，代码里就叫 ①~⑤）：
 *   ① 逐镜 TTS（调 scripts/video-factory/tts.py，凭据走项目 .env.local）
 *   ② 用**实测时长**回填每镜 dur（并保留原估算值 `_oldDur` 便于对比）
 *   ③ 写 `film.voiced.json` + `build/subs.srt`（字幕按音频区间）
 *   ④ 渲染（tools/render-film.mjs，画面用新时长）
 *   ⑤ 混音 + 烧字幕（ffmpeg；没有 libass 就退化成"只混音 + 留 SRT 旁挂文件"，并如实告知）
 *
 * 用法：
 *   node tools/film-voice.mjs films/xxx.json [--outdir <目录>] [--gap 0.5] [--voice-json <旁白.json>] [--no-sub]
 *   字幕风格（★VF_SUBCUE_V1，用户实测定过"字幕太大压住画面文字"）：
 *     --sub-size 10        字号（libass 以 PlayResY=288 换算 ⇒ 10 约等于画面高 3.4%）
 *     --sub-margin 6       距底边（同单位 ⇒ 6 约 27px，落在画面文字下方的"安全条"里）
 *     --sub-font "Microsoft YaHei"   字体（系统字体，不受内嵌字体子集限制）
 *     --sub-max-chars 13   单条字幕**最多几个字**（超了就按标点切成多条、按字数分配时间）
 *   旁白文件（可选）：与 film 同名 + `.voice.json`，形如 { "voice": ["第1镜口播", "第2镜口播", ...] }
 *      —— 没有它就退回读 `scene.voice`；两者都没有的那一镜 = 静音镜（只留画面，不塞假配音）。
 * ⚠️ 架构纪律同 pack-to-page：**顶层不读 argv 以外的外部状态**、不改任何老链路；只新增文件。
 * ⚠️ 网络：本工具会**真的调 TTS**（花一点点钱）。不跑 TTS 时不要用它。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')          // html-deck/
const PROJECT = path.resolve(HERE, '..', '..', '..')                                    // 项目根
const TTS = path.join(PROJECT, 'scripts', 'video-factory', 'tts.py')

const args = process.argv.slice(2)
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const has = (k) => args.includes('--' + k)
const filmPath = args.find((a) => !a.startsWith('--'))
if (!filmPath) {
  console.error('用法: node tools/film-voice.mjs <film.json> [--outdir <目录>] [--gap 0.5] [--voice-json <旁白.json>] [--no-sub]')
  console.error('      字幕可调: --sub-size 10 --sub-margin 6 --sub-font "Microsoft YaHei" --sub-max-chars 13')
  process.exit(2)
}
/** ★VF_SUBCUE_V1（2026-10-09 用户实测「字幕居然怎么大压在上面，视频压了字」）：
 *  为什么必须切短句：film 线的画面**自己就带文案**（title/sub/chips/foot），
 *  口播字幕一旦整句烧上去 ⇒ 要么换行、要么横穿画面 ⇒ 直接压住画面里的字。
 *  口径：**单行、短句**（默认 ≤13 字），按标点切、按字数分配时间；没标点的长句再硬切。 */
const splitCues = (text, maxLen) => {
  const hard = (s) => { const o = []; for (let i = 0; i < s.length; i += maxLen) o.push(s.slice(i, i + maxLen)); return o }
  const parts = String(text).split(/(?<=[，。、；！？：,.;!?])/).map((s) => s.trim()).filter(Boolean).flatMap(hard)
  const cues = []
  let buf = ''
  for (const p of parts) {
    if (buf && (buf + p).length > maxLen) { cues.push(buf); buf = p } else buf += p
  }
  if (buf) cues.push(buf)
  return cues.length ? cues : [String(text)]
}
const SRC = path.resolve(filmPath)
const SRC_DIR = path.dirname(SRC)
const film = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const scenes = film.scenes || []
// ★VF_FILMVOICE_V1c（2026-10-09 实验室配音自检实测踩到）：**素材路径必须先统一成绝对路径**。
//   因为本工具把 film.voiced.json 写到 `build/` 子目录，而渲染器是按"film.json 所在目录"解析相对素材的
//   ⇒ 实验室 workbench 的电影素材写的是 `media/xxx.jpg`，就会去 build/media/ 找 ⇒ 渲染闸门报"缺素材"整片失败。
//   口径：绝对路径原样保留，相对路径按**源 film.json 所在目录**解析。
for (const sc of film.scenes || []) {
  sc.media = (sc.media || []).map((m) => (path.isAbsolute(String(m)) ? String(m) : path.resolve(SRC_DIR, String(m))))
}
const gap = parseFloat(arg('gap', '0.5')) || 0.5
// ★VF_SUBCUE_V1：字幕风格参数（可调，见文件头用法）
const SUB_FONT = arg('sub-font', 'Microsoft YaHei')
const SUB_SIZE = parseFloat(arg('sub-size', '10')) || 10
const SUB_MARGIN = parseFloat(arg('sub-margin', '6')) || 6
const SUB_MAXC = parseInt(arg('sub-max-chars', '13'), 10) || 13
const voiceJson = arg('voice-json', path.resolve(filmPath).replace(/\.json$/, '.voice.json'))
const lines = fs.existsSync(voiceJson) ? (JSON.parse(fs.readFileSync(voiceJson, 'utf8')).voice || []) : []
const outDir = path.resolve(arg('outdir', path.join(PROJECT, 'storage', '_studio', 'out', 'film', film.id + '-voiced')))
const work = path.join(outDir, 'work')
const build = path.join(outDir, 'build')
fs.mkdirSync(work, { recursive: true })
fs.mkdirSync(build, { recursive: true })

const run = (cmd, a, o) => spawnSync(cmd, a, { encoding: 'utf8', ...(o || {}) })
const py = (() => { const t = run('python', ['--version']); return t.status === 0 ? 'python' : 'py' })()
const ffDur = (f) => {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])
  return parseFloat(String(r.stdout || '').trim()) || 0
}
const pad2 = (n) => String(n).padStart(2, '0')
const srtTime = (t) => {
  const ms = Math.max(0, Math.round(t * 1000))
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), x = ms % 1000
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s) + ',' + String(x).padStart(3, '0')
}

/** ★VF_TTSNODE_V1（2026-10-09 用户定案「先校准流程」）：TTS 后端链 = **Node（默认）→ python tts.py（兜底）**。
 *  为什么 Node 优先：配音流程要接到**主链路（AGENT 的 HTML成片线）**，而生产服务器是 Node 环境
 *  （deck 线 TTS 走的就是 TS 的 dashscopeTTS），不一定有 python；本机两种都有。
 *  可选：--tts python 强制用 tts.py；--voice Cherry|Serena|Ethan|Chelsie 指定音色。
 *  返回**真实音频时长**（秒）；全后端失败返回 0（调用方报错退出，绝不产坏片）。 */
const TTS_BACKEND = arg('tts', 'node')
const TTS_NODE = path.join(HERE, 'tools', 'tts-node.mjs')
const VOICE = arg('voice', '')
const ttsOne = (i, text, mp3) => {
  const tries = TTS_BACKEND === 'python' ? ['python', 'node'] : ['node', 'python']
  for (const bk of tries) {
    let r = null
    if (bk === 'node') {
      r = run(process.execPath, [TTS_NODE, '--text', text, '--out', mp3].concat(VOICE ? ['--voice', VOICE] : []), { cwd: HERE })
    } else {
      if (!fs.existsSync(TTS)) continue
      r = run(py, [TTS, '--text', text, '--out', mp3], { cwd: path.dirname(TTS) })
    }
    if (fs.existsSync(mp3) && fs.statSync(mp3).size >= 512) {
      if (i === 0) console.log('  TTS 后端 = ' + bk + '（' + (bk === 'node' ? 'tts-node.mjs · 纯 Node' : 'tts.py · python') + '）' + (VOICE ? ' 音色=' + VOICE : ''))
      return ffDur(mp3)
    }
    console.log('  ⚠ 第 ' + i + ' 镜 ' + bk + ' 后端失败 → 换下一个：' + String(r && (r.stderr || r.stdout) || '').replace(/\s+/g, ' ').slice(-160))
  }
  console.error('  ✗ 第 ' + i + ' 镜 TTS 所有后端都失败')
  return 0
}

console.log('★ audio-first：镜头时长 = TTS 实测时长 + ' + gap + 's 尾巴（不再用 4.5 字/秒 猜）')
console.log('  旁白文件：' + (fs.existsSync(voiceJson) ? path.basename(voiceJson) : '（无 → 读 scene.voice；都没有的镜 = 静音镜）'))
console.log('  输出目录：' + path.relative(PROJECT, outDir).replace(/\\/g, '/'))

// ---------------- ① 逐镜 TTS + ② 回填实测时长 ----------------
const clips = []
const srtRows = []
let cur = 0
let i = 0
for (const sc of scenes) {
  const text = String(lines[i] || sc.voice || '').trim()
  const mp3 = path.join(work, 's' + i + '.mp3')
  let audio = 0
  if (text) {
    audio = ttsOne(i, text, mp3)
    if (!audio) process.exit(1)
  }
  const oldDur = sc.dur
  const dur = Math.max(2.2, +(audio + (text ? gap : 0)).toFixed(2))
  // ★VF_FILMVOICE_V1b：模型写的分镜**故意不带 dur**（时长由 TTS 决定）⇒ 这里别显示 "undefined/NaN"
  if (oldDur === undefined) sc._oldDur = null
  sc._oldDur = oldDur                 // 保留估算值，方便对比"估算 vs 实测"
  sc.dur = dur
  sc._voice = text
  sc._voiceDur = +audio.toFixed(2)
  clips.push({ mp3: text ? mp3 : '', dur, audio })
  // ★VF_SUBCUE_V1：一句口播 → 切成若干**单行短字幕**，时间按字数占比分配（总时长仍等于该镜音频时长）
  if (text) {
    const cues = splitCues(text, SUB_MAXC)
    const totalChars = cues.reduce((a, c) => a + c.length, 0) || 1
    let t = cur
    for (const c of cues) {
      const d = audio * (c.length / totalChars)
      srtRows.push({ n: srtRows.length + 1, from: t, to: t + d, text: c })
      t += d
    }
  }
  const d = (dur - oldDur)
  console.log('  s' + String(i).padStart(2) + '  估=' + String(oldDur).padStart(5) + 's  TTS实测=' + audio.toFixed(2) + 's  定=' + String(dur).padStart(5) + 's  Δ=' + (d >= 0 ? '+' : '') + d.toFixed(2) + 's  ' + text.slice(0, 20))
  cur = +(cur + dur).toFixed(2)
  i++
}
film.total = +cur.toFixed(2)
film.voice = { engine: 'dashscope/CosyVoice（tts.py）', gap, at: new Date().toISOString().slice(0, 19).replace('T', ' ') }
fs.writeFileSync(path.join(build, 'film.voiced.json'), JSON.stringify(film, null, 2) + '\n', 'utf8')
fs.writeFileSync(path.join(build, 'subs.srt'),
  srtRows.map((s) => s.n + String.fromCharCode(10) + srtTime(s.from) + ' --> ' + srtTime(s.to) + String.fromCharCode(10) + s.text + String.fromCharCode(10)).join(String.fromCharCode(10)),
  'utf8')
console.log('  实测合计 = ' + film.total + 's（字幕 ' + srtRows.length + ' 条）')

// ---------------- ③ 拼音轨（每段补静音到该镜时长 ⇒ 与画面严格对齐） ----------------
const listFile = path.join(work, 'concat.txt')
const listLines = []
clips.forEach((c, k) => {
  const p = path.join(work, 'p' + k + '.mp3')
  if (c.mp3) {
    run('ffmpeg', ['-y', '-v', 'error', '-i', c.mp3, '-af', 'apad', '-t', String(c.dur),
      '-c:a', 'libmp3lame', '-ar', '44100', '-ac', '2', p])
  } else {
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(c.dur),
      '-c:a', 'libmp3lame', p])
  }
  listLines.push("file '" + p.replace(/\\/g, '/') + "'")
})
fs.writeFileSync(listFile, listLines.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8')
const voiceMp3 = path.join(build, 'voice.mp3')
run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', voiceMp3])

// ---------------- ④ 渲染画面（用新时长） ----------------
const renderDir = path.join(outDir, 'render')
console.log('  渲染中（用实测时长）…')
const rr = run(process.execPath, [path.join(HERE, 'tools', 'render-film.mjs'), path.join(build, 'film.voiced.json'), '--outdir', renderDir], { cwd: HERE })
const mp4 = path.join(renderDir, film.id + '.mp4')
if (!fs.existsSync(mp4)) {
  console.error('  ✗ 渲染失败：' + String(rr.stderr || rr.stdout || '').replace(/\s+/g, ' ').slice(-300))
  process.exit(1)
}
console.log('  ✓ 画面：' + path.relative(PROJECT, mp4).replace(/\\/g, '/'))

// ---------------- ⑤ 混音 + 烧字幕 ----------------
const hasLibass = (() => {
  const r = run('ffmpeg', ['-hide_banner', '-filters'])
  return / subtitles /.test(String(r.stdout || ''))
})()
fs.copyFileSync(path.join(build, 'subs.srt'), path.join(renderDir, 'subs.srt'))
const finalMp4 = path.join(outDir, film.id + '-voiced.mp4')
const base = ['-y', '-v', 'error', '-i', film.id + '.mp4', '-i', voiceMp3]
const tail = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
  // ⚠️ 这里必须用**绝对路径**：ffmpeg 的 cwd 是 renderDir，写成 basename 会落到 render/ 子目录里
  //    （2026-10-09 实测踩到：第一次跑完产物在 render/xxx-voiced.mp4，而脚本按 outDir 去判存在 ⇒ 误报失败）
  '-c:a', 'aac', '-b:a', '192k', '-shortest', finalMp4]
let vvf = null
if (!has('no-sub') && hasLibass) {
  // ★VF_SUBCUE_V1（用户实测「字幕太大压在上面」后定稿）：**小字号 + 贴底安全条**。
  //   换算：FontSize/MarginV 是 libass 的脚本单位（PlayResY=288）⇒ 像素 ≈ 值 × 1280/288 ≈ ×4.44。
  //     旧值 FontSize=15 / MarginV=46 ⇒ 每行约 67px、离底 204px（正好压在画面文字上，实测被抓）。
  //     新值 FontSize=10 / MarginV=6 ⇒ 每行约 44px、离底约 27px ⇒ 落在各模板"底部文字（foot/tail/CTA）"**下方**的安全条里。
  //   配合上面"单行短句"（≤13 字 ⇒ ≤572px 宽，绝不换行）。
  vvf = "subtitles=subs.srt:force_style='FontName=" + SUB_FONT + ",FontSize=" + SUB_SIZE
    + ",PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=" + SUB_MARGIN + "'"
}
const fr = run('ffmpeg', base.concat(vvf ? ['-vf', vvf] : []).concat(tail),
  { cwd: renderDir })
if (!fs.existsSync(finalMp4)) {
  console.error('  ✗ 混音/烧字幕失败：' + String(fr.stderr || fr.stdout || '').replace(/\s+/g, ' ').slice(-300))
  process.exit(1)
}
const sz = Math.round(fs.statSync(finalMp4).size / 1024)
console.log('  ✓ 成片（含配音' + (vvf ? ' + 烧字幕' : '，字幕为旁挂 SRT') + '）：'
  + path.relative(PROJECT, finalMp4).replace(/\\/g, '/') + '  ' + sz + ' KB  ' + film.total + 's')
if (!vvf) {
  console.log('    ⚠ 本机 ffmpeg 没有 libass（subtitles 滤镜）⇒ **没有烧字幕**，已把字幕留在：'
    + path.relative(PROJECT, path.join(build, 'subs.srt')).replace(/\\/g, '/') + '（可播放器外挂，或让带 libass 的机器再跑一次）')
}
console.log('  产物清单：' + path.relative(PROJECT, outDir).replace(/\\/g, '/') + '/'
  + '  [build/film.voiced.json · build/subs.srt · build/voice.mp3 · render/*.mp4 · ' + film.id + '-voiced.mp4]')
