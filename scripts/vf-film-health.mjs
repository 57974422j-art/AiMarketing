#!/usr/bin/env node
/**
 * ★VF_FILMHEALTH_V1（2026-10-01 team-lead 定案）「片子体检」—— 成片的**硬数字**体检
 *
 * 为什么：老板报的"空色块 / 画面不动 / 字幕断行难看 / 连着两镜同一句大字"，以前全靠**肉眼看**，
 *   说"好点了/还是那样"没法对账。这个脚本把能算的都算成数字，用来做**改前 / 改后**逐项对照。
 *
 * 用法（⚠️ 只读成片与留档；只往 --wd 写帧）：
 *   node scripts/vf-film-health.mjs --v <mp4> [--sb <留档json>] [--wd <临时目录>] [--json]
 *     --v   必填，成片路径
 *     --sb  可选，客户端留档（data/vf-storyboards/vf-*.json，V1 或 V2 都认）：
 *           有它才能给出「镜边界 / 重复大字 / deck 覆盖 / 字幕断口」；没有就跳过并如实写"缺留档"
 *     --wd  可选，抽帧目录，默认 dist-rel/health/<片名>/
 *     --json 只输出结构化 JSON（便于 diff 两次体检），不给就是中文文本报告
 *
 * 铁律：
 *   · **不联网、不烧钱、不依赖 python**（只 ffmpeg/ffprobe + node 自带模块）；
 *   · **退出码恒为 0**（有问题也 0 —— 别让流水线把"体检查出问题"误判成"脚本失败"）；
 *   · 测不准的项目**如实写"测不了/不确定"**，绝不编数字。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'

const ROOT = resolve(process.cwd())

function arg(name, def = '') {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? String(process.argv[i + 1] || '') : def
}
const has = (name) => process.argv.includes('--' + name)
function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
}
/** 与 scripts/vf-local.mjs 同一套探测顺序（换机器别再各写一份） */
function findFfmpeg() {
  const cands = [
    process.env.FFMPEG_PATH,
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg',
  ].filter(Boolean)
  for (const c of cands) if (existsSync(c)) return c
  const w = sh('where', ['ffmpeg'])
  if (w.status === 0) return String(w.stdout).split(/\r?\n/)[0].trim()
  return ''
}
const FFMPEG = findFfmpeg()
const FPROBE = FFMPEG
  ? FFMPEG.replace(/ffmpeg(\.exe)?$/i, (m) => (m.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe'))
  : ''

/* ══════════════ 常量：**唯一来源标注**（渲染层改了必须同步这里）══════════════
 * ① 运动量分箱阈值（**实证**，不是拍脑袋）：
 *    基线片 20261001_004（1280×720 / news / 13 镜 / 56.64s）实测 1130 帧的
 *    tblend 帧间差分 YAVG：min 0.00 / mean 1.12 / max 29.89，其中"完全静止"的帧几乎全是 0.00~0.1，
 *    "镜切换/擦入"那一格能到 8~15 → 取「<0.30 = 静止 / 0.30~1.0 = 轻微 / ≥1.0 = 在动」三档
 *    （阈值取整是为了可复现；换片若分布明显不同，用 --json 里的 yavg 平均值再调）。
 * ② 字幕折行规则：**照抄渲染层** `scripts/video-factory/render.py::wrap_subtitle(txt, limit=16, max_lines=2)`
 *    （每行 ≤16 字、最多 2 行；标点处优先断，否则满 16 字硬断；超出的行以「…」收尾）。
 *    ⚠️ 渲染层改了这个函数 → 本脚本必须同步（否则第⑤项的"断口违规"数会对不上）。
 * ③ 避头尾表：**照抄** `src/lib/agent/vf/anti-ai.ts` 的 ★VF_LINEBREAK_V2（两边逐字一致）。
 */
const MOTION_BIN_SEC = 0.5
const MOTION_STILL = 0.30   // < 静止
const MOTION_MOVING = 1.00  // >= 在动
const STILL_MIN_SEC = 0.8   // 记入"静止段清单"的最短时长
const SUB_WRAP_LIMIT = 16
const SUB_WRAP_MAX_LINES = 2
const SUB_WRAP_PUNCT = '。！？；，、,.!?;:：'
const KIN_TAIL = '的了是和与就都也在把被而或及等这那有无为之其你我他'   // 行尾禁则（anti-ai.ts ★VF_LINEBREAK_V2）
const KIN_HEAD = '。，、！？；：）」』》'                                  // 行首禁则
const KIN_NOPAIR = ['生成']                                              // 成对词不许拆（用户点名）
const KIN_BACK = 4                                                       // 最多回退字数
const ALNUM = /[0-9A-Za-z.%]/
const CN = /[\u4e00-\u9fa5]/

/* ══════════════ ① 规格 ══════════════ */
function probe(file) {
  if (!FPROBE || !existsSync(FPROBE)) return { error: 'ffprobe 不可用' }
  const r = sh(FPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  if (r.status !== 0) return { error: String(r.stderr || '').slice(0, 200) }
  let j = null
  try { j = JSON.parse(r.stdout) } catch (e) { return { error: 'ffprobe 输出无法解析' } }
  const vs = (j.streams || []).find((s) => s.codec_type === 'video') || {}
  const as = (j.streams || []).find((s) => s.codec_type === 'audio') || null
  const fps = (() => {
    const m = String(vs.r_frame_rate || '').match(/^(\d+)\/(\d+)$/)
    return m && Number(m[2]) ? Math.round((Number(m[1]) / Number(m[2])) * 100) / 100 : null
  })()
  return {
    duration: Math.round(Number(j.format?.duration || 0) * 100) / 100,
    sizeMB: Math.round((Number(j.format?.size || 0) / 1048576) * 100) / 100,
    kbps: Math.round(Number(j.format?.bit_rate || 0) / 1000),
    width: vs.width || null, height: vs.height || null, fps,
    vcodec: vs.codec_name || null, acodec: as ? as.codec_name : null,
    nbFrames: vs.nb_frames ? Number(vs.nb_frames) : null,
  }
}

/* ══════════════ ② 运动量时间轴（每 0.5s 一格）══════════════
 * 口径：ffmpeg `tblend=all_mode=difference` 逐帧与前一帧求差 → signalstats 的 YAVG = 该帧画面变化量；
 *       按 0.5s 分箱取平均。比"抽帧算 MD5"稳（能区分"轻微呼吸感"和"完全静止"）。
 */
function motion(file, wd) {
  if (!FFMPEG) return { error: 'ffmpeg 不可用' }
  const r = sh(FFMPEG, ['-v', 'error', '-i', file, '-an',
    '-vf', 'tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=motion.txt',
    '-f', 'null', '-'], { cwd: wd })
  const txtPath = join(wd, 'motion.txt')
  if (!existsSync(txtPath)) return { error: '没产出 motion.txt：' + String(r.stderr || '').slice(0, 160) }
  const rows = []
  let t = 0
  for (const line of readFileSync(txtPath, 'utf8').split(/\r?\n/)) {
    const mt = line.match(/pts_time:([0-9.]+)/)
    if (mt) { t = Number(mt[1]); continue }
    const my = line.match(/YAVG=([0-9.]+)/)
    if (my) rows.push({ t, y: Number(my[1]) })
  }
  if (!rows.length) return { error: 'motion.txt 里没有 YAVG 行' }
  const bins = []
  for (const r0 of rows) {
    const b = Math.floor(r0.t / MOTION_BIN_SEC)
    if (!bins[b]) bins[b] = { i: b, t: b * MOTION_BIN_SEC, sum: 0, n: 0 }
    bins[b].sum += r0.y; bins[b].n++
  }
  const out = bins.filter(Boolean).map((b) => ({ t: b.t, avg: b.sum / Math.max(1, b.n) }))
  const ys = rows.map((x) => x.y)
  // ★ 帧级口径（与"逐帧 < 阈值"手量同口径）：对账用 —— 分箱平均会把"半格静止"也算进来，两口径必然有差
  const dt = rows.length > 1 ? (rows[rows.length - 1].t - rows[0].t) / (rows.length - 1) : 1 / 25
  const frameRuns = []
  let fs = null, fp = null
  for (const r0 of rows) {
    if (r0.y < MOTION_STILL) { if (fs === null) fs = r0.t; fp = r0.t }
    else if (fs !== null) { frameRuns.push({ start: fs, end: fp + dt }); fs = null }
  }
  if (fs !== null) frameRuns.push({ start: fs, end: fp + dt })
  const frameSegs = frameRuns
    .map((s) => ({ start: Math.round(s.start * 100) / 100, end: Math.round(s.end * 100) / 100, sec: Math.round((s.end - s.start) * 100) / 100 }))
    .filter((s) => s.sec >= STILL_MIN_SEC)
  return {
    frames: rows.length,
    span: Math.round(rows[rows.length - 1].t * 100) / 100,
    stats: {
      min: Math.round(Math.min(...ys) * 100) / 100,
      max: Math.round(Math.max(...ys) * 100) / 100,
      mean: Math.round((ys.reduce((a, x) => a + x, 0) / ys.length) * 100) / 100,
    },
    bins: out,
    frameStillSegments: frameSegs,
    frameStillTotalSec: Math.round(frameSegs.reduce((a, s) => a + s.sec, 0) * 100) / 100,
  }
}
const binChar = (v) => (v < MOTION_STILL ? '.' : v < MOTION_MOVING ? '+' : '#')

/** ③ 静止段（连续 < MOTION_STILL 的格；≥ STILL_MIN_SEC 才记） */
function stillSegments(bins) {
  const segs = []
  let start = null, prev = null
  for (const b of bins) {
    if (b.avg < MOTION_STILL) { if (start === null) start = b.t; prev = b.t }
    else if (start !== null) { segs.push({ a: start, b: prev + MOTION_BIN_SEC }); start = null }
  }
  if (start !== null) segs.push({ a: start, b: prev + MOTION_BIN_SEC })
  return segs
    .map((s) => ({ start: Math.round(s.a * 100) / 100, end: Math.round(s.b * 100) / 100, sec: Math.round((s.b - s.a) * 100) / 100 }))
    .filter((s) => s.sec >= STILL_MIN_SEC)
}

/* ══════════════ 留档读取（V1 / V2 都认）══════════════ */
function readSb(p) {
  if (!p) return null
  if (!existsSync(p)) return { error: '留档不存在: ' + p }
  let j = null
  try { j = JSON.parse(readFileSync(p, 'utf8')) } catch (e) { return { error: '留档不是合法 JSON' } }
  const plan = j && j.plan && typeof j.plan === 'object' ? j.plan : null
  const shots = (plan && Array.isArray(plan.shots) && plan.shots)
    || (Array.isArray(j?.shotsNorm) && j.shotsNorm)
    || (Array.isArray(j?.shots) && j.shots)
    || []
  return {
    version: Number(j?.version || (plan ? 2 : 1)),
    path: p,
    shots,
    theme: j?.planRoot?.theme ?? j?.theme ?? null,
    deckStyle: plan?.deck_style ?? j?.planRoot?.deck_style ?? null,
    banner: plan?.banner ?? j?.planRoot?.banner ?? null,
    hasVariant: shots.some((s) => s && (s.variant !== undefined && s.variant !== null)),
  }
}

/** ④ 镜边界：留档 dur 累加（近似；tts 会按真实配音回填 dur，所以只当近似） */
function shotTable(shots) {
  let acc = 0
  return shots.map((s, i) => {
    const dur = Number(s?.dur) || 0
    const row = { n: i + 1, start: Math.round(acc * 100) / 100, end: Math.round((acc + dur) * 100) / 100, dur, text: String(s?.text || s?.title || '') }
    acc += dur
    return row
  })
}
const shotAt = (table, t) => (table.find((s) => t >= s.start && t < s.end) || {}).n || null

/** ③ 交叉验证：silencedetect（配音停顿）vs dur 累加边界 */
function silencePauses(file) {
  if (!FFMPEG) return []
  const r = sh(FFMPEG, ['-v', 'info', '-i', file, '-af', 'silencedetect=noise=-32dB:d=0.18', '-f', 'null', '-'])
  const out = []
  for (const line of String(r.stderr || '').split(/\r?\n/)) {
    const m = line.match(/silence_start:\s*([0-9.]+)/)
    if (m) out.push({ start: Number(m[1]), dur: null })
    const d = line.match(/silence_duration:\s*([0-9.]+)/)
    if (d && out.length) out[out.length - 1].dur = Number(d[1])
  }
  return out.map((p) => ({ start: Math.round(p.start * 100) / 100, dur: p.dur, mid: Math.round((p.start + (Number(p.dur) || 0) / 2) * 100) / 100 }))
}

/* ══════════════ ④ 重复大字 / deck 覆盖（纯数据）══════════════ */
function dupGroups(shots) {
  const groups = []
  for (let i = 1; i < shots.length; i++) {
    const cur = String(shots[i]?.text || shots[i]?.title || '').trim()
    const prev = String(shots[i - 1]?.text || shots[i - 1]?.title || '').trim()
    if (!cur || !prev || cur !== prev) continue
    const last = groups[groups.length - 1]
    if (last && last.to === i) { last.to = i + 1; last.n = i + 1 - last.from + 1 }
    else groups.push({ from: i, to: i + 1, n: 2, text: cur })
  }
  return groups
}
function deckStats(shots) {
  const variants = shots.map((s, i) => ({ n: i + 1, variant: (s && s.variant) || null }))
  const deckIdx = variants.filter((v) => typeof v.variant === 'string' && v.variant.startsWith('deck')).map((v) => v.n)
  // 连续 3 镜都用 deck（按镜号连续性判；口径见 ★VF_DECK_STYLES_V1「不要连续 3 镜都用 deck」）
  const dset = new Set(deckIdx)
  const triples = []
  for (let n = 1; n <= shots.length - 2; n++) if (dset.has(n) && dset.has(n + 1) && dset.has(n + 2)) triples.push(n + '-' + (n + 2))
  return { variants, deckIdx, deckCount: deckIdx.length, deckTriples: triples }
}

/* ══════════════ ⑤ 字幕断口体检（纯逻辑，不靠 OCR）══════════════
 * 把 render.py 现有折行规则**照抄**成 JS（见头部常量注释），逐镜模拟断口，
 * 再按 anti-ai.ts 的 ★VF_LINEBREAK_V2 判每个断口是否"避头尾"。
 */
function simWrapRows(txt) {
  const s = String(txt || '').trim()
  if (!s) return []
  if (s.length <= SUB_WRAP_LIMIT) return [s]
  const chars = Array.from(s)
  const lines = []
  let cur = ''
  for (const ch of chars) {
    cur += ch
    if (SUB_WRAP_PUNCT.includes(ch) && cur.length >= SUB_WRAP_LIMIT * 0.5) {
      lines.push(cur); cur = ''
      if (lines.length >= SUB_WRAP_MAX_LINES) break
    } else if (cur.length >= SUB_WRAP_LIMIT) {
      lines.push(cur); cur = ''
      if (lines.length >= SUB_WRAP_MAX_LINES) break
    }
  }
  if (cur) lines.push(cur)
  const rows = lines.slice(0, SUB_WRAP_MAX_LINES)
  const shown = rows.reduce((a, x) => a + x.length, 0)
  if (rows.length && shown < s.length) {
    const tail = rows[rows.length - 1]
    rows[rows.length - 1] = (tail.length >= SUB_WRAP_LIMIT ? tail.slice(0, -1) : tail) + '…'
  }
  return rows
}
function kinHit(a, b, s, pos) {
  const why = []
  if (KIN_TAIL.includes(a)) why.push('行尾是虚词「' + a + '」')
  if (KIN_HEAD.includes(b)) why.push('行首是收尾标点「' + b + '」')
  if (ALNUM.test(a) && ALNUM.test(b)) why.push('切进数字/字母（' + a + '|' + b + '）')
  if (ALNUM.test(a) && CN.test(b)) why.push('切进数字+单位（' + a + '|' + b + '）')
  for (const p of KIN_NOPAIR) {
    const L = p.length
    if (L >= 2 && pos - L + 1 >= 0 && s.slice(pos - L + 1, pos + 1) === p) why.push('拆开成对词「' + p + '」')
  }
  return why
}
/** 断口回退建议（只回退 ≤KIN_BACK，与 anti-ai.ts 同口径） */
function suggestBack(s, pos) {
  for (let k = 1; k <= KIN_BACK; k++) {
    const e = pos - k
    if (e <= 0 || e >= s.length) continue
    if (kinHit(s[e - 1], s[e], s, e).length === 0) {
      return { back: k, line1Tail: s.slice(Math.max(0, e - 6), e), line2Head: s.slice(e, e + 6) }
    }
  }
  return null
}
/** ⚠️ 旧口径：**纯 16 字硬排**（标点不优先）—— 基线片 20261001_004 成片就是这版渲的
 *  （截图里第一行正好 16 字、断在「…一键生|成…」），所以它必须一起报，才能对得上"改前"的底账。 */
function simWrapRowsLegacy(txt) {
  const s = String(txt || '').trim()
  if (!s) return []
  if (s.length <= SUB_WRAP_LIMIT) return [s]
  const out = []
  for (let i = 0; i < s.length; i += SUB_WRAP_LIMIT) out.push(s.slice(i, i + SUB_WRAP_LIMIT))
  return out.slice(0, SUB_WRAP_MAX_LINES)
}
/** 单镜：按给定 rows 判断口（断口 = 第一行长度）→ 违规清单 */
function checkOne(s, rows) {
  if (!rows || rows.length < 2) return []
  const pos = rows[0].replace(/…$/, '').length
  if (pos <= 0 || pos >= s.length) return []
  const a = s[pos - 1], b = s[pos]
  const why = kinHit(a, b, s, pos)
  if (!why.length) return []
  return [{ pos, pair: String(a) + '|' + String(b), why, before: s.slice(Math.max(0, pos - 8), pos) + '¦' + s.slice(pos, pos + 8), suggest: suggestBack(s, pos) }]
}
function subtitleChecks(shots) {
  const res = { current: { issues: [], truncated: [] }, legacy: { issues: [], truncated: [] } }
  shots.forEach((sh, i) => {
    const s = String(sh?.subtitle || '').trim()
    if (!s) return
    const variants = [['current', simWrapRows(s)], ['legacy', simWrapRowsLegacy(s)]]
    for (const [key, rows] of variants) {
      for (const x of checkOne(s, rows)) { x.n = i + 1; res[key].issues.push(x) }
      const shown = rows.join('').replace(/…$/, '').length
      if (shown < s.length) res[key].truncated.push({ n: i + 1, shown, total: s.length })
    }
  })
  return res
}

/* ══════════════ ⑥ 顶部条带（给人看的图 + 一条"仅供参考"的启发式）══════════════
 * ⚠️ 诚实说明：**"顶部有没有固定标题空色块"自动测不可靠**（要看图）→ 这里只做两件事：
 *   a) 每镜抽 1 帧、裁顶部 220px 出图（人来看）；
 *   b) 一个**简单启发式**：量"第 1 行下方那条窄带"（y≈7.5%~11.5%H）的最亮值 YMAX，
 *      YMAX 很暗（<60）= 那条带里没有可见文字（可能就是渲染层画的空底衬框）→ 标"疑似"。
 *      它区分不了"空色块"和"画面本来就黑"（基线片里 t=6.5s 就是后者）→ **仅供参考**。
 */
function topStrips(file, wd, table, W, H) {
  const out = []
  const bh = Math.max(4, Math.round(H * 0.03))
  const bandYs = [0.055, 0.075, 0.095].map((r) => Math.round(H * r))   // 第 1 行下方那几条窄带
  for (const row of table) {
    const t = Math.round(((row.start + row.end) / 2) * 100) / 100
    const png = join(wd, `shot${String(row.n).padStart(2, '0')}_t${String(t).replace('.', '_')}_top.png`)
    sh(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
      '-vf', `crop=${W}:220:0:0,scale=${Math.round(W * 1.5)}:330`, '-y', png], { cwd: wd })
    // 逐窄带量"最亮值 YMAX"：某条带最亮都很暗 = 那条带里没有可见文字（可能就是渲染层画的空底衬框）
    let darkest = null
    for (let i = 0; i < bandYs.length; i++) {
      const statFile = `band${String(row.n).padStart(2, '0')}_${i}.txt`
      sh(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
        '-vf', `crop=${W}:${bh}:0:${bandYs[i]},signalstats,metadata=print:file=${statFile}`, '-f', 'null', '-'], { cwd: wd })
      const sp = join(wd, statFile)
      if (!existsSync(sp)) continue
      const txt = readFileSync(sp, 'utf8')
      const m1 = txt.match(/YMAX=([0-9.]+)/), m2 = txt.match(/YAVG=([0-9.]+)/)
      const ymax = m1 ? Number(m1[1]) : null
      if (ymax === null) continue
      if (darkest === null || ymax < darkest.bandYMAX) darkest = { y: bandYs[i], h: bh, bandYMAX: ymax, bandYAVG: m2 ? Number(m2[1]) : null }
    }
    out.push({
      n: row.n, t, png,
      darkestBand: darkest,
      guessDarkBlock: darkest ? darkest.bandYMAX < 60 : null,
    })
  }
  return out
}

/* ══════════════ 主流程 ══════════════ */
const V = arg('v')
const SB = arg('sb')
const asJson = has('json')
const result = { tool: 'VF_FILMHEALTH_V1', video: V, sb: SB || null, ok: true, notices: [] }

if (!V || !existsSync(V)) {
  console.log('❌ 片子体检：--v 指向的成片不存在（' + (V || '(未给)') + '）')
  process.exit(0)   // ★ 退出码恒 0
}
const wd = resolve(arg('wd') || join(ROOT, 'dist-rel', 'health', basename(V).replace(/\.[^.]+$/, '')))
try { mkdirSync(wd, { recursive: true }) } catch (e) { result.notices.push('建目录失败: ' + e.message) }
result.workDir = wd

const spec = probe(V)
result.spec = spec
if (spec.error) result.notices.push('规格探测失败：' + spec.error)

const mv = motion(V, wd)
result.motion = mv
let bins = [], segs = [], timeline = ''
if (!mv.error) {
  bins = mv.bins
  timeline = bins.map((b) => binChar(b.avg)).join('')
  segs = stillSegments(bins)
  const stillSum = Math.round(segs.reduce((a, s) => a + s.sec, 0) * 100) / 100
  result.motion.timeline = timeline
  result.motion.stillSegments = segs
  result.motion.stillTotalSec = stillSum
  result.motion.stillRatio = spec.duration ? Math.round((stillSum / spec.duration) * 1000) / 10 : null
} else {
  result.notices.push('运动量测不了：' + mv.error)
}

const sb = readSb(SB)
result.dump = sb ? {
  version: sb.version, path: sb.path, shots: sb.shots ? sb.shots.length : 0,
  theme: sb.theme, deckStyle: sb.deckStyle, banner: sb.banner, hasVariant: !!sb.hasVariant,
  error: sb.error || null,
} : null
if (sb && sb.error) result.notices.push('留档没读到：' + sb.error)

let table = [], dup = [], deck = null, sub = null, strips = [], pauses = [], cuts = [], crossCheck = null
if (sb && Array.isArray(sb.shots) && sb.shots.length) {
  table = shotTable(sb.shots)
  for (const s of segs) s.shot = shotAt(table, (s.start + s.end) / 2)
  result.shotTable = table
  dup = dupGroups(sb.shots)
  result.dupBigText = dup
  deck = deckStats(sb.shots)
  result.deck = deck
  sub = subtitleChecks(sb.shots)
  result.subtitle = sub
  if (spec.width && spec.height) {
    strips = topStrips(V, wd, table, spec.width, spec.height)
    result.topStrips = strips
  }
  pauses = silencePauses(V)
  cuts = table.slice(1).map((s) => s.start)
  // 交叉验证：每个"留档 dur 累加边界"附近 ±1.5s 内有没有配音停顿（有 = 两个口径互证）
  let matched = 0, maxDev = 0
  const unmatched = []
  for (const c of cuts) {
    let best = Infinity
    for (const p of pauses) best = Math.min(best, Math.abs(p.mid - c))
    if (best <= 1.5) { matched++; maxDev = Math.max(maxDev, best) } else unmatched.push(c)
  }
  crossCheck = {
    definedCuts: cuts.length,
    pauses: pauses.length,
    matchedByPause: matched,
    unmatchedCount: unmatched.length,
    unmatchedAt: unmatched,
    maxDeviationMatchedSec: matched ? Math.round(maxDev * 100) / 100 : null,
  }
  result.silencePauses = pauses
  result.crossCheck = crossCheck
  if (unmatched.length) {
    result.notices.push(`镜边界是"留档 dur 累加"的**近似**（不是从画面检测的）：${unmatched.length} 个边界附近 ±1.5s 内没有配音停顿 → 两个口径的数字都列在报告里`)
  }
} else {
  result.notices.push('没有留档（--sb）→ 第③④⑤⑥项（镜边界/重复大字/deck/断口/顶部条带）跳过')
}

/* ── 输出 ── */
if (asJson) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

const L = []
L.push(`═══ 片子体检 · ${basename(V)} ═══`)
if (spec.error) L.push('① 规格：❌ ' + spec.error)
else L.push(`① 规格：${spec.duration}s / ${spec.width}×${spec.height} / ${spec.fps}fps / ${spec.kbps}kbps / ${spec.sizeMB}MB / 画面 ${spec.vcodec}${spec.acodec ? ' + 音轨 ' + spec.acodec : '（无音轨）'}`)
if (!mv.error) {
  L.push(`② 运动量（${MOTION_BIN_SEC}s/格，${bins.length} 格；图例 # ≥${MOTION_MOVING} 在动 / + ${MOTION_STILL}~${MOTION_MOVING} 轻微 / . <${MOTION_STILL} 静止；阈值实证见脚本注释）`)
  L.push('   ' + timeline)
  L.push(`   静止段（≥${STILL_MIN_SEC}s）**分箱口径** ${result.motion.stillTotalSec}s = ${result.motion.stillRatio}%（${segs.length} 段；图例就是按它画的）`)
  L.push(`   　　　　　　　　**帧级口径** ${mv.frameStillTotalSec}s = ${spec.duration ? Math.round((mv.frameStillTotalSec / spec.duration) * 1000) / 10 : '?'}%（${mv.frameStillSegments.length} 段）——与"逐帧 <${MOTION_STILL}"的手量同口径，两者之差 = 分箱平均的量化误差`)
  segs.slice(0, 6).forEach((s) => L.push(`   · ${s.start}–${s.end}s（${s.sec}s）${s.shot ? ' → 镜' + s.shot : ''}`))
  if (segs.length > 6) L.push(`   · …另 ${segs.length - 6} 段（见 --json）`)
  L.push(`   YAVG 原始分布：min ${mv.stats.min} / mean ${mv.stats.mean} / max ${mv.stats.max}（${mv.frames} 帧）`)
} else L.push('② 运动量：❌ ' + mv.error)
if (sb && !sb.error && table.length) {
  const tot = table[table.length - 1].end
  L.push(`③ 镜边界（**近似**：留档 dur 累加，非画面检测）：${table.length} 镜、dur 合计 ${tot}s${spec.duration ? `（实际 ${spec.duration}s，差 ${Math.round((spec.duration - tot) * 100) / 100}s）` : ''}；配音停顿 ${pauses.length} 处 → ${crossCheck.matchedByPause}/${crossCheck.definedCuts} 个累加边界 ±1.5s 内有停顿（最大偏差 ${crossCheck.maxDeviationMatchedSec}s）${crossCheck.unmatchedCount ? `，${crossCheck.unmatchedCount} 个边界附近没停顿` : ''}`)
  if (crossCheck.unmatchedCount && pauses.length) {
    L.push(`   两个口径都列（不硬凑）：dur累加边界 ${cuts.slice(0, 6).map((x) => x + 's').join('/')}${cuts.length > 6 ? ' …' : ''}｜停顿中点 ${pauses.slice(0, 6).map((p) => p.mid + 's').join('/')}${pauses.length > 6 ? ' …' : ''}`)
  }
  // ⚠️ 镜号口径：dup.from / dup.to 已经是 **1-based 镜号**（from = 组内第一镜，to = 组内最后一镜）
  L.push(`④ 重复大字（相邻镜同 text/title）：${dup.length} 组` + (dup.length ? '：' + dup.map((g) => `镜 ${g.from}–${g.to}（${g.n} 镜）同「${g.text}」`).join('；') : '（无）'))
  L.push(`   deck：${deck && sb.hasVariant ? `deck 系 ${deck.deckCount} 镜（镜 ${deck.deckIdx.join('/') || '无'}）；连续 3 镜都用 deck：${deck.deckTriples.length ? deck.deckTriples.join('、') : '无'}` : '留档里**没有 variant 字段**（V1 留档/旧客户端）→ deck 覆盖测不了'}`)
  const line = (it) => `   · 镜${it.n} 断在「${it.before}」（${it.pair}）：${it.why.join('；')}${it.suggest ? ` → 避头尾回退 ${it.suggest.back} 字（${it.suggest.line1Tail}¦${it.suggest.line2Head}）` : ' → 回退窗口内无合法点，保持原样'}`
  L.push(`⑤ 字幕断口（模拟折行；规则照抄 render.py::wrap_subtitle，≤${SUB_WRAP_LIMIT} 字/行、≤${SUB_WRAP_MAX_LINES} 行）：`)
  L.push(`   · **旧口径**（纯 16 字硬排、标点不优先 = 基线片当时那版）违规 ${sub.legacy.issues.length} 处${sub.legacy.truncated.length ? `；${sub.legacy.truncated.length} 镜被截断` : '；无截断'}`)
  sub.legacy.issues.slice(0, 3).forEach((it) => L.push(line(it)))
  if (sub.legacy.issues.length > 3) L.push(`     …另 ${sub.legacy.issues.length - 3} 处（见 --json）`)
  L.push(`   · **现行口径**（标点优先 + 只 2 行 + 「…」收尾）违规 ${sub.current.issues.length} 处；**${sub.current.truncated.length} 镜字幕被「…」截断**（现行规则下"截断"比"断口"更严重）`)
  sub.current.issues.slice(0, 3).forEach((it) => L.push(line(it)))
  if (sub.current.issues.length > 3) L.push(`     …另 ${sub.current.issues.length - 3} 处（见 --json）`)
  L.push(`⑥ 顶部条带：${strips.length} 张 → ${wd}`)
  const guess = strips.filter((s) => s.guessDarkBlock).map((s) => s.n)
  L.push(`   启发式（**仅供参考，不能替代看图**）：第 1 行下方窄带最亮值 YMAX<60 → 疑似"深色实心无字"：${guess.length ? '镜 ' + guess.join('/') : '无'}`)
  L.push(`   ⚠️ **它测不准**：深色背景会被误报（假阳），带内混入白卡片/亮素材会漏报（假阴）→ "有没有空色块"一律**看图下结论**`)
} else if (sb && sb.error) L.push('③④⑤⑥ 留档不可用：' + sb.error)
else L.push('③④⑤⑥ 未给 --sb（留档）→ 跳过')
if (result.notices.length) {
  L.push('ⓘ 说明/测不准：')
  result.notices.forEach((n) => L.push('   · ' + n))
}
console.log(L.slice(0, 40).join('\n'))
process.exit(0)
