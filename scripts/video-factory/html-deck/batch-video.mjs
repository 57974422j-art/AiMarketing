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
  '--clean': 'clean', '--sheet-only': 'sheetOnly', '--self-test-clean': 'selfTestClean',
}
/* ★★ 旗标类型 ④（唯一真源）：哪些选项键是 **bool**（不带值）—— 解析器从它派生，下面的断言核"⊆ 注册表 ∧ 真被用 ∧ 有值路径存在"。
   新增**布尔**旗标只许改这一行。 */
const BOOL_KEYS = new Set(['sheet', 'dryRun', 'keepRaw', 'reuseRaw', 'clean', 'sheetOnly', 'allPalettes', 'selfTestClean'])
const A = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!(a in FLAGS)) {
    console.error(`✗ 未识别的参数：${a}\n   允许：${Object.keys(FLAGS).join(' ')}`)
    process.exit(EXIT.INPUT)
  }
  const k = FLAGS[a]
  /* ★★ 旗标类型 ④：解析器**从声明的类型派生**（`BOOL_KEYS`），不再手写布尔名单 —— 防"bool 旗标被当有值旗标"。 */
  if (BOOL_KEYS.has(k)) { A[k] = true; continue }
  A[k] = process.argv[++i]
}
/* ★★ 旗标三件套的**覆盖断言**。⚠️ 编排类工具**必须两张表**（team-lead msg19 ①：`make-video` 上一版正是
   因为只有一张表而把**生产路径判红** —— 它把"传给子工具的旗标"当成自己的）。
   本工具的自有旗标在 `FLAGS`；**传给 `mux-video` 的 `--in/--out`** 单列下游表（`--srt/--logo/--bgm` 虽也传给
   mux，但**本工具自己也用** ⇒ 仍属自有表；`--outdir` 同理）。 */
{
  const DOWNSTREAM_FLAGS = ['--in', '--out']
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const found = [...new Set([...src.matchAll(/'(--[a-zA-Z][\w-]*)'/g)].map((m) => m[1]))]
  const known = new Set([...Object.keys(FLAGS), ...DOWNSTREAM_FLAGS])
  const missing = found.filter((f) => !known.has(f))
  const dead = Object.keys(FLAGS).filter((n) => !new RegExp(`\\bA\\.${FLAGS[n]}\\b|\\bA\\['${FLAGS[n]}'\\]`).test(src))
  /* ★★ ④ **旗标类型**（bool|value）：类型声明 = `BOOL_KEYS`，解析器必须从它派生（否则就是两份口径）。 */
  const keys = Object.values(FLAGS)
  const boolNotRegistered = [...BOOL_KEYS].filter((k) => !keys.includes(k))
  const usesBool = /BOOL_KEYS\.has\(/.test(src)
  const valuePath = /A\[(?:key|k)\]\s*=\s*process\.argv\[\+\+i\]/.test(src)
  if (boolNotRegistered.length || !usesBool || !valuePath) {
    console.error(`✗ 旗标三件套-④ 类型断言失败：BOOL_KEYS 里未注册的键 ${boolNotRegistered.join(' ') || '（无）'} · 解析器用 BOOL_KEYS=${usesBool} · 有值路径存在=${valuePath}`)
    console.error('   规矩：bool 旗标只许声明在 BOOL_KEYS 且解析器从它派生；非 bool 键走 argv[++i] ⇒ exit 2')
    process.exit(EXIT.INPUT)
  }
  console.log(`  ✓ 旗标三件套-④ 类型：bool **${[...BOOL_KEYS].join('/')}** · 值旗标 **${keys.length - BOOL_KEYS.size}** · 解析器由声明派生 ✓`)
  if (missing.length || dead.length) {
    console.error(`✗ 旗标三件套断言失败：**注册表不全** ${missing.join(' ') || '（无）'} · **注册但未消费** ${dead.join(' ') || '（无）'}`)
    console.error('   规矩：自有旗标登记进 FLAGS **并被真正读取**；传给子工具的列进 DOWNSTREAM_FLAGS ⇒ exit 2')
    process.exit(EXIT.INPUT)
  }
  console.log(`  ✓ 旗标三件套：自有注册 **${Object.keys(FLAGS).length}** · 下游表 **${DOWNSTREAM_FLAGS.length}** · 源码字面量 **${found.length}** 全部有归属 · 死旗标 **0**`)
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

/* ⚠️ team-lead msg18 ③：必须用 **`resolve`** 而非 `join` —— `join(HERE, 'G:\\…')` 会把绝对路径拼成 `HERE\\G:\\…`
   （实测：调用者只能按"相对 HERE"传参绕开；且与 `gen-deck` 的 `resolve(A.out)` 口径不一致）⇒ 统一 `resolve`。 */
const outRoot = resolve(HERE, A.outdir || 'out-tmp-batch')
/* ★ 两条来自现场的教训（都出过事故）：
 *   ① 第一版 `rmSync(outRoot)` 把调用者放进 `outdir` 的 `--srt/--logo` 一起删了（**工具删自己的输入**）⇒ 12 条全 `mux=2`；
 *   ② 第二版"每次启动清 raw/" ⇒ 与 `--reuse-raw` **直接矛盾**（清完再复用 ⇒ 清了个寂寞），
 *      且会把**上一批已出的成片**删掉（分批跑时前一批白做）。
 *   ⇒ 定稿：**默认增量**（不清任何东西，同名覆盖）；
 *   ③ 第三版 `--clean` 是**全量**清 `decks/raw/final` ⇒ 在**共享 outdir** 上会把**本次不会重建的别的皮肤**删掉
 *      （team-lead 实测：清 mono 四配色 ⇒ ecom 四条一起没了）⇒ 现 `--clean` **只清本次选中的皮肤**（见下方实现）。 */
/** ★★ **纯函数：本次 `--clean` 该删哪些条目**（判据 = **清理的集合 ⊆ 本次会重建的集合** · team-lead ③ 建议落成断言）——
 *  · 只有"条目名里含 `<本次皮肤短名>-`"的归本次所有；**别的皮肤一律不碰**。
 *  · **双向**（team-lead 的复现口径）：**自己的必须删** ∧ **别人的必须不删** ——
 *    只证后半句不够：那也可能是"**清理根本没生效**"，同样会过 ✓
 *  · **不碰文件系统**（`listing` 由调用方读好传入）⇒ 可用**合成样本**证伪（零渲染 · 秒级）✓ */
export function cleanPlan(listing, skins) {
  const shorts = (skins || []).map((s) => String(s).replace('master-', ''))
  /* ⚠️ 匹配**两种形态**：① 条目名**恰好等于**皮肤短名（如 `raw/mono/` ⇒ 条目名就是 `mono`）
     ② 含 `<短名>-`（如 `deck.mono-black-9x16.json` / `mono-black-9x16` / `sheet-mono.png`）。
     —— 首版只写 ② ⇒ `raw/mono/` 会被**漏清**（我的合成样本当场把这个缺口抓出来了 ✓ 这正是"样本要真"的价值）。 */
  const isOwn = (n) => shorts.some((s) => String(n) === s || String(n).includes(s + '-'))
  const own = [], others = []
  for (const n of listing || []) (isOwn(n) ? own : others).push(String(n))
  return { own, others }
}

/* ★★ **`--self-test-clean`**：把上面那条判据**双向**证伪（现场 = team-lead 的 `--clean` 事故 ✓）
   ⚠️ 旗标**已登记**进 `FLAGS` + `BOOL_KEYS`，且**按 `A.selfTestClean` 消费** —— 否则旗标三件套断言会红（实测首跑就是 ✗）。 */
if (A.selfTestClean) {
  const cases = []
  const chk = (name, cond) => { cases.push(cond); console.log(`   ${cond ? '✓' : '✗'} ${name}`) }
  const M = ['final-mono-black-9x16.mp4', 'deck.mono-black-9x16.json', 'mono', 'mono-black-9x16', 'mono-graphite-9x16']
  const E = ['final-ecom-alpha-9x16.mp4', 'deck.ecom-alpha-9x16.json', 'ecom', 'ecom-alpha-9x16', 'ecom-alpha-9x16-2']
  const p = cleanPlan([...M, ...E], ['master-mono'])
  chk('① **自己的必须删**（必红侧）：mono 的 5 项全在 own（含**恰好等于短名**的 `mono` = `raw/mono/` 那种）',
    M.every((x) => p.own.includes(x)))
  chk('② ★**别人的必须不删**（不许红侧）：ecom 的 5 项全在 others',
    E.every((x) => p.others.includes(x)))
  chk('③ 两套都选中 ⇒ 全归 own（不误留）', cleanPlan([...M, ...E], ['master-mono', 'master-ecom']).others.length === 0)
  chk('④ 前缀不误伤（`monogram.mp4` ≠ `mono` 且不含 `mono-` ⇒ 归 others）', cleanPlan(['monogram.mp4'], ['master-mono']).others.length === 1)
  chk('⑤ 边界：**不含**本次皮肤名的 `sheet-*.png`（如跨皮肤对照图）⇒ 归 others（不许误删共享产物）',
    cleanPlan(['sheet-all12.png'], ['master-mono']).others.length === 1)
  const fail = cases.filter((x) => !x).length
  console.log(`   ${fail === 0 ? '✓' : '✗'} [CLEAN-PLAN-SELFTEST] 清理 ⊆ 重建 用例=${cases.length} · 失败=${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

/* ⚠️ **建目录必须无条件**（不能放在 `if (!A.dryRun)` 里）：`--dry-run` 下紧随其后的"派生档落盘 + 校验"仍需要
   `outRoot/decks` 存在 —— 否则 `writeFileSync` 直接 ENOENT（实测：dry-run + 新 outdir ⇒ 未捕获异常 exit=1）。
   `--clean` 仍只在非 dry-run 生效（**dry-run 不许删东西** ✓）。 */
mkdirSync(outRoot, { recursive: true })
if (!A.dryRun && A.clean) {
  /* ★★ 判据（team-lead ③ + K29"清扫是一次性的、断言才常设"）：**清理的集合 ⊆ 本次会重建的集合** ——
     抽成**纯函数** `cleanPlan()`（可**合成样本**证伪，见 `--self-test-clean`）。
     现场（team-lead 实测）：全量 `--clean` 在**共享 outdir** 上把同目录 ecom 四条一起删了
     （**清理范围 ≠ 重建范围** ⇒ 删掉本次不会补回来的东西）✗。 */
  let removed = 0, keptOthers = 0
  for (const sub of ['decks', 'raw', 'final']) {
    const dir = join(outRoot, sub)
    if (!existsSync(dir)) continue
    const plan = cleanPlan(readdirSync(dir), skins)
    keptOthers += plan.others.length
    for (const e of plan.own) { rmSync(join(dir, e), { recursive: true, force: true }); removed++ }
  }
  const rootPlan = cleanPlan(readdirSync(outRoot).filter((f) => /^sheet-/.test(f)), skins)
  for (const f of rootPlan.own) { rmSync(join(outRoot, f), { force: true }); removed++ }
  keptOthers += rootPlan.others.length
  console.log(`   · --clean：只清本次皮肤（${skins.map((s) => s.replace('master-', '')).join('/')}）的产物 · 已清 ${removed} 项 · **保留别人的 ${keptOthers} 项**（清理 ⊆ 重建 ✓）`)
}
mkdirSync(join(outRoot, 'decks'), { recursive: true })
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
    /* 幂等：派生档**内容不变就不落盘**（否则每次重跑刷新 mtime ⇒ `--reuse-raw` 形同虚设）。
       ⚠️ dry-run 在上面已 `continue`（不写档、不校验、不渲染）⇒ 此处只剩正常路径。 */
    if (!A.dryRun) {
      const body = JSON.stringify(d, null, 2) + '\n'
      if (!existsSync(deckPath) || readFileSync(deckPath, 'utf8') !== body) writeFileSync(deckPath, body)
    }
    /* ★★ team-lead msg20 ②：`--dry-run` **必须不干活** —— 此前只挡了"报告落盘"，**照样渲染 20s / 出 2.5MB 成片** ✗。
       现在：**不写 deck、不校验、不渲染、不合成**，只打印"将产出什么 + 目标路径"（秒级）。 */
    if (A.dryRun) {
      /* ⚠️ 计划行是**预测** ⇒ 名字必须与真实交付一致（原先写 `${tag}.mp4`，实际是 `final-${tag}.mp4` —— 预测也在撒谎，K24/K36 族） */
      console.log(`   · ${tag}：将产出 ⇒ ${join(outRoot, 'final', `final-${tag}.mp4`)}`)
      continue
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
    /* ★★ **交付位置恒定**（K40 · team-lead ③）：同一个字段（"交付"）**不许随"有没有合成项"变位置** ✓
       原先：无合成项 ⇒ `final` 指向 `raw/`（于是只有 raw 里有）· 有合成项 ⇒ `final/final-<tag>.mp4`
       ⇒ 用户/脚本按 `final/` 找会**找不到**（他的现场：拼 10 套墙时先按 `final/` 找 ⇒ 缺 health/edu ✗）。
       修法（他倾向的 ①，我也选它）：**无合成项时把渲染原片拷进同一个交付位置** —— 零成本、位置恒定 ✓
       ⚠️ **如实**：这会让"无合成项"这条路径**也**走下面的删除守卫（`final !== rawMp4` ⇒ 清 `raw/`）——
          与"有合成项"**同一规则**（`--keep-raw` 是逃生舱 ✓）；此前无合成项**会留下 `raw/`**（不一致 ✓）。 */
    let final = join(outRoot, 'final', `final-${tag}.mp4`)
    mkdirSync(dirname(final), { recursive: true })
    if (A.srt || A.logo || A.bgm) {
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
      /* ⚠️ 平台 bug（服务器 Linux 实测红）：原先 `final.replace(HERE + '\\', '')` 硬编码 Windows 反斜杠 ⇒
       *   Linux 上剥离永不命中 ⇒ 报告里的 final 留成**绝对路径** ⇒ 上游 make-video 自测的
       *   `existsSync(join(HERE, final))` 拼出不存在的路径 ⇒ 「产物存在=false」（Windows 绿、Linux 红的现场形状）。 */
      rows.push({ skin, ori, ok: true, final: final.startsWith(HERE + sep) ? final.slice(HERE.length + 1) : final, dur, sizeMB: Number(size) })
    } else {
      /* ★ 无合成项 ⇒ **把渲染原片拷进同一个交付位置**（位置恒定 · K40）。
         ⚠️ 用已 import 的 read+write（不引入 `copyFileSync` 这个新依赖；~2MB 量级，零成本）✓ */
      const size = (readFileSync(rawMp4).length / 1048576).toFixed(1)
      writeFileSync(final, readFileSync(rawMp4))
      console.log(`   ✓ [BATCH-ITEM-OK] ${tag} · ${mf.name || skin} · ${ori} · ${size}MB（无合成项 ⇒ 交付渲染原片 · **已拷入「final/」**）· ${((Date.now() - t0) / 1000).toFixed(0)}s`)
      rows.push({ skin, ori, ok: true, final: final.startsWith(HERE + sep) ? final.slice(HERE.length + 1) : final, sizeMB: Number(size) })
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
/* ★★ team-lead msg20 ①：dry-run ⇒ **exit 1 + 专属 tag + ok=false**（"有意未产出"不许伪装成通过；
   不新造 3 —— `§3` 的 3/4/5/6 按 stage 占用）；报告字段 `dryRun=true`（报告本身**不落盘** ✓）。 */
if (A.dryRun) {
  const will = skins.length * oris.length
  console.log(`   ⚠ DRY-RUN：本次**未渲染 / 未合成 / 未产出任何文件**（将产出 ${will} 条 · 目标 ${join(outRoot, 'final')}）`)
  console.log(`✗ [DRY_RUN_NO_OUTPUT] BATCH-RESULT ok=false · dryRun=true · 将产出=${will} · 目标=${join(outRoot, 'final')}`)
  process.exit(EXIT.FAIL)
}
console.log(`✓ [BATCH-RESULT] BATCH-RESULT ok=${fail === 0} · n=${rows.length} · fail=${fail}`)
process.exit(fail === 0 ? EXIT.OK : EXIT.FAIL)
