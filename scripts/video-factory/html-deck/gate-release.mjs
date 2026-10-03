#!/usr/bin/env node
/**
 * gate-release.mjs —— **发版闸门的唯一入口**（team-lead ④）
 *
 * 为什么需要：主清单闸门 / 覆盖矩阵 / 17 档判据分散在三个地方 ⇒ "发版前必跑"必然靠**人记得**，
 * 而这正是我们一路在防的失效模式。
 * 本脚本**依次**跑完三件，打印**单步耗时 + 分组小计 + 总耗时**（照抄进发版清单），任一步非 0 ⇒ 整体非 0。
 *
 * 路径/引擎解析**不重复实现**：路径 import `paths.mjs`；引擎 bin 由各子脚本自己 import `engine-bin.mjs`。
 *
 * 用法: node gate-release.mjs          （人读：耗时表）
 *       node gate-release.mjs --json    （机器可读）
 * 退出码: 0 = 全绿 · 1 = 有判据失败 · 2 = 环境/输入不完整（子步骤冒泡，§25b）
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DECK_DIR, ENGINE_ROOT, selfCheck } from './paths.mjs'
import { declaredDecks } from './deck-targets.mjs'
/* ★ 本断言**自带豁免**：`timing.mjs` = 时序唯一实现（公式与四个常数只许在这里出现） */
import { evaluate } from './check-product-freshness.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const NODE = process.execPath
const jsonMode = process.argv.includes('--json')
/* ★ `--fast` = **日常自查子集**（覆盖矩阵 + 4 个代表档）：快，但**不得作为发版依据**；
   **发版必须用无参全量**（主清单 + 覆盖矩阵 + 全部档判据，本机约 10.7 分钟）。 */
const FAST = process.argv.includes('--fast')
/* ★ `--render` = **全新克隆/服务器的唯一命令**（team-lead ②-④）：先把"缺产物 / 陈旧"的**声明档**渲出来再判；
   **逐档打印渲染 exit（永不吞输出）**；判据只依赖"源 + 产物"（运行态不落仓库）。 */
const RENDER = process.argv.includes('--render')
selfCheck({ quiet: true })

/** ③ 判据的目标枚举：**来自声明清单**（唯一实现 `deck-targets.mjs`）——
 *  ⚠️ 旧版由**磁盘现状**定义（`readdirSync(out*)`）⇒ 被 `out-sweep-k*` ×30 骗过一次（34 档 vs 实际 2 档）。
 *  team-lead ②.3：`--render` 里"跳过"必须以满足**新鲜度**为前提（否则会跳过而漏渲）。 */
function deckTargets() {
  const { decks, issues } = declaredDecks()
  if (issues.length) {
    console.error('✗ 声明清单有问题（禁静默跳过）：')
    for (const x of issues) console.error('    · ' + x)
    process.exit(1)
  }
  return decks.map((d) => `${d.outdir}/${d.deck}`)
}

function step(group, label, script, extra = []) {
  const t0 = Date.now()
  const r = spawnSync(NODE, [join(HERE, script), ...extra], { cwd: HERE, encoding: 'utf8' })
  const sec = (Date.now() - t0) / 1000
  const tail = ((r.stdout || '') + (r.stderr || '')).split('\n').map((s) => s.trim()).filter(Boolean)
  const verdict = tail.find((l) => l.startsWith('结论:')) || tail[tail.length - 1] || ''
  return { group, label, script, exit: r.status, sec, verdict, tail }
}

/* ---------- ⓪ 引擎根目录**白名单断言**（team-lead ④ 硬要求）----------
   根目录一乱，入库清单就得**靠人挑** ⇒ 迟早漏（两个 `transient-*.txt` 就是证据）。
   ✅ 白名单：`*.mjs` · `*.md` · `deck.schema.json` · 契约数据 `allowlist-*.json`/`exclude-coverage.json` · 目录 `masters/` `examples/` `fonts/` `evidence/`
   ❌ 其余（`frames-*.png` · `tmp-*` · `transient-*.txt` · `out*` · `_diag-*` · `*.bak`）⇒ **红**，提示"移到 `evidence/` 并登记（§22b）"。 */
