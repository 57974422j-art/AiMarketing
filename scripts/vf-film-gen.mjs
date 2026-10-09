#!/usr/bin/env node
/**
 * ★VF_FILMGEN_V1（2026-10-09 用户定案「qwen 真做」）—— 让**真模型**写分镜（film.json）
 * =============================================================================
 * 为什么分两步（关键，别省）：
 *   用户要的 qwen 版 = `qwen3.8-flash`（model-catalog.ts:43，`multimodal:false`）—— 它**看不见图片**。
 *   直接喂 17 个文件名让它编，等于让它瞎猜（第一版就是这么翻车的）。
 *   ⇒ 两步：
 *     ① **看图**：`qwen3.8-max`（多模态，model-catalog.ts:54）逐张读图，各写一句描述；
 *     ② **写分镜**：`qwen3.8-flash` 拿"17 条描述 + 硬规矩"写 film.json（含每镜口播 voice）。
 *   ⇒ 这样才是"qwen 真做"，而不是我在替它写。
 *
 * 与项目其他工具同一套纪律：
 *   · 只**新增**文件，不改任何老链路；产物写到 films/（分镜）与 storage/_studio/out/（成片，gitignored）。
 *   · 硬规矩**服务端校验**（不靠模型自觉）：17 张全用且各一次 / 结构白名单 / 独立卡≤1 / 每镜文案≤60字 / 每镜有 voice。
 *
 * 用法：
 *   node scripts/vf-film-gen.mjs --images "E:\...\餐饮素材" --pitch "火锅到店点单"
 *        [--out films/hotpot-qwen-v1.json] [--writer qwen3.8-flash] [--vision qwen3.8-max]
 *        [--desc-cache <缓存.json>] [--render]
 *   --render 会在写完分镜后**直接接着跑 audio-first**（tools/film-voice.mjs：TTS + 字幕 + 混音 + 烧字幕）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')          // 项目根
const DECK = path.join(HERE, 'scripts', 'video-factory', 'html-deck')
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

const args = process.argv.slice(2)
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const has = (k) => args.includes('--' + k)

// ---------- 凭据：进程环境变量优先 → 项目 .env.local（与 tts.py / ai-providers.ts 同口径） ----------
const readEnvFile = () => {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(HERE, f)
    if (!fs.existsSync(p)) continue
    const out = {}
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  }
  return {}
}
const ENV = readEnvFile()
const KEY = process.env.DASHSCOPE_API_KEY || ENV.DASHSCOPE_API_KEY || ''
if (!KEY) { console.error('✗ 没有 DASHSCOPE_API_KEY（进程环境变量与 .env.local 都没有）'); process.exit(2) }

const IMAGES_DIR = arg('images', '')
const PITCH = arg('pitch', '火锅到店点单清单')
const writer = arg('writer', 'qwen3.8-flash')
const vision = arg('vision', 'qwen3.8-max')
const outFile = path.resolve(arg('out', path.join(DECK, 'films', 'hotpot-qwen-v1.json')))
const descCache = path.resolve(arg('desc-cache', path.join(DECK, 'films', '_desc-' + path.basename(outFile).replace(/\.json$/, '') + '.json')))

// ---------- 调模型（OpenAI 兼容，非流式，超时 180s） ----------
async function chat(model, messages, maxTokens) {
  const ctl = new AbortController()
  // ★VF_FILMGEN_V2：180s 不够（实测 qwen3.8-flash 写 10+ 镜分镜会被 abort）⇒ 300s
  const t = setTimeout(() => ctl.abort(), 300000)
  try {
    const r = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens || 4000, temperature: 0.7, stream: false }),
      signal: ctl.signal,
    })
    const j = await r.json()
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 300))
    return String((((j.choices || [])[0] || {}).message || {}).content || '')
  } finally { clearTimeout(t) }
}
const jsonOf = (txt) => {
  // ★VF_FILMGEN_V2（2026-10-09 实测踩到）：**必须配对括号扫描**，不能"第一个 { 到最后一个 }"——
  //   第一次跑 qwen3.8-flash 就是栽在这：它 JSON 后面又补了解释文字（含 `}`），
  //   于是 lastIndexOf('}') 越过了真正的对象结尾 ⇒ "Unexpected non-whitespace character after JSON"。
  //   现做法：剥掉 markdown 围栏 → 找到第一个 { → 逐字符配对（带字符串/转义处理）→ 取**第一个完整对象**。
  const s = String(txt).replace(/```(?:json)?/gi, '')
  const a = s.indexOf('{')
  if (a < 0) throw new Error('模型没给 JSON：' + s.slice(0, 200))
  let depth = 0, inStr = false, esc = false
  for (let i = a; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return JSON.parse(s.slice(a, i + 1)) }
  }
  throw new Error('JSON 括号不闭合：' + s.slice(a, a + 200))
}

// ---------- ① 看图（多模态）→ 每张一句描述（带缓存，重跑不烧钱） ----------
let descs = fs.existsSync(descCache) ? JSON.parse(fs.readFileSync(descCache, 'utf8')) : null
const media = (() => {
  if (!IMAGES_DIR) { console.error('✗ 缺 --images <素材目录>'); process.exit(2) }
  return fs.readdirSync(IMAGES_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()
    .map((f) => path.join(IMAGES_DIR, f))
})()
console.log('★ 模型：看图=' + vision + '  写分镜=' + writer + '  素材=' + media.length + ' 张')

// ★VF_FILMGEN_V3（2026-10-09 实测踩到）：模型写的 media 是**素材编号**（1..N），
//   而 film-to-page 要的是**素材路径**。第一版只在"校验副本"里换了编号，落盘时写的还是数字
//   ⇒ 渲染器把 `14` 当路径 ⇒ ERR_INVALID_ARG_TYPE（渲染直接崩）。
//   这里提供 `--fix-media`：只做"编号 → 绝对路径"的改写，**不重新调模型**（保住已审过的分镜、不重复花钱）。
// ★VF_FILMGEN_V4（2026-10-09 实测被"用字闸门"拦下）：**模型不知道项目有字体子集**——
//   qwen 写了"铜锅**涮**肉"，而 html-deck/fonts/chars-cmn.txt（GB2312 一级 3755 字）里**没有「涮」**
//   ⇒ check-page-fonts 判 FAIL ⇒ render-film 直接拒产（设计如此，不产坏片）。
//   口径（照闸门提示的"首选：改文案避开表外字"）：
//     ① 给模型的硬规矩里**点名**这个坑；
//     ② 服务端再兜一层：**同义替换表**（涮→烫）+ **字表校验**，替换后仍有表外字就**如实报出来**（不静默）。
const CHARSET = new Set([...fs.readFileSync(path.join(DECK, 'fonts', 'chars-cmn.txt'), 'utf8')])
const SYN = { '涮': '烫' }
const fixText = (s) => { let r = String(s); for (const k of Object.keys(SYN)) r = r.split(k).join(SYN[k]); return r }
const bannedOf = (s) => Array.from(new Set([...String(s)].filter((c) => c.charCodeAt(0) > 127 && !CHARSET.has(c))))
const fixDeep = (v) => {
  if (typeof v === 'string') return fixText(v)
  if (Array.isArray(v)) return v.map(fixDeep)
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = fixDeep(v[k]); return o }
  return v
}
/** 对整个 film 做"换字 + 字表体检"；返回仍不在字表里的字 */
const fixFilmChars = (film) => {
  const bad = new Set()
  const keep = ['generatedBy']
  for (const s of film.scenes || []) {
    s.slots = fixDeep(s.slots || {})
    if (s.voice) s.voice = fixText(s.voice)
    bannedOf(JSON.stringify(s.slots) + s.voice).forEach((c) => bad.add(c))
  }
  if (film.name) film.name = fixText(film.name)
  film.rationale = (film.rationale || []).map((r) => fixText(String(r)
    + (bannedOf(r).length ? '（注：已自动换字 ' + bannedOf(r).join('') + '）' : '')))
  void keep
  return Array.from(bad)
}

