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

const HERE = dirname(fileURLToPath(import.meta.url))
const NODE = process.execPath
const jsonMode = process.argv.includes('--json')
/* ★ `--fast` = **日常自查子集**（覆盖矩阵 + 4 个代表档）：快，但**不得作为发版依据**；
   **发版必须用无参全量**（主清单 + 覆盖矩阵 + 全部档判据，本机约 10.7 分钟）。 */
const FAST = process.argv.includes('--fast')
selfCheck({ quiet: true })

/** 17 档判据的目标枚举：与人工跑的口径一致（`out/` 排除 STALE 档；`out-master-v2/` 全量） */
function deckTargets() {
  const t = []
  for (const [dir, skipStale] of [['out', true], ['out-master-v2', false]]) {
    const base = join(DECK_DIR, dir)
    if (!existsSync(base)) continue
    for (const n of readdirSync(base)) {
      if (!n.startsWith('deck.')) continue
      if (skipStale && existsSync(join(base, n, 'STALE.md'))) continue
      t.push(`${dir}/${n}`)
    }
  }
  return t
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
  const okFile = (n) => /\.mjs$/.test(n) || /\.md$/.test(n) || n === '.gitignore' || n === 'package.json' || n === 'package-lock.json' || n === 'deck.schema.json' || /^(allowlist-.*|docs-fork-.*|probe-path-.*)\.json$/.test(n) || n === 'exclude-coverage.json'
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
  }
  // ★ 两部分**都**要防自匹配/误报（上一版踩了两次）：
  //   ① 先剥掉**块注释**（保留换行 ⇒ 行号不乱）与行注释（注释里提到旧写法不算数）
  //   ② 待查的两种写法**分段拼**成正则 ⇒ 本文件自身的源码不构成命中
  const RE1 = new RegExp("'\\.\\.'" + "\\s*,\\s*'" + "(masters|fonts|deck-contract)" + "'")
  // ★ 只针对"**从脚本目录往上跳**"这一类（K12/K13 家族）；`resolve(mp4,'..')`（取 mp4 的父目录）**不算** —— 上一版误报过 verify-masters.mjs
  const RE2 = new RegExp('resolve' + '\\(\\s*' + '(HERE|HERE_V|__dirname|SCRIPT_DIR)' + '\\s*,\\s*' + "'\\.\\.'" + '\\)')
  // ★ ③ 单字符串变体（躲过前两条的"字符串拼接"写法，如 `resolve(x, '../../fonts')`；**import 行豁免** —— 那是模块引用）
  const RE3 = new RegExp('(resolve|join)' + '\\([^)]*' + "'\\.\\./")
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
        if ((RE1.test(l) || RE2.test(l) || RE3.test(l)) && !EXEMPT[f]) bad.push(`${f}:${i + 1}`)
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
          if (l.indexOf('/*') >= 0) hits.push(`${f}:${i + 1}（块注释内出现"星号+斜杠"，该块起于第 ${start} 行）`)
          if (l.indexOf('*/') >= 0) inBlock = false
        }
      })
    }
  }
  return hits
}

const ck = commentKillers()
rows.push({
  group: '⓪c注释安全(提示级)', label: '注释安全（提示级：块注释内不许出现"星号+斜杠"）', script: '(内置)', exit: 0, sec: 0,
  verdict: ck.length ? `⚠ ${ck.length} 处（**提示级，不判红**；契约规矩 R）` : '✓ 无隐患',
  tail: ck.slice(0, 5).map((h) => `· ${h} ⇒ 按契约规矩 R 改写（引用路径分段写 / 改用行注释）`),
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
  const ckOnly = commentKillers()
  console.log(`⓪c 注释安全（**提示级，不判红**）：${ckOnly.length ? `⚠ ${ckOnly.length} 处 —— ` + ckOnly.slice(0, 3).join(' ｜ ') : '✓ 无隐患（块注释内无"星号+斜杠"序列）'}`)
  const present = GRAY_DIR.filter((g) => readdirSync(DECK_DIR).some((n) => g.re.test(n)))
  console.log(`   灰名单在场 ${present.length} 类（允许在场、**不入库**；每条理由如下）：`)
  for (const g of present) console.log(`     · ${g.name} —— 为什么允许：${g.why} ｜ 不入库依据：${g.basis}`)
  const fkOnly = spawnSync(NODE, [join(HERE, 'check-docs-fork.mjs')], { cwd: HERE, encoding: 'utf8' })
  console.log(`⓪d docs 分叉不变量（内容级）：${fkOnly.status === 0 ? '✓ 成立' : `✗ exit=${fkOnly.status}`}`)
  for (const l of ((fkOnly.stdout || '') + (fkOnly.stderr || '')).split('\n').map((s) => s.trim()).filter(Boolean).slice(-4)) console.log('     ' + l)
  // 退出码分档：白名单/自造路径红 ⇒ 1；分叉红 ⇒ 1；分叉**配置错**（2）⇒ 2（§25b）
  process.exit(extra.length || smpOnly.length ? 1 : (fkOnly.status === 2 ? 2 : (fkOnly.status ? 1 : 0)))
}
if (!FAST) rows.push(step('①主清单闸门', 'check-master-manifest', 'check-master-manifest.mjs'))
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
  console.log(`  结论: ${failedRows.length === 0 ? 'PASS（发版闸门全绿）' : envRows.length ? '环境/输入不完整（exit 2）—— 不是判据失败' : `FAIL（${failedRows.length} 步未过）`}`)
}
process.exit(failedRows.length === 0 ? 0 : (envRows.length ? 2 : 1))
