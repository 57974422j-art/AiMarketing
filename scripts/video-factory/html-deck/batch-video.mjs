#!/usr/bin/env node
/**
 * batch-video.mjs —— **一条命令出"全套餐"**：同一份内容 × 若干皮肤 × 横/竖屏 ⇒ 逐条渲染 + 合成（字幕/角标/背景乐）
 *
 * 为什么要有：此前"六皮肤 × 横竖屏"是靠聊天里手敲的循环 + 一次性 ffmpeg 命令 ⇒ 换台机器、换个人就重来一遍。
 *   本工具把这条流水线**入库**，并保证：
 *   · 派生只改白名单字段（`style.masterId/palette/orientation`），派生档写到 `out-tmp-batch/`（不污染 examples、不触发漂移锚点）
 *   · 每条都经 **validate-deck** 才渲染（校验不过 ⇒ 该条红，不入片，且**点名原因**）
 *   · 每条都给**结论行**；末尾给**总账**（`BATCH-RESULT ok=… n=… fail=…`）+ 机读 `batch-report.json`
 *   · 合成交给 `mux-video.mjs`（唯一实现），本工具不自己拼 ffmpeg
 *
 * 用法：
 *   node batch-video.mjs --base examples/deck.factory-tech.json --skins all --orientations 16:9,9:16
 *        [--srt a.srt] [--logo logo.png] [--bgm music.m4a] [--palette 金] [--outdir out-tmp-batch]
 *        [--only master-mono] [--sheet] [--dry-run]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname, resolve, basename, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
/* ★ K17-ff（team-lead msg16 ① 补的第 4 处）：本工具此前**直接写裸 `ffmpeg`/`ffprobe`** ⇒ 现统一走唯一实现。 */
import { resolveFfmpeg, resolveFfprobe } from './engine-bin.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXIT = { OK: 0, FAIL: 1, INPUT: 2 }

const FLAGS = {
  '--base': 'base', '--skins': 'skins', '--orientations': 'orientations', '--outdir': 'outdir',
  '--srt': 'srt', '--logo': 'logo', '--bgm': 'bgm', '--palette': 'palette', '--only': 'only',
  '--palettes': 'palettes', '--all-palettes': 'allPalettes', '--palette-index': 'paletteIndex',
  '--sheet': 'sheet', '--dry-run': 'dryRun', '--keep-raw': 'keepRaw', '--reuse-raw': 'reuseRaw',
  '--clean': 'clean', '--sheet-only': 'sheetOnly',
}
const A = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!(a in FLAGS)) {
    console.error(`✗ 未识别的参数：${a}\n   允许：${Object.keys(FLAGS).join(' ')}`)
    process.exit(EXIT.INPUT)
  }
  const k = FLAGS[a]
  if (k === 'sheet' || k === 'dryRun' || k === 'keepRaw' || k === 'reuseRaw' || k === 'clean' || k === 'sheetOnly' || k === 'allPalettes') { A[k] = true; continue }
  A[k] = process.argv[++i]
}
const run = (file, args, opts = {}) => spawnSync(process.execPath, [join(HERE, file), ...args], { encoding: 'utf8', maxBuffer: 1 << 28, ...opts })

/* ---------------- ① 皮肤清单：从每个母版的 master.json 读（唯一真源，不手抄） ---------------- */
const mastersDir = join(HERE, 'masters')
const allSkins = readdirSync(mastersDir).filter((d) => existsSync(join(mastersDir, d, 'master.json')))
const skins = (A.skins === 'all' || !A.skins ? allSkins : A.skins.split(',')).map((s) => (s.startsWith('master-') ? s : 'master-' + s))
const oris = (A.orientations || '16:9').split(',')
const base = A.base || join('examples', 'deck.factory-tech.json')
if (!existsSync(resolve(HERE, base))) { console.error(`✗ --base 不存在：${base}`); process.exit(EXIT.INPUT) }
for (const [k, p] of [['--srt', A.srt], ['--logo', A.logo], ['--bgm', A.bgm]]) {
  if (p && !existsSync(resolve(HERE, p))) { console.error(`✗ ${k} 不存在：${p}`); process.exit(EXIT.INPUT) }
}

const outRoot = join(HERE, A.outdir || 'out-tmp-batch')
/* ★ 两条来自现场的教训（都出过事故）：
 *   ① 第一版 `rmSync(outRoot)` 把调用者放进 `outdir` 的 `--srt/--logo` 一起删了（**工具删自己的输入**）⇒ 12 条全 `mux=2`；
 *   ② 第二版"每次启动清 raw/" ⇒ 与 `--reuse-raw` **直接矛盾**（清完再复用 ⇒ 清了个寂寞），
 *      且会把**上一批已出的成片**删掉（分批跑时前一批白做）。
 *   ⇒ 定稿：**默认增量**（不清任何东西，同名覆盖）；要全量重来请显式 `--clean`。 */