/** ★ 灰名单：**允许在场但不入库**。纪律（team-lead 拍板）：**每条必须写明「为什么允许在场 + 不入库依据」**；
 *  **新增模式必须写理由**（不许静默往灰名单里加东西 —— 否则它就是新的"垃圾桶"）。 */
const GRAY_DIR = [
  { re: /^out(-|$)/, name: 'out*/', why: '渲染产物 —— **闸门的操作对象**（判据要读 out/… 里的产物）', basis: '`LANDING-INVENTORY.md` §2 排除项：可重生成' },
  { re: /^node_modules/, name: 'node_modules/', why: '依赖 —— 引擎 bin 解析的"开发回退"要在这里找 `hyperframes`；本机验收用 junction 指向开发树', basis: '§2 排除项：依赖不入库（部署侧 `npm i`；引擎目录 `.gitignore` 已声明）' },
  { re: /^\./, name: '点目录/点文件', why: '工具与版本控制的元数据', basis: '§2 排除项：非源码' },
]

function rootWhitelist() {
  const okFile = (n) => /\.mjs$/.test(n) || /\.md$/.test(n) || n === '.gitignore' || n === 'package.json' || n === 'package-lock.json' || n === 'deck.schema.json' || /^(allowlist-.*|docs-fork-.*|probe-path-.*|bad-.*|deck-targets|comment-killer-allowlist)\.json$/.test(n) || n === 'exclude-coverage.json'
  /* `cs-test/` `seek-test/` = **引擎自测资产**（随引擎走；原本只在不可分发树，2026-10-03 补入库） */
  const okDir = ['masters', 'examples', 'fonts', 'evidence', 'cs-test', 'seek-test']
  // 灰名单 = **运行时生成物 / 已声明不入库**：`out*/`（渲染产物，闸门的操作对象）· `node_modules/` · 点目录
  //   ⇒ 允许在树里存在，但**明示不入库**（否则闸门根本没法跑；入库清单里它们属"排除项"）。
  const grayDir = GRAY_DIR.map((g) => g.re)
  const extra = []
  for (const e of readdirSync(DECK_DIR, { withFileTypes: true })) {
    // ★ 灰名单按**名字**先判（不看类型）：junction/软链在 Windows 上的类型判定不稳（实测 `node_modules` junction 漏判）
    if (grayDir.some((r) => r.test(e.name))) continue
    if (e.isDirectory()) { if (!okDir.includes(e.name)) extra.push(e.name + '/') }
    else if (!okFile(e.name)) extra.push(e.name)
  }
  return extra
}

/* ---------- ⓪b **自造路径断言**（flat 搬迁验收抓出的真 bug 的机器保证）----------
   `validate-deck.mjs` 曾写死 `join(HERE_V,'..','masters')`（且注释自称"与 render-deck 同一约定"）⇒ 扁平后解析错。
   规矩：**除 `paths.mjs` 外，任何脚本不得自己拼引擎根/母版根**（`'..' + masters|fonts|deck-contract`，或 `resolve(HERE…,'..')`）。 */