const mapMedia = (j) => {
  let n = 0
  for (const s of j.scenes || []) {
    s.media = (s.media || []).map((x) => { n++; return media[Number(x) - 1] || String(x) })
  }
  return n
}
if (has('fix-media')) {
  const j = JSON.parse(fs.readFileSync(outFile, 'utf8'))
  const n = mapMedia(j)
  const stillBad = fixFilmChars(j)
  fs.writeFileSync(outFile, JSON.stringify(j, null, 2) + '\n', 'utf8')
  console.log('  ✓ fix-media：已把 ' + n + ' 个素材编号换成绝对路径 → ' + path.relative(HERE, outFile).replace(/\\/g, '/'))
  console.log('    样例：scene0.media[0] = ' + ((j.scenes || [])[0] || {}).media + '')
  console.log('  ' + (stillBad.length ? '⚠ 仍有表外字：' + stillBad.join('') : '✓ 用字体检：全部在字表内') + '（换字表 ' + JSON.stringify(SYN) + '）')
  process.exit(0)
}
if (descs && descs.length === media.length) {
  console.log('  ① 看图：用缓存 ' + path.relative(HERE, descCache).replace(/\\/g, '/'))
} else {
  const work = path.join(HERE, 'storage', '_studio', 'out', '_gen', 'desc')
  fs.mkdirSync(work, { recursive: true })
  descs = []
  console.log('  ① 看图（' + vision + '，逐张一句话）…')
  for (let i = 0; i < media.length; i++) {
    const small = path.join(work, 'i' + i + '.jpg')
    spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', media[i], '-vf', 'scale=512:-1', '-q:v', '4', small])
    const b64 = fs.readFileSync(small).toString('base64')
    const d = await chat(vision, [{
      role: 'user',
      content: [
        { type: 'text', text: '用一句不超过 20 字的中文说明这张餐饮实拍图的主要内容（菜名/场景/环境）。只回这一句，不要引号、不要编号、不要标点开头。' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } },
      ],
    }], 200)
    descs.push(String(d).trim().replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 30))
    console.log('    ' + String(i + 1).padStart(2) + '. ' + path.basename(media[i]).slice(-18) + ' → ' + descs[i])
  }
  fs.writeFileSync(descCache, JSON.stringify(descs, null, 2) + '\n', 'utf8')
  console.log('    描述已缓存：' + path.relative(HERE, descCache).replace(/\\/g, '/'))
}

