#!/usr/bin/env node
/**
 * crosscheck-deck-json.mjs —— **deck JSON 真渲染路**（"双路交叉校验"的第二路；team-lead 要求）
 *
 * 为什么需要它：量表 `measure-sweep.mjs` 用的是 **HTML 注入法**（在已渲染产物里替换文字再测）。
 * 若"注入方式"本身引入偏差（例如改了 DOM 却漏了别处引用同一文案的地方），量表给出的上限就不可复核。
 * ⇒ 本工具走**源头路**：改 `examples/` 下各 deck JSON 的**字段**（如 `meta.title`）→ **真渲染** → 同一个判据闸门读结论。
 *
 * 用法：
 *   node crosscheck-deck-json.mjs --json examples/deck.master-v1.json --field meta.title \
 *        --cls cover-title --ks 36,37,38 [--outdir out-xcheck] [--pathA 37]
 *
 * 输出（每 k 一行，**两路都报原始读数**）：
 *   k · 读回长度 · 门 exit · 判据内 codes（稳定帧原文）· 结论
 * 判读规则（team-lead）：**两路不一致 ⇒ 先查"注入方式是否引入偏差"**；不许取平均、不许以某一路为准。
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'   /* ★ ④-2：覆盖 schema 只写**仓库外**（%TEMP%） */
import { DECK_DIR } from './paths.mjs'
import { resolveHyperframes } from './engine-bin.mjs'
import { pageNoOfSelector, settledAt } from './timing.mjs'
import { domTarget } from './dom-target.mjs'
/* ★★ team-lead msg8 ③：**兜底必须是"跳过 shebang/import 后的第一句可执行"** ——
   否则它**之前**的顶层逻辑（`arg()`/各种检查）一抛异常**仍然漏网**（实测量具：measure-count 曾有 ~60 行在兜底之前）。
   ⚠️ 该位置**不再靠记**：`commit-safe` 的语法门禁断言「每工具的**首个顶层声明**必须在兜底之后」（我做反面例证时被它抓过）。 */
for (const [ev, tag] of [['uncaughtException', 'UNCAUGHT_EXCEPTION'], ['unhandledRejection', 'UNCAUGHT_REJECTION']]) {
  process.on(ev, (e) => {
    console.log(`✗ **[${tag}] 未捕获的故障 ⇒ 已转为带 tag 的红（exit 2）：${(e && e.message) || e}`)
    const st = String((e && e.stack) || '').split('\n').slice(1, 4).join(' | ')
    if (st) console.error(`     ${st}`)
    process.exit(2)
  })
}
/* ★ msg8 ③：**兜底本身要有正控** —— 该旗标主动抛，用来断言"兜底真的会转 tag + exit 2"（否则"装了兜底"未经证明）。 */
if (process.argv.includes('--self-test-uncaught')) throw new Error('自测：故意抛出（验证兜底转 tag）')

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
/* ★ 记录每个 flag 消费掉的下标 ⇒ 事后检查**未识别参数**（这正是 `--ks 37 38` 被拆成两个 argv 时暴露的信号：
   `38` 成了没人认领的位置参数 ⇒ 必须 exit 2，而不是静默只用 37、"临界+1 恒缺"） */
const _consumed = new Set()
const arg = (k, d) => {
  const i = args.indexOf(k)
  if (i >= 0) { _consumed.add(i); _consumed.add(i + 1); return args[i + 1] }
  return d
}
/* ★ 布尔旗标要**登记消费下标**，否则会被自己的"未识别参数 ⇒ exit 2"守卫拒掉
   （实测：`--allow-multi` 与 `--keep` 都因为只按 `process.argv.includes` 判、没登记而被拒 —— 又一次"把纪律用在自己身上"） */
const flag = (k) => { const i = args.indexOf(k); if (i >= 0) { _consumed.add(i); return true } return false }
const ALLOW_MULTI = flag('--allow-multi')
const KEEP_OUT = flag('--keep')
/** ★ team-lead msg6 ④：**跨工具提示** —— 未识别旗标时查一遍本仓其它工具，直接告诉你该用哪个
    （他两度用错工具、各白跑一次：`--verify-cell`/`--self-test-page` 都不在本工具里）。 */
function siblingHint(flagName) {
  /* ⚠️ **逐文件 try**（把整个循环包在一个 try 里 ⇒ 任何**单个**文件读取失败都会**吞掉整轮扫描**并返回 ''：
     症状是"明明有别的工具在用这个旗标，却提示本工具不认识" ⇒ 正是我实测遇到的。单调 try 是"静默失败"家族。） */
  let scanned = 0
  try {
    for (const f of readdirSync(HERE)) {
      if (!f.endsWith('.mjs') || f === 'crosscheck-deck-json.mjs') continue
      /* 两种引号都认（**单引号形式与双引号形式**）—— 第一版只认单引号 ⇒ 若目标文件写成双引号就**静默不命中**
         ⚠️ 本注释**故意不写那两个带引号的旗标字面量** —— 写了就会被本工具的注册表断言扫到（实测：`✗ 旗标注册表不全：--x`）。 */
      try { const t = readFileSync(join(HERE, f), 'utf8'); scanned++; if (t.includes("'" + flagName + "'") || t.includes('"' + flagName + '"')) return f } catch { /* 单个文件失败 ⇒ 跳过，不吞整轮 */ }
    }
    if (!scanned) console.error('   （跨工具提示：本目录没有可扫描的 .mjs）')
    else console.error(`   （跨工具提示：已扫 ${scanned} 个 .mjs，未见到该旗标）`)
  } catch (e) { console.error(`   （跨工具提示：扫描失败 ⇒ ${e.message}）`) }   /* ★ msg6 ⑥：catch 必须说话，不许静默 */
  return ''
}
/* ★★ team-lead ②：**旗标注册表**（"**守卫自己也要被守卫**" —— 本会话第 4 例同族：
   ① 负控失去判伪力 ② 棘轮是手写数 ③ 参数守卫拒自己的旗标 ④ **注册表只覆盖 2/11**）。
   两张表**分开**：**本工具旗标** vs **下游引擎旗标**（把下游的算成自己的 ⇒ 会造出**假覆盖**）。
   断言：文件里出现的每个「引号包起来的双横线旗标字面量」都必须登记（⚠️ 本行**故意不写那个形态** —— 写了就会被自己的断言扫到，实测踩过）；
   `--self-test-usage` 的用例集合必须**覆盖全部本工具旗标**。 */
const TOOL_FLAGS = [
  { name: '--json', argv: true, case: 'auto-hit' }, { name: '--field', argv: true, case: 'auto-hit' },
  { name: '--cls', argv: true, case: 'auto-hit' }, { name: '--ks', argv: true, case: 'auto-hit' },
  { name: '--pathA', argv: true, case: '(对照打印)' }, { name: '--raise-max', argv: true, case: 'auto-hit' },
  { name: '--judge-fixture', argv: true, case: 'judge-fixture' }, { name: '--at', argv: true, case: '(内部)' },
  { name: '--readback-offset', argv: true, case: 'offset' },
  { name: '--keep', argv: false, case: 'keep' }, { name: '--allow-multi', argv: false, case: 'multi-allow' },
  { name: '--self-test-usage', argv: false, case: '(自身)' },
  { name: '--self-test-page', argv: false, case: '(自身)' },
  { name: '--self-test-uncaught', argv: false, case: '(自身)' },   /* ★ msg8 ③：兜底正控（主动抛 ⇒ 断言转 tag） */
  { name: '--expect-page', argv: true, case: '(格子断言)' },
  /* ★ team-lead ②(1)：`--page-unknown` = **显式豁免**（承认本轮不校验同页 ⇒ 读数待判、不得入表）。
     注：登记在这里**也是"守卫自己被守卫"的实例** —— 我加这两个旗标时，本工具**自己的注册表断言**先判红
     （`✗ 旗标注册表不全：--page-unknown --self-test-page`）⇒ 我照它补登。 */
  { name: '--page-unknown', argv: false, case: '(格子断言)' },
]
const DOWNSTREAM_FLAGS = ['--outdir', '--assert-overlap', '--assert-decor', '--no-contrast']
/* ★ **外部命令**（git 等）的旗标：本工具**不解析**、只是转交给外部程序 ⇒ 单列一类（不是"下游引擎"，
   也不是本工具旗标）。加这一类的原因：我加"读数打印 SHA"时写了 `'--short'`/`'--porcelain'` 字面量
   ⇒ **被本工具的注册表断言当场判红**（守卫自己被守卫 ✓，是**假阳性**但方向正确）⇒ 单列类别说清语义。 */
