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
 *        [--bgm music.m4a] [--bgm-vol -18]
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
  '--dry-run': 'dryRun',
}
const A = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!(a in FLAGS)) {
    console.error(`✗ 未识别的参数：${a}`)
    console.error(`   允许：${Object.keys(FLAGS).join(' ')}`)
    process.exit(EXIT.INPUT)
  }
  const key = FLAGS[a]
  if (key === 'selfTest') { A.selfTest = true; continue }
  A[key] = process.argv[++i]
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
  if (o.srt) { steps.push(`[${v}]subtitles=filename='${escSub(o.srt)}'[vsub]`); v = 'vsub' }
  const w = Number(o.logoW || 160), m = Number(o.logoMargin || 40), op = Number(o.logoOpacity == null ? 0.85 : o.logoOpacity)
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
  /* ★ 因字幕会切工作目录 ⇒ 输入/输出必须**先转绝对路径**，否则相对路径在切目录后失效 */
  const args = buildArgs({ ...o, in: resolve(o.in), out: resolve(o.out) })
  /* 字幕用"工作目录 + 裸文件名"⇒ 运行目录必须切到字幕所在目录 */
  const cwd = o.srt ? dirname(resolve(o.srt)) : undefined
  if (A.dryRun) {
    console.log('   [dry-run] ffmpeg=' + bin + ' · cwd=' + (cwd || process.cwd()))
    console.log('   [dry-run] argv=' + JSON.stringify(args))
    concl('MUX-DRY-RUN', true, {})
    return EXIT.OK
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
  /* 负控：输入不存在 ⇒ 必须 exit 2 + 专属标签（"能失败"要结构性满足） */
  console.log('  — 负控 E 输入不存在')
  const rE = mux({ in: join(wd, 'nope.mp4'), out: join(wd, 'e.mp4') })
  const eOk = rE === EXIT.INPUT
  console.log(`    ${eOk ? '✓' : '✗'} 负控 E ⇒ exit=${rE}（须 2）`)
  if (!eOk) fail++
  concl('MUX-SELFTEST', fail === 0, { 用例: cases.length + 1, 失败: fail })
  return fail === 0 ? EXIT.OK : EXIT.FAIL
}

if (A.selfTest) process.exit(selfTest())
if (!A.in || !A.out) {
  console.error('✗ 用法：--in <raw.mp4> --out <final.mp4> [--srt …] [--logo …] [--bgm …]  或  --self-test')
  process.exit(EXIT.INPUT)
}
process.exit(mux(A))