// ---------- ② 写分镜（文本模型） ----------
const STRUCTS = [
  'opening-hero  开场封面：slots{eyebrow,title1,title2,sub,foot}   media=1 张',
  'fullbleed     满幅实拍：slots{eyebrow,title,sub,chips[1~4],foot} media=1 张',
  'works-wall    作品墙(3图)：slots{title,sub,rows[3],foot}        media=3 张',
  'grid-2x2      四宫格(4图)：slots{title,sub,nums[4],tail,foot}    media=4 张',
  'glass-product 到店/结尾卡：slots{eyebrow,title,sub,value,unit,kpiTitle,kpi[[标签,值]x3],mini[[标签,值]x3],cta}  media=0 张',
].join('\n  ')
const rules = [
  '【硬规矩 · 服务端会逐条校验，违反即返工】',
  '1. 素材共 ' + media.length + ' 张，**每一张都必须出镜、且每张只能用一次**（media 数组里填上面给的"编号"）。',
  '2. 结构只能用这 5 种（不许自创）：\n  ' + STRUCTS,
  '3. 首镜必须是 opening-hero，末镜必须是 glass-product；中间用 fullbleed / works-wall / grid-2x2 组合，总镜数 10~13。',
  '4. **独立信息卡（media=0 的镜）最多 1 张**（就是末镜那张 glass-product；别再插别的无图卡）。',
  '5. 每镜的文案（title+sub+rows 或 chips 全部相加）**不超过 60 字**；chips 每条 ≤3 字；rows 每条 ≤12 字。',
  '6. 反 AI 味：**零 emoji、零符号图标**；**不许编造数据**——画面里出现的数字必须是这个主题里本来就有的（没有就一个数字都别写）；不要"紫粉渐变/渐变药丸标签"这类默认审美词。',
  '7. 每镜必须给一句**口播文案 `voice`**（口语、≤40 字、能被 TTS 直接朗读；不要 emoji、不要括号注音）。',
  '8. **不要写 dur**（时长由 TTS 实测决定，你写了也会被覆盖）。',
  '9. **用字限制（硬）**：只能用常用字。**绝对不许写「涮」**——本项目内嵌字体子集里没有这个字，写进画面会变豆腐块、整片会被闸门拦下；火锅的动作请写「烫 / 下锅 / 火锅」。同理别用任何生僻字/异体字。',
  '',
  '【输出格式】只回一个 JSON 对象，不要 markdown 围栏、不要解释：',
  '{ "id":"...", "name":"...", "pack":"paper-editorial", "vertical":"ecommerce", "fps":25,',
  '  "scenes":[ { "structure":"opening-hero", "slots":{...}, "media":[编号], "voice":"口播" }, ... ],',
  '  "rationale":["为什么这么排"] }',
].join('\n')
const payload = [
  { n: 1, desc: '' },
].slice(0, 0) // 占位（保持代码形态简单）
const imgList = descs.map((d, i) => '  ' + (i + 1) + '. ' + d).join('\n')
const prompt = '你是一位竖屏短视频（9:16）分镜师。主题：' + PITCH + '。\n'
  + '可用素材（编号. 画面内容）：\n' + imgList + '\n\n' + rules