const EXTERNAL_FLAGS = ['--short', '--porcelain']
{
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const seen = [...new Set([...src.matchAll(/'(--[a-zA-Z][\w-]*)'/g)].map((m) => m[1]))]
  const known = new Set([...TOOL_FLAGS.map((f) => f.name), ...DOWNSTREAM_FLAGS, ...EXTERNAL_FLAGS])
  const unknown = seen.filter((s) => !known.has(s))
  if (unknown.length) {
    console.error(`✗ **旗标注册表不全**：${unknown.join(' ')} ⇒ 新增旗标必须登记进 TOOL_FLAGS（自己）或 DOWNSTREAM_FLAGS（下游）⇒ exit 2`)
    process.exit(2)
  }
}
const SELF_TEST = flag('--self-test-usage')
/* ★ team-lead ②/③：`--self-test-usage` —— **每个用法分支各跑一次**，断言
   "**有结论行** ＋ **退出码 ∈ {0,1,2}**"；退出码 2 必须带**原因文案**（非空 stderr）。
   并把"自测用例集合 ⊇ 本工具旗标集合"**断言化**（否则以后新加的旗标又绕过它）。 */
function runSelfTestUsage() {
  /* ★★ team-lead ②：**把"前置绿"变成机制** —— 所有控制/负控/自测**先跑前置**并断言全绿，
     否则打印 **CONTROL-INVALID** 且**不打印任何读数**。
     理由（你给的根因）：`check-syntax-and-json` **已经**全量覆盖语法（37 .mjs / 67 .json · 1.9s），
     但三个工具的前置里**命中 = 0**（没人接）⇒ "语法错的 exit=1" 与 "棘轮红的 exit=1" 分不开。
     ⇒ 判据落在**前置**（"用后果做判据"），落点不是词法规则 ✓ */
  const sx = spawnSync(process.execPath, [join(HERE, 'check-syntax-and-json.mjs')], { cwd: HERE, encoding: 'utf8' })
  const ck = spawnSync(process.execPath, [join(HERE, 'check-schema-vs-limits.mjs')], { cwd: HERE, encoding: 'utf8' })
  const synOk = sx.status === 0
  const chkOk = ck.status === 0
  const leafOk = existsSync(join(HERE, 'examples', 'deck.master-v1.json'))
  console.log(`PRE: syntax=${synOk ? 0 : 1} json=${synOk ? 0 : 1} checker=${chkOk ? 0 : 1} leaf=${leafOk ? 'found' : 'missing'}`)
  if (!synOk || !chkOk || !leafOk) {
    console.error('✗ **CONTROL-INVALID**（前置未全绿）⇒ 本次控制**不打印任何读数**（读数作废）')
    process.exit(2)
  }
  /* ★ team-lead ②：**必须至少一条真成功路径（exit=0）** —— 否则 10 例全 exit=2 ⇒ "**全红与全坏不可区分**"
     （镜像版："全绿 = 全红不可区分"）：若某天解析器整体坏掉、每条用法都 exit 2，自测**照样全 ✓**。
     成功路径须走通到**渲染/读数**（真底档 + 真 `--cls` + 合法 `auto=`）⇒ 断言 **exit=0** 且出现 `GATE-RESULT` 机器标记。 */
  /* ★ team-lead ③：**每个用例显式声明"期望族"** ⇒ 断言 `实际族集合 == 期望族集合`（不只"≥1 族被命中"——
     那只证明"**有话说**"，不证明"**说对了话**"）。与"每族 ≥1 用例"合起来才是完整双向。 */
  const CASES = [
    /* ⚠️ 期望族曾写漏 `auto 反查`（该用例用 `auto=100` ⇒ 会打 ℹ auto 反查行）⇒ **被期望族断言当场抓到** ✓ */
    /* ⚠️ `--expect-page 1` **必须加**：我自己新立的"读数模式缺它 ⇒ 红"规则**同样适用于本自测**
       （第一版没加 ⇒ `success` 用例被自己的规则判红 —— "纪律用在自己身上" ✓）。title 在第 1 页。 */
    ['success', ['--json', 'examples/deck.master-v1.json', '--field', 'meta.title', '--cls', 'cover-title', '--ks', '37', '--raise-max', 'auto=100', '--expect-page', '1'], ['仅量测', 'auto 反查', '成功读数']],
    ['auto-hit', ['--json', 'examples/__nope.json', '--field', 'meta.title', '--ks', '1', '--raise-max', 'auto=39'], ['auto 反查', '仅量测']],
    ['auto-miss', ['--json', 'examples/__nope.json', '--field', 'nosuch.field', '--ks', '1', '--raise-max', 'auto=9'], ['查不到 jsonPointer']],
    ['lower-value', ['--json', 'examples/__nope.json', '--field', 'meta.issuer', '--ks', '1', '--raise-max', 'issuer=700'], ['只许抬']],
    /* ★ 消息族断言当场抓到的缺口：**「无需抬」族没有用例命中** ⇒ 补"等值"分支（cap=33 ⇒ `auto=33` 恰好相等）
       ⚠️ 该用例的 exit=2 来自**该分支本身**（无需抬），不是下游 bogus 参数 —— 由**期望族断言**保证 ✓ */
    ['equal-value', ['--json', 'examples/__nope.json', '--field', 'meta.title', '--ks', '1', '--raise-max', 'auto=33'], ['无需抬', 'auto 反查']],
    ['not-found', ['--json', 'examples/__nope.json', '--field', 'meta.title', '--ks', '1', '--raise-max', 'nosuchleaf=9'], ['找不到 leaf']],
    ['multi-hit', ['--json', 'examples/__nope.json', '--field', 'meta.title', '--ks', '1', '--raise-max', 'title=99'], ['仅量测', '不许入表']],
    ['multi-allow', ['--json', 'examples/__nope.json', '--field', 'meta.title', '--ks', '1', '--raise-max', 'title=99', '--allow-multi'], ['仅量测', '尚无判据']],
    /* ⚠️ 该用例曾实际命中「查不到 jsonPointer」—— 真因是 **fixture 的 cell 没声明 `field`**（`auto=` 按 `--field` 反查需要它）
       ⇒ 已给 fixture 补 `field` ✓（**期望族断言当场抓到**，这正是"说对话"检查的价值） */
    ['judge-fixture', ['--json', 'examples/__nope.json', '--field', 'meta.title', '--ks', '1', '--raise-max', 'auto=40', '--judge-fixture', 'out-tmp-ctl/fx-judge33.json'], ['auto 反查', '仅量测']],
    ['offset', ['--json', 'examples/__nope.json', '--field', 'meta.issuer', '--ks', '1', '--raise-max', 'auto=800', '--readback-offset', '13'], ['auto 反查', '仅量测']],
    ['keep', ['--json', 'examples/__nope.json', '--field', 'meta.title', '--ks', '1', '--raise-max', 'auto=39', '--keep'], ['仅量测', 'auto 反查']],
    ['bad-pointer', ['--json', 'examples/__nope.json', '--field', 'meta.title', '--ks', '1', '--raise-max', '#//x=9'], ['形态不支持']],
    /* ★ team-lead msg1 ③：**`k > cap` 且无 `--raise-max` ⇒ 必须给补救提示**（他亲自踩的 K22 通式 ⇒ 正好是验收样例）。
       用**真底档 + 合法 k**（不吃 __nope 的提前退出）⇒ 该检查在渲染前就红 ⇒ 秒级。 */
    ['need-raise', ['--json', 'examples/deck.master-v1.json', '--field', 'meta.title', '--ks', '400'], ['需抬上限']],
  ]
  let bad = 0
  const outs = []
  for (const [name, argv2, expectFam] of CASES) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...argv2], { cwd: HERE, encoding: 'utf8', maxBuffer: 1 << 24 })
    const sout = String(r.stdout || ''), serr = String(r.stderr || '')
    /* ⚠️ 判据**必须覆盖全部消息族**（第一版漏了"查不到 jsonPointer"与"形态不支持" ⇒ 把 2 例误报成失败 —— 自测自己也栽在"判据不全"）
       ⇒ 用**消息族的特征词**而非完整句；失败时**打原样末 3 行**（§25a：不许丢失败输出）。 */
    /* ⚠️ **新消息族必须同时登记到这里**（我加 `需抬上限` 时只登记了 `FAMILIES` ⇒ 该用例 `hasConcl=false` 被判红 ——
       正是本文件注释写的"判据必须覆盖全部消息族"同族 · **自测自己抓到的** ✓）。 */
    const hasConcl = /(仅量测|无需抬|只许抬|找不到|不许入表|尚无判据|auto ⇒|找不到 deck|查不到 jsonPointer|形态不支持|judge-fixture|测量会被上限拒死)/.test(sout + serr)
    const codeOk = [0, 1, 2].includes(r.status)
    const reasonOk = r.status !== 2 || serr.trim().length > 0
    const ok = hasConcl && codeOk && reasonOk
    /* ★ **成功路径**：必须 exit=0 且出现机器标记 `GATE-RESULT`（"走通到读数"） */
    const okSuccess = name !== 'success' ? true : (r.status === 0 && /GATE-RESULT/.test(sout))
    const okAll = ok && okSuccess
    if (!okAll) bad++
    if (name === 'success') {
      console.log(`  ${okAll ? '✓' : '✗'} 用例 ${name.padEnd(14)} exit=${r.status}（**须 0**）· GATE-RESULT 机器标记=${/GATE-RESULT/.test(sout)}`)
    } else {
      console.log(`  ${okAll ? '✓' : '✗'} 用例 ${name.padEnd(14)} exit=${r.status} · 有结论行=${hasConcl} · code∈{0,1,2}=${codeOk} · exit2 带原因=${reasonOk}`)
    }
    if (!okAll) for (const l of (sout + serr).split('\n').filter(Boolean).slice(-3)) console.log(`        ↳ ${l.trim().slice(0, 160)}`)
    outs.push([name, sout + serr])
  }
  /* ★ team-lead ③：把"消息族"变成**可枚举表**，并断言 **双向一致**（与"旗标注册表 ⊇ 用例集合"同形）：
     · 每个**用例**至少命中一个消息族（否则该用例是**空壳**）· 每个**消息族**至少被一个用例命中（否则该族**没被守**） */
  const FAMILIES = {
    '仅量测': /仅量测/, '不许入表': /不许入表/, '无需抬': /无需抬/, '只许抬': /只许抬/,
    '找不到 leaf': /找不到 leaf/, '尚无判据': /尚无判据/, 'auto 反查': /auto ⇒/,
    '查不到 jsonPointer': /查不到 jsonPointer/, '形态不支持': /形态不支持/, '成功读数': /GATE-RESULT/,
    '需抬上限': /测量会被上限拒死/,
  }
  const hitFam = new Set()
  const famBad = []
  for (const [name, txt] of outs) {
    const hits = Object.entries(FAMILIES).filter(([, re]) => re.test(txt)).map(([k]) => k)
    if (!hits.length) { famBad.push(`用例 **${name}** 未命中任何消息族 ⇒ **空壳用例**`); continue }
    /* ★ team-lead ③：断言 `实际族集合 == 期望族集合`（不只"≥1 族"——那只证明"有话说"，不证明"**说对了话**"）
       ⚠️ **累计全部不符再报**（第一版逐例 `exit 2` ⇒ 一次只暴露一例，代价是每轮一次渲染） */
    const exp = (CASES.find(([n]) => n === name) || [])[2] || []
    const eq = hits.length === exp.length && exp.every((f) => hits.includes(f))
    if (!eq) famBad.push(`用例 **${name}** 实际族 [${hits.join(', ')}] ≠ 期望族 [${exp.join(', ')}]`)
    hits.forEach((h) => hitFam.add(h))
  }
  if (famBad.length) { console.error(`✗ **期望族不符 ${famBad.length} 例**：`); for (const s of famBad) console.error(`   · ${s}`); process.exit(2) }
  const orphan = Object.keys(FAMILIES).filter((k) => !hitFam.has(k))
  if (orphan.length) { console.error(`✗ 消息族**未被任何用例命中**：${orphan.join(', ')} ⇒ 这些族的文案没被守 ⇒ exit 2`); process.exit(2) }
  console.log(`  消息族 ↔ 用例：**双向一致 ✓**（族 ${Object.keys(FAMILIES).length} 个 · 全部被命中）`)
  /* ★ team-lead ②：机读「成功路径 N / 失败路径 M」；**成功路径缺位 ⇒ 红**（I11 要守的是"无声失败"，而只有成功路径上
     "无输出"才可能被误当"没触发"）。 */
  const nOk = CASES.filter(([n]) => n === 'success').length
  const nFailPath = CASES.length - nOk
  if (nOk === 0) { console.error('✗ 自测**缺成功路径**（全 exit=2 ⇒ 全红与全坏不可区分）⇒ exit 2'); process.exit(2) }
  console.log(`  路径覆盖：**成功路径 ${nOk} 条 / 失败路径 ${nFailPath} 条**（成功路径缺位 ⇒ 红）✓`)
  /* 覆盖断言：用例集合必须罩住**本工具旗标**（旗标自己的 case 名必须在用例名里） */
  const caseNames = new Set(CASES.map(([n]) => n))
  const uncovered = TOOL_FLAGS.filter((f) => !f.case.startsWith('(') && !caseNames.has(f.case))
  if (uncovered.length) { console.error(`✗ 旗标未被自测覆盖：${uncovered.map((f) => `${f.name}→${f.case}`).join(' ')} ⇒ exit 2`); process.exit(2) }
  console.log(`\n  自测覆盖：本工具旗标 **${TOOL_FLAGS.length}** 个 ⇒ 未覆盖 **0** 个 ✓（用例 ${CASES.length} 条 · 失败 ${bad} 条）`)
  process.exit(bad ? 1 : 0)
}
if (SELF_TEST) runSelfTestUsage()
const NODE = process.execPath
const JSONF = arg('--json', 'examples/deck.master-v1.json')
const FIELD = arg('--field', 'meta.title')
const CLS = arg('--cls', 'cover-title')
const KS = String(arg('--ks', '37,38')).split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
/* ★★ 并发安全一（team-lead ②-1）：**默认 outdir 唯一化** —— 不再默认共享 `out-xcheck`。
   事故（2026-10-03）：team-lead 与我**并发**跑同一默认 outdir ⇒ 他读到的是被并发改写的产物 ⇒
   得到一个"看起来正常但错"的数（k=37 闸门 exit 报 1，实际 0）——比报错危险得多。显式指定时才用指定值。 */
