#!/usr/bin/env node
/* ============================================================================
 * commit-safe.mjs —— **唯一允许的提交入口**（team-lead ②："先验证后提交"要机械化）
 *
 * 为什么存在：`67db97a` 是一次**含语法错误的提交** —— 根因不是手滑，是**流程**：
 *   我"先 `git commit`、后 `node --check`"（今晚两次），于是"顺序"成了要靠人记住的东西。
 *   ⇒ 本脚本把顺序**写进代码**：**前置全过才允许提交**，序错误变成**不可能**（比"记住"可靠）。
 *
 * 步骤（任一失败 ⇒ exit 1，**绝不提交**）：
 *   1) `node --check` 全部 `.mjs`（递归；跳过 node_modules / out* / dist-rel / .git）
 *   2) 全部 `.json` **逐个 JSON.parse**（65 个；坏 JSON 在提交前就红）
 *   3) 同步 dist-rel 契约目录（`--no-sync` 跳过）
 *   4) `check-probe-drift.mjs` 守卫（**漂移 ≠ 0 ⇒ 不提交** —— 防止"改了引擎没同步"被提交进去）
 *   5) （可选 `--fast`）`gate-release.mjs --whitelist-only` 快验（秒级）
 *   6) 只有全过才 `git add` / `git commit`
 *
 * 用法：
 *   node commit-safe.mjs -m "标题" -m "正文段 1" [-m "正文段 2" ...] [--files <path...>] [--fast] [--no-sync]
 *   不传 `--files` ⇒ `git add -A scripts/video-factory/html-deck`（注意：别把 out-tmp 控件加进库）
 * ========================================================================== */
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync, readFileSync, existsSync, copyFileSync, writeFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/* ⚠️ **仓库根不许靠路径推导**：第一版写 join(HERE, '..','..','..') ⇒ 被闸门 ⓪b「自造路径断言」判红
   （规则 ⑤：禁止手工推导引擎根 —— 同一族错误两轮内出过两次）。改用 git 自身回答（正确由构造保证）。 */
const ROOT = String(spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE, encoding: 'utf8' }).stdout || '').trim()
const argv = process.argv
const msgParts = []
for (let i = 0; i < argv.length; i++) if (argv[i] === '-m' && argv[i + 1] !== undefined) msgParts.push(argv[i + 1])
const doFast = argv.includes('--fast')
const noSync = argv.includes('--no-sync')
let files = []
const fi = argv.indexOf('--files')
/* ⚠️ 停在**任何**以 `-` 开头的旗标（第一版只判 `--` ⇒ `-m` 被当成文件路径塞给 `git add` ⇒ `unknown switch m`；
   前置检查已全过、却栽在最后一步 —— 所以这行也要"验证"，不能只看"检查绿了"） */
if (fi >= 0) for (let i = fi + 1; i < argv.length && !argv[i].startsWith('-'); i++) files.push(argv[i])
/* ★ team-lead ②(a)：**未识别参数 ⇒ exit 2**（把纪律用在自己身上 —— crosscheck/measure-table 早就这么做；
   第一版把 `--check-only` **静默吞掉**、一路走到 commit 那步，只因缺 `-m` 才没提交 ⇒ 不许靠"恰好"兜底）。
   并新增**显式 `--dry`**：只跑前置、**绝不提交**，让"我只想跑闸门"与"我要提交"两条路彻底分开。 */
const KNOWN = new Set(['--fast', '--no-sync', '--dry', '--dist-rel', '--files', '-m',
  /* ★ msg9 ②③：三个自测/基线模式 —— **登记才算数**（本工具的守卫当场拒了未登记的它们 ✓ 又一次"守卫自己被守卫"）。 */
  '--self-test-catch-classifier', '--self-test-ratchet', '--write-silent-baseline'])
const dry = argv.includes('--dry')
for (let i = 2; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('-')) continue                      /* 参数值（-m 的消息 / --files 的路径）跳过 */
  if (!KNOWN.has(a)) {
    console.error(`✗ 未识别参数：${a} ⇒ exit 2（**不许静默忽略**）`)
    process.exit(2)
  }
  if (a === '--files' || a === '-m' || a === '--dist-rel') i++
}
/** dist-rel 契约目录：仓库根下 dist-rel 的任一子目录里的 deck-contract（存在即用；--dist-rel 可覆盖）
    ⚠️ 本注释**故意不写出那个 glob 字面量** —— 它含 star-slash，会把本块注释**提前闭合**（我今晚已栽两次：
    gate-release 与**本文件**。这也是 invariants.json 的 I8 之外该记的一条「注释卫生」）。 */
