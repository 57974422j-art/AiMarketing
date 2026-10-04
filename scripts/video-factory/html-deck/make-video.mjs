#!/usr/bin/env node
/**
 * make-video.mjs —— **一条命令：一段文案 ⇒ 成套可投放成片**
 *
 *   文案(md) ──gen-deck──▶ deck.json + subs.srt ──batch-video──▶ 逐皮肤逐方向成片（渲染 + 水印 + 字幕 + 背景乐）
 *
 * 设计（与全仓同口径）：
 *   · **不重复实现**：生成走 `gen-deck`、渲染与合成走 `batch-video`（它们各有一条结论行 + 退出码语义）
 *   · **每个皮肤一份文案派生**：因为页面文案要落进该母版的长度窗口（`gen-deck` 会按 schema 校核）
 *   · 子步骤失败 ⇒ 该条红并**转述子工具的结论行**（不吞错、不猜测原因）
 *   · `--clean` 才清自己的产物目录；默认增量；**只清自己的命名空间**
 *   · 自测：`--self-test`（合成 2 行文案 ⇒ 跑通 1 皮肤 × 1 方向 ⇒ 断言产物存在 + 结论行齐全）
 *
 * 用法：
 *   node make-video.mjs --in copy.md --skins all --orientations 16:9,9:16
 *        [--palette-index 0] [--logo logo.png] [--bgm music.m4a] [--seconds 3.4] [--toc]
 *        [--outdir out-tmp-make] [--sheet] [--clean] [--dry-run] [--self-test] [--only master-mono]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname, resolve, basename, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXIT = { OK: 0, FAIL: 1, INPUT: 2 }

const FLAGS = {
  '--in': 'in', '--skins': 'skins', '--orientations': 'orientations', '--palette-index': 'paletteIndex',
  '--logo': 'logo', '--bgm': 'bgm', '--seconds': 'seconds', '--outdir': 'outdir', '--only': 'only',
  '--title': 'title', '--issuer': 'issuer',
  '--toc': 'toc', '--sheet': 'sheet', '--clean': 'clean', '--dry-run': 'dryRun', '--self-test': 'selfTest',
  '--plan': 'plan',
}
const A = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!(a in FLAGS)) {
    console.error(`✗ 未识别的参数：${a}\n   允许：${Object.keys(FLAGS).join(' ')}`)
    process.exit(EXIT.INPUT)
  }
  const k = FLAGS[a]
  if (['toc', 'sheet', 'clean', 'dryRun', 'selfTest', 'plan'].includes(k)) { A[k] = true; continue }
  A[k] = process.argv[++i]
}
/* ★★★ **下游旗标 = 两张表**（本工具是"编排器"，必然要往子工具传旗标）：
 *   本工具自己的旗标在 `FLAGS`；**传给子工具的**必须单列 `DOWNSTREAM_FLAGS` —— 否则覆盖断言 ① 会把
 *   "我传给 gen-deck/batch-video 的旗标" 误判成"我没登记自己的旗标" ⇒ **断言把自己的生产路径卡死**
 *   （第一次实跑就是被这条卡住的：`--out --srt --master --palette --base` 报了"注册表不全"）。
 *   这正是 `crosscheck` 里 `TOOL_FLAGS` / `DOWNSTREAM_FLAGS` 分表的同一条纪律。 */
const DOWNSTREAM_FLAGS = new Set(['--out', '--srt', '--master', '--palette', '--base', '--workdir'])