const OUT = arg('--outdir', '') || `out-tmp-xcheck-${process.pid}-${Date.now().toString(36)}`
/* ★ **工具自洁**（team-lead ①卫生）：**未显式指定 `--outdir`** 时，退出即删本进程自建的临时目录
   （显式指定 ⇒ 保留：那是调用方要的产物；`--keep` 亦可保留）。事故：`out-tmp-*` 一度 287 个 / 2.8 GB。 */
const AUTO_OUT = !arg('--outdir', '')
if (AUTO_OUT && !KEEP_OUT) {
  process.on('exit', () => { try { rmSync(OUT, { recursive: true, force: true }) } catch { /* ignore */ } })
}
/* ★ team-lead ④-2：`--raise-max <字段>=<值>` ⇒ **仅量测**地把该字段的 schema `maxLength` 临时抬到 <值>，
   让第二路**真能跑到 k=判据**（期望：k 过闸 · k+1 因**版式**（overlap/overflow）不过 ⇒ 与第一路真交叉）。
   实现：把覆盖后的 schema 写到 **仓库外**（os.tmpdir()），只给本次子进程设 `DECK_SCHEMA_OVERRIDE`；
   validate-deck 会**打印告示**。发版闸门不设该 env ⇒ 永远走真 schema。 */
const RAISE_MAX = arg('--raise-max', '')       // 形如 "pages.1.title=57"（leaf=值）
/* ★ team-lead ③-1：**读回口径换算** —— 有些字段的**元素文本 = 输入值 + 模板常量**（如 `meta.issuer` 的元素 =
   `出品：` + issuer + ` · ` + date ⇒ 常量 **13**）⇒ 判据按**输入口径**给（827），而读回按**元素口径**（840）。
   ⇒ `--readback-offset <n>`：断言 `读回 == k + n`。**offset 属该格元数据**（模板常量），不许靠"目测"绕过。 */
const RB_OFFSET = Number(arg('--readback-offset', '0') || 0)
/* ★ team-lead ③：格子声明的页号（1-based）⇒ 断言"命中元素所在页 == 它"（把 `p2-` 前缀**约定**变成机器校验） */
const EXPECT_PAGE = Number(arg('--expect-page', '0') || 0)
/* ★ team-lead ②：两个洞一起补 ——
   (1) **危险默认**（与 `--sel` 同类）：`--expect-page` 缺省 = 0 = **静默不做「命中页 == 该格 page」断言**，
       而"同页"正是"靠 `p2-` 前缀约定"的机器校验 ⇒ **静默失守最危险** ⇒ **读数模式下缺它 ⇒ 红（exit 2）**。
       唯一豁免：显式 `--page-unknown`（= 承认「本轮不校验同页 ⇒ 读数待判」，逐行打印警示，**不得用于入表读数**）。
   (2) **专属 tag**：红的原因必须可区分 ⇒ `EXPECT_PAGE_MISMATCH`（另有 `RENDER_FAILED` / `READBACK_MISMATCH`），
       并配**纯合成自测**（`--self-test-page`）断言「负控的红因 == 该 tag」。 */