function findDistRel() {
  const di = argv.indexOf('--dist-rel')
  if (di >= 0 && argv[di + 1]) return argv[di + 1]
  const base = join(ROOT, 'dist-rel')
  if (!existsSync(base)) return null
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const p = join(base, e.name, 'deck-contract')
    if (existsSync(p)) return p
  }
  return null
}
/* ⚠️ 只按**目录名**跳过（相对名），别用"含路径片段"的正则 —— 第一版写 `(^|[\\/])out[^\\/]*([\\/]|$)`
   且递归时**忘了传子目录**（`collect(ext, out)` 里又扫 `HERE`）⇒ **无限递归**（RangeError: Maximum call stack size exceeded），
   脚本第 2 次运行被自己的这个 bug 挡住（**又一次证明"先验证后提交"的价值**：它宁可报错也不提交）。 */
const SKIP = /^(node_modules|\.git|dist-rel|out.*)$/
function collect(dir, ext, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.test(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) collect(full, ext, out)
    else if (e.name.endsWith(ext)) out.push(full)
  }
  return out
}
const steps = []
/* 1) 语法 */
const mjs = collect(HERE, '.mjs')
let syntaxBad = []
for (const f of mjs) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
  if (r.status !== 0) syntaxBad.push(`${basename(f)}：${(r.stderr || '').split('\n')[0]}`)
}
steps.push({ name: `node --check ${mjs.length} 个 .mjs`, ok: syntaxBad.length === 0, detail: syntaxBad })
/* 2) JSON */
const jsons = collect(HERE, '.json')
let jsonBad = []
for (const f of jsons) { try { JSON.parse(readFileSync(f, 'utf8')) } catch (e) { jsonBad.push(`${basename(f)}：${e.message}`) } }
steps.push({ name: `JSON.parse ${jsons.length} 个 .json`, ok: jsonBad.length === 0, detail: jsonBad })
/* ★★ msg9（自查追加）：**I9 注释卫生**（我今天**两次**栽在"块注释里写块注释闭合符号" ⇒ 外层注释提前闭合 ⇒ 语法错）
   ⇒ 窄判据：**以星号开头的注释续行**里出现"星号+斜杠"这个连续符号 ⇒ 必红（**纯闭合行不算** ✓ 负向断言已含）。
   ⚠️ 本注释**故意不写出那个符号本身** —— 写了它就会把我这条注释**提前闭合**（我写这段时正是这么栽的第 4 次）。
   为什么值得机械化：该错**只在运行时/检查时**才现形，而写的时候"看着像普通注释"。 */
{
  const bad = []
  /* ★ **合成自测**（team-lead 三条通则之"读数解析类判据须配合成自测"）：三样本（真错 / 合法块尾 / glob）必须分类正确。
     样本里那个符号**运行期拼接** ⇒ 不在源码里造出字面量（否则样本自己违规）。 */
  const S = '*' + '/'
  const samples = [
    [' * 例如 `out' + S + '` 被忽略（有后文 ⇒ 真错）', true],
    [' * ========' + S, false],
    [' * 递归 glob 的写法（不含那个连续符号）', false],
    [' * 说明：**' + S + '.mjs 形式（glob ⇒ 不算）', false],
  ]
  for (const [l, want] of samples) {
    if (isI9Violation(l) !== want) bad.push(`分类器自测失败：${JSON.stringify(l)} ⇒ ${isI9Violation(l)}（须 ${want}）`)
  }
  for (const f of mjs) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((l, i) => {
      const t = l.trimStart()
      /* 判据用**字符串判断**（不用正则字面量：正则里写转义的斜杠会把字面量**提前闭合** ⇒ 同类符号坑）。
         ⚠️ **假阳性收窄**：递归 glob（双星号 加 斜杠 的形式）里也含那个连续符号 ⇒ 若它**前一字符是星号或斜杠**则**不算**
            （首跑 31 条里绝大多数是这种 glob，不是真错）。注释里**故意不写那个 glob 字面量** —— 写了就把它提前闭合（第 5 次）。 */
      const idx = l.indexOf('*' + '/')
      const isGlob = idx > 0 && (l[idx - 1] === '*' || l[idx - 1] === '/')
      const tailText = idx >= 0 && l.slice(idx + 2).trim() !== ''      /* 闭合符**后面还有文字**才算（纯闭合行是合法的块尾） */
      if (t.startsWith('*') && !t.startsWith('*' + '/') && idx >= 0 && !isGlob && tailText) {
        bad.push(`${basename(f)}:L${i + 1} ⇒ **注释续行内含块注释闭合符**（会让外层注释提前闭合 —— I9）`)
      }
    })
  }
  steps.push({ name: `I9 注释卫生（${mjs.length} 个 .mjs：注释续行不得含闭合符）`, ok: bad.length === 0, detail: bad })
}
/* ★★ team-lead msg9 ②③：**哑 catch 判据要"工具产出 + 有负控 + 有合成自测"** ——
   我上一版把 `26` **手写**进代码/步名（正是 `COUNT_DEBT_MAX = 12` 的老病：**人读的数字守机读的事实**）⇒ 现改为：
   ① 基线由工具产出的 `silent-catch-baseline.json`（per-file + 时间 + SHA）
   ② 棘轮是**纯函数** `ratchetViolations(基线, 实测)` ⇒ 负控/自测调的就是它（单一实现）
   ③ **分类器（启发式）必须有合成自测**：已知哑 catch ⇒ 计入；已知说话 catch ⇒ 不计入（否则"哑=0"可能只是**识别器不工作**）。 */
