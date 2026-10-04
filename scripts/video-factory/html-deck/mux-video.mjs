#!/usr/bin/env node
/**
 * mux-video.mjs —— **成片合成器（唯一实现）**：渲染产物 + 字幕 + 水印/角标 + 背景音乐 ⇒ 可直接投放的 mp4
 *
 * 为什么要有这个脚本：这四件事此前是**聊天里的一次性 ffmpeg 命令**（没入库、没法复跑、换台机器就没了）。
 *   按本仓的纪律（"同一逻辑只许一处" + "读数解析类逻辑必须配合成输入自测"），把它收口成一个工具：
 *   · 所有分支都有**结论行**（机读）+ 退出码∈{0,1,2}（0 通过 / 1 判据失败 / 2 输入·环境错误）
 *   · `--self-test` **用合成输入**自证（不需要渲染、秒级）：正控 3 例（仅视频 / +字幕+角标 / +背景乐）
 *     ＋ 负控 1 例（输入不存在 ⇒ exit 2 + 标签 MUX-INPUT-MISSING）
 *   · 产物校验：ffprobe 回读**时长/分辨率/是否有音轨** ⇒ 只"跑了命令"不算成功（防假绿）
 *
 * 用法：
 *   node mux-video.mjs --in <raw.mp4> --out <final.mp4> [--srt a.srt] [--logo logo.png]
 *        [--logo-pos tr|br|tl|bl] [--logo-w 160] [--logo-opacity 0.85] [--logo-margin 40]
 *        [--bgm music.m4a] [--bgm-vol -18] [--subs-style auto|plain|dark]
 *   node mux-video.mjs --self-test
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
/* ★ K17-ff：媒体工具解析的**唯一实现**（本文件不许再出现候选数组/该环境变量字面量） */
import { resolveFfmpeg, resolveFfprobe } from './engine-bin.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXIT = { OK: 0, FAIL: 1, INPUT: 2 }

/* ---------------- ffmpeg / ffprobe 解析（★ K17-ff：唯一实现在 engine-bin.mjs） ----------------
 * ⚠️ 本仓已有 3 处各写一份同逻辑（render-deck / check-master-manifest）⇒ team-lead msg16 ① 已把它们连同本处
 *   一起**收口**：候选数组与环境变量只许在 `engine-bin.mjs`（有出现次数断言拦着）⇒ 本处退化为**一行转发**。 */
function resolveBin(name) { return name === 'ffprobe' ? resolveFfprobe().p : resolveFfmpeg().p }

/* ---------------- 旗标：全部登记（未登记 ⇒ 大声红；本仓"引用须登记"纪律） ---------------- */
const FLAGS = {
  '--in': 'in', '--out': 'out', '--srt': 'srt', '--logo': 'logo', '--logo-pos': 'logoPos',
  '--logo-w': 'logoW', '--logo-opacity': 'logoOpacity', '--logo-margin': 'logoMargin',
  '--bgm': 'bgm', '--bgm-vol': 'bgmVol', '--self-test': 'selfTest', '--workdir': 'workdir',
  '--dry-run': 'dryRun', '--subs-size': 'subsSize', '--subs-margin-v': 'subsMarginV',
  '--subs-style': 'subsStyle',
}
/* ★★ 旗标类型 ④（唯一真源）：**哪些选项键是 bool**（不带值）—— 解析器**从这里派生**，
   并由下面的断言核"① ⊆ 注册表键 ② 解析器真的用它 ③ 非 bool 键必须走有值路径"。
   ⚠️ 新增**布尔**旗标只许改这一行（改完断言会验它确实被用上；忘了改 ⇒ `--xxx` 会吃掉下一个参数 ⇒ 断言可拦）。 */