/* ⚠️ **必须用 `flag()`**（登记消费下标）—— 我第一版写 `process.argv.includes` ⇒ 被本工具"未识别参数 ⇒ exit 2"守卫拒掉
   （实测 `--page-unknown` 那次 exit=2；本文件 L37-38 早就写过这个坑，我又踩一次 ⇒ 现在**照做**）。 */
const PAGE_UNKNOWN = flag('--page-unknown')
const TAG_PAGE = 'EXPECT_PAGE_MISMATCH'
/* ★ team-lead msg3 ②(a)(b)：**"我没真正校验"必须能被退出码/tag 表达**（与 I10「零分母不许算通过」同族）——
   ① 缺 `--expect-page` ⇒ tag **`EXPECT_PAGE_MISSING`**
   ② 显式 `--page-unknown` ⇒ tag **`PAGE_CHECK_SKIPPED`**，且**非 0**（此前我设计成 exit 0 ⇒ 上层脚本会读成"通过" ✗
      —— "未校验"不许伪装成"通过"）。⇒ 两者合一的**唯一实现** `modeTag()`，并由 `--self-test-page` 断言。 */
const TAG_PAGE_MISSING = 'EXPECT_PAGE_MISSING'
const TAG_PAGE_SKIP = 'PAGE_CHECK_SKIPPED'
function modeTag(exp, unk) { if (exp) return null; return unk ? TAG_PAGE_SKIP : TAG_PAGE_MISSING }
/* ★★ team-lead msg12 ②：**机器标记只许出现在 stdout 一处**（同一条 tag 落两流 ⇒ 上层按流取会拿两份，
   将来措辞一分叉就成"两套结论"）。⇒ stderr 的逐行明细**去掉 tag**，只留人类可读的说明；
   并由 `--self-test-page` 断言"人类行里标签计数 = 0"（机读形态仍由 stdout 结论行承载）。 */
function humanRowLine(r, exp) {
  const tag = badReason(r, exp)
  const why = tag === 'RENDER_FAILED' ? '渲染失败' : tag === 'READBACK_MISMATCH'
    ? `读回 ${r.back} 与 k 加 offset（${r.k + RB_OFFSET}）不符`
    : `本次命中页 ${r.no}，与期望的格子 page ${exp} 不符`
  return `   · k=${r.k}：${why}（渲染=${r.renderOk ? 'ok' : '✗'} · 读回=${r.back}/${r.k + RB_OFFSET} · 命中页=${r.no}）〔人类提示；机读标签只在 stdout 结论行〕`
}
/* 判据唯一实现（循环里只做**可见提示**，判定在汇总处 ⇒ 不与"循环里 push 后面声明的数组"那种 TDZ 假红同形）。 */
function badReason(r, exp) {
  if (!r.renderOk) return 'RENDER_FAILED'
  if (r.back !== r.k + RB_OFFSET) return 'READBACK_MISMATCH'
  if (exp && Number(r.no) !== exp) return TAG_PAGE
  return null
}
/* ★ **合成输入自测**（team-lead ④：读数解析类逻辑必须配合成自测 ⇒ 免渲染、秒级、可判伪）。
   断言 ① 异页 ⇒ 红因恰为 `EXPECT_PAGE_MISMATCH` ② 同页 ⇒ 不红 ③ 渲染失败 ⇒ 红因是 `RENDER_FAILED`（**不是**页 tag）。 */