/* ★★ 旗标三件套的**覆盖断言**（与 `crosscheck` / `measure-count` / `gen-deck` 同款纳管）。
   ① **注册表 ⊇ 源码里出现的全部旗标字面量**（含下游表） ② **每个注册项必须被消费**（`A.<key>` / `opt.<key>`）
   ⚠️ 本断言**不得写出旗标字面量**（否则 ① 会把自己的扫描正则当成未登记旗标 ⇒ 自匹配误判）。 */
{
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const found = [...new Set([...src.matchAll(/'(--[a-zA-Z][\w-]*)'/g)].map((m) => m[1]))]
  const known = new Set(Object.keys(FLAGS))
  const missing = found.filter((f) => !known.has(f) && !DOWNSTREAM_FLAGS.has(f))
  const dead = [...known].filter((n) => !new RegExp(`\\b(A|opt)\\.${FLAGS[n]}\\b|\\b(A|opt)\\['${FLAGS[n]}'\\]`).test(src))
  if (missing.length || dead.length) {
    console.error(`✗ 旗标三件套断言失败：**注册表不全** ${missing.join(' ') || '（无）'} · **注册但未消费** ${dead.join(' ') || '（无）'}`)
    console.error('   规矩：新增旗标必须登记进 FLAGS **并被真正读取**（否则就是"登记即假装覆盖"）⇒ exit 2')
    process.exit(EXIT.INPUT)
  }
  const dsCount = found.filter((f) => DOWNSTREAM_FLAGS.has(f)).length
  console.log(`  ✓ 旗标三件套：自有注册 **${known.size}** · 下游表 **${DOWNSTREAM_FLAGS.size}** · 源码字面量 **${found.length}**` +
    `（自有 ${found.length - dsCount} + 下游 ${dsCount}）全部有归属 · 死旗标 **0**`)
}
const concl = (tag, ok, extra = {}) =>
  console.log(`${ok ? '✓' : '✗'} [${tag}] MAKE-RESULT ok=${ok}${Object.keys(extra).length ? ' · ' + Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' · ') : ''}`)