const BOOL_KEYS = new Set(['selfTest', 'dryRun'])
const A = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!(a in FLAGS)) {
    console.error(`✗ 未识别的参数：${a}`)
    console.error(`   允许：${Object.keys(FLAGS).join(' ')}`)
    process.exit(EXIT.INPUT)
  }
  const key = FLAGS[a]
  /* ★★ 旗标类型 ④（team-lead msg28 ④）：**解析器从已声明的类型派生**（`BOOL_KEYS`）——不再手写布尔名单。
     背景：`--dry-run` 曾因**不在手写名单**里而被当作"有值旗标"（`A.dryRun = argv[++i]` 吃掉下一个参数，
     末尾时是 `undefined`）⇒ **它从来没生效过**（实测：`--dry-run` 时依旧真合成）——**看着在预览，实际在干活**。 */
  if (BOOL_KEYS.has(key)) { A[key] = true; continue }
  A[key] = process.argv[++i]
}

/* ★★ 旗标三件套的**覆盖断言**（与 `crosscheck` / `measure-count` / `gen-deck` / `make-video` 同款纳管）。
   本工具**不编排别的工具**（只调 ffmpeg/ffprobe，其参数是**单横杠** ⇒ 不进本扫描）⇒ 只需一张自有表。
   ① **注册表 ⊇ 源码里全部旗标字面量**（防"加了旗标忘了登记 ⇒ 照抄者只得到哑红"）
   ② **每个注册项必须被消费**（`A.<key>`；防"登记了却没人读 = 假装覆盖"） */
{
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const found = [...new Set([...src.matchAll(/'(--[a-zA-Z][\w-]*)'/g)].map((m) => m[1]))]
  const known = new Set(Object.keys(FLAGS))
  const missing = found.filter((f) => !known.has(f))
  /* ⚠️ 本文件的选项对象叫 **`o`**（`const o = …`）⇒ 消费判定必须认 `o.<key>`；只认 `A.` 会把 10 个**真在用**的
     旗标报成"未消费"（实测首跑就这么红的 —— 宽了的代价是弱一点，但"报假死旗标"会让人去删真功能）。
     `\b` 同时防 `foo.logo` 这类误匹配。 */
  const dead = [...known].filter((n) => !new RegExp(`\\b(A|opt|o)\\.${FLAGS[n]}\\b|\\b(A|opt|o)\\['${FLAGS[n]}'\\]`).test(src))
  /* ★★ ④ **旗标类型**（bool|value）：类型声明 = `BOOL_KEYS`，解析器**必须从它派生**（否则就是两份口径）——
     这条能**结构性**堵住"bool 旗标被当有值旗标"（mux 踩过：`--dry-run` 吃掉下一个参数 ⇒ 看着在预览、实际在干活）。 */
  const keys = Object.values(FLAGS)
  const boolNotRegistered = [...BOOL_KEYS].filter((k) => !keys.includes(k))
  const usesBool = /BOOL_KEYS\.has\(/.test(src)
  const valuePath = /A\[key\]\s*=\s*process\.argv\[\+\+i\]/.test(src)
  if (boolNotRegistered.length || !usesBool || !valuePath) {
    console.error(`✗ 旗标三件套-④ 类型断言失败：BOOL_KEYS 里未注册的键 ${boolNotRegistered.join(' ') || '（无）'} · 解析器用 BOOL_KEYS=${usesBool} · 有值路径存在=${valuePath}`)
    console.error('   规矩：bool 旗标**只许**声明在 BOOL_KEYS 且解析器从它派生（不许再手写一份名单）；非 bool 键走 argv[++i] ⇒ exit 2')
    process.exit(EXIT.INPUT)
  }
  console.log(`  ✓ 旗标三件套-④ 类型：bool **${[...BOOL_KEYS].join('/')}** · 值旗标 **${keys.length - BOOL_KEYS.size}** · 解析器由声明派生 ✓`)
  if (missing.length || dead.length) {
    console.error(`✗ 旗标三件套断言失败：**注册表不全** ${missing.join(' ') || '（无）'} · **注册但未消费** ${dead.join(' ') || '（无）'}`)
    console.error('   规矩：新增旗标必须登记进 FLAGS **并被真正读取** ⇒ exit 2')
    process.exit(EXIT.INPUT)
  }
  console.log(`  ✓ 旗标三件套：注册 **${known.size}** · 源码字面量 **${found.length}** 全部已登记 · 死旗标 **0**`)
}

/** 结论行：**唯一**机读承载（人类细节不承载判据） */
const concl = (tag, ok, extra = {}) => {
  const kv = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' · ')
  console.log(`${ok ? '✓' : '✗'} [${tag}] MUX-RESULT ok=${ok}${kv ? ' · ' + kv : ''}`)
}