if (process.argv.includes('--self-test-page')) {
  const a = badReason({ k: 37, renderOk: true, back: 37, no: 1 }, 2)
  const b = badReason({ k: 37, renderOk: true, back: 37, no: 2 }, 2)
  const c = badReason({ k: 37, renderOk: false, back: -1, no: '-' }, 2)
  /* ★ msg3 ②：**"没真正校验"的两种红因也要有 tag**（team-lead 指出我唯独漏了这一种）。 */
  const d = modeTag(0, false), e = modeTag(0, true), f = modeTag(1, false)
  /* ★ msg12 ②：**通道断言** —— 人类明细行里**标签计数 = 0**（机读标签只许在 stdout 结论行出现一次）。 */
  const human = humanRowLine({ k: 30, renderOk: true, back: 30, no: 1 }, 2)
  const humanTagFree = !/\[[A-Z][A-Z_]{2,}\]/.test(human)
  const ok = a === TAG_PAGE && b === null && c === 'RENDER_FAILED'
    && d === TAG_PAGE_MISSING && e === TAG_PAGE_SKIP && f === null && humanTagFree
  console.log(`  合成自测(page)：异页(1/2) ⇒ ${a}（须 ${TAG_PAGE}）${a === TAG_PAGE ? '✓' : '✗'} · 同页(2/2) ⇒ ${b === null ? '不红 ✓' : `✗ 误红（${b}）`} · 渲染失败 ⇒ ${c}（须 RENDER_FAILED）${c === 'RENDER_FAILED' ? '✓' : '✗'}`)
  console.log(`                   **未校验类**：缺参数 ⇒ ${d}（须 ${TAG_PAGE_MISSING}）${d === TAG_PAGE_MISSING ? '✓' : '✗'} · 显式跳过 ⇒ ${e}（须 ${TAG_PAGE_SKIP}，**非 0**）${e === TAG_PAGE_SKIP ? '✓' : '✗'} · 已声明 ⇒ ${f === null ? '不红 ✓' : `✗ ${f}`}`)
  console.log(`                   **通道**：人类明细行标签计数 = 0（须 true）${humanTagFree ? '✓' : '✗'}`)
  process.exit(ok ? 0 : 1)
}
let OVERRIDE_ENV = null
if (RAISE_MAX) {
  /* ★ team-lead ③-2：`--raise-max` 的两条**断言**（此前只判"有没有命中"，抬错/抬不动都会静默）：
     ① **只许抬不许降**：`val ≤ 现 maxLength` ⇒ 抬了个寂寞（测量仍被旧上限拒）⇒ **红**（exit 2）；
     ② **目标叶必须在命中清单里**（不在 ⇒ 红 = 抬没生效）。
     ⚠️ 裸叶名会命中**多个**（`title`/`explain`/`items`）：只抬不降 ⇒ 无害，但**必须打印命中数**让量测者确认目标在其中；
     也支持**整指针**精确指定（`--raise-max "#/$defs/meta/properties/issuer=847"`）⇒ 只命中那一个。 */
  const [leafSpecRaw, valStr] = RAISE_MAX.split('=')
  /* ★ team-lead ③：`--raise-max auto=<n>` —— **按 `--field` 反查该字段自己的指针**再去抬 ⇒ 一箭双雕：
     ① 免掉**裸叶名的多命中误伤**（裸叶 `title` 会同时命中 meta.title（cap 33）与 pageBullets.title（cap 50），
        而"只许抬 / 无需抬"是**逐命中叶**判的 ⇒ 会被 cap 更大的**兄弟字段**误伤 —— 实测踩到）；
     ② 形态里**没有 `$`** ⇒ 免掉 PowerShell 双引号吃 `$defs` 的坑（`#/$defs/x` 变 `#//x`）。
     反查来源 = `measured-limits.json` 的 `cell.field` → `cell.jsonPointer`（判据表的**同一真源**，不新增入口）。 */
  let leafSpec = leafSpecRaw
  /* ⚠️ `auto` 的**反查必须等 `TABLE` 建好之后**再做 —— 第一版把这段放在这里 ⇒ **ReferenceError: Cannot access 'TABLE' before initialization**
     （`TABLE` 在下面才声明）⇒ 反查 + "查不到就报错"整段已挪到 `TABLE`/`judgeOf` 之后（见下面的 auto 块）。
     这正是"**初始化顺序**"类错误（与"定界符嵌套"同族：**都是把代码放在它依赖的东西之前/之内**）。 */
  /* ★ team-lead ①(a)(b)：**畸形 spec 守卫**（别让"整指针必须单引号"靠人记住）——
     · 含 `//`：典型是 **PowerShell 双引号把 `$defs` 展开成空**（`#/$defs/x` ⇒ `#//x`）；
     · 不以 `#/` 开头却含 `/`：**多段部分路径**（如 `secondary/items/label`）—— 匹配规则是"以 /spec 结尾"⇒ 必然 0 命中。
     ⇒ 两种都**报错并自解释**（列出支持的两形态 + 指出不支持多段部分路径）⇒ exit 2。 */
  if (leafSpec.includes('//') || (!leafSpec.startsWith('#/') && leafSpec.includes('/'))) {
    console.error(`✗ --raise-max 的 spec 形态不支持或被 shell 改坏：${leafSpec}
     支持的只有**两种形态**：① **裸叶名**（例：issuer） ② **整指针**（例：#/$defs/meta/properties/issuer）
     ⚠️ **多段部分路径不支持**（例：secondary/items/label —— 匹配规则是"以 /spec 结尾"，部分路径必然 0 命中）
     ⚠️ 若出现双斜杠：通常是 **PowerShell 双引号把美元号变量展开成空**（$defs 变空）⇒ **整指针请用单引号**`)
    process.exit(2)
  }
  const val = Number(valStr)
  const sp = join(DECK_DIR, 'deck.schema.json')
  const sch = JSON.parse(readFileSync(sp, 'utf8'))
  /* ★ team-lead ③ 第三支裁定：**判据从表按指针读**（`measured-limits.json` 是判据的唯一真源 ⇒
     不把判据当参数传 —— 那会多一条"能传错"的入口）。用于判：该格**是否根本不需要抬**。
     ⚠️ 表里查不到 = **未测格** ⇒ 只给信息级提示（抬上限可探边界，但**补判据前结果不入表**）。 */
  /* ★ team-lead ③：**(iii) 今天 0 格满足 ⇒ 是"死代码"，必须能被证明（能失败）** ——
     加 `--judge-fixture <file>`（**仅自证**：默认读真表 `measured-limits.json`，与生产行为一致；
     fixture 只临时顶替"判据"这一列，不改任何生产参数）⇒ 可造合成格（例：真 cap=33 的指针 + fixture 判据 20
     ⇒ `判据+1 = 21 ≤ 33` ⇒ **应当触发 (iii)**）。 */
  const JF = arg('--judge-fixture', '')
  const TABLE = (() => {
    try {
      const p = JF ? join(process.cwd(), JF) : join(DECK_DIR, 'measured-limits.json')
      const db = JSON.parse(readFileSync(p, 'utf8'))
      const arr = db.cells || db.entries || db.items || db.limits || db.judges || (Array.isArray(db) ? db : [])
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  })()
  if (JF) console.log(`  ℹ --judge-fixture=${JF}（**仅自证**：判据列来自该 fixture，不读真表）`)
  const judgeOf = (ptr) => { const c = TABLE.find((x) => x.jsonPointer === ptr); return c ? c.judgeLimit : undefined }
/* ★★ team-lead msg1 ③：**K22 通式的前置拦截** —— `k > 当前 cap` 且**未给 `--raise-max`** 时，
   使用者只会看到「渲染失败 exit=3」⇒ 第一反应是"渲染器坏了"（team-lead 亲自踩了一次）⇒
   这里**直接点名并给可照抄的补救**（`auto=` 形态），exit 2。
   ⚠️ **必须在 `if (RAISE_MAX)` 块之外**（块内 ⇒ `!RAISE_MAX` 永不成立 ⇒ 整段等于没写；实测踩到）。 */
  /* ★ `--raise-max auto` 的**反查**（放这里才安全：`TABLE` 已就绪）——
     按 `--field` 找到该字段自己的指针 ⇒ 避开①裸叶名多命中误伤 ②整指针的 `$` 展开坑（形态里没有 `$`）。 */
  if (leafSpecRaw === 'auto') {
    const c = TABLE.find((x) => x.field === FIELD)
    if (!c || !c.jsonPointer) {
      console.error(`✗ --raise-max auto：按 --field=${FIELD} 在判据表里**查不到 jsonPointer** ⇒ 请显式指定
     （推荐**整指针 + 单引号** —— ⚠️ 整指针**含美元号** ⇒ 在 PowerShell **双引号**里会被吃成空 ⇒ **必须单引号**）⇒ exit 2`)
      process.exit(2)
    }
    leafSpec = c.jsonPointer
    console.log(`  ℹ --raise-max auto ⇒ 按 --field=${FIELD} 反查指针：${leafSpec}（**推荐形态**：无多命中误伤、无 $ 需转义）`)
  }
  const noJudge = []
  const hit = []
  const hitKind = []   /* ★ 每个命中抬的是 `maxLength` 还是 `maxItems`（告示里要写明） */
  const walk = (node, ptr) => {
    if (!node || typeof node !== 'object') return
    /* ★ team-lead ③-1：**按叶子类型分派** —— **条数格抬的是 `maxItems`（不是 `maxLength`）**，
       否则扫到现上限就停、根本探不到条数真判据。`key` 决定抬哪个，并在告示里**写明抬了哪一个**。 */
    const key = node.maxLength !== undefined ? 'maxLength' : (node.maxItems !== undefined ? 'maxItems' : null)
    if (key && (ptr === leafSpec || ptr.endsWith('/' + leafSpec))) {
      /* ★ team-lead ③ 四情形（判据**从表按指针读**，不加参数）：
         (i)   val < 现上限 ⇒ **只许抬、不许降**（抬没生效：测量仍会被旧上限拒）
         (ii)  val == 现上限 ⇒ **无需抬**（这次抬没意义）
         (iii) 表里有该指针且 **判据 + 1 ≤ 现上限** ⇒ **无需抬：请去掉 --raise-max 直接跑**（现上限已足够跑到判据+1）
         (iv)  表里查不到该指针（**未测格**）⇒ **信息级**提示：抬到 val 可探边界，但**补判据前结果不入表**（不拒绝） */
      const cap0 = node[key]
      const judge0 = judgeOf(ptr)
      if (!(val > cap0)) {
        if (val === cap0) {
          console.error(`✗ --raise-max **无需抬**：${ptr} 现 ${key}=${cap0}，与 val 相等 ⇒ 这次抬没意义 ⇒ 请**去掉 --raise-max** 直接跑（现上限已足够）⇒ exit 2`)
        } else {
          console.error(`✗ --raise-max **只许抬、不许降**：${ptr} 现 ${key}=${cap0}，而 val=${val} < 它 ⇒ **抬没生效**（测量仍会被旧上限拒）⇒ exit 2
     （提示：**裸叶名会命中多个**（例 title 同时命中 meta.title 与 pageBullets.title）⇒ 兄弟字段 cap 更大时会**误伤**；
      推荐用 **--raise-max auto=<n>**（按 --field 反查指针）或**整指针 + 单引号**）`)
        }
        process.exit(2)
      }
      if (judge0 !== undefined && judge0 + 1 <= cap0) {
        console.error(`✗ --raise-max **无需抬**：${ptr} 现 ${key}=${cap0} **已经 ≥ 判据+1（${judge0 + 1}）** ⇒ 现上限已足够跑到判据+1 ⇒ **请去掉 --raise-max 直接跑** ⇒ exit 2（抬了反而把边界推远，测到的不是真判据）`)
        process.exit(2)
      }
      if (judge0 === undefined) noJudge.push(ptr)
      node[key] = val
    hitKind.push(key); hit.push(ptr)
    }
    for (const k of Object.keys(node)) walk(node[k], `${ptr}/${k}`)
  }
  walk(sch, '#')
  /* ⚠️ team-lead ①：搜索已覆盖**两类**（`maxLength`/`maxItems`），报错却只说 `maxLength` ⇒ **文案与实现不一致**
     （今天已咬过一次）⇒ 现明确写"两类"。 */
  if (!hit.length) { console.error(`✗ --raise-max：schema 里找不到 leaf=${leafSpec} 的 **maxLength / maxItems** 任一 ⇒ exit 2（**抬没生效**）`); process.exit(2) }
  /* ② 目标叶在命中清单里（用整指针指定时必须**精确命中**该指针） */
  const exact = leafSpec.startsWith('#/')
  if (exact ? !hit.includes(leafSpec) : !hit.some((p) => p.endsWith('/' + leafSpec))) {
    console.error(`✗ --raise-max：目标 ${leafSpec} **不在命中清单**${'[' + hit.join(', ') + ']'} ⇒ 抬没生效 ⇒ exit 2`); process.exit(2)
  }
  const tmp = join(tmpdir(), `deck.schema.override.${process.pid}.json`)
  writeFileSync(tmp, JSON.stringify(sch, null, 2), 'utf8')
  OVERRIDE_ENV = tmp
  const hitDesc = hit.map((p, i) => `${p}（${hitKind[i] || 'maxLength'}）`).join(' / ')
  console.log(`  ★★ **仅量测**：把 ${hitDesc} 抬到 ${val} —— 命中 **${hit.length}** 个${hit.length > 1 ? '（裸叶名会命中多个：只抬不降 ⇒ 无害，但**请确认量测目标是其中之一**；可用整指针精确指定）' : ''}（覆盖 schema 写于仓库外 ${tmp}）`)
  /* ★ team-lead ②：**多命中 ⇒ 本次读数不许入表**（可判伪的归因纪律）——
     "一格 = 一叶"；多命中时若判据码来自**另一个被抬的叶子**，读数就会被归到**错的格子**（今天已在别处栽过一次归因）。
     ⇒ 默认 **红**（exit 2）；确需探索时才显式 `--allow-multi`，且**即便允许也打印"不作为入表依据"**。 */
  if (hit.length > 1 && !ALLOW_MULTI) {
    console.error(`✗ --raise-max 命中 **${hit.length}** 个叶子 ⇒ **本次读数不许入表**（红）：一格 = 一叶，多命中会把读数归到错的格子
     命中的是：${hitDesc}
     ⇒ 请改用 **--raise-max auto=<n>**（按 --field 反查 ⇒ 单命中、可归因）或**整指针 + 单引号**；
       确需探索时显式加 **--allow-multi**（此时读数**不作为入表依据**）`)
    process.exit(2)
  }
  if (hit.length > 1) console.log(`  ⚠️ --allow-multi：命中 **${hit.length}** 个 ⇒ **本次读数不作为入表依据**（探索用；不许写进 measured-limits）`)
  /* ★ 情形 (iv)：**未测格** ⇒ 信息级（不拒绝）—— 抬上限可探边界，但**补判据前结果不入表** */
  for (const p of noJudge) {
    console.log(`  ℹ --raise-max：${p} **尚无判据（未测）** ⇒ 抬到 ${val} 可探边界；**补判据前该格结果不入表**（判据真源 = measured-limits.json）`)
  }
}
const PATH_A = arg('--pathA', '')          // 第一路（HTML 注入）给出的临界，仅用于打印对照

/** 深设 `a.b.c` 路径字段 */
function setPath(obj, path, val) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const p = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i]
    if (cur[p] == null) cur[p] = {}
    cur = cur[p]
  }
  const last = /^\d+$/.test(parts[parts.length - 1]) ? Number(parts[parts.length - 1]) : parts[parts.length - 1]
  cur[last] = val
}

