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
  // ★VF_SUBCUE_V2（2026-10-09 用户实测「一桌好菜，等你下锅，」—— 断句处把逗号留在行尾）：
  //   字幕是**单行小字**，行尾/行首标点纯属噪声（切句时必然产生）⇒ 每条只保留正文；
  //   清完只剩标点的 cue 直接丢掉（别烧出一行光秃秃的"，"）。
  const clean = cues.map((c) => c
    .replace(/^[\s，。、；！？：,.;!?·…—\-]+/, '')
    .replace(/[\s，。、；！？：,.;!?·…—\-]+$/, '')
    .trim()).filter((c) => c.length > 0)
  if (clean.length) return clean
  return cues.length ? cues : [String(text)]
}
const SRC = path.resolve(filmPath)
const SRC_DIR = path.dirname(SRC)
const film = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const scenes = film.scenes || []
// ★VF_FILMVOICE_V1d（2026-10-09 用户实测「明明渲染成功了却报失败」）：
//   AGENT 侧编排器产出的 film.json **没有 id** ⇒ render-film 只好按**文件名**命名产物
//   （`film.voiced.json` → `film.voiced.mp4`），而下面却按 `<film.id>.mp4` 去找 ⇒ **误报"渲染失败"**
//   ⇒ 上层回退无声版、白跑一趟。这里补上 id（没有就用源文件名），并且**找成片改成按目录找**（见下）。
if (!film.id) film.id = path.basename(SRC, '.json')
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
// ★VF_NOEMPTY_V1（2026-10-09 用户实测「视频根本打不开」= 服务端 0 字节还报成功）：
//   事故链（**客户端日志原文**为证）：`[storage:mirror] 已镜像到本地仓库: …20261009_021.mp4 (0.0MB)`
//     · ffmpeg 有个恶习 —— **先把输出文件创建出来、再报错退出**（`-y` 会立刻把目标 truncate 成 0 字节）；
//     · 老代码只判 `fs.existsSync(finalMp4)` ⇒ **0 字节也当成功** ⇒ 打印 FINAL_MP4 ⇒ 上传空对象到 OSS
//       ⇒ 客户端把它镜像到本地就是 0.0MB ⇒ 本地、网页**都**打不开（与 faststart 无关，那是另一件事）。
//   现口径：**每一步都过三道闸** ① exit=0 ② 产物存在 ③ 产物**不是空的**（还要能被 ffprobe 读出时长）。
//   混音失败**降级重试**：先去掉烧字幕 → 再退到"只换音轨不重编码"；全失败才 exit 1（上层如实回退无声版）。
const sizeOf = (f) => { try { return fs.statSync(f).size } catch { return -1 } }
const okFile = (f, min) => sizeOf(f) >= (min || 512)
const rmQuiet = (f) => { try { fs.unlinkSync(f) } catch { /* 本来就没有 */ } }
/** ffmpeg 能力探测（编码器/滤镜缺不缺）—— 出片日志里直接写明，别等出事再猜。
 *  刻意在**失败现场**也再打一遍（见下面 exit 1 之前的那行）：
 *  服务端是精简 ffmpeg 时，缺 libmp3lame/libx264/libass 就是"0 字节/没字幕"的真正原因。 */
const CAPS = (() => {
  const r = run('ffmpeg', ['-hide_banner', '-encoders'])
  const t = String(r.stdout || '') + String(r.stderr || '')
  const rf = run('ffmpeg', ['-hide_banner', '-filters'])
  const tf = String(rf.stdout || '')
  return { lame: / libmp3lame /.test(t), x264: / libx264 /.test(t), libass: / subtitles /.test(tf) }
})()
const capsLine = () => '音轨编码=' + AUDIO.enc + ' libmp3lame=' + (CAPS.lame ? '有' : '无')
  + ' libx264=' + (CAPS.x264 ? '有' : '无') + ' libass=' + (CAPS.libass ? '有' : '无')
/** 音轨编码：优先 mp3，缺 libmp3lame 就退 aac/.m4a ——
 *  服务端 ffmpeg 常是精简构建，**没有 libmp3lame 会让整条音轨全空**（老代码忽略 exit code ⇒ 一路"成功"） */
const AUDIO = CAPS.lame ? { enc: 'libmp3lame', ext: '.mp3' } : { enc: 'aac', ext: '.m4a' }
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
/** ★VF_VOICE_DERIVE_V1（2026-10-09 用户实测「TTS实测=0.00s + 字幕 0 条」）：
 *  病灶：AGENT 侧走的是"**不带旁白文件**"的调用（`makeFilmFromMaterials({voiced:true})`）⇒
 *  这里 `lines=[]`、`scene.voice` 也不存在 ⇒ 每镜文案为空 ⇒ **一次 TTS 都没调** ⇒
 *  镜头时长全落到 2.2s 下限（17 镜就会得到一条 13.2s 的哑片）。
 *  口径（与实验室 studio-server 那条路**统一**）：没给口播时，**按该镜的在屏文案兜底**
 *  （`title1`/`title` + `sub`）—— 画面写什么就念什么，绝不编造。 */