if (!A.dryRun) {
  mkdirSync(outRoot, { recursive: true })
  if (A.clean) {
    for (const sub of ['decks', 'raw', 'final']) rmSync(join(outRoot, sub), { recursive: true, force: true })
    for (const f of readdirSync(outRoot)) if (/^(sheet-|batch-sheet|batch-report|batch\.log)/.test(f)) rmSync(join(outRoot, f), { force: true })
  }
  mkdirSync(join(outRoot, 'decks'), { recursive: true })
}
const baseDeck = JSON.parse(readFileSync(resolve(HERE, base), 'utf8'))

console.log(A.sheetOnly
  ? `重建对照图（读 batch-report.json：${rows.length} 条 · 不重渲染）`
  : `批次：皮肤 ${skins.length} 套 × 方向 ${oris.length} 种 = **${skins.length * oris.length} 条**` +
    `（基底 ${basename(base)} · 字幕=${A.srt ? '√' : '-'} 角标=${A.logo ? '√' : '-'} 背景乐=${A.bgm ? '√' : '-'}）`)

/* `--sheet-only`：只拿已有报告重出对照图（免重跑 7 分钟）—— 报告就是本次运行的机读真源 */
const rows = A.sheetOnly ? JSON.parse(readFileSync(join(outRoot, 'batch-report.json'), 'utf8')).rows : []
if (!A.sheetOnly) for (const skin of skins) {
  if (!existsSync(join(mastersDir, skin, 'master.json'))) { console.log(`   ⚠ 跳过 ${skin}（无 master.json）`); continue }
  if (A.only && skin !== A.only) continue
  const mf = JSON.parse(readFileSync(join(mastersDir, skin, 'master.json'), 'utf8'))
  const palKeys = Object.keys(mf.palette || {})
  /* 配色挑选（四选一，按优先级）：
   *   ① `--all-palettes` ⇒ 该母版**全部**配色各出一条（组合最丰富）
   *   ② `--palette <名>`  ⇒ 指定单一配色（不存在则**红**，不静默回退 —— 与"找不到 leaf 就红"同族）
   *   ③ `--palettes a,b,c` ⇒ **轮流**取第一个在该母版存在的（跨皮肤自动多样化）
   *   ④ 都没有 ⇒ 母版默认（palette 首项） */
  let palList
  /* `--palette-index <n>`：按**序号**取（跨母版通用 —— 各母版配色名语言都不统一：warm-gold / 松绿 / black …） */
  if (A.paletteIndex != null) {
    const i = Number(A.paletteIndex)
    if (!Number.isInteger(i) || i < 0 || i >= palKeys.length) {
      console.log(`   ✗ ${skin}：--palette-index=${A.paletteIndex} 越界（本母版 ${palKeys.length} 项：${palKeys.join('/')}）⇒ 红`)
      rows.push({ skin, ori: '-', ok: false, why: 'palette-index-out-of-range' }); continue
    }
    palList = [palKeys[i]]
  }
  else if (A.allPalettes) palList = palKeys.slice()
  else if (A.palette) {
    if (!palKeys.includes(A.palette)) { console.log(`   ✗ ${skin}：指定的配色 ${A.palette} 不在本母版（可选：${palKeys.join('/')}）⇒ 红`); rows.push({ skin, ori: '-', ok: false, why: 'palette-not-in-master' }); continue }
    palList = [A.palette]
  } else if (A.palettes) {
    const want = String(A.palettes).split(',').map((x) => x.trim()).filter(Boolean)
    const pick = want.find((w) => palKeys.includes(w))
    if (!pick) console.log(`   ℹ ${skin}：--palettes 里没有本母版认识的配色（可选：${palKeys.join('/')}）⇒ 用默认 ${palKeys[0]}`)
    palList = [pick || palKeys[0]]
  } else palList = [palKeys[0]]
  for (const palette of palList) {
    if (!palette) { console.log(`   ✗ ${skin}：master.json 没声明 palette ⇒ 无法派生（红）`); rows.push({ skin, ori: '-', ok: false, why: 'no-palette' }); break }
   for (const ori of oris) {
    const tag = `${skin.replace('master-', '')}-${palette}-${ori.replace(':', 'x')}`
    const deckPath = join(outRoot, 'decks', `deck.${tag}.json`)
    const d = JSON.parse(JSON.stringify(baseDeck))
    d.style = { ...d.style, masterId: skin, palette, orientation: ori }
    /* ★ 幂等：派生档**内容不变就不落盘** —— 否则每次重跑都会刷新 mtime，
     *   让下面的"产物 ≥ 派生档"守卫失效 ⇒ `--reuse-raw` 形同虚设（每次白渲 12 条 ≈5 分钟） */
    if (!A.dryRun) {
      const body = JSON.stringify(d, null, 2) + '\n'
      if (!existsSync(deckPath) || readFileSync(deckPath, 'utf8') !== body) writeFileSync(deckPath, body)
    }
    const t0 = Date.now()
    const v = run('validate-deck.mjs', [deckPath])
    if (v.status !== 0) {
      const why = String(v.stdout || v.stderr || '').trim().split('\n').filter((l) => l.includes('✗')).slice(0, 2).join(' | ')
      console.log(`   ✗ [BATCH-ITEM-FAILED] ${tag} · validate=${v.status} · ${why || '(无原因行)'}`)
      rows.push({ skin, ori, ok: false, why: 'validate:' + v.status }); continue
    }
    const rawDir = join(outRoot, 'raw', tag)
    let r = { status: 0 }
    /* 渲染器把产物放在 <outdir>/<deckName>/output-<deckName>.mp4 ⇒ **递归**找（第一版只扫了 outdir 根 ⇒ 找不到却报 render=0） */
    const findMp4 = (dir) => {
      if (!existsSync(dir)) return null
      for (const x of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, x.name)
        if (x.isDirectory()) { const hit = findMp4(p); if (hit) return hit }
        else if (/^output-.*\.mp4$/.test(x.name)) return p
      }
      return null
    }
    let rawMp4 = findMp4(rawDir)
    /* `--reuse-raw`：已有产物且**不早于派生档**才复用（免每次重渲 12 条 ≈5 分钟）；
     * 时间戳守卫防"拿旧片当新片"（否则改完皮肤却交旧片子 —— 最危险的一种假绿）。 */
    const fresh = rawMp4 && statSync(rawMp4).mtimeMs >= statSync(deckPath).mtimeMs
    if (A.reuseRaw && fresh) {
      console.log(`   · ${tag}：复用已有渲染产物（mtime ≥ 派生档）`)
    } else {
      if (A.reuseRaw && rawMp4 && !fresh) console.log(`   · ${tag}：产物早于派生档 ⇒ 必须重渲（不许拿旧片当新片）`)
      r = run('render-deck.mjs', [deckPath, '--outdir', rawDir])
      rawMp4 = findMp4(rawDir)
    }
    if (r.status !== 0 || !rawMp4) {
      console.log(`   ✗ [BATCH-ITEM-FAILED] ${tag} · render=${r.status} · 未找到产物 mp4`)
      rows.push({ skin, ori, ok: false, why: 'render:' + r.status }); continue
    }
    let final = rawMp4
    if (A.srt || A.logo || A.bgm) {
      final = join(outRoot, 'final', `final-${tag}.mp4`)
      mkdirSync(dirname(final), { recursive: true })
      const mArgs = ['--in', rawMp4, '--out', final]
      if (A.srt) mArgs.push('--srt', resolve(HERE, A.srt))
      if (A.logo) mArgs.push('--logo', resolve(HERE, A.logo))
      if (A.bgm) mArgs.push('--bgm', resolve(HERE, A.bgm))
      const m = run('mux-video.mjs', mArgs)
      if (m.status !== 0) {
        console.log(`   ✗ [BATCH-ITEM-FAILED] ${tag} · mux=${m.status}`)
        rows.push({ skin, ori, ok: false, why: 'mux:' + m.status }); continue
      }
      const dur = (String(m.stdout).match(/dur=([\d.]+)/) || [])[1]
      const size = (readFileSync(final).length / 1048576).toFixed(1)
      console.log(`   ✓ [BATCH-ITEM-OK] ${tag} · ${mf.name || skin} · ${ori} · ${dur}s · ${size}MB · ${((Date.now() - t0) / 1000).toFixed(0)}s`)
      rows.push({ skin, ori, ok: true, final: final.replace(HERE + '\\', ''), dur, sizeMB: Number(size) })
    } else {
      const size = (readFileSync(rawMp4).length / 1048576).toFixed(1)
      console.log(`   ✓ [BATCH-ITEM-OK] ${tag} · ${mf.name || skin} · ${ori} · ${size}MB（无合成项 ⇒ 交付渲染原片）· ${((Date.now() - t0) / 1000).toFixed(0)}s`)
      rows.push({ skin, ori, ok: true, final: rawMp4.replace(HERE + '\\', ''), sizeMB: Number(size) })
    }
    /* ★ 删除守卫（probe-html 建议，属"超限"同族）：删之前断言目标**真的在自己 outdir 之下** ——
     *   否则一律拒绝并点名（工具**不许删调用者的输入**；第一版 `rmSync(outdir)` 就删掉过 --srt/--logo）。 */
    if (!A.keepRaw && final !== rawMp4) {
      const rp = resolve(rawDir), op = resolve(outRoot)
      if (rp === op || !rp.startsWith(op + sep)) {
        console.log(`   ✗ [BATCH-DELETE-REFUSED] 拒绝删除 ${rawDir}（不在 outdir ${outRoot} 之下）—— 工具不许删调用者的输入`)
        rows.push({ skin, ori, ok: false, why: 'delete-refused' }); continue
      }
      rmSync(rawDir, { recursive: true, force: true })
    }
   }
  }
}