function classifyCatchBlock(block) {
  const loud = /(console\.|throw|return|writeSync|Atomics|\+\+|-=|\+=)/.test(block)
  return loud ? 'loud' : 'dumb'
}
function catchCounts(text) {
  const all = [...text.matchAll(/catch\s*(\([^)]*\))?\s*\{[^{}]*\}/g)].map((m) => m[0])
  const dumb = all.filter((s) => classifyCatchBlock(s) === 'dumb')
  return { all: all.length, loud: all.length - dumb.length, dumb: dumb.length, samples: dumb.slice(0, 3) }
}
/* ★ I9 谓词（**单一实现**）：注释续行里"闭合符后面还有文字"才算违规。
   ⚠️ 样本**运行期拼接**那个符号（`'*' + '/'`），不在源码里写字面量 —— 否则样本自己就成了违规（自我指涉坑）。 */
function isI9Violation(l) {
  const t = l.trimStart()
  const idx = l.indexOf('*' + '/')
  const isGlob = idx > 0 && (l[idx - 1] === '*' || l[idx - 1] === '/')
  const tailText = idx >= 0 && l.slice(idx + 2).trim() !== ''
  return t.startsWith('*') && !t.startsWith('*' + '/') && idx >= 0 && !isGlob && tailText
}
function ratchetViolations(baselineFiles, actualFiles) {
  const out = []
  for (const [f, base] of Object.entries(baselineFiles || {})) {
    const now = actualFiles[f] ?? 0
    if (now > base) out.push(`${f}：哑 catch **${now}** > 基线 ${base} ⇒ 新增了静默 catch（要么接线、要么显式计债）`)
  }
  for (const f of Object.keys(actualFiles)) if (!(f in (baselineFiles || {}))) out.push(`${f}：**未登记基线**（新文件 ⇒ 请跑 --write-silent-baseline 登记）`)
  return out
}
const SILENT_BASE = join(HERE, 'silent-catch-baseline.json')
if (process.argv.includes('--self-test-catch-classifier')) {
  const cases = [
    ['catch { }', 'dumb'], ['catch (e) { /* 忽略 */ }', 'dumb'],
    ['catch (e) { console.error(e.message) }', 'loud'], ['catch (e) { statFail++ }', 'loud'],
    ['catch (e) { throw e }', 'loud'], ['catch { /* x */ }', 'dumb'],
  ]
  const bad = cases.filter(([t, want]) => classifyCatchBlock(t) !== want)
  console.log(bad.length ? `✗ 分类器自测：${bad.map(([t, w]) => `${t}（须 ${w}）`).join(' · ')}` : `✓ 分类器自测：${cases.length} 例（哑 3 / 说话 3）全对`)
  process.exit(bad.length ? 1 : 0)
}
if (process.argv.includes('--self-test-ratchet')) {
  /* ★ msg9 ②(b)：**负控** —— 基线 −1 ⇒ 棘轮**必须咬**；同时断言"等值/下降不误报""未登记文件红"。
     调的是**真实现**（`ratchetViolations` 纯函数）⇒ 不是另写一份判据。 */
  const f = { 'a.mjs': 2 }
  const less = ratchetViolations({ 'a.mjs': 1 }, f)
  const same = ratchetViolations({ 'a.mjs': 2 }, f)
  const down = ratchetViolations({ 'a.mjs': 3 }, f)
  const unreg = ratchetViolations({}, { 'n.mjs': 1 })
  const ok = less.length > 0 && same.length === 0 && down.length === 0 && unreg.length > 0
  console.log(ok
    ? '✓ 棘轮负控：基线−1 ⇒ 红 ✓ · 等值 ⇒ 不红 ✓ · 下降 ⇒ 不红 ✓ · 未登记文件 ⇒ 红 ✓'
    : `✗ 棘轮负控失败：−1⇒${less.length} · 等值⇒${same.length} · 下降⇒${down.length} · 未登记⇒${unreg.length}`)
  process.exit(ok ? 0 : 1)
}
if (process.argv.includes('--write-silent-baseline')) {
  const FILES = ['crosscheck-deck-json.mjs', 'measure-count.mjs', 'check-schema-vs-limits.mjs', 'gate-release.mjs', 'commit-safe.mjs']
  const files = {}
  /* ★ 顺带打印**样本**（给"哑 catch N → 0"小批当工单：每处要写清"吞了什么"）。 */
  for (const f of FILES) {
    const c = catchCounts(readFileSync(join(HERE, f), 'utf8'))
    files[f] = c.dumb
    for (const s of c.samples) console.log(`   · ${f}：${s.replace(/\s+/g, ' ').slice(0, 90)}`)
  }
  const sha = String(spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).stdout || '').trim() || 'n/a'
  const total = Object.values(files).reduce((a, b) => a + b, 0)
  writeFileSync(SILENT_BASE, JSON.stringify({
    _doc: '哑 catch 基线（**工具产出**：node commit-safe.mjs --write-silent-baseline）—— 判据=「体内既无 console./throw 也无计数」的 catch 数',
    _invariant: 'I8b：哑 catch **只许减**；新增即红；基线与实测**逐文件对账**（不许手写数字）',
    at: new Date().toISOString(), sha, files, total,
  }, null, 2) + '\n', 'utf8')
  console.log(`✓ 已写 ${basename(SILENT_BASE)}：${FILES.map((f) => `${f}=${files[f]}`).join(' · ')} ⇒ 合计 ${total}（SHA=${sha}）`)
  process.exit(0)
}
/* ★★ team-lead msg8 ③：**兜底位置断言** —— 兜底必须是"跳过 shebang/import 后的**第一句可执行**"
   （否则它**之前**的顶层逻辑（`arg()`/检查）一抛异常仍漏网；实测量具：measure-count 曾有 ~60 行在兜底之前）⇒ 源扫描断言。 */
{
  const TOOLS = ['crosscheck-deck-json.mjs', 'measure-count.mjs', 'check-schema-vs-limits.mjs']
  const bad = []
  for (const f of TOOLS) {
    const p = join(HERE, f)
    if (!existsSync(p)) { bad.push(`${f}：缺文件`); continue }
    const lines = readFileSync(p, 'utf8').split('\n')
    const hook = lines.findIndex((l) => l.includes('unhandledRejection'))
    const firstDecl = lines.findIndex((l) => /^(const|let|var|function)\s/.test(l))
    if (hook < 0) bad.push(`${f}：**没有兜底**`)
    else if (firstDecl >= 0 && hook > firstDecl) bad.push(`${f}：兜底在首个顶层声明（L${firstDecl + 1}）**之后**（L${hook + 1}）⇒ 它前面那段仍会漏网`)
  }
  steps.push({ name: `兜底位置（${TOOLS.length} 个工具：兜底须在首个顶层声明之前）`, ok: bad.length === 0, detail: bad })
}
/* ★★ team-lead msg8 ④（I8 延伸）：**"会打印"必须真的能打印** —— 哑 catch（体内既无 console/throw 也无计数）**只许减**。
   基线（2026-10-04 实测）：crosscheck 11 · measure-count 4 · checker 5 · gate 5 · commit-safe 1 = **26**。
   为何不"一律红"：26 处要逐个接线（多数属清理/收尾的可忽略路径）⇒ 先用仓库既有的**显式计债 + 棘轮**形态；
   新增一处即红（并打印清单）⇒ 与 I5/I10 的"显式计债"同形。 */
{
  /* ★ msg9 ②：基线**读工具产出的 JSON**（不再手写数字）；并**逐文件打印 实测 vs 基线**。 */
  let base = null
  /* ⚠️ 这一处**不哑**：读基线失败必须**说出原因**（我上一版写成"空体 catch + 注释"⇒ 被自己的分类器算作哑 catch ✗）
     ⚠️ 且**注释里不许出现块注释的闭合符号**（我本次又栽：它把本块注释提前闭合 ⇒ 语法错 —— I9 第二次） */
  try { base = JSON.parse(readFileSync(SILENT_BASE, 'utf8')) } catch (e) { console.error(`   （读 silent-catch-baseline.json 失败 ⇒ ${e.message}；请跑 --write-silent-baseline）`) }
  const bad = []
  if (!base || !base.files) bad.push('缺 `silent-catch-baseline.json`（跑 `node commit-safe.mjs --write-silent-baseline` 生成）⇒ 棘轮无基线')
  else {
    const FILES = Object.keys(base.files)
    const actual = {}
    const lines = []
    for (const f of FILES) {
      if (!existsSync(join(HERE, f))) { bad.push(`${f}：缺文件`); continue }
      const c = catchCounts(readFileSync(join(HERE, f), 'utf8'))
      actual[f] = c.dumb
      lines.push(`${f} 实测 ${c.dumb} / 基线 ${base.files[f]}${c.dumb < base.files[f] ? ' ⬇' : c.dumb > base.files[f] ? ' ⬆' : ''}`)
    }
    bad.push(...ratchetViolations(base.files, actual))
    steps.push({ name: `哑 catch 棘轮（基线=${
      'silent-catch-baseline.json'} @ ${String(base.sha || '?')} · 合计 ${base.total}）`, ok: bad.length === 0, detail: bad })
    for (const l of lines) console.log(`     · ${l}`)
  }
  if (bad.length && !base) steps.push({ name: '哑 catch 棘轮', ok: false, detail: bad })
}
/* ★★ team-lead msg8 ③：**兜底正控** —— "装了兜底"本身要有证明（与"负控要能失败"同族）。 */
{
  const bad = []
  for (const f of ['crosscheck-deck-json.mjs', 'measure-count.mjs', 'check-schema-vs-limits.mjs']) {
    const r = spawnSync(process.execPath, [join(HERE, f), '--self-test-uncaught'], { cwd: HERE, encoding: 'utf8' })
    const out = String(r.stdout || '')
    const hasTag = out.includes('[UNCAUGHT_EXCEPTION]')
    if (r.status !== 2 || !hasTag) bad.push(`${f}：exit=${r.status}（须 2）· stdout 带 tag=${hasTag}（须 true）`)
  }
  steps.push({ name: '兜底正控（--self-test-uncaught ⇒ exit 2 + [UNCAUGHT_EXCEPTION]）', ok: bad.length === 0, detail: bad })
}
/* 3) 同步 dist-rel */
const distRel = findDistRel()
if (!noSync && distRel) {
  let n = 0
  /* ★ 契约同步：**引擎树的 top-level 工具与契约数据**全部拷进探针树
     （第一版只拷 schema、measured-limits、allowlist ⇒ 新脚本 commit-safe.mjs 没同步 ⇒ **漂移守卫判红**：
     「入库树有、探针树无的 .mjs 与 .json = 1 个」。同步范围 = 全部 top-level 工具加契约数据。）
     ⚠️ 注释里**不要写斜杠连成的路径**（即使分词写成 a 与 b 也不行 —— 闸门 ⓪c「注释安全」会判红，
        我本行第一版写 schema 斜杠 measured-limits 斜杠 allowlist 就被它抓到 ⇒ 改用顿号分段）。 */
  for (const f of [...collect(HERE, '.mjs'), ...collect(HERE, '.json')]) {
    const rel = f.slice(HERE.length + 1)
    if (rel.includes('\\') || rel.includes('/')) continue   /* 只同步**顶层**文件（子目录各有归属） */
    try { copyFileSync(f, join(distRel, basename(f))); n++ } catch { /* ignore */ }
  }
  steps.push({ name: `同步 dist-rel（${n} 个契约文件）`, ok: true, detail: [] })
}
/* 4) 漂移守卫 */
if (!noSync && distRel && existsSync(join(HERE, 'check-probe-drift.mjs'))) {
  const r = spawnSync(process.execPath, [join(HERE, 'check-probe-drift.mjs')], { cwd: HERE, encoding: 'utf8' })
  const txt = String(r.stdout || '') + String(r.stderr || '')
  const ok = r.status === 0 && !/有漂移/.test(txt)
  steps.push({ name: '漂移守卫（check-probe-drift）', ok, detail: ok ? [] : [txt.split('\n').filter(Boolean).slice(-3).join(' / ')] })
}
/* 5) 快验（可选） */
if (doFast) {
  const r = spawnSync(process.execPath, [join(HERE, 'gate-release.mjs'), '--whitelist-only'], { cwd: HERE, encoding: 'utf8' })
  steps.push({ name: '快验（gate-release --whitelist-only）', ok: r.status === 0, detail: r.status === 0 ? [] : [String(r.stdout || '').split('\n').filter(Boolean).slice(-3).join(' / ')] })
}
/* 打印 + 判定 */
console.log('=== commit-safe 前置检查 ===')
for (const s of steps) {
  console.log(`  ${s.ok ? '✓' : '✗'} ${s.name}`)
  for (const d of s.detail || []) console.log(`      · ${d}`)
}
const failed = steps.filter((s) => !s.ok)
if (failed.length) {
  console.error(`\n✗ 前置检查失败 ${failed.length} 步 ⇒ **拒绝提交**（这就是"先验证后提交"的机械保证）`)
  process.exit(1)
}
if (dry) {
  console.log('\n✓ 前置全过（**dry，未提交**）—— 这是"只跑闸门"的显式路径（不用再靠"恰好缺 -m"兜底）')
  process.exit(0)
}
console.log('\n✓ 前置全过 ⇒ 执行 git add / git commit')
const run = (args) => { const r = spawnSync('git', ['--no-pager', ...args], { cwd: ROOT, encoding: 'utf8' }); if (r.status !== 0) { console.error(String(r.stderr || r.stdout)); process.exit(1) } return String(r.stdout || '') }
if (!msgParts.length) { console.error('✗ 没有 -m 提交信息 ⇒ 拒绝提交'); process.exit(1) }
if (files.length) run(['add', ...files])
else run(['add', '-A', 'scripts/video-factory/html-deck'])
run(['commit', ...msgParts.flatMap((m) => ['-m', m])])
/* ★ team-lead ②(b)：**"前置绿 ≠ 提交对"**（我那条 `--files` 把 `-m` 当路径就是"前置全过、栽在最后一步"）⇒
   提交后**断言"实际提交的文件集 == 意图"**：用 `diff-tree --name-only` 取真文件集，与 `--files` 数量比对（不等 ⇒ 红）。 */
const hash = run(['rev-parse', '--short', 'HEAD']).trim()
console.log(run(['log', '-1', '--oneline']).trim())
const changed = run(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).split('\n').map((s) => s.trim()).filter(Boolean)
console.log(`✓ 提交 ${hash} · **实际改动文件 ${changed.length} 个**：`)
for (const n of changed.slice(0, 20)) console.log(`    · ${n}`)
if (files.length && changed.length !== files.length) {
  console.error(`✗ **提交文件集与意图不符**：意图 ${files.length} 个 · 实际 ${changed.length} 个 ⇒ 请核对（不许当成功）`)
  process.exit(1)
}