const deriveVoice = (sc) => {
  const v = sc.slots || {}
  // ★VF_VOICE_SPOKEN_V1（2026-10-09 用户实测「字幕/配音=画面大字，音画完全重复」）：
  //   **优先用"口播句"** —— AI 写文案时可以额外给一句 `slots.voice`（口语化、与画面大字不同）；
  //   有它就用它，没有才退回"念画面字"（画面写什么就念什么，绝不编造）。
  const spoken = String(v.voice || sc.voice || '').trim()
  if (spoken) return spoken
  const pick = (...ks) => ks.map((k) => String(v[k] || '').trim()).filter(Boolean)
  const arr = (k) => (Array.isArray(v[k]) ? v[k].map((x) => String(x).trim()).filter(Boolean) : [])
  // 主口径：标题 + 副题（画面写什么就念什么，绝不编造）
  let s = pick('title', 'title1', 'title2', 'sub').join('，')
  // ★VF_VOICE_DERIVE_V2（2026-10-09）：标题/副题都空时**退到画面上的其它文字** ——
  //   否则"这镜其实有字"也会被判成没文案 ⇒ 又变成 2.2s 静音镜（就是用户踩的那条哑片）。
  if (!s) s = pick('eyebrow', 'foot', 'tail').join('，')
  if (!s) s = arr('chips').concat(arr('rows')).concat(arr('nums')).join('，')
  return s.trim()
}

// ★VF_NOCOPY_V1（2026-10-09 用户定案「分镜没有任何文案就不许出片」；与 vf-film.ts 同一口径）：
//   配音线的**时长与字幕全靠分镜文本**：没文本 ⇒ 不调 TTS ⇒ 音轨全静音、字幕 0 条、
//   每镜时长只能落 2.2s 下限 ⇒ 出来就是"没字没声的快闪哑片"（用户实测 8 段 = 8×2.2 = 17.6s）。
//   ⇒ 先算清每镜文本，**有一镜没文案就拒绝出片**（在调 TTS 之前拦，不浪费配额）。
const texts = scenes.map((sc, k) => (k < lines.length
  ? String(lines[k] || '')
  : String(sc.voice || deriveVoice(sc))).trim())
const noTextIdx = texts.map((t, k) => (t ? -1 : k)).filter((k) => k >= 0)
if (noTextIdx.length) {
  console.error('  ✗ ' + noTextIdx.length + '/' + scenes.length + ' 镜**没有任何文案**（第 '
    + noTextIdx.slice(0, 8).join('、') + ' 镜）⇒ 拒绝出片（ERR_KIND:NO_TEXT）')
  console.error('    配音线的时长/字幕全靠分镜文本：没文本 ⇒ 不调 TTS、0 条字幕、每镜只能掉到 2.2s 下限（快闪哑片）。')
  console.error('    多半是"AI 文案没并进分镜"（形状/字段没对上）—— 回去查合并那一步（vf-film.ts 的 ★VF_FILMCOPY）。')
  console.error('  ffmpeg 环境：' + capsLine())
  process.exit(1)
}