const leftovers = args.filter((a, i) => !_consumed.has(i))
if (leftovers.length) {
  console.error(`✗ 未识别的参数：${leftovers.join(' ')}（提示：\`--ks\` 必须写成 **一个** 参数，如 \`--ks "37,38"\`；拆成两个位置参数会被静默忽略 ⇒ "临界+1 恒缺"那类错。§25b ⇒ exit 2）`)
  /* ★ msg6 ④：跨工具提示（`--verify-cell` 属检查器 ⇒ 直接点名，免得"用错工具白跑"）。 */
  const badFlags = leftovers.filter((a) => /^--/.test(a))
  if (badFlags.length) {
    const hint = siblingHint(badFlags[0])
    console.error(`   ★ 未登记/属其它工具：${badFlags.join(' ')}${hint ? ` ⇒ **\`${hint}\`** 里有这个旗标：请用 \`node ${hint} …\`` : '（本工具也不认识）'}`)
  }
  process.exit(2)
}
const src = resolve(DECK_DIR, JSONF)
if (!existsSync(src)) { console.error(`✗ 找不到 deck JSON：${src}（§25b ⇒ exit 2）`); process.exit(2) }
const base = JSON.parse(readFileSync(src, 'utf8'))
const outRoot = resolve(DECK_DIR, OUT)
mkdirSync(outRoot, { recursive: true })
/* ★★ 并发安全二（team-lead ②-2）：**锁文件 + 存活检测** —— 发现另一进程在用同一 outdir ⇒ exit 2（明说）。 */
const LOCK = join(outRoot, '.xcheck.lock')
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return !!e && e.code === 'EPERM' } }
{
  let got = false
  for (let attempt = 0; attempt < 2 && !got; attempt++) {
    try {
      const fd = openSync(LOCK, 'wx')      // ★ 独占创建：已存在即抛 EEXIST（比"先查再写"无竞态）
      writeFileSync(fd, JSON.stringify({ pid: process.pid, t: new Date().toISOString(), outdir: OUT }))
      closeSync(fd); got = true
    } catch (e) {
      if (e.code !== 'EEXIST') { console.error(`✗ 无法创建锁文件 ${LOCK}：${e.message}（§25b ⇒ exit 2）`); process.exit(2) }
      let info = null
      try { info = JSON.parse(readFileSync(LOCK, 'utf8')) } catch { info = null }
      const other = info && Number(info.pid)
      if (other && other !== process.pid && alive(other)) {
        console.error(`✗ **另一进程正在使用同一输出目录**（${OUT} · pid=${other} · 起于 ${info.t}）⇒ 读数是并发污染的 ⇒ **exit 2**（team-lead ②-2）`)
        console.error(`   处置：换一个 outdir（本工具默认已唯一化），或等它结束。`)
        process.exit(2)
      }
      console.log(`  ⚠ 发现**陈旧锁**（pid=${other || '?'} 已不在）⇒ 清除后重试（这是并发事故的残留，不是正常状态）`)
      try { rmSync(LOCK, { force: true }) } catch { /* ignore */ }
    }
  }
  if (!got) { console.error('✗ 取锁失败（重试后仍冲突）⇒ exit 2'); process.exit(2) }
  process.on('exit', () => { try { rmSync(LOCK, { force: true }) } catch { /* ignore */ } })
}
/* ★★ 并发安全三（team-lead ②-3）：**测量期防篡改** —— 每行记产物指纹，测量期间被改写 ⇒ exit 2（不许照常出结论）。 */
const fp = (p) => { try { const s = statSync(p); return `${s.size}:${Math.round(s.mtimeMs)}` } catch { return 'missing' } }
const HF = resolveHyperframes().p        // ★ 返回 {p, why}（`resolveHyperframes().p` 才是可执行路径；与 measure-sweep 同口径）

console.log(`=== deck JSON 真渲染路（第二路）===`)
/* ★ team-lead msg4 ②：**读数必须能归属到一棵树**（否则跨快照比对会产出假"未修 / 假"已修"；今天各发生过一次）。 */
const TREE = (() => {
  try {
    const sha = String(spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).stdout || '').trim() || 'n/a'
    /* ⚠️ 排除 `.codebuddy/`（**协作目录，不入库、不是代码改动**）—— 否则每轮都报"有未提交改动"（假警报）。
       另：`git status` 的 `--porcelain` 已含短格式 ⇒ 不必再传 `--short`（`--short` 只用于上面 `rev-parse`）。 */
    const paths = String(spawnSync('git', ['status', '--porcelain'], { cwd: HERE, encoding: 'utf8' }).stdout || '')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.includes('.codebuddy/'))
    return { sha, dirty: paths.length > 0, n: paths.length, paths }
  } catch { return { sha: 'n/a', dirty: null, n: 0 } }
})()
console.log(`  ℹ 读数归属：**SHA=${TREE.sha}** · 工作树 ${TREE.dirty ? `**有 ${TREE.n} 处未提交改动 ⇒ 该读数不可用于复核**（先提交再取读数）` : '清洁 ✓'}`)
/* ★ msg6 ③(b)：**打印那 N 处的路径（≤5）** —— 否则人只会看到"有 1 处"，无法一眼判断是不是真污染（狼来了）。 */
if (TREE.dirty) for (const l of TREE.paths.slice(0, 5)) console.log(`       · ${l}`)
if (TREE.dirty && TREE.n > 5) console.log(`       · …（其余 ${TREE.n - 5} 处）`)
console.log(`  源 = ${JSONF} · 字段 = ${FIELD} · 检测点 = .${CLS} · 变体 k = [${KS.join(', ')}] · 出目录 = ${OUT}${PATH_A ? ` · 第一路(HTML 注入)临界 = ${PATH_A}` : ''}`)
const rows = []
const tamper = []                       // ★ 测量期产物被改写的行（⇒ 结论作废）
if (!RAISE_MAX) {
  /* ⚠️ **自读表**（不依赖 `TABLE`：它声明在 `if (RAISE_MAX)` 块内 ⇒ 此处引用会 ReferenceError；实测踩到）。 */
  let ptr
  try {
    const tbl = JSON.parse(readFileSync(join(DECK_DIR, 'measured-limits.json'), 'utf8'))
    ptr = (tbl.limits || []).find((x) => x.field === FIELD)?.jsonPointer
  } catch { /* 表读不到就不拦（不制造假红） */ }
  if (ptr) {
    let cap
    try {
      const s = JSON.parse(readFileSync(join(DECK_DIR, 'deck.schema.json'), 'utf8'))
      cap = ptr.replace(/^#\//, '').split('/')
        .map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~'))
        .reduce((o, k) => (o == null ? undefined : o[k]), s)?.maxLength
    } catch { /* 拿不到 cap 就不拦（不制造假红） */ }
    const kBig = (cap === undefined) ? [] : KS.filter((k) => k > cap)
    if (kBig.length) {
      console.error(`✗ **测量会被上限拒死**：k=${kBig.join(',')} > 当前 cap=${cap}（字段 ${FIELD} · ${ptr}）`)
      console.error('   ⚠️ 未给 `--raise-max` ⇒ 渲染阶段就会被 schema 上限拒（你只会看到「渲染失败」⇒ 容易误判成渲染器故障 —— **K22 通式**）')
      console.error(`   ⇒ 补救（照抄）：\`--raise-max auto=${Math.max(...kBig)}\`（按 --field 反查 ⇒ 单命中、无 $ 转义）；或整指针 + **单引号**`)
      process.exit(2)
    }
  }
}
for (const k of KS) {
  const variant = JSON.parse(JSON.stringify(base))
  setPath(variant, FIELD, '汉'.repeat(k))
  /* ★ team-lead ③（更省事、假设更少）：变体**写在源档同目录**（前缀 `__tmp_`、**不匹配 `deck*.json` 声明档 glob**）
     ⇒ **天然免疫相对素材语义**：`cover.asset`（相对**母版**目录）与 `image.asset`（相对**源档**目录）都按原语义解析。
     事故回顾：写在 `out-tmp-xcheck-*` 时，image 页报"素材文件不存在：<临时目录>/assets/test-media.png" ⇒ **整档被拒渲染
     ⇒ 我的自证出现假红**（团队 lead 把同一变体放到源档同目录 ⇒ render exit=0 定死了这一点）。跑完即删（`exit` 钩子兜底）。 */
  const srcAbs = resolve(DECK_DIR, JSONF)
  const vj = join(dirname(srcAbs), `__tmp_xcheck-k${k}.json`)
  process.on('exit', () => { try { rmSync(vj, { force: true }) } catch { /* ignore */ } })
  writeFileSync(vj, JSON.stringify(variant, null, 2), 'utf8')
  const deckName = basename(vj).replace(/\.json$/, '')
  /* ⚠️ **不许** `shell: true`：Windows 下 `process.execPath` 含空格（`C:\Program Files\nodejs\…`）
     ⇒ shell 拼接会把路径拆坏（实测：三行全"渲染 ✗"）。传数组、不用 shell 即可（§25a：失败原因要原样打印）。 */
  const r = spawnSync(NODE, [join(HERE, 'render-deck.mjs'), vj, '--outdir', join(DECK_DIR, OUT)], {
    cwd: HERE, encoding: 'utf8',
    /* ★ ④-2：只在 **--raise-max** 时把覆盖 schema 传给子进程（validate-deck 会打印告示） */
    env: OVERRIDE_ENV ? { ...process.env, DECK_SCHEMA_OVERRIDE: OVERRIDE_ENV } : process.env,
  })
  /* ★ 渲染是变体的**唯一消费者** ⇒ 渲染一结束就删（`exit` 钩子只作兜底）。
     实测：只靠 exit 钩子会残留 `__tmp_xcheck-k37/k38.json` 在 `examples/`（会污染声明档/锚点扫描）。 */
  try { rmSync(vj, { force: true }) } catch { /* ignore */ }
  const prod = join(DECK_DIR, OUT, deckName)
  const renderOk = r.status === 0 && existsSync(join(prod, 'index.html'))
  const fpRender = renderOk ? fp(join(prod, 'index.html')) : 'n/a'   // ★ 渲染完成即取指纹（防篡改基线）
  if (!renderOk) {
    const raw = (r.stdout || '') + (r.stderr || '')
    const tail = raw.split('\n').map((s) => s.trim()).filter(Boolean).slice(-4)
    console.log(`  k=${k} 渲染失败 exit=${r.status} ⇒ 原样末 4 行：`)
    for (const l of tail) console.log(`      ${l.slice(0, 170)}`)
    /* ★ team-lead ④-1：**拒绝原因必须归属正确** —— 末 4 行常常是 JSON 回显（无用），
       这里把校验器的**错误消息**单独抽出来（`"msg": "…"` / `"path": "…"`）⇒ 让"是不是 schema 上限拦的"可判。 */
    const msgs = [...raw.matchAll(/"path"\s*:\s*"([^"]+)"[\s\S]{0,200}?"msg"\s*:\s*"([^"]+)"/g)].slice(0, 6)
    if (msgs.length) {
      console.log(`      拒绝原因（校验器 error/msg，共 ${msgs.length} 条，最多列 6）：`)
      for (const mm of msgs) console.log(`        · ${mm[1]} ⇒ ${mm[2].slice(0, 150)}`)
    } else {
      console.log('      拒绝原因：**未解析到 path/msg**（若是 schema 上限，应看到"超出上限 N 字"）')
    }
  }
  // ① 读回（注入是否生效）：产物 HTML 里目标元素文本长度
  let back = -1, selCount = -1
  if (renderOk) {
    /* ★ 读回也走 **唯一实现** `dom-target.mjs`（支持 `li:first-child .t` 这类唯一形态），并把**命中数**带回：
       `count !== 1` ⇒ 目标不明确 ⇒ 读数无意义（与量表的"唯一命中断言"同一口径）。 */
    const html = readFileSync(join(prod, 'index.html'), 'utf8')
    const tg = domTarget(html, CLS)
    selCount = tg.count
    back = tg.count ? html.slice(tg.openEnd, tg.closeStart).replace(/<[^>]+>/g, '').trim().length : -1
  }
  // ② 判据码：在"该字段所在页的稳定帧"上直接问引擎（`timing.mjs` 唯一实现）
  let codes = [], at = '', no = ''
  if (renderOk) {
    const n = pageNoOfSelector(prod, CLS) || 1
    const st = settledAt(prod, n)
    if (st) {
      no = n; at = st.at.toFixed(3)
      const cr = spawnSync(HF, ['check', prod, '--json', '--at', at, '--no-contrast'], { encoding: 'utf8', shell: true })
      const out = String(cr.stdout || '')
      const i = out.indexOf('{')
      try {
        const j = JSON.parse(out.slice(i))
        codes = (j.layout?.findings || []).map((f) => String(f.code))
      } catch { codes = ['(JSON 不可解析)'] }
    }
  }
  // ③ 闸门口径（与量表的判据**同一套**：--assert-overlap --assert-decor）
  /* ⚠️ 两个坑都要躲（team-lead 实测抓到）：
     ① **不许 `shell: true`** —— Windows 下 `process.execPath` 含空格（"Program Files"）⇒ shell 拼接把命令拆坏
        ⇒ 进程以 1 退出 ⇒ **闸门 exit 列变成假红**（k=37 报 1，而直接跑闸门是 0）；
     ② 机器可读真源 = **闸门自己打印的 `GATE-RESULT {...}`**（二手 `status` 只作对拍，不作结论）。 */
  let gateExit = null, gateResult = null, gateRaw = '(未跑)', gateVerdict = ''
  if (renderOk) {
    const g = spawnSync(NODE, [join(HERE, 'check-engine-lint.mjs'), prod, '--assert-overlap', '--assert-decor', '--no-contrast'], { cwd: HERE, encoding: 'utf8' })
    gateExit = g.status
    const gout = String(g.stdout || '') + String(g.stderr || '')
    gateVerdict = gout.split('\n').map((s) => s.trim()).filter((s) => /^结论:/.test(s)).pop() || ''
    const m = /GATE-RESULT\s+(\{[^\n]*\})/.exec(gout)
    if (m) { gateRaw = `GATE-RESULT ${m[1]}`; try { gateResult = JSON.parse(m[1]) } catch { gateResult = null } }
    else gateRaw = '(无 GATE-RESULT 行) ⇒ 闸门末 3 行：' + gout.split('\n').map((s) => s.trim()).filter(Boolean).slice(-3).join(' ｜ ')
  }
  /* ★ 对拍断言（team-lead ③："两处不得各说各的"）：进程 status 与闸门自报 ok 必须互推（status==0 ⇔ ok） */
  let pairViol = null
  if (renderOk && gateResult) {
    const expectStatus = gateResult.ok ? 0 : 1
    if (gateExit !== expectStatus) pairViol = `工具捕获 exit=${gateExit} ↔ 闸门自报 ok=${gateResult.ok}（应为 exit=${expectStatus}）`
  } else if (renderOk && !gateResult) pairViol = '闸门未打印 GATE-RESULT（拿不到机器可读真源）'
  /* ★ 指纹防篡改：**渲染完成即取**，读完（引擎 + 闸门）再取一次 —— 两次不一致 ⇒ 本轮读数作废（并发改写） */
  const fpAfter = renderOk ? fp(join(prod, 'index.html')) : 'n/a'
  const tampered = renderOk && fpAfter !== fpRender
  if (tampered) tamper.push(`k=${k}：测量期间产物被改写（${fpRender} → ${fpAfter}）`)
  rows.push({ k, renderOk, back, at, no, codes, gateExit, gateResult, gateRaw, gateVerdict, pairViol, fpBefore: fpRender, fpAfter })
  console.log(`  k=${String(k).padStart(3)} · 渲染 ${renderOk ? 'ok' : '✗'} · 读回 ${back}/${k}${back === k + RB_OFFSET ? ' ✓' : ' ✗'}${RB_OFFSET ? `（口径：元素 = k + offset ${RB_OFFSET}）` : ''} · 页 ${no || '-'}${EXPECT_PAGE ? (Number(no) === EXPECT_PAGE ? ` ✓（= 格子 page ${EXPECT_PAGE}）` : ` ✗（≠ 格子 page ${EXPECT_PAGE}）`) : ''} · 稳定帧 t=${at || '-'} · 判据内 codes = [${codes.join(', ')}]`)
  /* ★ team-lead ③：**每格读回断言「命中元素所在页 == 该格 page 字段」**（一次写、13 格共用）——
     把"靠 `p2-` 前缀约定"变成机器校验（约定式风险 ⇒ 可判伪）。 */
  /* ⚠️ **不许在循环里 push 到 `bad`**：它声明在循环**之后**（`const bad = rows.filter(...)`）⇒ push 会抛
     `Cannot access 'bad' before initialization`（TDZ）⇒ 负控打出的 `exit=1` 是**异常**的 1、不是**断言**的 1 ✗
     （又一次"退出码多义"，与 I11/I12 同族）。⇒ 判据改在**汇总处**按 `r.no` 断言；循环里只做**可见提示**。 */
  if (EXPECT_PAGE) console.log(`        ${Number(no) === EXPECT_PAGE ? '✓' : `✗ [${TAG_PAGE}]`} 页断言：命中页 ${no} == 格子 page ${EXPECT_PAGE}（判定在汇总处 ⇒ 有牙）`)
  else if (PAGE_UNKNOWN) console.log('        ⚠️ `--page-unknown`：**本轮不校验同页**（读数待判 · **不得用于入表**）')
  else console.log('        ⚠️ **未声明 `--expect-page` ⇒ 未校验同页**（读数待判）—— 读数模式缺它会在汇总处**判红**')
  /* ★ team-lead ②：**打印差分，不打印全量** —— 全量列表会让人（包括他第一眼）把"通过的 k 上恒定的装饰性 findings"
     误读成"这格在失败"（实例：data 页在**通过的 k** 上就带约 36 个 canvas_overflow，而 GATE 仍 ok:true）。
     ⇒ 每行与**上一行**（通常是 k-1 或判据）做差集：
        · **决定性判据码** = codes(k) 减 codes(上一 k)（这才是"依据"）
        · **恒定装饰性 findings** = 两边都有的数量（打「N 个（已允许）」，不计入依据） */
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null
  if (prev) {
    const setP = new Set(prev.codes)
    const decisive = [...new Set(codes)].filter((x) => !setP.has(x))
    const constant = [...new Set(codes)].filter((x) => setP.has(x))
    console.log(`        ↳ **差分**（相对 k=${prev.k}）：**决定性判据码 = [${decisive.join(', ') || '—'}]** · 恒定装饰性 findings **${constant.length}** 个（已允许，不计入依据）`)
  }
  console.log(`       闸门真源：${gateRaw}${gateVerdict ? ' ⇒ ' + gateVerdict : ''}`)
  if (pairViol) console.error(`       ✗ 对拍不一致：${pairViol}`)
}
/* 双路对照（只对"临界 / 临界+1"两个点做定论；多 k 只是旁证） */
/* ★ **参数自检**（team-lead ③）：要求"打印出的行数 == 期望点数" —— 防 `--ks 37 38` 被拆成两个 argv 那类
   "参数错导致恒定缺行"（我踩过一次：临界+1 恒缺、而报表面上看不出）。 */