const run = (file, args) => spawnSync(process.execPath, [join(HERE, file), ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
const tagOf = (out) => (String(out || '').split('\n').map((l) => l.trim()).filter((l) => /\[[A-Z-]+\]/.test(l)).slice(-1)[0] || '(无结论行)')

const mastersDir = join(HERE, 'masters')
const allSkins = existsSync(mastersDir) ? readdirSync(mastersDir).filter((d) => existsSync(join(mastersDir, d, 'master.json'))) : []

function paletteOf(skin) {
  const mf = JSON.parse(readFileSync(join(mastersDir, skin, 'master.json'), 'utf8'))
  const keys = Object.keys(mf.palette || {})
  if (!keys.length) return null
  const i = A.paletteIndex != null ? Number(A.paletteIndex) : 0
  if (!Number.isInteger(i) || i < 0 || i >= keys.length) return { err: `--palette-index=${A.paletteIndex} 越界（${skin} 有 ${keys.length} 项：${keys.join('/')}）` }
  return keys[i]
}

/* ---------------- 主流程 ---------------- */
function main(text, opt) {
  const outRoot = resolve(opt.outdir || join(HERE, 'out-tmp-make'))
  const skins = (opt.skins === 'all' || !opt.skins ? allSkins : String(opt.skins).split(',').map((s) => (s.startsWith('master-') ? s : 'master-' + s)))
  const oris = String(opt.orientations || '16:9').split(',')
  if (opt.clean) {
    /* 只清自己的命名空间（不碰调用者放进来的 --logo/--bgm/--in） */
    for (const sub of ['decks', 'skins']) rmSync(join(outRoot, sub), { recursive: true, force: true })
  }
  mkdirSync(join(outRoot, 'decks'), { recursive: true })
  const textFile = join(outRoot, 'decks', '_source.md')
  writeFileSync(textFile, text, 'utf8')
  console.log(`   输入 ${basename(opt.in || '(内联)')} · 皮肤 ${skins.length} 套 × 方向 ${oris.length} 种 · 母版配色按序号 ${opt.paletteIndex ?? 0}`)
  /* ★ `--plan`：**只打印计划**（不生成、不渲染）—— 此前它被登记却**从未被读**
     （`旗标三件套` 断言 ②「注册但未消费」当场抓出 ⇒ 这里接线，而不是留在表里假装覆盖）。 */
  if (opt.plan) {
    console.log(`   [PLAN] 将生成 ${skins.length} × ${oris.length} = **${skins.length * oris.length}** 条；输出根 ${outRoot}`)
    for (const s of skins) if (!opt.only || s === opt.only) console.log(`     · ${s}`)
    return 0
  }

  const rows = []
  for (const skin of skins) {
    if (opt.only && skin !== opt.only) continue
    const pal = paletteOf(skin)
    if (pal && pal.err) { console.log(`   ✗ [MAKE-ITEM-FAILED] ${skin} · ${pal.err}`); rows.push({ skin, ok: false, why: 'palette-index' }); continue }
    if (!pal) { console.log(`   ✗ [MAKE-ITEM-FAILED] ${skin} · master.json 未声明 palette`); rows.push({ skin, ok: false, why: 'no-palette' }); continue }
    /* ① 文案 ⇒ 该皮肤的 deck + 字幕（每皮肤一份：长度窗口按 schema 校核） */
    const deckPath = join(outRoot, 'decks', `deck.${skin.replace('master-', '')}.json`)
    const srtPath = join(outRoot, 'decks', `subs.${skin.replace('master-', '')}.srt`)
    const gArgs = ['--in', textFile, '--out', deckPath, '--srt', srtPath, '--master', skin, '--palette', pal]
    if (opt.toc) gArgs.push('--toc')
    if (opt.seconds) gArgs.push('--seconds', String(opt.seconds))
    if (opt.title) gArgs.push('--title', opt.title)
    if (opt.issuer) gArgs.push('--issuer', opt.issuer)
    const g = run('gen-deck.mjs', gArgs)
    if (g.status !== 0) {
      console.log(`   ✗ [MAKE-ITEM-FAILED] ${skin} · gen-deck 失败：${tagOf(g.stdout)}`)
      console.log('      ' + String(g.stdout || g.stderr).split('\n').filter((l) => l.includes('✗')).slice(0, 3).map((s) => s.trim()).join('\n      '))
      rows.push({ skin, ok: false, why: 'gen-deck:' + g.status }); continue
    }
    /* ② 渲染 + 合成：交给 batch-video（单皮肤、自己的 outdir；字幕恒定带上） */
    /* ⚠️ `batch-video` 的 `--outdir` 内部用 `join(HERE, x)`（**不是 resolve**）⇒ 传**绝对路径会被拼坏**
     *   （`join(HERE, 'G:\\…')` ⇒ `HERE\\G:\\…`）。这里按**相对 HERE** 传；该不一致我已报给 probe-html。 */
    const relToHere = (p) => (p.startsWith(HERE + sep) ? p.slice(HERE.length + 1) : p)
    const bArgs = ['--base', deckPath, '--skins', skin, '--orientations', oris.join(','),
      '--srt', srtPath, '--outdir', relToHere(join(outRoot, 'skins', skin.replace('master-', '')))]
    if (opt.logo) bArgs.push('--logo', resolve(opt.logo))
    if (opt.bgm) bArgs.push('--bgm', resolve(opt.bgm))
    if (opt.sheet) bArgs.push('--sheet')
    /* ★ `--dry-run` **接线**（此前登记却未被读 ⇒ 断言②抓出）：透传给 batch-video ⇒ 只校验不渲染。 */
    if (opt.dryRun) bArgs.push('--dry-run')
    const b = run('batch-video.mjs', bArgs)
    const rep = (() => { try { return JSON.parse(readFileSync(join(outRoot, 'skins', skin.replace('master-', ''), 'batch-report.json'), 'utf8')) } catch { return null } })()
    if (b.status !== 0 || !rep) {
      console.log(`   ✗ [MAKE-ITEM-FAILED] ${skin} · batch-video 失败：${tagOf(b.stdout)}`)
      rows.push({ skin, ok: false, why: 'batch-video:' + b.status }); continue
    }
    for (const r of rep.rows) rows.push({ skin, ori: r.ori, palette: pal, ok: r.ok, final: r.final, dur: r.dur, sizeMB: r.sizeMB, why: r.why })
    const pages = (() => { try { return JSON.parse(readFileSync(deckPath, 'utf8')).pages.length } catch { return '?' } })()
    console.log(`   ✓ [MAKE-ITEM-OK] ${skin} · 配色 ${pal} · ${pages} 页 · 方向 ${rep.rows.filter((r) => r.ok).length}/${rep.rows.length} 条成片`)
  }
  const fail = rows.filter((r) => !r.ok).length
  const report = { at: new Date().toISOString(), input: opt.in || '(内联)', skins: skins.length, oris, rows, ok: fail === 0, fail }
  writeFileSync(join(outRoot, 'make-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`   汇总：成片 ${rows.filter((r) => r.ok).length}/${rows.length} 条 · 报告 ${join(outRoot, 'make-report.json')}`)
  for (const r of rows.filter((x) => x.ok)) console.log(`     · ${String(r.skin).replace('master-', '').padEnd(10)} ${String(r.ori).padEnd(6)} ${String(r.dur || '?').padStart(6)}s ${String(r.sizeMB || '?').padStart(5)}MB`)
  return fail
}

/* ---------------- 自测：合成 2 行文案 ⇒ 真跑 1 皮肤 × 1 方向 ---------------- */
function selfTest() {
  const tmp = join(HERE, 'out-tmp-make', '_selftest')      // ★ 只在自己的子目录里活动
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true })
  const md = join(tmp, 'copy.md')
  writeFileSync(md, [
    '# 自测成片',
    '两行文案也要能出片',
    '',
    '## 为什么值得换',
    '- 传统剪辑一条片四小时起步',
    '- 这套流程十分钟就能出片',
    '- 同一条文案可批量出多版本',
    '省下的是重复劳动，不是创意',
    '',
    '## 上线四步',
    '1. 定稿文案与旁白',
    '2. 导出带时间戳的字幕',
    '3. 生成页面并过契约校验',
    '4. 渲染成片并抽帧验收',
    '',
    '下一步：挑一套皮肤，出第一条片',
  ].join('\n'), 'utf8')
  const cases = []
  const fail = main(readFileSync(md, 'utf8'), { in: md, skins: 'master-mono', orientations: '16:9', outdir: tmp, plan: true })
  const rep = (() => { try { return JSON.parse(readFileSync(join(tmp, 'make-report.json'), 'utf8')) } catch { return null } })()
  const okRow = rep && rep.rows.length === 1 && rep.rows[0].ok
  const finalExists = okRow && existsSync(join(HERE, rep.rows[0].final))
  console.log(`   自测：MAKE 退出=${fail}（须 0）· 报告条数=${rep ? rep.rows.length : '?'}（须 1）· 产物存在=${finalExists}`)
  cases.push(fail === 0, !!okRow, finalExists)
  /* 负控：输入不存在 ⇒ exit 2（不许抛栈） */
  const bad = spawnSync(process.execPath, [join(HERE, 'make-video.mjs'), '--in', join(tmp, 'nope.md')], { encoding: 'utf8' })
  const badOk = bad.status === EXIT.INPUT
  console.log(`   负控（输入不存在）⇒ exit=${bad.status}（须 2）`)
  cases.push(badOk)
  const fails = cases.filter((x) => !x).length
  concl('MAKE-SELFTEST', fails === 0, { 用例: cases.length, 失败: fails })
  rmSync(tmp, { recursive: true, force: true })
  return fails === 0 ? EXIT.OK : EXIT.FAIL
}

if (A.selfTest) process.exit(selfTest())
if (!A.in || !existsSync(resolve(A.in))) {
  console.error(`✗ --in 不存在或未给：${A.in || '(空)'}`)
  concl('MAKE-INPUT-MISSING', false, {}); process.exit(EXIT.INPUT)
}
const text = readFileSync(resolve(A.in), 'utf8')
if (!text.trim()) { console.error('✗ 输入为空'); concl('MAKE-EMPTY', false, {}); process.exit(EXIT.INPUT) }
const fail = main(text, A)
concl('MAKE-OK', fail === 0, { 成片: '-', 失败: fail })
process.exit(fail === 0 ? EXIT.OK : EXIT.FAIL)