for (const sc of scenes) {
  const text = texts[i]
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
  // ★VF_FILMGEN_V6（2026-10-10）：这条线的分镜**按规矩不写 dur**（时长由 TTS 实测决定）
  //   ⇒ 老打印会出现 `估=undefineds Δ=NaN`（看着像故障）。没有估算值就如实显示 "—"。
  const hasEst = Number.isFinite(Number(oldDur)) && Number(oldDur) > 0
  const d = hasEst ? (dur - oldDur) : null
  console.log('  s' + String(i).padStart(2)
    + '  估=' + (hasEst ? String(oldDur).padStart(5) : '   — ') + 's'
    + '  TTS实测=' + audio.toFixed(2) + 's'
    + '  定=' + String(dur).padStart(5) + 's'
    + '  Δ=' + (d === null ? '   —  ' : (d >= 0 ? '+' : '') + d.toFixed(2)) + 's'
    + '  ' + text.slice(0, 20))
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
console.log('  ffmpeg 环境：' + capsLine()
  + (CAPS.lame ? '' : '（没有 libmp3lame ⇒ 音轨退 aac/.m4a）')
  + (CAPS.x264 ? '' : '（没有 libx264 ⇒ 成片不重编码、字幕只能旁挂）'))
const badAudio = []
clips.forEach((c, k) => {
  const p = path.join(work, 'p' + k + AUDIO.ext)
  rmQuiet(p)
  const a = c.mp3
    ? ['-y', '-v', 'error', '-i', c.mp3, '-af', 'apad', '-t', String(c.dur),
      '-c:a', AUDIO.enc, '-ar', '44100', '-ac', '2', p]
    : ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(c.dur),
      '-c:a', AUDIO.enc, p]
  const r2 = run('ffmpeg', a)
  // ★VF_NOEMPTY_V1：**必须校验**（老代码把 exit code 全忽略 ⇒ 服务端没有 libmp3lame 时
  //   p*.mp3 全失败 ⇒ 拼出空 voice.mp3 ⇒ 混音 0 字节 ⇒ 还报成功）
  if (r2.status !== 0 || !okFile(p, 512)) {
    badAudio.push('p' + k + '（' + (r2.status === 0 ? '空文件' : 'exit=' + r2.status) + '）')
    rmQuiet(p)
    // 兜底：拿**静音**补上这一段（宁可有静音，也不要整条音轨作废）
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-t', String(c.dur), '-c:a', AUDIO.enc, p])
  }
  listLines.push("file '" + p.replace(/\\/g, '/') + "'")
})
fs.writeFileSync(listFile, listLines.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8')
const voiceTrack = path.join(build, 'voice' + AUDIO.ext)
rmQuiet(voiceTrack)
const cr = run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', voiceTrack])
if (cr.status !== 0 || !okFile(voiceTrack, 4096)) {
  console.error('  ✗ 音轨合成失败（' + (badAudio.length ? '异常段 ' + badAudio.slice(0, 4).join(', ') + ' · ' : '')
    + '）' + String(cr.stderr || cr.stdout || '').replace(/\s+/g, ' ').slice(-260))
  console.error('  ffmpeg 环境：' + capsLine())   // ★VF_NOEMPTY_V1：失败现场自报能力（服务端缺什么一眼可见）
  rmQuiet(voiceTrack)
  process.exit(1)
}
if (badAudio.length) console.log('    ⚠ ' + badAudio.length + ' 段音轨异常（已按静音补齐）：' + badAudio.slice(0, 4).join(', '))

// ---------------- ④ 渲染画面（用新时长） ----------------
const renderDir = path.join(outDir, 'render')
console.log('  渲染中（用实测时长）…')
const rr = run(process.execPath, [path.join(HERE, 'tools', 'render-film.mjs'), path.join(build, 'film.voiced.json'), '--outdir', renderDir], { cwd: HERE })
// ★VF_FILMVOICE_V1d：**按目录找成片**（取最大的 .mp4）—— 不再猜文件名。
//   实测踩到：AGENT 的 film.json 没 id ⇒ render-film 按文件名出品 `film.voiced.mp4`，
//   旧实现却去找 `<film.id>.mp4` ⇒ 误报"渲染失败"（渲染其实成功了），上层白回退一次。
const pickMp4 = () => {
  try {
    const a = fs.readdirSync(renderDir).filter((n) => /\.mp4$/i.test(n))
      .map((n) => ({ p: path.join(renderDir, n), sz: fs.statSync(path.join(renderDir, n)).size }))
      .sort((x, y) => y.sz - x.sz)
    return a.length ? a[0].p : ''
  } catch { return '' }
}
const mp4 = pickMp4()
if (!mp4) {
  console.error('  ✗ 渲染失败：' + String(rr.stderr || rr.stdout || '').replace(/\s+/g, ' ').slice(-300))
  process.exit(1)
}
console.log('  ✓ 画面：' + path.relative(PROJECT, mp4).replace(/\\/g, '/'))

// ---------------- ⑤ 混音 + 烧字幕 ----------------
const hasLibass = CAPS.libass   // ★VF_NOEMPTY_V1：探测上移到 CAPS —— 失败现场也要能打出来
fs.copyFileSync(path.join(build, 'subs.srt'), path.join(renderDir, 'subs.srt'))
const finalMp4 = path.join(outDir, film.id + '-voiced.mp4')
// ★VF_FILMVOICE_V1d：输入用**实际找到的那个 mp4**（cwd=renderDir ⇒ 取 basename），不写死名字
const base = ['-y', '-v', 'error', '-i', path.basename(mp4), '-i', voiceTrack]
// 视频侧：有 libx264 ⇒ 重编码（**只有重编码才能烧字幕**）；没有 ⇒ 直接 copy（不重编码，字幕只能旁挂）
const venc = CAPS.x264
  ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p']
  : ['-c:v', 'copy']
// 音频 + 输出。⚠️ 输出必须用**绝对路径**：ffmpeg 的 cwd 是 renderDir，写成 basename 会落到 render/ 子目录里
//    （2026-10-09 实测踩到：第一次跑完产物在 render/xxx-voiced.mp4，而脚本按 outDir 去判存在 ⇒ 误报失败）
// ★VF_FASTSTART_V1（2026-10-09 用户实测「视频根本打不开」）——**必须**加 faststart：
//   病灶铁证（本机比对了两个文件的文件头）：
//     · 引擎渲染出的静帧产物：`ftyp` 后紧接 **`moov`**（索引在头）⇒ 浏览器能秒开、能流式播；
//     · 只混音不加 faststart 的成片：`ftyp` 后是 `free`+`mdat`，**`moov` 被推到文件尾** ⇒
//       网页 `<video>` 必须先把整个文件（含末尾索引）拿到才能初始化 ⇒ 表现就是"转圈/根本打不开"。
//   （注：本次 0.0MB 那件事不是它 —— 那是混音失败留下 0 字节被当成功，见 ★VF_NOEMPTY_V1。
//     两件事都修了，别只修一件。）
const AMIX = ['-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', finalMp4]
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
// ★VF_NOEMPTY_V1：混音**降级重试链** + 三道闸校验（exit=0 / 非空 / ffprobe 读得出时长）。
//   老代码只跑一次、且只判 `existsSync` ⇒ ffmpeg 失败留下的 0 字节文件被当成功（用户这次踩的坑）。
const tries = []
if (vvf) tries.push({ tag: '混音 + 烧字幕', vf: vvf, enc: venc })
if (CAPS.x264) tries.push({ tag: '混音（不烧字幕）', vf: null, enc: venc })
tries.push({ tag: '只换音轨（不重编码）', vf: null, enc: ['-c:v', 'copy'] })
let used = null
let lastErr = ''
for (const t of tries) {
  rmQuiet(finalMp4)   // ← 关键：每次先把上一次留下的 0 字节残骸删掉（否则 existsSync 会骗人）
  const fr = run('ffmpeg', base.concat(t.vf ? ['-vf', t.vf] : []).concat(t.enc, AMIX), { cwd: renderDir })
  const szNow = sizeOf(finalMp4)
  const dur = ffDur(finalMp4)
  if (fr.status === 0 && szNow >= 20 * 1024 && dur > 0.5) { used = t; break }
  lastErr = String(fr.stderr || fr.stdout || '').replace(/\s+/g, ' ').slice(-300)
  console.log('    ⚠ ' + t.tag + ' 失败（'
    + (fr.status !== 0 ? 'exit=' + fr.status : (szNow < 20 * 1024 ? '产物为空 ' + szNow + 'B' : '时长读不出'))
    + '）' + (lastErr ? '：' + lastErr.slice(-160) : ''))
}
if (!used) {
  rmQuiet(finalMp4)   // ← 绝不留 0 字节"假产物"（本次事故就是它被当成功、传上 OSS 的）
  console.error('  ✗ 混音全部降级尝试都失败（末次原因）：' + lastErr)
  console.error('  ffmpeg 环境：' + capsLine())
  process.exit(1)
}
const sz = Math.round(sizeOf(finalMp4) / 1024)
console.log('  ✓ 成片（含配音' + (used.vf ? ' + 烧字幕' : '，字幕为旁挂 SRT') + '）：'
  + path.relative(PROJECT, finalMp4).replace(/\\/g, '/') + '  ' + sz + ' KB  ' + film.total + 's'
  + (used.vf ? '' : '（因环境能力不足降级：' + used.tag + '）'))
// ★VF_FILMVOICE_V1d：给调用方（vf-film.ts）一行**机器可读**的成片路径，别再靠猜文件名
console.log('FINAL_MP4:' + finalMp4)
if (!used.vf) {
  console.log('    ⚠ 这次**没有烧字幕**（' + (hasLibass ? '已降级，见上面失败行）' : '本机 ffmpeg 没有 libass 的 subtitles 滤镜）')
    + '，字幕已留在：' + path.relative(PROJECT, path.join(build, 'subs.srt')).replace(/\\/g, '/')
    + '（可播放器外挂，或让带 libass + libx264 的机器再跑一次）')
}
console.log('  产物清单：' + path.relative(PROJECT, outDir).replace(/\\/g, '/') + '/'
  + '  [build/film.voiced.json · build/subs.srt · build/voice' + AUDIO.ext + ' · render/*.mp4 · ' + film.id + '-voiced.mp4]')