if (rows.length !== KS.length) {
  console.error(`✗ 参数自检：期望 ${KS.length} 个 k（[${KS.join(', ')}]），实际取到 ${rows.length} 行 ⇒ 参数/解析不符（§25b ⇒ exit 2）`)
  process.exit(2)
}
/* ★ team-lead ②(1)：**危险默认 ⇒ 红**（先保证行数对，再谈"该给的参数给了没"）。 */
/* ★ msg3 ②：**两种"未真正校验"合一的唯一实现**（谁都没法只登记一半 —— 之前我正是漏了"缺参数"这种）。 */
const mt = modeTag(EXPECT_PAGE, PAGE_UNKNOWN)
if (mt) {
  if (mt === TAG_PAGE_MISSING) {
    /* ★★ team-lead msg5 ④：**通道契约** —— `tag` 与结论行**同在 stdout 的同一行**（人类提示/告示走 stderr）
       ⇒ 上层脚本与 grep 才可靠（他捕获不到 tag，正是因为它们原来都在 stderr）。 */
    console.log(`✗ **[${TAG_PAGE_MISSING}] 读数模式缺 \`--expect-page <n>\`**（危险默认：0 = 静默不做「命中元素所在页 == 该格 page」断言，与 \`--sel\` 同类）`)
    console.error('   ⇒ 该断言是「靠 `p2-` 前缀约定」的机器校验 ⇒ **静默失守最危险**。请补 `--expect-page <该格 page>`（13 格命令已按此重排）。')
  } else {
    console.log(`✗ **[${TAG_PAGE_SKIP}] \`--page-unknown\`：本轮**未校验同页** ⇒ 读数**不得入表**`)
    console.error('   ⇒ **"未校验"不许伪装成"通过"**（上层脚本通常只看退出码）—— 与 I10「零分母不许算通过」同族。')
  }
  console.error('   （若只想人工排查：本命令仍会打印全部读数，但**退出码非 0**，不会被当成通过。）⇒ exit 2')
  process.exit(2)
}
/* ★ team-lead ③：**页断言在这里判**（`命中元素所在页 == 该格 page`）—— 与读回不符**同一批**红，
   避免"循环里 push 到后面的数组"那种 TDZ 假红。②(2)：红因**可区分**（专属 tag）。 */