console.log('  ② 写分镜（' + writer + '）…')
let film = null
for (let attempt = 1; attempt <= 2 && !film; attempt++) {
  const txt = await chat(writer, [{ role: 'user', content: prompt }], 4000)
  try { film = jsonOf(txt) } catch (e) {
    console.log('    第 ' + attempt + ' 次解析失败：' + String(e.message).slice(0, 140))
    if (attempt === 2) process.exit(1)
  }
}

// ---------- ③ 服务端校验（硬规矩，不靠模型自觉） ----------
const sceneOf = (s) => ({ structure: s.structure, media: (s.media || []).map((n) => media[Number(n) - 1] || String(n)), voice: s.voice })
const used = []
for (const s of film.scenes || []) { sceneOf(s).media.forEach((m) => used.push(m)) }
const uniq = Array.from(new Set(used))
const missFiles = used.filter((m) => !fs.existsSync(m))
const noCard = (film.scenes || []).filter((s) => !(s.media || []).length)
const badStruct = Array.from(new Set((film.scenes || []).map((s) => s.structure).filter((st) => !['opening-hero', 'fullbleed', 'works-wall', 'grid-2x2', 'glass-product'].includes(st))))
const longText = (film.scenes || []).map((s, i) => {
  const v = s.slots || {}
  const n = ['title', 'title1', 'title2', 'sub', 'tail', 'foot', 'eyebrow'].reduce((a, k) => a + String(v[k] || '').length, 0)
    + (Array.isArray(v.rows) ? v.rows.join('').length : 0) + (Array.isArray(v.chips) ? v.chips.join('').length : 0)
  return n > 60 ? ('s' + i + '=' + n + '字') : ''
}).filter(Boolean)
const noVoice = (film.scenes || []).map((s, i) => (String(s.voice || '').trim() ? '' : 's' + i)).filter(Boolean)
const emoji = JSON.stringify(film).match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu)
const chk = []
chk.push(['17 张全用且各一次', used.length === media.length && uniq.length === media.length, used.length + '/' + media.length + '（去重 ' + uniq.length + '）'])
chk.push(['素材文件都存在', missFiles.length === 0, missFiles.length ? missFiles.length + ' 个缺失' : 'ok'])
chk.push(['结构都在白名单', badStruct.length === 0, badStruct.length ? badStruct.join(',') : 'ok'])
chk.push(['独立信息卡 ≤1', noCard.length <= 1, '无图镜 ' + noCard.length + ' 张'])
chk.push(['每镜文案 ≤60 字', longText.length === 0, longText.length ? longText.join(' ') : 'ok'])
chk.push(['每镜都有 voice', noVoice.length === 0, noVoice.length ? noVoice.join(',') : 'ok'])
chk.push(['无 emoji', !emoji, emoji ? String(emoji).slice(0, 40) : 'ok'])
let bad = 0
for (const c of chk) { if (!c[1]) bad++; console.log('  ' + (c[1] ? '✓' : '✗') + ' ' + c[0].padEnd(18) + ' ' + c[2]) }
if (bad) { console.log('  ⚠ 有 ' + bad + ' 条不达标 —— 分镜仍写出（便于你看模型差在哪），但**成片质量可能打折**') }