/* ---------------- ② 对照图（可选）：每条取 1.5s 封面 —— **按方向分行** ----------------
 * ⚠️ 第一版把 12 张图直接 hstack ⇒ 横版 1280×720 与竖版 720×1280 **高度不同** ⇒ ffmpeg 报错（对照图生成失败）。
 *   修法：先各自缩放到统一高度，**同方向一行**，再把两行**补宽对齐**后 vstack。 */
if ((A.sheet || A.sheetOnly) && rows.some((r) => r.ok)) {
  const FF_BIN = resolveFfmpeg().p
  const ff = spawnSync(FF_BIN, ['-version']).status === 0 ? FF_BIN : null
  if (ff) {
    const H = 320
    const rowsPng = {}
    rows.filter((r) => r.ok).forEach((r, i) => {
      const p = join(outRoot, `sheet-${i}.png`)
      spawnSync(ff, ['-v', 'error', '-y', '-ss', '1.5', '-i', join(HERE, r.final), '-frames:v', '1', p])
      if (existsSync(p)) (rowsPng[r.ori] = rowsPng[r.ori] || []).push(p)
    })
    const rowFiles = []
    for (const [ori, pngs] of Object.entries(rowsPng)) {
      const rowFile = join(outRoot, `sheet-row-${ori.replace(':', 'x')}.png`)
      const args = pngs.flatMap((p) => ['-i', p])
      /* ★ 复杂滤镜图必须**显式 `-map`**：第一版只写 `hstack=6`（无输出标签、无 map）⇒ ffmpeg 报"没有流" ⇒ 行图没生成 */
      /* ⚠️ 每个 scale **必须带自己的输出标签** `[s{i}]`：第一版写成 `[0]scale=-1:320[1]scale=…` ⇒ 后面的 `[1]`
       *    被当成**上一个 scale 的输出标签**（链式串联）⇒ ffmpeg `Invalid argument`。（手工对照命令验证了正确形态） */
      const filt = `${pngs.map((_, i) => `[${i}]scale=-1:${H}[s${i}]`).join(';')};` +
        `${pngs.map((_, i) => `[s${i}]`).join('')}hstack=${pngs.length}[out]`
      const s = spawnSync(ff, ['-v', 'error', '-y', ...args, '-filter_complex', filt, '-map', '[out]', '-frames:v', '1', rowFile])
      if (s.status === 0 && existsSync(rowFile)) rowFiles.push({ ori, rowFile })
      else console.log(`   ⚠ 行图 ${ori} 生成失败：${String(s.stderr || '').trim().split('\n').slice(-1).join('')}`)
    }
    if (rowFiles.length) {
      const sheet = join(outRoot, 'batch-sheet.png')
      /* 两行宽度不同（横版一行远宽于竖版一行）⇒ 用 ffprobe 量出各行宽度，再把窄行 pad 到最宽（居中）后 vstack。
       * 不用 `max(overlay_w…)` 那类表达式：ffprobe 量**真实像素宽**更直接、可回读。 */
      const wOf = (p) => {
        const pr = spawnSync(resolveFfprobe().p, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', p], { encoding: 'utf8' })
        return Number(String(pr.stdout || '').trim()) || 0
      }
      const W = Math.max(...rowFiles.map((r) => wOf(r.rowFile)))
      const args = rowFiles.flatMap((r) => ['-i', r.rowFile])
      const parts = rowFiles.map((r, i) => `[${i}]pad=${W}:ih:(ow-iw)/2:0[p${i}]`)
      const filt = `${parts.join(';')};${rowFiles.map((_, i) => `[p${i}]`).join('')}vstack=${rowFiles.length}[out]`
      const s = spawnSync(ff, ['-v', 'error', '-y', ...args, '-filter_complex', filt, '-map', '[out]', '-frames:v', '1', sheet])
      console.log(s.status === 0 ? `对照图：${sheet}\n` : `⚠ 对照图生成失败（不影响成片）：${String(s.stderr || '').trim().split('\n').slice(-2).join(' | ')}\n`)
    }
  }
}

const fail = rows.filter((r) => !r.ok).length
const report = { at: new Date().toISOString(), base, skins: skins.length, oris, rows, ok: fail === 0, fail }
if (!A.dryRun) writeFileSync(join(outRoot, 'batch-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`✓ [BATCH-RESULT] BATCH-RESULT ok=${fail === 0} · n=${rows.length} · fail=${fail}`)
process.exit(fail === 0 ? EXIT.OK : EXIT.FAIL)