const bad = rows.filter((r) => badReason(r, EXPECT_PAGE))
if (bad.length) {
  /* ★ msg5 ④ 通道契约：**结论行 + 全部 tag 同在 stdout 同一行**（grep/上层脚本可靠；人类细节仍在 stderr）。 */
  console.log(`✗ 有 ${bad.length} 行读数作废 ⇒ tags=[${[...new Set(bad.map((r) => badReason(r, EXPECT_PAGE)))].join(', ')}]（EXPECT_PAGE=${EXPECT_PAGE || '（未指定）'}）⇒ **读数无意义**（§25b：先过读回再谈读数）⇒ exit 2`)
  for (const r of bad.slice(0, 4)) console.error(humanRowLine(r, EXPECT_PAGE))
  process.exit(2)
}
const pair = rows.filter((r) => r.pairViol)
if (pair.length) { console.error(`✗ 有 ${pair.length} 行"工具 exit ↔ 闸门自报"对拍不一致 ⇒ 该列不可信 ⇒ **不许据此下结论**（exit 2）`); process.exit(2) }
if (tamper.length) { console.error(`✗ 有 ${tamper.length} 行**测量期产物被改写**（并发写同一 outdir）⇒ 读数不可信 ⇒ exit 2：`); for (const t of tamper) console.error(`     · ${t}`); process.exit(2) }
/* 结论行只在"三关都过"之后才允许输出（读回 / 对拍 / 防篡改）—— 这也是并发事故的教训：宁可不出结论。 */
console.log(`\n  判读：每行都以 **闸门同一判据**（--assert-overlap --assert-decor）在**该字段所在页的稳定帧**上读结论；`)
console.log(`        第一路（HTML 注入）临界 = ${PATH_A || '(未提供)'}；两路不一致 ⇒ **先查注入方式是否引入偏差**（不许取平均/不许以某一路为准）。`)
/* 退出码：本工具只负责"把第二路的原始读数取回来"（读数可信 = 渲染成功且读回 == k，否则上面已 exit 2）；
   两路是否一致由**人/表**判定（不许工具替我们下"哪一路为准"的结论）。 */
process.exit(0)