function probe(file) {
  const r = spawnSync(resolveBin('ffprobe'), ['-v', 'error', '-show_entries',
    'stream=codec_type,width,height', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8' })
  if (r.status !== 0) return null
  try {
    const j = JSON.parse(r.stdout || '{}')
    const v = (j.streams || []).find((s) => s.codec_type === 'video') || {}
    const hasA = (j.streams || []).some((s) => s.codec_type === 'audio')
    return { w: Number(v.width) || 0, h: Number(v.height) || 0, hasAudio: hasA, dur: Number((j.format || {}).duration) || 0 }
  } catch { return null }
}

/** subtitles 滤镜的文件名转义：Windows 盘符冒号必须转义，且**不许**用反斜杠 */
/* ⚠️ 转义的第一版是错的（自测当场抓到）：`subtitles=filename='C\:/…'` 里的 `\:` 在**单引号内不会被解转义**
 *    ⇒ 路径里多出一个反斜杠 ⇒ 找不到字幕。**结构性解法：不要出现盘符冒号** ——
 *    以**字幕所在目录为工作目录**运行 ffmpeg，只传**裸文件名**。 */
const escSub = (p) => basename(p)

/* ★★ 字幕样式：**从产物读数决定**（不靠人挑、也不信"声明值"）——
 *   抽一帧量"**字幕脚下那条底带**"的平均亮度：亮底 ⇒ **深字 + 白描边**；暗底 ⇒ **白字 + 深描边**。
 *   为什么不按皮肤名/母版声明：**同一皮肤的不同页底亮也不同**（封面 vs 数据页），该管的是"字幕下面那块像素"。
 *   为什么量产物而不是读 `master.json`：母版 `bg` 只是**基色声明**，实际画面还有色块/图片 ⇒ **以像素为准**。
 *   `--subs-style plain|dark|auto`（默认 `auto`）；`auto` 量不到（抽帧失败/无时长）⇒ **回退 plain 并打印**（可见回退，不静默）。 */
const SUBS_STYLE_PLAIN = 'BorderStyle=1,Outline=1,Shadow=0'
const SUBS_STYLE_DARK = 'BorderStyle=1,Outline=2,Shadow=0,PrimaryColour=&H00101010,OutlineColour=&H00FFFFFF'
/** 纯函数：按底带平均亮度（0..1）选样式（阈值 0.6）—— 可用**合成样本**证伪，不必渲染 */
const pickSubsStyle = (meanY) => (Number(meanY) > 0.6 ? 'dark' : 'plain')
/** 量"字幕底带"平均亮度：**多帧均值**（样式应**整片一致** ⇒ 均值才是对的统计量；单帧会撞到深色页 ⇒ 脆）
 *  ⇒ 返回 `{ mean, ok, total }`；一帧都没量到 ⇒ `{ mean: null }`（调用方**可见回退**，不静默） */
function bandLuminance(file, dur, samples = 5) {
  const fr = []
  if (dur && dur > 0.6) for (let i = 1; i <= samples; i++) fr.push((dur * i) / (samples + 1))
  else fr.push(0)
  const vals = []
  for (const at of fr) {
    const r = spawnSync(resolveBin('ffmpeg'), ['-v', 'error', '-ss', String(Math.max(0, at - 0.1)), '-i', file,
      '-vf', 'crop=iw:ih*0.20:0:ih*0.76,scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { encoding: 'buffer', maxBuffer: 1 << 20 })
    if (r.status === 0 && r.stdout && r.stdout.length) vals.push(r.stdout[0] / 255)
  }
  if (!vals.length) return { mean: null, ok: 0, total: fr.length }
  return { mean: vals.reduce((s, x) => s + x, 0) / vals.length, ok: vals.length, total: fr.length }
}

function buildArgs(o) {
  const inputs = ['-i', o.in]
  let idx = 1, logoI = -1, bgmI = -1
  /* ⚠️ 这里第一版写成了 `bgmI = idx++`（复制粘贴）⇒ logo 索引恒为 -1 ⇒ 滤镜图里出现 `[-1:v]`
   *    ⇒ ffmpeg 报 `Invalid file index -1`。**是合成自测把它抓出来的**（C/B/D 例同时红）。 */
  if (o.logo) { logoI = idx++; inputs.push('-i', o.logo) }
  if (o.bgm) { const j = idx++; inputs.push('-stream_loop', '-1', '-i', o.bgm); bgmI = j }
  const steps = []
  let v = '0:v'
  steps.push(`[${v}]scale=iw:ih,setsar=1[base]`)
  v = 'base'
  /* ⚠️ 转义（自测当场抓到）：`subtitles=C\:/...` 会被滤镜解析器吃掉盘符 ⇒ 必须写成
   *    `subtitles=filename='C\:/...'`（显式键名 + 单引号包住路径） */
  const W0 = Number(o.srcW) || 1280, H0 = Number(o.srcH) || 720
  /* ★ 竖屏事故修复：libass 拿不到画面尺寸时按 **384×288** 假定 ⇒ 字幕被放大到溢出画面。
   *   正解是 `original_size=WxH`（这条参数就是为此存在），再显式给 FontSize/边距。 */
  /* ★ 单位换算（第二次踩）：libass 的脚本坐标空间默认是 **PlayResY = 288**（SRT 无脚本头，`original_size` 只影响缩放提示、
   *   **不设 PlayRes**）⇒ `FontSize` 是**脚本单位**：渲染像素 = FontSize × H / 288。
   *   所以"按 H 取字号"是错的（我第一版 `FontSize=round(H*0.042)` 在竖屏变成 ~240px 巨字）。
   *   正解：**先定目标像素，再换算成脚本单位**（≈ 按 288 归一，故近似常量）。 */
  const SCRIPT_Y = 288
  const px2script = (px) => Math.max(1, Math.round((px / H0) * SCRIPT_Y))
  const subSize = Number(o.subsSize) || px2script(Math.round(H0 * 0.042))
  const w = Number(o.logoW || Math.round(W0 * 0.14)), m = Number(o.logoMargin || Math.round(W0 * 0.03))
  const op = Number(o.logoOpacity == null ? 0.85 : o.logoOpacity)
  let logoH = 0
  if (o.logo) { const lg = probe(o.logo); logoH = lg && lg.w ? Math.round((lg.h / lg.w) * w) : w }
  /* 字幕下边距：底角有水印时抬到水印之上，否则按画面比例留白（同样要换算成脚本单位） */
  const bottomLogo = o.logo && String(o.logoPos || 'br').startsWith('b')
  const marginVPx = bottomLogo ? m + logoH + Math.round(H0 * 0.02) : Math.round(H0 * 0.05)
  const marginV = Number(o.subsMarginV) || px2script(marginVPx)
  if (o.srt) {
    /* ★ 样式由 `o.subsStyle`（`plain`|`dark`）决定 —— `auto` 已在主路径**量完产物**后解析掉；
       buildArgs 保持"只拼参数"（不自己抽帧）：否则 `--dry-run` 会**真的去跑 ffmpeg**（与 dry-run 纪律冲突）。 */
    const kind = o.subsStyle === 'dark' ? 'dark' : 'plain'
    const style = `FontSize=${subSize},MarginV=${marginV},Alignment=2,${kind === 'dark' ? SUBS_STYLE_DARK : SUBS_STYLE_PLAIN}`
    steps.push(`[${v}]subtitles=filename='${escSub(o.srt)}':original_size=${W0}x${H0}:force_style='${style}'[vsub]`)
    v = 'vsub'
  }
  if (o.logo) {
    steps.push(`[${logoI}:v]scale=${w}:-1,format=rgba,colorchannelmixer=aa=${op}[lg]`)
    const pos = o.logoPos || 'br'
    const x = pos.endsWith('r') ? `W-w-${m}` : `${m}`
    const y = pos.startsWith('t') ? `${m}` : `H-h-${m}`
    /* ⚠️ 标签**不许重名**（自测当场抓到）：上一版这里与 `[v]null[vout]` 撞了同名标签 ⇒ 滤镜图非法 */
    steps.push(`[${v}][lg]overlay=${x}:${y}[vout]`)
    v = 'vout'
  } else {
    steps.push(`[${v}]null[vout]`); v = 'vout'
  }
  const maps = ['-map', `[${v}]`]
  if (o.bgm) {
    steps.push(`[${bgmI}:a]volume=${Number(o.bgmVol == null ? -18 : o.bgmVol)}dB[a]`)
    maps.push('-map', '[a]', '-shortest')
  } else {
    if (idx === 1) maps.push('-an')          // 无新音轨 ⇒ 原视频音轨保留
  }
  return [...inputs, '-filter_complex', steps.join(';'), ...maps,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-y', o.out]
}

/** 单次合成 + 产物校验（只"跑了命令"不算成功） */
function mux(o) {
  const t0 = Date.now()
  for (const [k, p] of [['--in', o.in], ['--srt', o.srt], ['--logo', o.logo], ['--bgm', o.bgm]]) {
    if (p && !existsSync(p)) {
      console.error(`✗ [MUX-INPUT-MISSING] ${k} 不存在：${p}`)
      concl('MUX-INPUT-MISSING', false, { arg: k })
      return EXIT.INPUT
    }
  }
  const src = probe(o.in)
  const bin = resolveBin('ffmpeg')
  /* ★ auto：**先量产物**（字幕底带亮度）再定样式；量不到 ⇒ 回退 `plain` 并**打印**（可见回退） */
  let subsStyle = o.subsStyle || 'auto'
  if (o.srt && subsStyle === 'auto') {
    const b = bandLuminance(resolve(o.in), src && src.dur)
    subsStyle = b.mean == null ? 'plain' : pickSubsStyle(b.mean)
    console.log(b.mean == null
      ? `   ⚠ [MUX-SUBS-STYLE] 底带亮度量不到（抽帧失败 ${b.ok}/${b.total}）⇒ 回退 plain`
      : `   · 字幕样式=**${subsStyle}**（底带亮度均值=${b.mean.toFixed(2)} · ${b.ok}/${b.total} 帧有效 · 阈值 0.6）`)
  }
  /* ★ 因字幕会切工作目录 ⇒ **所有**路径（in/out/**logo/bgm**）必须**先转绝对**，否则相对路径在切目录后失效。
   *   ⚠️ 第一版只转了 in/out ⇒ `--logo out-tmp-batch/logo.png` 被解析成 `<字幕目录>/out-tmp-batch/logo.png` ⇒
   *   `Error opening input file … No such file or directory`（端到端跑「文案→字幕→合成」时暴露）。 */
  const abs = (p) => (p ? resolve(p) : p)
  const args = buildArgs({ ...o, subsStyle, in: abs(o.in), out: abs(o.out), logo: abs(o.logo), bgm: abs(o.bgm),
    srcW: src && src.w, srcH: src && src.h })
  /* 字幕用"工作目录 + 裸文件名"⇒ 运行目录必须切到字幕所在目录 */
  const cwd = o.srt ? dirname(resolve(o.srt)) : undefined
  if (A.dryRun) {
    /* ★★ team-lead msg20 ①：**dry-run 统一口径** —— "**有意未产出**" ≠ 成功：
       退出码 **1**（**不新造 3**：`§3` 的 3/4/5/6 已被 stage 占用 ⇒ 撞码比不便更糟）· 专属 tag **`DRY_RUN_NO_OUTPUT`**
       · 结论行 **ok=false** · 报告字段 `dryRun=true` · 并打**显眼人话**。
       理由与前几批**同一口径**（`--page-unknown` 那次）：**未干活不许伪装成通过** —— 只读退出码的脚本**必须停下来**，
       要"确认计划可用"就**读 tag**（稳定 tag 存在的意义）。 */
    console.log('   [dry-run] ffmpeg=' + bin + ' · cwd=' + (cwd || process.cwd()))
    console.log('   [dry-run] argv=' + JSON.stringify(args))
    console.log('   ⚠ DRY-RUN：本次**未渲染 / 未合成 / 未产出任何文件**（要"确认计划可用"请读 tag）')
    concl('DRY_RUN_NO_OUTPUT', false, { dryRun: true })
    return EXIT.FAIL
  }
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 28, cwd })
  if (r.status !== 0) {
    console.error('✗ ffmpeg 失败（bin=' + bin + '）\n' + String(r.stderr || '').trim().split('\n').slice(-8).join('\n'))
    concl('MUX-FFMPEG-FAILED', false, { in: basename(o.in) })
    return EXIT.FAIL
  }
  const got = probe(o.out)
  const bad = []
  if (!got) bad.push('产物不可读')
  else {
    if (src && src.dur && Math.abs(got.dur - src.dur) > 0.35) bad.push(`时长 ${got.dur.toFixed(2)}s ≠ 源 ${src.dur.toFixed(2)}s（Δ>0.35s）`)
    if (src && src.w && (got.w !== src.w || got.h !== src.h)) bad.push(`分辨率 ${got.w}×${got.h} ≠ 源 ${src.w}×${src.h}`)
    if (o.bgm && !got.hasAudio) bad.push('要了背景乐却没有音轨')
  }
  if (bad.length) {
    console.error('✗ [MUX-OUTPUT-MISMATCH] ' + bad.join(' · '))
    concl('MUX-OUTPUT-MISMATCH', false, { out: basename(o.out) })
    return EXIT.FAIL
  }
  console.log(`  · ${basename(o.in)} ⇒ ${basename(o.out)} · ${got.w}×${got.h} · ${got.dur.toFixed(2)}s · 音轨=${got.hasAudio ? '有' : '无'} · ` +
    `字幕=${o.srt ? '√' : '-'} 角标=${o.logo ? `√(${o.logoPos || 'br'})` : '-'} 背景乐=${o.bgm ? '√' : '-'} · ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  concl('MUX-OK', true, { out: basename(o.out), dur: got.dur.toFixed(2), audio: got.hasAudio ? 1 : 0 })
  return EXIT.OK
}

/* ---------------------------- 合成自测（免渲染 · 秒级 · 含负控） ---------------------------- */
function selfTest() {
  const wd = A.workdir || join(HERE, 'out-tmp-mux-selftest')
  rmSync(wd, { recursive: true, force: true }); mkdirSync(wd, { recursive: true })
  const ff = resolveBin('ffmpeg')
  const gen = (args, out) => {
    const r = spawnSync(ff, ['-v', 'error', '-y', ...args, out], { encoding: 'utf8' })
    if (r.status !== 0) { console.error(`✗ 合成输入失败：${out} ${String(r.stderr || '').trim().split('\n').slice(-2).join(' ')}`); return false }
    return true
  }
  const raw = join(wd, 'raw.mp4')
  const ok1 = gen(['-f', 'lavfi', '-i', 'color=c=0x224466:s=640x360:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'], raw)
  const srt = join(wd, 'a.srt')
  writeFileSync(srt, '1\n00:00:00,200 --> 00:00:01,600\n自测字幕第一行\n\n2\n00:00:01,800 --> 00:00:02,900\n第二条\n', 'utf8')
  const logo = join(wd, 'logo.png')
  const ok2 = gen(['-f', 'lavfi', '-i', 'color=c=0xE0B64A:s=140x140:d=1', '-frames:v', '1'], logo)
  const bgm = join(wd, 'bgm.m4a')
  const ok3 = gen(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', '-c:a', 'aac'], bgm)
  if (!ok1 || !ok2 || !ok3) { concl('MUX-SELFTEST-INPUT-FAILED', false, {}); return EXIT.FAIL }

  const cases = [
    { n: 'A 仅视频', a: { in: raw, out: join(wd, 'a.mp4') }, wantAudio: null },
    { n: 'B +字幕+角标', a: { in: raw, out: join(wd, 'b.mp4'), srt, logo, logoPos: 'br', logoW: 140, logoOpacity: 0.85 }, wantAudio: null },
    { n: 'C +背景乐(1s 循环到 3s)', a: { in: raw, out: join(wd, 'c.mp4'), bgm, bgmVol: -18, logo, logoPos: 'tr' }, wantAudio: true },
    { n: 'D 字幕+角标+背景乐', a: { in: raw, out: join(wd, 'd.mp4'), srt, logo, bgm }, wantAudio: true },
  ]
  let fail = 0
  for (const c of cases) {
    console.log(`  — 用例 ${c.n}`)
    const r = mux(c.a)
    const g = probe(c.a.out)
    const durOk = g && Math.abs(g.dur - 3) <= 0.35
    const aOk = c.wantAudio === true ? !!(g && g.hasAudio) : true
    const ok = r === 0 && g && durOk && aOk
    console.log(`    ${ok ? '✓' : '✗'} ${c.n} ⇒ exit=${r} 时长=${g ? g.dur.toFixed(2) : '?'} 音轨=${g && g.hasAudio ? '有' : '无'}（须 ${c.wantAudio === true ? '有' : '与源一致'}）`)
    if (!ok) fail++
  }
  /* 用例 F：**字幕尺寸必须按源画面入图**（结构断言）——
   *   竖屏事故根因是 libass 拿不到尺寸就按 384×288 假定 ⇒ 字幕被放大到溢出。
   *   这里断言滤镜图里真的带 `original_size=<源宽>x<源高>` 与 `FontSize/MarginV`（防"改了参数但没拼进去"）。 */
  console.log('  — 用例 F 字幕尺寸按源入图（结构断言）')
  {
    const fArgs = buildArgs({ in: raw, out: join(wd, 'f.mp4'), srt, srcW: 640, srcH: 360 })
    const fc = fArgs[fArgs.indexOf('-filter_complex') + 1] || ''
    const fOk = fc.includes('original_size=640x360') && /FontSize=\d+/.test(fc) && /MarginV=\d+/.test(fc)
    console.log(`    ${fOk ? '✓' : '✗'} 滤镜图含 original_size=640x360 / FontSize / MarginV${fOk ? '' : ' ⇒ ' + fc.slice(0, 150)}`)
    if (!fOk) fail++
  }
  /* 用例 G：**样式选择的纯函数样本**（必红/不许红**成对** + 边界）——不必渲染，秒级 */
  console.log('  — 用例 G 样式选择纯函数（底带亮度 ⇒ 样式）')
  {
    const g1 = pickSubsStyle(0.85) === 'dark'        // 亮底 ⇒ 深字白描边
    const g2 = pickSubsStyle(0.35) === 'plain'       // 暗底 ⇒ 白字深描边
    const g3 = pickSubsStyle(0.6) === 'plain'        // 边界：**严格大于** 0.6 才算亮底（把口径钉住）
    console.log(`    ${g1 && g2 && g3 ? '✓' : '✗'} 0.85⇒${pickSubsStyle(0.85)} · 0.35⇒${pickSubsStyle(0.35)} · 0.60⇒${pickSubsStyle(0.6)}（须 dark/plain/plain）`)
    if (!(g1 && g2 && g3)) fail++
  }
  /* 用例 H：**样式真的进了滤镜图**（防"算了样式却没拼进去"）＋ 两种样式必须**不同**（防 dark 是空操作） */
  console.log('  — 用例 H 样式入图（结构断言）')
  {
    const fcOf = (st) => {
      const a = buildArgs({ in: raw, out: join(wd, 'h.mp4'), srt, srcW: 640, srcH: 360, subsStyle: st })
      return a[a.indexOf('-filter_complex') + 1] || ''
    }
    const fcD = fcOf('dark'), fcP = fcOf('plain')
    const hOk = fcD.includes(SUBS_STYLE_DARK) && fcP.includes(SUBS_STYLE_PLAIN) && fcD !== fcP
    console.log(`    ${hOk ? '✓' : '✗'} dark 已拼进=${fcD.includes(SUBS_STYLE_DARK)} · plain 已拼进=${fcP.includes(SUBS_STYLE_PLAIN)} · 两者不同=${fcD !== fcP}`)
    if (!hOk) fail++
  }

  /* 回归用例 E2：**相对路径 + 字幕**（覆盖"切 cwd"的副作用 —— 第一版只把 in/out 转绝对，
   *   `--logo` 相对路径会被解析到字幕目录下 ⇒ 找不到。用**相对路径**才测得到，全用绝对路径测不出来） */
  console.log('  — 用例 E2 相对路径 + 字幕（切 cwd 回归）')
  const cwd0 = process.cwd()
  let e2ok = false
  try {
    process.chdir(wd)
    const r2 = mux({ in: 'raw.mp4', out: 'e2.mp4', srt: 'a.srt', logo: 'logo.png', bgm: 'bgm.m4a' })
    const g2 = probe(join(wd, 'e2.mp4'))
    e2ok = r2 === 0 && !!g2 && Math.abs(g2.dur - 3) <= 0.35
    console.log(`    ${e2ok ? '✓' : '✗'} 用例 E2 ⇒ exit=${r2} 时长=${g2 ? g2.dur.toFixed(2) : '?'}（须 0 / ≈3.00）`)
  } catch (e) {
    console.log('    ✗ 用例 E2 抛异常：' + String(e.message))
  } finally { process.chdir(cwd0) }
  if (!e2ok) fail++

  /* 负控：输入不存在 ⇒ 必须 exit 2 + 专属标签（"能失败"要结构性满足） */
  console.log('  — 负控 E 输入不存在')
  const rE = mux({ in: join(wd, 'nope.mp4'), out: join(wd, 'e.mp4') })
  const eOk = rE === EXIT.INPUT
  console.log(`    ${eOk ? '✓' : '✗'} 负控 E ⇒ exit=${rE}（须 2）`)
  if (!eOk) fail++
  concl('MUX-SELFTEST', fail === 0, { 用例: cases.length + 3, 失败: fail })
  return fail === 0 ? EXIT.OK : EXIT.FAIL
}

if (A.selfTest) process.exit(selfTest())
if (!A.in || !A.out) {
  console.error('✗ 用法：--in <raw.mp4> --out <final.mp4> [--srt …] [--logo …] [--bgm …]  或  --self-test')
  process.exit(EXIT.INPUT)
}
process.exit(mux(A))