// ---------- ④ 落盘（film + voice 旁白两份） ----------
// ★VF_FILMGEN_V3：落盘前**必须**把素材编号换成绝对路径（否则渲染器崩，见上面 --fix-media 那段注释）
mapMedia(film)
// ★VF_FILMGEN_V4：换掉字体子集外的字（否则会被"用字闸门"整片拦下）
const stillBadChars = fixFilmChars(film)
film.id = film.id || path.basename(outFile).replace(/\.json$/, '')
film.name = film.name || (PITCH + ' · ' + writer + ' 版')
// ★VF_FILMGEN_V5（2026-10-09 用户反馈「2 个设计完全一样」）：风格包**从命令行给**，
//   这样"两个模型版"可以用不同风格包（视觉上真能看出差别），而不是都挤在同一个 pack 上。
film.pack = arg('pack', film.pack || 'paper-editorial')
film.fps = film.fps || 25
film.generatedBy = { writer, vision, at: new Date().toISOString().slice(0, 19).replace('T', ' ') }
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(film, null, 2) + '\n', 'utf8')
fs.writeFileSync(outFile.replace(/\.json$/, '.voice.json'),
  JSON.stringify({ _note: '★VF_FILMGEN_V1：由 ' + writer + ' 写的口播（逐镜一句，TTS 的输入）', voice: (film.scenes || []).map((s) => String(s.voice || '').trim()) }, null, 2) + '\n', 'utf8')
console.log('  ' + (bad ? '⚠' : '✓') + ' 分镜：' + path.relative(HERE, outFile).replace(/\\/g, '/')
  + '（' + (film.scenes || []).length + ' 镜 · 素材 ' + used.length + ' 张）')
console.log('    旁白：' + path.relative(HERE, outFile.replace(/\.json$/, '.voice.json')).replace(/\\/g, '/'))

// ---------- ⑤ 直接出片（audio-first：TTS 实测时长 + 字幕 + 混音 + 烧字幕） ----------
if (has('render')) {
  console.log('  ③ audio-first 出片（TTS → 实测时长 → 渲染 → 混音烧字幕）…')
  const r = spawnSync(process.execPath, [path.join(DECK, 'tools', 'film-voice.mjs'), outFile],
    { cwd: DECK, encoding: 'utf8', maxBuffer: 1 << 26 })
  process.stdout.write(String(r.stdout || ''))
  if (r.status !== 0) { console.error(String(r.stderr || '').slice(-600)); process.exit(1) }
}