function selfMadePaths() {
  const bad = []
  /* ★ 显式豁免表（**不静默**：命中即打印豁免理由）。加进来必须同时写"为什么两种布局下都正确"，
     否则就是往白名单里塞垃圾 —— 本表只允许放"import 在两种布局下不可能成立"的极少数情况。 */
  const EXEMPT = {
    // ⚠️ 理由文字**不能**出现被断言的写法本身（否则断言自匹配 ⇒ 又红一次；这里踩过两次，故用自然语言描述）
    'sync-master-fonts.mjs': '本文件在 fonts/ 下，而 paths.mjs 在脚本目录下 ⇒ 用模块相对引用时，该相对路径在 flat 恰好成立、在 dev 会指向不存在的文件；而"从本文件目录上一级"在 dev=probe-hf / flat=html-deck **两布局都等于引擎根**（已实测，且脚本输出结论 PASS）',
    'timing.mjs': '**时序唯一实现**：稳定帧公式与四个具名常数（入场收尾 / 页长沉降比例 / 下一页淡入余量 / 末页页尾余量）只许出现在这里；其它文件一律 import',
  }
  // ★ 两部分**都**要防自匹配/误报（上一版踩了两次）：
  //   ① 先剥掉**块注释**（保留换行 ⇒ 行号不乱）与行注释（注释里提到旧写法不算数）
  //   ② 待查的两种写法**分段拼**成正则 ⇒ 本文件自身的源码不构成命中
  const RE1 = new RegExp("'\\.\\.'" + "\\s*,\\s*'" + "(masters|fonts|deck-contract)" + "'")
  // ★ 只针对"**从脚本目录往上跳**"这一类（K12/K13 家族）；`resolve(mp4,'..')`（取 mp4 的父目录）**不算** —— 上一版误报过 verify-masters.mjs
  const RE2 = new RegExp('resolve' + '\\(\\s*' + '(HERE|HERE_V|__dirname|SCRIPT_DIR)' + '\\s*,\\s*' + "'\\.\\.'" + '\\)')
  // ★ ③ 单字符串变体（躲过前两条的"字符串拼接"写法，如 `resolve(x, '../../fonts')`；**import 行豁免** —— 那是模块引用）
  const RE3 = new RegExp('(resolve|join)' + '\\([^)]*' + "'\\.\\./")
  /* ★ ⑤ **禁止手工推导引擎根**（team-lead 批准；同一族错误两轮内出了两次：②b "检查 0 档"假绿 · ⓪e 扫错 fonts/）：
   *   `dirname(DECK_DIR)` / `dirname(HERE)` … 或 `join(HERE,'..')` 一类 ⇒ 必须用 `paths.mjs` 导出的根。
   *   注释已在上方剥离 ⇒ 注释里提到这些写法不会误报。 */
  const RE4 = new RegExp('dirname' + '\\(\\s*(DECK_DIR|ENGINE_ROOT|HERE|HERE_V|SCRIPT_DIR|__dirname)\\s*\\)')
  const RE5 = new RegExp('join' + '\\(\\s*(DECK_DIR|HERE|HERE_V|SCRIPT_DIR)\\s*,\\s*' + "'\\.\\.'")
  /* ★ ⑥ **"时序唯一实现"断言**（team-lead ①/③）：消费方不许再写时序算术或硬编码时刻 ——
   *   活证据：`measure-sweep --at 1.0`（漂移）、`check-engine-lint` L314 内联 `+ 0.6`（抽了模块留了副本）。
   *   只在"**提到时序概念**且含常数"时判红（避免误伤无关的 0.6/0.1）： */
  const TIMED = /(maxAt|data-at|settledAt|SETTLED)/
  const TIMING_LIT = /(\+\s*0\.6\b)|(\*\s*0\.6\b)|(-\s*0\.15\b)|(-\s*0\.1\b)/
  /* `--at 1.0` / `--at=1.0` / `['--at','1.0']`（spawnSync 实参写法）—— 引号与逗号都容错：
     第一版写成 `--at\s*[=,]?\s*['"]?\d` ⇒ **打不中** `['--at','1.0']`（中间夹了 `'` 与 `,`）⇒ 负控当场抓出。 */
  const AT_LITERAL = /--at['"]*[\s=,]*['"]*\s*\d/
  /* ⚠️ 这两条**收窄过**：第一版写成 `\|\|\s*['"]?\d+\.\d` 与 `['"]--at['"][^\n]*\d` ⇒ **误报 9 处**
     （`encoding:'utf8'` 里的 8、对比度阈值 `|| 4.5`、纯变量写法 `'--at', atList`）⇒ 现只认**数字兜底**的精确形状：
       ① `SWEEP_AT || <数字>` / `|| '1.0'`（"看着像死代码，字面量在就还会被人复制"）
       ② `'--at'` 与数字**紧邻**：`['--at','1.0']` / `['--at', 1.0]`（数字在别处的不算 —— 那种由 ① 兜） */
  const TIMING_FALLBACK = /(SWEEP_AT\s*\|\|\s*['"]?\d)|(\|\|\s*['"]1\.\d)/
  const AT_ARRAY_LITERAL = /['"]--at['"]\s*,\s*['"]?\d/
  const timingHard = (l) => AT_LITERAL.test(l) || AT_ARRAY_LITERAL.test(l) || TIMING_FALLBACK.test(l) || (TIMED.test(l) && TIMING_LIT.test(l))
  // ★ ④ 扫描范围**含子目录**（`fonts/*.mjs` 也曾自造根 —— 只扫 DECK_DIR 顶层会漏，team-lead 指出的正是这个）
  const dirs = [DECK_DIR, join(ENGINE_ROOT, 'fonts')].filter((d) => existsSync(d))
  for (const d of dirs) {
    // ★ 不扫 `paths.mjs`（唯一路径来源，必须能写根推导）与**本文件自身**（断言必须写出的正则/示例天然自匹配；
    //   linter 不 lint 自己的规则表达式 —— 这是显式豁免，输出里会说明）
    for (const f of readdirSync(d).filter((x) => x.endsWith('.mjs') && x !== 'paths.mjs' && x !== 'gate-release.mjs')) {
      let raw = ''
      try { raw = readFileSync(join(d, f), 'utf8') } catch { continue }
      const txt = raw
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))   // 块注释 → 等长空格（保留行号）
        .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
      txt.split('\n').forEach((l, i) => {
        if (/^\s*import\b/.test(l)) return                                 // import 语句豁免
        if ((RE1.test(l) || RE2.test(l) || RE3.test(l) || RE4.test(l) || RE5.test(l) || timingHard(l)) && !EXEMPT[f]) bad.push(`${f}:${i + 1}`)
      })
    }
  }
  return bad
}

const rows = []
const t0 = Date.now()
const smp = selfMadePaths()
rows.push({
  group: '⓪b自造路径', label: '自造路径断言（除 paths.mjs 外不许自己拼根）', script: '(内置)', exit: smp.length ? 1 : 0, sec: 0,
  verdict: smp.length ? `✗ ${smp.length} 处自造路径：${smp.join(', ')}` : '✓ 无自造路径（全部 import paths.mjs）',
  tail: smp.map((x) => `· ${x} ⇒ 改为 import { ENGINE_ROOT | DECK_DIR | MASTERS_DIR | FONTS_DIR } from './paths.mjs'`),
})
/* ---------- ⓪c **提示级**（不判红）：块注释里再出现"块注释起始符" ⇒ 可能**提前终止** ----------
   实战事故（render-deck）：注释里把 glob 路径**连写**（"星号 + 斜杠 + 文件名"）⇒ 其中的结束符把块注释提前切断 ⇒
   注释尾部当代码 ⇒ ReferenceError（且**只在特定分支触发**，极难发现）。
   ⚠️ 本条注释自己就踩过一次：写这条规矩时把那个连写序列原样写进注释 ⇒ **本文件当场语法错**（第一次生效就抓住自己）。
   ★ team-lead 口径：**做不到精确就不判红** ⇒ 本项**只提示**；契约规矩 R：源码注释里禁止该连写序列
     （引用路径分段写，或改用行注释）。 */
function commentKillers() {
  const hits = []
  const dirs = [DECK_DIR, join(ENGINE_ROOT, 'fonts')].filter((d) => existsSync(d))
  for (const d of dirs) {
    for (const f of readdirSync(d).filter((x) => x.endsWith('.mjs') && x !== 'gate-release.mjs')) {
      let raw = ''
      try { raw = readFileSync(join(d, f), 'utf8') } catch { continue }
      let inBlock = false
      let start = 0
      raw.split('\n').forEach((l, i) => {
        if (!inBlock) {
          const m = l.indexOf('/*')
          if (m >= 0 && l.indexOf('*/', m + 2) < 0) { inBlock = true; start = i + 1 }
        } else {
          if (l.indexOf('/*') >= 0) hits.push({ file: f, line: i + 1, blockStart: start, text: l.trim() })
          if (l.indexOf('*/') >= 0) inBlock = false
        }
      })
    }
  }
  return hits
}

/* ⓪c **升成判红**（team-lead 批准）：块注释内出现"星号+斜杠"会让注释**提前终止** ⇒ 尾部当代码。
   命中必须**修**（引用路径分段写 / 改用行注释）或进 `comment-killer-allowlist.json`（`file+snippet+reason`）。
   —— 与 ⓪f 的**全量 `node --check`** 配对：⓪c 抓"还没造成语法错但迟早"的，⓪f 抓"已经造成"的。 */
const CK_ALLOW_FILE = join(DECK_DIR, 'comment-killer-allowlist.json')
const ckAllow = existsSync(CK_ALLOW_FILE) ? (JSON.parse(readFileSync(CK_ALLOW_FILE, 'utf8')).allow || []) : []
const ckAll = commentKillers()
const ckBad = ckAll.filter((h) => !ckAllow.some((a) => a.file === h.file && (!a.snippet || h.text.includes(a.snippet)) && (a.reason || a.why)))
rows.push({
  group: '⓪c注释安全', label: '注释安全（**判红**：块注释内不许出现"星号+斜杠"）', script: '(内置)', exit: ckBad.length ? 1 : 0, sec: 0,
  verdict: ckBad.length ? `✗ ${ckBad.length} 处（豁免 ${ckAllow.length} 条）⇒ 命中必须**修**或进白名单（带 reason）` : `✓ 无隐患（豁免 ${ckAll.length - ckBad.length} 处 / 白名单 ${ckAllow.length} 条）`,
  tail: ckBad.slice(0, 6).map((h) => `· ${h.file}:${h.line}（该块起于第 ${h.blockStart} 行）${String(h.text).slice(0, 80)}`),
})
const extra = rootWhitelist()
rows.push({
  group: '⓪根目录白名单', label: '根目录白名单（引擎根只许白名单文件/目录）', script: '(内置)', exit: extra.length ? 1 : 0, sec: 0,
  verdict: extra.length ? `✗ 多出 ${extra.length} 项：${extra.join(', ')}` : '✓ 全部命中白名单',
  tail: extra.map((x) => `· 非白名单项：${x} ⇒ **移到 \`evidence/\` 并登记（§22b）**，别放根目录`),
})
/* ---------- ⓪d **docs 分叉不变量**（内容级：docs 只许保留"引擎里从来没有过的东西"）---------- */
const forkRow = step('⓪d docs分叉', 'docs 分叉不变量（内容级扫描，不看名字）', 'check-docs-fork.mjs')
rows.push(forkRow)
/* ⓪e **陈旧路径断言**（team-lead ④-3）：tracked 文件里不许出现不可分发的 `dist-rel/…`（可执行指引必须指入库根；
   纯历史注记进 `probe-path-allowlist.json`，`file+snippet+reason` 必填）。 */
rows.push(step('⓪e 陈旧路径', '陈旧路径引用（不可分发路径未登记即红）', 'check-probe-paths.mjs'))
if (process.argv.includes('--fork-only')) {
  console.log(`\n⓪d docs 分叉不变量 ⇒ exit=${forkRow.exit}`)
  for (const l of forkRow.tail) console.log('  ' + l)
  process.exit(forkRow.exit ?? 2)
}
if (process.argv.includes('--whitelist-only')) {
  console.log(`\n⓪ 根目录白名单：${extra.length ? `✗ 多出 ${extra.length} 项：${extra.join(', ')}` : '✓ 全部命中白名单（' + readdirSync(DECK_DIR).length + ' 项）'}`)
  const smpOnly = selfMadePaths()
  console.log(`⓪b 自造路径断言：${smpOnly.length ? `✗ ${smpOnly.length} 处：${smpOnly.join(', ')}` : '✓ 无自造路径（除 paths.mjs 外全部 import）'}`)
  if (smpOnly.length) process.exit(1)
  console.log(`⓪c 注释安全（**判红**）：${ckBad.length ? `✗ ${ckBad.length} 处 —— ` + ckBad.slice(0, 10).map((h) => `${h.file}:${h.line}`).join(' ｜ ') + '（命中必须修或进白名单带 reason）' : `✓ 无隐患（白名单 ${ckAllow.length} 条）`}`)
  /* ⓪f **全量语法/JSON 守卫**（判红）：node --check 抓"已造成语法错"；JSON.parse 抓任何 JSON 破损 */
  const fk = spawnSync(NODE, [join(HERE, 'check-syntax-and-json.mjs')], { cwd: HERE, encoding: 'utf8' })
  console.log(`⓪f 语法/JSON 守卫：${fk.status === 0 ? '✓ 全过' : `✗ exit=${fk.status}`}`)
  for (const l of ((fk.stdout || '') + (fk.stderr || '')).split('\n').map((s) => s.trim()).filter(Boolean).slice(-3)) console.log(`     ${l}`)
  const present = GRAY_DIR.filter((g) => readdirSync(DECK_DIR).some((n) => g.re.test(n)))
  console.log(`   灰名单在场 ${present.length} 类（允许在场、**不入库**；每条理由如下）：`)
  for (const g of present) console.log(`     · ${g.name} —— 为什么允许：${g.why} ｜ 不入库依据：${g.basis}`)
  const fkOnly = spawnSync(NODE, [join(HERE, 'check-docs-fork.mjs')], { cwd: HERE, encoding: 'utf8' })
  console.log(`⓪d docs 分叉不变量（内容级）：${fkOnly.status === 0 ? '✓ 成立' : `✗ exit=${fkOnly.status}`}`)
  for (const l of ((fkOnly.stdout || '') + (fkOnly.stderr || '')).split('\n').map((s) => s.trim()).filter(Boolean).slice(-4)) console.log('     ' + l)
  // 退出码分档：白名单/自造路径红 ⇒ 1；分叉红 ⇒ 1；分叉**配置错**（2）⇒ 2（§25b）
  process.exit(extra.length || smpOnly.length || ckBad.length || fk.status ? 1 : (fkOnly.status === 2 ? 2 : (fkOnly.status ? 1 : 0)))
}
/* ①b **`--render`**：渲"缺产物 ∪ 陈旧"的声明档再判（跳过以新鲜度为前提）；逐档打印 exit */
if (RENDER) {
  const ev = evaluate()
  const todo = [...ev.missing, ...ev.stale.map((s) => ({ deck: s.deck, outdir: s.outdir }))]
  console.log(`\n--render：声明档 ${ev.decks.length} · 缺产物 ${ev.missing.length} · 陈旧 ${ev.stale.length} ⇒ 需渲 ${todo.length} 档`)
  for (const d of todo) {
    const r = spawnSync(NODE, [join(HERE, 'render-deck.mjs'), `examples/${d.deck}.json`, '--outdir', d.outdir], { cwd: HERE, encoding: 'utf8' })
    const last = ((r.stderr || '') + (r.stdout || '')).split('\n').map((s) => s.trim()).filter(Boolean).pop() || ''
    console.log(`  ${r.status === 0 ? '✓' : '✗'} render ${d.outdir}/${d.deck} exit=${r.status}${r.status === 0 ? '' : ' ⇒ ' + last.slice(0, 120)}`)
  }
  const ev2 = evaluate()
  console.log(`  --render 完成：剩余缺产物 ${ev2.missing.length} · 剩余陈旧 ${ev2.stale.length}`)
}
if (!FAST) rows.push(step('①主清单闸门', 'check-master-manifest', 'check-master-manifest.mjs'))
/* ②b **产物新鲜度**（team-lead ②）：产物 mp4 mtime 必须 ≥ 该档全部输入的最新 mtime
   —— 防"旧产物被当成证据"（本次跨树不一致的真因就是它；也覆盖"改了母版/字体忘了重渲"整类）。 */
rows.push(step('②b 产物新鲜度', '产物新鲜度（产物 mtime ≥ 输入 mtime）', 'check-product-freshness.mjs'))
/* ②c **反例退出码断言**（team-lead）：`deck.bad-*` 等**本来就应该失败** ⇒ 断言"失败退出码 == 声明值"
   （否则真故障会被洗成"设计性失败"）；同时断言它们**不产出 mp4**。 */
rows.push(step('②c 反例退出码', '反例退出码与声明一致（且不产出产物）', 'check-bad-examples.mjs'))
rows.push(step('②覆盖矩阵', 'check-coverage-matrix', 'check-coverage-matrix.mjs'))
const targets = FAST
  ? ['out/deck.all12', 'out/deck.all12-9x16', 'out-master-v2/deck.all12-master-v2', 'out-master-v2/deck.all12-9x16-master-v2']
  : deckTargets()
/* ★ `--assert-overlap` **恒带**：发版口径 = `measure-sweep` 口径 = (三码 ∪ `content_overlap`) − (溢出 ∪ 重叠白名单) = 0。
   否则"内容上限"用了比闸门更严的判据 ⇒ 出现"过闸门却违反上限"（team-lead ③ 抓到的分叉）。 */
for (const t of targets) rows.push(step(FAST ? '③代表档判据(fast)' : '③全档判据', t, 'check-engine-lint.mjs', [t, '--assert-contrast', '--assert-overlap']))
const total = (Date.now() - t0) / 1000

const failedRows = rows.filter((r) => r.exit !== 0)
const envRows = rows.filter((r) => r.exit === 2)
/* ★ **exit 4 = 需先渲染**（与"判据失败 exit 1"分开 ⇒ 服务器/CI 能区分"还没渲染"与"真不合格"） */
const needRenderRows = rows.filter((r) => r.exit === 4)
const groups = [...new Set(rows.map((r) => r.group))].map((g) => ({
  group: g,
  n: rows.filter((r) => r.group === g).length,
  sec: Number(rows.filter((r) => r.group === g).reduce((s, r) => s + r.sec, 0).toFixed(1)),
  bad: rows.filter((r) => r.group === g && r.exit !== 0).length,
}))

if (jsonMode) {
  console.log(JSON.stringify({ pass: failedRows.length === 0, totalSec: Number(total.toFixed(1)), groups, rows }, null, 2))
} else {
  console.log('\n=== 发版闸门（唯一入口）===\n')
  for (const g of groups) {
    console.log(`  ${g.group}  ${g.n} 步 · ${g.sec}s  ${g.bad ? `✗ 失败 ${g.bad}` : '✓'}`)
  }
  for (const r of failedRows) {
    console.log(`\n  ✗ ${r.label}  exit=${r.exit}  ${r.sec.toFixed(1)}s`)
    for (const l of r.tail.slice(-8)) console.log(`      ${l.slice(0, 150)}`)   // §25a：失败输出原样保留（仅取末 8 行，未过滤关键字）
  }
  console.log(`\n  总耗时 = ${total.toFixed(1)}s（含 ${rows.length} 步；发版清单请照抄此数字）`)
  console.log(`  结论: ${failedRows.length === 0 ? 'PASS（发版闸门全绿）' : needRenderRows.length ? `需先渲染（exit 4）—— ${needRenderRows.length} 步；请跑 \`node gate-release.mjs --render\`` : envRows.length ? '环境/输入不完整（exit 2）—— 不是判据失败' : `FAIL（${failedRows.length} 步未过）`}`)
}
process.exit(failedRows.length === 0 ? 0 : (needRenderRows.length ? 4 : (envRows.length ? 2 : 1)))
