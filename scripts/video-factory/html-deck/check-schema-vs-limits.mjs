#!/usr/bin/env node
/**
 * check-schema-vs-limits.mjs —— **"每个硬上限都能被闸门复核，且都留有余量"** 的机器可判化（team-lead ③）
 *
 * 输入：`measured-limits.json`（实测表；唯一来源）+ `deck.schema.json`
 * 判据（**I1–I4**）：
 *   I1  有 `judgeLimit` 的字段 ⇒ `maxLength` 必须存在，**或**显式声明 `noHardLimit: true`（二者必居其一，不许含糊）
 *   I2  有 `maxLength` ⇒ **`maxLength ≤ ⌊0.9 × judgeLimit⌋`**（余量规则；防换机/换引擎版本 ±1 波动）
 *   I3  `judgeLimit === null`（到 K_MAX 不触发判据）⇒ **不许**有 `maxLength`（只许 `recommendedMax`）
 *   I4  两者都有 ⇒ **`recommendedMax ≤ maxLength`**
 * 覆盖（默认**只报告不判红**，`--strict-coverage` 才红）：schema 里每个 `maxLength` 字段都必须出现在实测表里
 *   —— 发版前必须开 `--strict-coverage`（否则"没测过的硬上限"会静默存在，与 §25c 冲突）。
 *
 * 退出码：0 = 无违规 · 1 = 有违规（或 `--strict-coverage` 下覆盖不全）· 2 = 输入/配置错（§25b）
 * 用法：`node check-schema-vs-limits.mjs [--strict-coverage]`
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'   /* ★ --selftest-handchecks：逐叶子跑第二路 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DECK_DIR } from './paths.mjs'
/* ★ 路径语义**唯一实现**（team-lead 裁定 (B)：新建 `deck-jsonpath.mjs`）—— 本文件只用 `pageIndexOf()`，
   **不再自己写 `pages.` 的解析正则**（有跨文件出现次数断言守着，见下方"路径唯一性"块）。 */
import { pageIndexOf } from './deck-jsonpath.mjs'
/* ★★ team-lead msg8 ③：兜底 = **跳过 shebang/import 后的第一句可执行**（否则 `const HERE` / `process.argv` 那几行里的异常仍漏网）。 */
for (const [ev, tag] of [['uncaughtException', 'UNCAUGHT_EXCEPTION'], ['unhandledRejection', 'UNCAUGHT_REJECTION']]) {
  process.on(ev, (e) => {
    console.log(`✗ **[${tag}] 未捕获的故障 ⇒ 已转为带 tag 的红（exit 2）：${(e && e.message) || e}`)
    const st = String((e && e.stack) || '').split('\n').slice(1, 4).join(' | ')
    if (st) console.error(`     ${st}`)
    process.exit(2)
  })
}
/* ★ msg8 ③：兜底的正控（主动抛 ⇒ 断言转 tag + exit 2）。 */
if (process.argv.includes('--self-test-uncaught')) throw new Error('自测：故意抛出（验证兜底转 tag）')

const HERE = dirname(fileURLToPath(import.meta.url))
const STRICT = process.argv.includes('--strict-coverage')
const SCHEMA = join(DECK_DIR, 'deck.schema.json')
const LIMITS = join(DECK_DIR, 'measured-limits.json')
if (!existsSync(SCHEMA)) { console.error(`✗ 缺 ${SCHEMA}（§25b ⇒ exit 2）`); process.exit(2) }
if (!existsSync(LIMITS)) { console.error(`✗ 缺 measured-limits.json（实测表是唯一输入；§25b ⇒ exit 2）`); process.exit(2) }
const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'))
const limits = JSON.parse(readFileSync(LIMITS, 'utf8'))
const K_MAX = Number(limits.K_MAX || 0)

const get = (ptr) => {
  const parts = ptr.replace(/^#\//, '').split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
  let cur = schema
  for (const p of parts) { if (cur == null) return null; cur = cur[p] }
  return cur
}
/** 收集 schema 里所有含 maxLength/recommendedMax 的叶子（指针 → 节点） */
const leaves = new Map()
;(function walk(n, p) {
  if (!n || typeof n !== 'object') return
  if (n.maxLength !== undefined || n.recommendedMax !== undefined) leaves.set(p, n)
  for (const k of Object.keys(n)) walk(n[k], `${p}/${k}`)
})(schema, '#')

/* ★★ team-lead msg35 ②：把本轮两条新判据抽成**纯函数** —— ⇒ 可用**合成输入**证伪（免渲染、不碰真表），
   且真表走的**就是同一个函数**（单一实现）。两个函数各返回"违规信息数组/单条"⇒ 调用方直接上报。 */

/** 判据 1（`fixedWindowVerdict`）：**固定窗口不许报容量** + `boundSource` 路线的一致性
 *   · (a) `minItems == maxItems` 且给 `capacityAtLeast` ⇒ 违反（契约固定 ⇒ 那不是容量）
 *   · (b) `boundSource` 指向的节点**不存在/不可解析** ⇒ 违反（= 等于没声明）
 *   · (c) `renderedMax ≠ 该节点 maxItems` ⇒ 违反（不许把 schema 上限包装成容量）
 *   · (d) `boundSource` 与 `capacityAtLeast` **互斥** ⇒ 违反 */
export function fixedWindowVerdict(cell, node, boundNode) {
  const out = []
  if (!cell) return out
  if (cell.boundSource !== undefined) {
    if (boundNode == null) { out.push('boundSource 不存在/不可解析'); return out }
    if (boundNode.minItems === undefined && boundNode.maxItems === undefined) out.push('boundSource 指向的节点无 minItems/maxItems（无处生效）')
    if (cell.renderedMax !== undefined && Number(cell.renderedMax) !== Number(boundNode.maxItems)) out.push(`renderedMax ${cell.renderedMax} ≠ schema maxItems ${boundNode.maxItems}（不许把上限包装成容量）`)
    if (cell.capacityAtLeast !== undefined) out.push('既声明 boundSource（编辑意图）又给 capacityAtLeast（几何容量）⇒ 二者互斥')
    return out
  }
  if (node && node.minItems !== undefined && Number(node.minItems) === Number(node.maxItems) && cell.capacityAtLeast !== undefined) {
    out.push(`固定窗口（minItems == maxItems == ${node.maxItems}，契约固定）不许给 capacityAtLeast=${cell.capacityAtLeast} ⇒ 应改走 boundSource 路线`)
  }
  return out
}

/** ★★ team-lead msg37 ② + msg38 ①②：**同一判据只许一处实现** —— 结构性断言（≠"此刻消除了分叉"）。
 *  · ① **调用点**：`verifyCoverageVerdict(` 出现 **≥ 2** 次（定义 + 真路径调用点）⇒ 防"删了调用却留着纯函数"；
 *  · ② **禁止串表**：本轮那次回归的**三条内联原文**只许出现在判据**区间之内**（区间内 = 纯函数自己的合法文案 ✓），
 *      出现在**区间之外** ⇒ 红（**按区间判**而不是"全文命中就红" —— 否则纯函数自己的输出会把自己判红 ✗）；
 *  · ③ **区间抽样**：`capacityAtLeast` 的**比较**只许住在两个判据纯函数区间内（别处 ⇒ 内联重写）；
 *      存在性检查（`!== undefined` / `=== null`）**不算比较**（它们是"有没有这个字段"，不是判据）。
 *  ⚠️ **能力边界（如实 · team-lead msg38 ②）**：本断言防"**原样回写**"，**不防"等价改写"** ——
 *     例如 `const cal = it.capacityAtLeast; if (cap > cal) …`（**别名**）或换一种措辞写回内联 ⇒ **抓不到**；
 *     彻底堵死需**别名/数据流**分析（成本高，暂不做，已记 K 表）。**"能抓什么 / 不能抓什么"本身就是可判伪的知识。**
 *  ⚠️ 所有指纹**分段拼**（源码里无连续旧字面量）⇒ 判定器**不自匹配**（HF / K17-ff 同款坑）；区间也**自动定位**
 *     （列 0 函数头 + 大括号配平 ⇒ 不手写行号，挪动代码不会失效）。 */
export function sameCriterionVerdicts(src) {
  const out = []
  const lines = String(src || '').split('\n')
  const CALL = 'verifyCoverage' + 'Verdict('
  const nCall = lines.join('\n').split(CALL).length - 1
  if (nCall < 2) out.push(`${CALL} 只出现 **${nCall}** 次（须 ≥ 2：定义 + 真路径调用点）⇒ 分叉 / 调用被删`)
  /* 区间：两个判据纯函数的行范围（自动定位，不靠手写行号） */
  const region = (name) => {
    const i = lines.findIndex((l) => new RegExp('^(export )?function ' + name + '\\(').test(l))
    if (i < 0) return null
    let d = 0
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) { if (ch === '{') d++; else if (ch === '}') { d--; if (d === 0) return [i + 1, j + 1] } }
    }
    return null
  }
  const R = [region('verifyCoverage' + 'Verdict'), region('fixedWindow' + 'Verdict')].filter(Boolean)
  const inRegion = (ln) => R.some(([a, b]) => ln >= a && ln <= b)
  /* ② 禁止串：本轮回归的三条原文（+ 早前两条内联形态）—— **只许在区间内** */
  const OLD = [
    ['旧内联比较', 'maxIn !== Number(' + 'cell.' + 'capacityAtLeast)'],
    ['旧回归·容量比较推送', 'cell.' + 'capacityAtLeast)) why.push('],
    ['旧回归·固定值比较推送', 'else if (maxIn < ' + 'fixed) why.push('],
    ['旧回归·口径不全文案', '既无 capacityAt' + 'Least 也非固定窗口'],
    ['旧内联文案（verify-cell 版）', '页内=' + '${inPage[1]} ≠ ' + 'capacityAtLeast='],
  ]
  for (const [nm, pat] of OLD) {
    const at = lines.findIndex((l, k) => l.includes(pat) && !inRegion(k + 1))
    if (at >= 0) out.push(`**旧内联形态出现在判据区间之外**（${nm} · L${at + 1}）⇒ 同一判据两份实现（应改调纯函数）`)
  }
  /* ③ 区间抽样：比较只许住在判据区间内（别名/换措辞抓不到 —— 见能力边界） */
  const PRESENCE = new RegExp('capacityAt' + 'Least\\s*(!==|===)\\s*(undefined|null)')
  const CMP = new RegExp('capacityAt' + 'Least\\s*(!==|===|<=|>=|<|>)|(!==|===|<=|>=|<|>)\\s*[A-Za-z_$][\\w$]*\\.capacityAt' + 'Least')
  const bad = lines.map((l, k) => [k + 1, l]).filter(([ln, l]) => CMP.test(l) && !PRESENCE.test(l) && !inRegion(ln)).map(([ln]) => ln)
  if (bad.length) out.push(`**判据区间外出现 \`capacityAtLeast\` 的比较**（L${bad.join(',L')}）⇒ 该判据只许住在纯函数里`)
  return out
}

/** 判据 2（`verifyCoverageVerdict`）：`--verify-cell` 对 count 格的"预期值" ——
 *   · 有 `capacityAtLeast` ⇒ `maxIn == capacityAtLeast`
 *   · 无（**固定窗口**）⇒ `maxIn >= 契约值`（**必须覆盖到**；**越契约仍渲染不算错** —— 那是"越契约可渲染"的旁证）
 *   · 既无容量也非固定窗口 ⇒ 口径不全 */
export function verifyCoverageVerdict(cell, maxIn, fixed) {
  if (!cell) return null
  if (cell.capacityAtLeast !== undefined) return Number(maxIn) === Number(cell.capacityAtLeast) ? null : `max 页内=${maxIn} ≠ capacityAtLeast=${cell.capacityAtLeast}`
  if (fixed === null || fixed === undefined) return '该 count 格既无 capacityAtLeast 也非固定窗口（minItems == maxItems）⇒ 表内口径不全'
  return Number(maxIn) >= Number(fixed) ? null : `max 页内=${maxIn} < 契约固定值 ${fixed} ⇒ 读数没覆盖到契约值`
}

/* ★★ 合成负控（team-lead msg35 ② 的四条，**免渲染、秒级**）：这两条判据此前只有正向证据（真表全绿）⇒
   按"判据必须能被合成样本证伪"必须补负控；**并含正控**（越契约不算错那条要能"不红"）。 */
if (process.argv.includes('--self-test-synth')) {
  const cases = []
  const chk = (name, cond) => { cases.push(cond); console.log(`   ${cond ? '✓' : '✗'} ${name}`) }
  chk('(a) min==max 且给 capacityAtLeast ⇒ 必红', fixedWindowVerdict({ capacityAtLeast: 30 }, { minItems: 3, maxItems: 3 }, null).length > 0)
  chk('(b) boundSource 指向不存在的指针 ⇒ 必红', fixedWindowVerdict({ boundSource: 'deck.schema.json#/nope', renderedMax: 3 }, null, null).length > 0)
  chk('(c) renderedMax ≠ 该节点 maxItems ⇒ 必红', fixedWindowVerdict({ boundSource: 'x#/y', renderedMax: 9 }, null, { minItems: 3, maxItems: 3 }).length > 0)
  chk('(d) verify-cell 读数未覆盖契约值（fixed=3 · max=2）⇒ 必红', verifyCoverageVerdict({}, 2, 3) !== null)
  /* 正控（必须"不红"，否则判据等于恒红） */
  chk('正控：读数恰为契约值（max=3 · fixed=3）⇒ 不红', verifyCoverageVerdict({}, 3, 3) === null)
  chk('正控：**越契约仍渲染**（max=30 · fixed=3）⇒ 不红', verifyCoverageVerdict({}, 30, 3) === null)
  chk('正控：有容量时 max==capacityAtLeast ⇒ 不红', verifyCoverageVerdict({ capacityAtLeast: 30 }, 30) === null)
  chk('正控：区间窗口的格（有容量）不被判"固定窗口"', fixedWindowVerdict({ capacityAtLeast: 30 }, { minItems: 3, maxItems: 6 }, null).length === 0)
  /* ★ msg37 ② / msg38 ② 那条**指纹断言**自己的必红/不许红样本（判据必须能被合成样本证伪、
     **且必须成对**：负控防漏报 · 正控防误报 —— 防"过严 ⇒ 将来有人为让闸门绿而放宽判据"）。
     ⚠️ 样本**运行期拼**（源码里不出现连续旧字面量 ⇒ 判定器不自匹配）。 */
  const CAP = 'capacityAt' + 'Least'
  const OLD_MSG = '既无 capacityAt' + 'Least 也非固定窗口'
  const DEF = 'export function verifyCoverage' + 'Verdict() {\n  return `' + OLD_MSG + '`\n}\nconst v = verifyCoverage' + 'Verdict()'
  chk('指纹：**旧内联比较 + 旧回归·容量比较推送 ⇒ 必红**', sameCriterionVerdicts("x\nif (maxIn !== Number(" + "cell." + CAP + ")) why.push('x')").length > 0)
  chk('指纹：**旧回归·固定值比较推送 ⇒ 必红**', sameCriterionVerdicts("x\nelse if (maxIn < " + "fixed) why.push('x')").length > 0)
  chk('指纹：**旧文案落在判据区间内**（纯函数自己的合法输出）⇒ 不许红', sameCriterionVerdicts(DEF).length === 0)
  chk('指纹：**同一文案落在区间之外 ⇒ 必红**（区间规则咬得动）', sameCriterionVerdicts('// x\nconst s = "' + OLD_MSG + '"\n' + DEF).length > 0)
  chk('指纹：**区间外 `capacityAtLeast` 的比较 ⇒ 必红**（区间抽样）', sameCriterionVerdicts(DEF + '\nconst bad = maxIn !== cell.' + CAP).length > 0)
  chk('指纹：**`!== undefined` 是存在性检查、不是判据 ⇒ 不许红**', sameCriterionVerdicts(DEF + '\nif (cell.' + CAP + ' !== undefined) {}').length === 0)
  chk('指纹：**纯函数两处（定义+调用）⇒ 不许红**', sameCriterionVerdicts("export function verifyCoverage" + "Verdict(a,b,c){}\nconst v = verifyCoverage" + "Verdict(cell, maxIn, fixed)").length === 0)
  /* ★ compare 两侧**共用 pointer**（同一 `$ref` 的两个格引用）—— 成对样本（必红/不许红），且**判据不钉数字**（K41） */
  {
    const P = '#/$defs/compareSide/properties/points'
    const L = { jsonPointer: P, field: 'pages.5.left.points', pageType: 'compare' }
    const R = { jsonPointer: P, field: 'pages.5.right.points', pageType: 'compare' }
    const n = (x) => sharedPointerVerdicts(x).viols.length
    chk('共用 pointer：**compare 左右成对 + pointer 逐字相同 ⇒ 不许红**', n([L, R]) === 0)
    chk('共用 pointer：**只剩左侧（右侧被删/改名）⇒ 必红**（防"只改一处"静默失效）', n([L]) > 0)
    chk('共用 pointer：**两侧 pointer 不逐字相同 ⇒ 必红**（不许各写一个）', n([L, { ...R, jsonPointer: P + '-x' }]) > 0)
    chk('共用 pointer：**非成对的多格复用 ⇒ 必红**（pointer 与 schema 位置脱钩）', n([{ jsonPointer: '#/$defs/x', field: 'pages.1.a' }, { jsonPointer: '#/$defs/x', field: 'pages.2.b' }]) > 0)
  }
  const fail = cases.filter((x) => !x).length
  console.log(`   ${fail === 0 ? '✓' : '✗'} [SYNTH-SELFTEST] 合成负控/正控 用例=${cases.length} · 失败=${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

/* ★★ team-lead ②(8)：**`pages.` 的解析只许出现在 `deck-jsonpath.mjs`**（此前 **3 份**：`measure-count` L193/L208
   + 本文件 L210）—— 与 msg37 ② 的"同判据只许一处"同族，但探针是**跨文件**的。
   ⚠️ 探针**分段拼**（源码里不出现连续探针）⇒ 判定器不会把自己判红（HF / K17-ff / 本批同款自匹配坑）。
   ⚠️ **分母不许为零**：唯一实现里**必须真的**含该探针（否则断言恒真 = 装饰）。 */
{
  const NEEDLE = '/' + '^pages' + '\\' + '.'
  const off = []
  let rdFail = 0, own = 0
  try { own = readFileSync(new URL('deck-jsonpath.mjs', import.meta.url), 'utf8').split(NEEDLE).length - 1 } catch (e) { rdFail++; console.error(`   （路径唯一性断言：读唯一实现失败 ⇒ ${e.message}）`) }
  try {
    for (const f of readdirSync(new URL('.', import.meta.url))) {
      if (!f.endsWith('.mjs') || f === 'deck-jsonpath.mjs') continue
      let t = ''
      try { t = readFileSync(new URL(f, import.meta.url), 'utf8') } catch { rdFail++; continue }
      const n = t.split(NEEDLE).length - 1
      if (n) off.push(`${f}×${n}`)
    }
  } catch (e) { rdFail++; console.error(`   （路径唯一性断言：目录读取失败 ⇒ ${e.message}）`) }
  if (rdFail) console.error(`   （路径唯一性断言：有 ${rdFail} 处读取失败 ⇒ 计数可能不完整）`)
  if (own < 1) {
    console.error(`✗ **探针失效**：唯一实现 deck-jsonpath.mjs 里没找到 pages. 的解析 ⇒ 断言恒真（分母为零）`)
    process.exit(2)
  }
  if (off.length) {
    console.error('✗ **`pages.` 的解析只许出现在 `deck-jsonpath.mjs`**（team-lead ②(8)：页下标解析 3 份 ⇒ 1 份）')
    console.error(`   违规：${off.join(' · ')} ⇒ 请改调 \`pageIndexOf()\` / \`parseDeckPath()\`（本文件已 import）`)
    process.exit(2)
  }
}

/* ★★ msg37 ②：**同判据只许一处**的结构性断言（每次跑都跑：普通运行 / `--self-test-synth` / `--verify-cell` 都过它）。 */
{
  let src = ''
  let fpReadFail = 0       /* ⚠️ catch 必须会说话（哑 catch 棘轮咬过 4 次） */
  try { src = readFileSync(new URL(import.meta.url), 'utf8') } catch { fpReadFail++ }
  if (fpReadFail) console.error('   （同判据断言：源码读取失败 ⇒ 判定不完整）')
  const fp = sameCriterionVerdicts(src)
  if (fp.length) {
    console.error('✗ **同一判据只许一处实现**（否则下次必然分叉 —— K17 的坑）：')
    for (const m of fp) console.error(`   · ${m}`)
    process.exit(2)
  }
}

/* ★★ team-lead msg41 ②（compare 两侧**共用 pointer** 的三条要求 · 全部**可判伪**）——
 * 背景：`compareSide` 是 `$ref` ⇒ **左右两格的 pointer 逐字相同**（`#/$defs/compareSide/properties/points`）
 *  ⇒ 表内「条目 = 21 · 唯一 pointer = 20」是**正确形态**（不是脏数据、也不许"为了让数字好看而复制一个似是而非的 pointer"）。
 * 三条（原样落）：
 *   ① **多格 pointer 只允许"compare 左右成对"**（其它 ⇒ pointer 已与实际 schema 位置脱钩 ⇒ 红）；
 *   ② **可见**：必须**打印**"N 格引用同一 pointer（列出来）" ⇒ **不许静默去重**；
 *   ③ **防将来只改一处**：两侧 pointer **必须逐字相同**且**两侧格都存在**（只剩一侧 ⇒ 红）。
 * ⚠️ 判据**不钉数字**（不写"必须 21/20"：那样加一格就红 —— 正是 **K41** 的坑）⇒ 断言的是**关系**
 *    （成对性 + 存在性 + 逐字一致）；数字只**打印**出来当**可见量** ✓ */
export function sharedPointerVerdicts(items) {
  const out = []
  const byPtr = new Map()
  for (const it of (items || [])) {
    const k = it && it.jsonPointer
    if (!k) continue
    if (!byPtr.has(k)) byPtr.set(k, [])
    byPtr.get(k).push((it && it.field) || '?')
  }
  const multi = [...byPtr.entries()].filter(([, cells]) => cells.length > 1)
  const isPair = (cells) => cells.length === 2 && cells.some((f) => f.endsWith('.left.points')) && cells.some((f) => f.endsWith('.right.points'))
  for (const [p, cells] of multi) {
    if (!isPair(cells)) out.push(`**多格 pointer 只允许 compare 左右成对**：${p} 被 ${cells.length} 格引用（${cells.join(' · ')}）⇒ 其它情形说明 pointer 与实际 schema 位置脱钩`)
  }
  const L = (items || []).find((it) => it && it.pageType === 'compare' && String(it.field || '').endsWith('.left.points'))
  const R = (items || []).find((it) => it && it.pageType === 'compare' && String(it.field || '').endsWith('.right.points'))
  if (L && !R) out.push('compare **左侧格在、右侧格缺** ⇒ "两侧共用 pointer"这条知识已随编辑静默失效（须两侧同表）')
  if (R && !L) out.push('compare **右侧格在、左侧格缺** ⇒ 同上')
  if (L && R && L.jsonPointer !== R.jsonPointer) out.push(`compare 两侧 pointer **不逐字相同**：${L.jsonPointer} ≠ ${R.jsonPointer} ⇒ 同一条 schema 节点必须同 pointer（不许两侧各写一个）`)
  return { viols: out, multi, entries: (items || []).length, uniq: byPtr.size }
}

const viol = [], noted = []
/* ★ team-lead msg2 ②：**「每格必有断言」的机器化** —— 用来区分「已测且已断言」与「只记录未断言」（I10 的分子/分母要用）。 */
const IT_ASSERTED = [], IT_RECORD_ONLY = []
/* ⚠️ `label` 在下面才声明（循环体后半段）⇒ 条数分派块在**之前** ⇒ 需一个同名口径的本地小助手（防 TDZ）。 */
const labelC = (it) => `${it.jsonPointer}（${it.field || '?'}）`
/* ★ 上面那条判据的**落点**：打印（可见 · 不许静默去重）+ 违规（可判伪）—— 数字**打印**、判据**不钉数字**（K41） */
{
  const sp = sharedPointerVerdicts(limits.limits || [])
  if (sp.multi.length) {
    console.log(`\n  表内 pointer 共用（**不静默去重**）：${sp.multi.length} 个 pointer 被**多个格**引用 ——`)
    for (const [p, cells] of sp.multi) console.log(`     · ${p} ⇐ ${cells.join(' · ')}`)
  }
  console.log(`  · 表内条目 = ${sp.entries} · 唯一 pointer = ${sp.uniq}${sp.multi.length ? `（多格 pointer ${sp.multi.length} 个 ⇒ 条目数 − 唯一数 = ${sp.entries - sp.uniq}）` : ''}`)
  viol.push(...sp.viols)
}
for (const it of (limits.limits || [])) {
  const node = get(it.jsonPointer)
  if (!node) { viol.push(`${it.jsonPointer} ⇒ 实测表指向的 schema 节点不存在（表/schema 不同源）`); continue }
  /* ★ 队列回填：**`kind` 必填**（14 格里曾有 **11 格**未标 ⇒ 断言把它变成"填了才绿"，避免"只记录未断言"） */
  if (!it.kind) viol.push(`${labelC(it)} ⇒ **kind 必填**：该格未标类型（content = 几何判据驱动 · editorial = 容量、上限由编辑意图定）`)
  /* ★★ team-lead msg27 ③：**定位口径一致**（I7 的延伸）—— ⚠️ **语义经判决实验修正**（probe-html）：
     ① **实质判据 = `--jsonpath pages.<i>…` ↔ `page`**：**`--jsonpath` 才是定位权威**（实测：`--page` 的数值
        **不决定**被量对象 —— `--page 9` 打 `pages.9.items` 与 `--page 10` **同值通过**；`--page 3` 打
        `pages.3.steps`（实际第 4 页）**也通过**）⇒ 只有 jsonpath 的 0-based 下标能决定"量的是哪个对象"。
     ② `--page N == page`、③ 长度格 `--expect-page N == page` ⇒ 属**文本一致性/卫生**判据（防"纸面口径漂移"），
        **不是**正确性判据（`--page` 写错并**不会**量错对象 —— 我一度据此误诊，见 `pages.9.items` 的 readback 撤回）。
     ⇒ 本断言拦的是"**表内三处纸面口径互相矛盾**"（含"该补的没补"），拦不了"读数量错对象"（那要靠 jsonpath 下标）。 */
  {
    const src = String(it.source || '')
    const one = (re) => { const m = re.exec(src); return m ? Number(m[1]) : null }
    const pPage = one(/--page\s+(\d+)/)
    const pExp = one(/--expect-page\s+(\d+)/)
    /* ★★ 路径语义**唯一实现**（team-lead ②(8)：**页下标解析 3 份 ⇒ 1 份**）：
       本文件此前自己写 `/--jsonpath\s+pages\.(\d+)\./`（第 3 份）⇒ 现只从 `source` 串里**取参数值**，
       解析交给 `deck-jsonpath.mjs` 的 `pageIndexOf()`（解析只许出现在那一处 ⇒ 有出现次数断言守着）。 */
    const jpRaw = (/--jsonpath\s+(\S+)/.exec(src) || [])[1] || null
    const jpIdx = pageIndexOf(jpRaw)
    const want = it.page
    if (want !== undefined) {
      if (it.unit === 'count' || it.capacityAtLeast !== undefined) {
        if (pPage === null) viol.push(`${labelC(it)} ⇒ **定位口径**：条数格 source 缺 --page（无法定位 ⇒ 读数可能量到了别的页）`)
        else if (pPage !== want) viol.push(`${labelC(it)} ⇒ **定位口径**：source 的 --page ${pPage} ≠ 表内 page ${want} ⇒ **读数被归到错的格子**`)
        /* ⚠️ 放宽到**任意层**（`pages.<i>.<a>.<b>` 合法）—— 但"页下标"仍由唯一实现给出（`pageIndexOf`）。
           此前只接受两层 ⇒ 嵌套格会被误判"缺定位口径"（正是"文本级校验与语义实现脱节"的形状）。 */
        if (jpRaw === null || jpIdx === null) viol.push(`${labelC(it)} ⇒ **定位口径**：条数格 source 缺 --jsonpath pages.<i>.<字段>…（**任意层**；0-based 口径无法核）`)
        else if (jpIdx + 1 !== want) viol.push(`${labelC(it)} ⇒ **定位口径**：--jsonpath pages.${jpIdx}（0-based ⇒ 第 ${jpIdx + 1} 页）≠ 表内 page ${want}`)
      } else {
        if (pExp === null) viol.push(`${labelC(it)} ⇒ **定位口径**：长度格 source 缺 --expect-page（无法核「命中页 == 该格 page」）`)
        else if (pExp !== want) viol.push(`${labelC(it)} ⇒ **定位口径**：--expect-page ${pExp} ≠ 表内 page ${want}`)
      }
    }
  }
  /* ★★ **I1/I2-「条数版」按 `kind` 分派**（team-lead msg2 ②：此前 `capacityAtLeast` **0 命中** ⇒
     该格的"唯一断言 `maxItems ≤ 容量`"**只是散文**（写在 `judgeLimitNote` 里）⇒ 与"汇总句 vs 逐格"同族。
     分派：`kind:'editorial'`（条数）⇒ 断言 `maxItems ≤ capacityAtLeast`（容量是**下限**，不是判据）；
           `kind:'content'`（长度）⇒ 走下面的 I2（`maxLength ≤ ⌊0.9×判据⌋`）。 */
  /* ★★ team-lead msg28 ③：**上界来源声明**（`boundSource`）—— 给"**页数**这类由编辑意图定的条数"用：
     它们**没有几何容量**（硬测一个 N_MAX 只是**同义反复**）⇒ 表内**不设** `capacityAtLeast`，
     改声明 `boundSource`（`<契约文件>#<指针>`）⇒ 断言：① 指针**必须存在**；② 若有 `renderedMax`（对照值）⇒
     必须 == 该节点 `maxItems`（**不许把 schema 上限包装成"容量"**）；③ `basis` 必须写明"由编辑意图定、非几何容量"；
     ④ 与 `capacityAtLeast` **互斥**（同时给 ⇒ 语义冲突 ⇒ 红）。 */
  if (it.boundSource) {
    let BS_READ_FAIL = 0
    const m = /^([\w.-]+)#(.+)$/.exec(String(it.boundSource))
    if (!m) viol.push(`${labelC(it)} ⇒ **boundSource 形态**：应为 <契约文件>#<指针>（现 ${it.boundSource}）`)
    else {
      const st = m[1].endsWith('.json') ? join(DECK_DIR, m[1]) : join(DECK_DIR, `${m[1]}.json`)
      let n2 = null
      /* ⚠️ 本文件的 `get` 期待 **`#/` 前缀** 的指针（与各格 `jsonPointer` 同形）⇒ 解析出的路径要补 `#`（实测漏了 ⇒ 判"不存在"）。
         ⚠️ catch **必须会说话**（计数）：静默 catch 会被"哑 catch 棘轮"咬（我这版加了 1 处空的 ⇒ 当场被判红）。 */
      try { n2 = get(String(m[2]).startsWith('#') ? m[2] : `#${m[2].startsWith('/') ? '' : '/'}${m[2]}`) } catch { n2 = null; BS_READ_FAIL++ }
      if (BS_READ_FAIL) console.error(`   （boundSource 自检：有 ${BS_READ_FAIL} 处读取失败 ⇒ 判定可能不完整）`)
      if (!n2) viol.push(`${labelC(it)} ⇒ **boundSource 不存在**：${it.boundSource}（上界来源声明不可解析 ⇒ 等于没声明）`)
      else {
        /* ★ msg35 ②：**真表路径走同一个纯函数**（renderedMax 包装 / 互斥 / 无 min-max ⇒ 都在它里面） */
        for (const m of fixedWindowVerdict(it, node, n2)) viol.push(`${labelC(it)} ⇒ **上界来源**：${m}`)
        if (!Array.isArray(it.basis) || !it.basis.length) viol.push(`${labelC(it)} ⇒ **每格必有断言**：上界来源格缺 basis`)
        else noted.push(`${labelC(it)} ⇒ ✓ **上界来源**：${it.boundSource}（min=${n2.minItems ?? '-'} / max=${n2.maxItems ?? '-'} · renderedMax=${it.renderedMax ?? '-'} 对照 · **无容量读数**）`)
        IT_ASSERTED.push(it.field || it.jsonPointer)
      }
    }
    continue
  }
  if (it.unit === 'count' || it.capacityAtLeast !== undefined) {
    const cap = node.maxItems, cal = it.capacityAtLeast
    /* ★★ team-lead msg33 ②（把顶层 `pages` 那条**推广**）：`minItems == maxItems` 的窗口**条数被契约固定** ⇒
       **不许报容量** —— 因为"容量"是"能装多少"的经验事实，而固定窗口下你测到的永远是这个唯一值：
         · summary（恰 3 条）与 secondary（恰 2 条）：`capacityAtLeast: 30` / `: 2` 都**不是在说容量**
           （前者把**违约变体**（强注 30 条）的渲染成功当容量；后者只是把 schema 上限抄了一遍）
       ⇒ 这类格走 `boundSource` 路线（不设 capacityAtLeast）＋ basis 写"契约固定为 N，非几何容量"。 */
    /* ★ msg35 ②：**真表路径走同一个纯函数**（单一实现 —— 合成负控证伪的就是它） */
    for (const m of fixedWindowVerdict(it, node, null)) viol.push(`${labelC(it)} ⇒ **固定窗口不许报容量**：${m}`)
    if (cal == null) viol.push(`${labelC(it)} ⇒ **I1-count**：条数格必须声明 \`capacityAtLeast\`（容量下限 = 已证能装多少）`)
    else if (cap === undefined) viol.push(`${labelC(it)} ⇒ **I1-count**：schema 该指针**无 \`maxItems\`** ⇒ 条数上限**无处生效**（断言无法落地）`)
    else if (cap > cal) viol.push(`${labelC(it)} ⇒ **I2-count**：maxItems=${cap} > capacityAtLeast=${cal} ⇒ **上限超出已证容量**（该断言落地就会拒掉自己证过的容量）`)
    else noted.push(`${labelC(it)} ⇒ ✓ **I2-count**：maxItems=${cap} ≤ capacityAtLeast=${cal}（kind=${it.kind || '-'} · 容量是下限，上限由编辑意图定）`)
    if (!Array.isArray(it.basis) || !it.basis.length) viol.push(`${labelC(it)} ⇒ **每格必有断言**：条数格缺 \`basis\`（"无几何失败模式"必须写明）`)
    if (IT_ASSERTED) IT_ASSERTED.push(it.field || it.jsonPointer)
    continue
  }
  const has = node.maxLength !== undefined
  const adv = node.recommendedMax
  const C = it.judgeLimit
  const label = `${it.jsonPointer}（${it.field || '?'}）`
  if (C == null) {
    // I3：无判据支撑 ⇒ 不许硬上限
    /* ⚠️ **语义细分**（自查补）：`judgeLimit=null` 有两种完全不同的情况 ——
       ① **已测、到 K_MAX 不触发** ⇒ 该字段**真无硬上限** ⇒ 有 `maxLength` 就判红（I3 本意）；
       ② **未测**（含"量具缺陷/待批 C"）⇒ 它只是**还没量**，属于**覆盖**问题（归 `--strict-coverage` 的清单），
          **不是**"测出来没有上限" ⇒ 不该在这里判红（否则会把"量具坏了"误当"无上限"）。
       ⇒ 靠条目 `status` 区分；未测的进 `noted` + 留在 uncovered 清单里。 */
    const unmeasured = /量具|未测|待测|待上探/.test(String(it.status || ''))
    if (has && !unmeasured) viol.push(`${label} ⇒ **I3**：判据未触发（到 K_MAX=${K_MAX} 无上限证据，status=${it.status || '-'}）却仍有 maxLength=${node.maxLength}（无据的硬上限会无端限制写作）`)
    else if (unmeasured) noted.push(`${label} ⇒ ⏳ **未测**（status=${it.status}）⇒ 归"未实测"清单（${has ? `现 maxLength=${node.maxLength} 暂留，发版前必须清` : '无硬上限'}）`)
    else noted.push(`${label} ⇒ ✓ 无硬上限（advisory${adv !== undefined ? ' ' + adv : '无'}）· status=${it.status || '-'}`)
    continue
  }
  // I1
  if (!has && node.noHardLimit !== true) viol.push(`${label} ⇒ **I1**：有判据临界 ${C} 但既无 maxLength 也未声明 noHardLimit:true（二者必居其一）`)
  else IT_ASSERTED.push(it.field || it.jsonPointer)   /* ★ I10：长度格也有**机器断言**（I1 的 noHardLimit 或 I2 的 maxLength） */
  // I2
  if (has) {
    const cap = Math.floor(0.9 * C)
    if (node.maxLength > cap) viol.push(`${label} ⇒ **I2**：maxLength=${node.maxLength} > ⌊0.9×${C}⌋=${cap}（余量不足：判据是本机某次测量，换机/换引擎版本可能 ±1 波动）`)
    else noted.push(`${label} ⇒ ✓ maxLength=${node.maxLength} ≤ ⌊0.9×${C}⌋=${cap}（判据 ${C} · 依据 ${(it.basis || []).join('/') || '-'}）`)
    // I4
    if (adv !== undefined && adv > node.maxLength) viol.push(`${label} ⇒ **I4**：recommendedMax=${adv} > maxLength=${node.maxLength}（"建议值比硬上限还大"是荒谬组合）`)
  }
}
/* ---------- ★ **I5：enforced 上限只许一处真源**（本轮新发现的分叉，team-lead 会认这条）----------
   事实（2026-10-03）：`validate-deck.mjs` 里**手抄**了一份长度表（14 处 `checkString(x, path, min, max, label)`
   加 `n > 40`），注释还写"规则严格对齐 schema"，但**从不读 deck.schema.json** ⇒ 我改 schema 后渲染器仍按旧表拒收
   （实测：`items[0]` 的 schema 上限已删，而 render 仍 `exit=3` 拒绝 k=164）。
   判据：validate-deck 的硬编码 (min,max) 必须与 schema 同名叶子一致；schema 没有而它有（或反之）⇒ **红**。 */
let COUNT_DEBT = []          /* I5 条数版的债务清单（模块级：函数内算、函数外打印） */
function i5Violations() {
  const out = []
  const p = join(DECK_DIR, 'validate-deck.mjs')
  if (!existsSync(p)) return out
  const vd = readFileSync(p, 'utf8')
  const leafHasMax = (leaf) => [...leaves.entries()].filter(([q, n]) => q.endsWith('/' + leaf) && n.maxLength !== undefined)
  /* ⚠️ **必须同时认两种写法**：`` `${path}.x` ``（模板串）**与** `'meta.subtitle'`（普通字面串）。
     第一版**只认模板串** ⇒ 漏掉 `checkString(meta.subtitle, 'meta.subtitle', 6, 60, …)`（60 只是 advisory，
     schema 硬上限是 203 ⇒ validate-deck 比 schema 严、k=61..203 被无端拒收 —— 由**第二路实测**揪出，
     本断言本该抓到 ⇒ 拓宽后即可拦住这类）。 */
  for (const m of vd.matchAll(/checkString\(\s*[^,]+,\s*(?:`\$\{path\}\.([\w.]+)`|'([\w.]+)')\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']*)'/g)) {
    /* 普通字面串那种写法给的是**全路径**（如 'meta.title'）⇒ 取最后一段当叶名（`leafHasMax` 按 `/leaf` 后缀匹配） */
    const leaf = String(m[1] || m[2]).split('.').pop()
    const min = m[3], max = m[4], label = m[5]
    const hits = leafHasMax(leaf)
    if (!hits.length) { out.push(`**validate-deck 有硬编码** ${leaf} ∈ [${min}, ${max}]（${label}），而 schema 里该字段**无 maxLength** ⇒ 两处真源（渲染器会拒收 schema 允许的输入）`); continue }
    if (!hits.some(([, n]) => Number(n.minLength ?? min) === Number(min) && Number(n.maxLength) === Number(max))) {
      out.push(`**两处不一致**：validate-deck ${leaf} ∈ [${min}, ${max}]（${label}）↔ schema ${hits.map(([q, n]) => `${q}=[${n.minLength ?? '-'}, ${n.maxLength}]`).join(' / ')}`)
    }
  }
  /* ★★ **条数版**（K22 同族第二例，2026-10-04）：`.length > 5` 这类**手写条数**同样会**无视 schema** ⇒
     被我覆盖 `maxItems` 到 8 后，渲染仍被 `> 5` 拒死（条数测量做不了）⇒ 必须改用 `limItems(指针)` 读 schema。
     ⚠️ 尚未转换的两处**显式计债**（不是静默放行 —— 按 I10「分母不许为零」的口径：宁可红名单上挂着）。 */
  const COUNT_DEBT_OK = new Map([
    ['p.secondary.length', 'pageData.secondary（恰 2 条）尚未转换 ⇒ 计债；与 count 构造器第二批一起改'],
    ['c.series.length', 'pageChart.series（4~12）尚未转换 ⇒ 计债；同上'],
  ])
  /* ★ **棘轮（ratchet）口径**（team-lead 的"显式计债" + I10「一侧为空不许算通过」）：
     条数单源债务**只许减、不许增** —— 首跑实测 **9 处**手写条数 ⇒ 记 `COUNT_DEBT_MAX = 9`：
       · 数量 **≤ 9** ⇒ 不判红，但**显著打印**（不是静默；每处都点名）
       · 数量 **> 9**（又新增手写条数）⇒ **红**
       · 数量下降 ⇒ 提示"可把 ratchet 调小"（不让债务悄悄回来） */
  /* ⚠️ **棘轮先量后设**：我第一版凭 grep 的截断输出设 9 ⇒ 实际 **12** ⇒ 首跑就"涨了"报警。
     正确顺序：**先测出真值，再把它钉成上限**（否则棘轮自己制造假红）。 */
  /* ⚠️ **口径固定**（team-lead ②）：棘轮只计**闸门判定类**（同行出现 `add('error'`）——
     `L248/L399` 那类**建议文案**不算（否则口径一变，12 这个数字**跨版本不可比**，棘轮就会误报）。 */
  const countDebt = []
  for (const m of vd.matchAll(/([A-Za-z_$][\w.$]*)\.length\s*(<=|>=|<|>)\s*(\d+)/g)) {
    const [, obj, op, num] = m
    const ls = vd.lastIndexOf('\n', m.index) + 1
    const le = vd.indexOf('\n', m.index)
    const lineTxt = vd.slice(ls, le < 0 ? undefined : le)
    if (!/add\(\s*'error'/.test(lineTxt)) continue          /* 建议文案 ⇒ 不计入债务 */
    const line = vd.slice(0, m.index).split('\n').length
    countDebt.push(`L${line}：${obj}.length ${op} ${num}${COUNT_DEBT_OK.has(`${obj}.length`) ? `（计债：${COUNT_DEBT_OK.get(`${obj}.length`)}）` : ''}`)
  }
  /* ★ **棘轮基准不许是手写数**（team-lead ⑤）：基准由**本工具产出**（`debt-baseline.json`），断言读它；
     `--update-baseline` 显式重写；`DEBT_BASELINE_OVERRIDE=<n>` 供**负控**（必须能让它红）。 */
  const BASE_FILE = join(DECK_DIR, 'debt-baseline.json')
  let base = null
  try { base = JSON.parse(readFileSync(BASE_FILE, 'utf8')).countDebt } catch { /* 无基准 ⇒ 首建 */ }
  /* ★ team-lead ③：`--baseline <n>` **CLI 优先**（避免 `$env:` 触发审批 ⇒ 负控可随时跑，不必改仓库文件）。
     `DEBT_BASELINE_OVERRIDE` 仍保留（CI/脚本可用）。 */
  const _bi = process.argv.indexOf('--baseline')
  const ovrB = _bi >= 0 && process.argv[_bi + 1] !== undefined ? process.argv[_bi + 1] : process.env.DEBT_BASELINE_OVERRIDE
  const want = ovrB !== undefined && ovrB !== '' ? Number(ovrB) : base
  if (process.argv.includes('--update-baseline')) {
    try {
      writeFileSync(BASE_FILE, JSON.stringify({
        _doc: '**条数单源债务基准（机器产出，不许手写）**：`countDebt` = validate-deck 里"同行有 add(error)"的 `.length` 比较数；只许减不许增。',
        _rule: '工具 `check-schema-vs-limits.mjs --update-baseline` 重写；`DEBT_BASELINE_OVERRIDE=<n>` 仅供负控。',
        countDebt: countDebt.length, updatedAt: new Date().toISOString().slice(0, 10),
      }, null, 2) + '\n', 'utf8')
    } catch { /* ignore */ }
    noted.push(`条数债务基准已重写为 **${countDebt.length}**（--update-baseline）`)
  } else if (want == null) {
    out.push(`**缺基准** \`debt-baseline.json\`（或 env 覆盖）⇒ 请先跑 \`--update-baseline\` 建立基准（不许用手写数当棘轮）`)
  } else if (countDebt.length !== want) {
    /* ★ team-lead ⑤(2)：**稳定机器标记**（退出码是多义的：语法错/参数错/棘轮红/判据红 都可能是 1 或 2）
       ⇒ 控制必须断言 tag，而不是只看退出码。 */
    out.push(`**[RATCHET_BASELINE_MISMATCH]** 条数债务棘轮：实测 **${countDebt.length}** ↔ 基准 **${want}** ⇒ **不等即红**（涨=新增手写条数；降=请 --update-baseline 同步基准）：${countDebt.join(' · ')}`)
  }
  COUNT_DEBT = countDebt
  /* 数组元素那种"n > N"的硬编码（如 items：`if (n > 40)`）
     ⚠️ 必须**按指针**判定：第一版用"叶名含 items"⇒ 被 `pageChart…labels/items` 撞车 ⇒ 漏报（实测）。
     ⇒ 只认 `#/$defs/pageBullets/properties/items/items`（要点数组元素）。 */
  /* ⚠️ **等级敏感**：`add('error', …)` = enforced（必须与 schema 的 maxLength 一致）；
     `add('warn'/'info', …)` = advisory（应与 `recommendedMax` 一致，且**不许**当硬拒）。
     （第一版只看数字、不看等级 ⇒ 把"已降级为 advisory"的那条也误报成真源分叉 —— 实测踩过。） */
  /* ⚠️ **必须限定作用域**：第一版写成全文件 `if (n > N) add(...)` ⇒ 撞到 `checkQuote` 的 `n > 80`
     ⇒ 拿 80 去比 items 指针 ⇒ **误报**（自查抓到）。现只在 **bullets items 循环**（`const n = cp(it)` 之后 300 字内）内匹配。 */
  const scope = vd.indexOf('const n = cp(it)')
  const arr = (scope < 0 ? null : /if\s*\(\s*n\s*>\s*(\d+)\s*\)\s*add\(\s*'(\w+)'/.exec(vd.slice(scope, scope + 300)))
  if (arr) {
    const lvl = arr[2]
    const node = get('#/$defs/pageBullets/properties/items/items')
    const cap = node ? node.maxLength : undefined
    const adv = node ? node.recommendedMax : undefined
    if (lvl === 'error' && cap === undefined) out.push(`**validate-deck 硬编码（error 级）** items 长度 > ${arr[1]}，而 schema 该指针**无 maxLength** ⇒ 两处真源：渲染器会拒收 schema 允许的输入`)
    else if (lvl === 'error' && Number(cap) !== Number(arr[1])) out.push(`**两处不一致（error 级）**：validate-deck items > ${arr[1]} ↔ schema maxLength=${cap}`)
    else if (lvl !== 'error' && adv !== undefined && Number(adv) !== Number(arr[1])) out.push(`**advisory 不一致**：validate-deck items 建议 > ${arr[1]} ↔ schema recommendedMax=${adv}`)
  }
  /* ★ **指针守卫**：validate-deck 现在用 `lim('#/…')` 取上限 ⇒ 指针写错会**静默变成"无上限"**（Infinity）⇒
     等于悄悄放行。每个用到的指针必须在 schema 里解析到**带 minLength/maxLength** 的节点，否则红。 */
  for (const m of vd.matchAll(/lim\(\s*'([^']+)'/g)) {
    const ptr = m[1]
    const node = get(ptr)
    if (!node || (node.minLength === undefined && node.maxLength === undefined)) out.push(`**指针守卫**：validate-deck 用了 \`lim('${ptr}')\`，但 schema 里该指针${node ? '**没有 minLength/maxLength**' : '**解析不到**'} ⇒ 静默变成"无上限"（放行）`)
  }
  return out
}
/* ---------- ④ **ASCII 引号 lint**（team-lead 批准的口径）----------
   只扫 **JSON 文件的散文字段**（`description` / 任何 `_` 开头键 / `reason` / `note`）：
   出现 **ASCII 直引号** ⇒ 红（统一用「」/『』）。**`.md` 不在此列** —— 代码块里必须有 `"`，一刀切会制造假红。
   理由（我的亲身事故，一晚**三次**）：在 JSON 字符串里手写裸 `"` ⇒ **文件直接不是合法 JSON**（deck.schema.json 一次、
   invariants.json 一次、以及"已转义的 \\" 也别写"这条同样是为了可读与防手滑）。 */
function asciiQuoteViolations() {
  const out = []
  const PROSE = /^(description|reason|note|_.*)$/
  const FILES = readdirSync(DECK_DIR).filter((f) => /\.json$/.test(f) && (
    f === 'deck.schema.json' || f === 'measured-limits.json' || f === 'bad-expected.json' ||
    f === 'exclude-coverage.json' || f.startsWith('allowlist-') ||
    f === 'comment-killer-allowlist.json' || f === 'probe-path-allowlist.json'))
  for (const f of FILES) {
    let obj
    try { obj = JSON.parse(readFileSync(join(DECK_DIR, f), 'utf8')) } catch { continue }
    const walk = (node, path) => {
      if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return }
      if (!node || typeof node !== 'object') return
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'string' && PROSE.test(k) && v.includes('"')) {
          out.push(`${f} ${path}.${k} 含 ASCII 直引号 ⇒ 改「」/『』（含已转义的双引号也不许：JSON 里手写它=一次事故）`)
        } else walk(v, `${path}.${k}`)
      }
    }
    walk(obj, '$')
  }
  return out
}
const q11 = asciiQuoteViolations()

/* ---------- ④b **编号序列断言**：`invariants.json` 的 I 序号必须**连续且唯一**（I1…In 不跳号、不重号）----------
   并把**代码/文档里出现的** `I\d+`（必须已登记）/ `K\d+` / `⓪x`（先做**清单可见**）统计出来。 */
function seqViolations() {
  const out = [], info = []
  let ids = []
  try {
    const inv = JSON.parse(readFileSync(join(DECK_DIR, 'invariants.json'), 'utf8'))
    ids = (inv.invariants || []).map((x) => String(x.id))
  } catch { return { out: ['invariants.json 读不到/不可解析'], info } }
  const nums = ids.map((i) => Number((String(i).match(/^I(\d+)/) || [])[1])).filter((n) => Number.isFinite(n))
  const uniq = [...new Set(nums)].sort((a, b) => a - b)
  /* ⚠️ **按 id 原文**判重复，不按数字 —— `I5-表` 是 I5 的**变体**（同一编号的不同守卫），
     第一版按数字判 ⇒ 把它误报成"重复号"（被本断言自己的首跑抓到）。连续性仍按**数字去重后**判。 */
  if (new Set(ids.map(String)).size !== ids.length) out.push(`invariants.json 的 I 序号**有重复**：${ids.join(', ')}`)
  /* ★ team-lead ④：**升序断言**（"连续 + 唯一" ≠ "升序"）—— 实测踩到 `… I9 I11 I12 I10`（I10 排末尾 ⇒
     读者扫到 I12 就停、**漏读 I10**，且看起来像"被重编号"）。`I5-表` 视为 I5 的**变体**（紧邻 I5，不参与排序）。 */
  const ordered = ids.map((i) => Number((String(i).match(/^I(\d+)/) || [])[1])).filter((n) => Number.isFinite(n))
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i] < ordered[i - 1]) {
      out.push(`invariants.json 的 I 序号**不是升序**：第 ${i + 1} 条是 I${ordered[i]}，而前一条是 I${ordered[i - 1]}（读者会**漏读**）`)
      break
    }
  }
  for (let i = 1; i < uniq.length; i++) {
    if (uniq[i] !== uniq[i - 1] + 1) out.push(`invariants.json 的 I 序号**跳号**：${uniq[i - 1]} → ${uniq[i]}（编号序列必须连续）`)
  }
  const known = new Set(nums)
  const srcs = [...readdirSync(DECK_DIR).filter((f) => /\.mjs$/.test(f)), 'README.md', 'ENGINE-CONTRACT.md', 'AI-PROMPT.md']
    .filter((f) => existsSync(join(DECK_DIR, f)))
  const kSet = new Set(), zeroSet = new Set()
  for (const f of srcs) {
    const t = readFileSync(join(DECK_DIR, f), 'utf8')
    for (const m of t.matchAll(/\bI(\d+)\b/g)) {
      if (!known.has(Number(m[1]))) out.push(`${f} 引用了 **I${m[1]}**，但 invariants.json 里**没有登记它**（未登记 = 没人守、也没人知道为什么有它）`)
    }
    for (const m of t.matchAll(/\bK(\d+)\b/g)) kSet.add(Number(m[1]))
    for (const m of t.matchAll(/⓪([a-z])/g)) zeroSet.add(m[1])
  }
  info.push(`K 编号出现 ${kSet.size} 个：K${[...kSet].sort((a, b) => a - b).join(' / K')}（**登记表待建** —— 本断言先让清单可见）`)
  info.push(`⓪ 小节出现 ${zeroSet.size} 个：${[...zeroSet].sort().map((c) => '⓪' + c).join(' / ')}（同上）`)
  return { out, info }
}
const seq = seqViolations()

const i5 = i5Violations()

/* ---------- ★ **I5-文档**（team-lead 裁定 (a)-①）：文档里的写作数字必须与 schema 同源 ----------
   背景（K22 第三处真源）：`AI-PROMPT.md` 里手写了 12 处"N 字"（给 AI 的写作说明）⇒ 改了 schema 不改文档
   ⇒ **AI 按旧数字写** ⇒ 上限形同虚设。便宜做法：文档里每个"N 字"必须是**某个 schema 约束值**
   （maxLength / recommendedMax / minLength）；否则判为**陈旧或自造**（须改成 schema 的值，或进白名单带理由）。 */
function i5docViolations() {
  const out = []
  const p = join(DECK_DIR, 'AI-PROMPT.md')
  if (!existsSync(p)) return out
  const doc = readFileSync(p, 'utf8')
  const allowed = new Set()
  for (const n of leaves.values()) {
    if (n.maxLength !== undefined) allowed.add(Number(n.maxLength))
    if (n.recommendedMax !== undefined) allowed.add(Number(n.recommendedMax))
    if (n.minLength !== undefined) allowed.add(Number(n.minLength))
  }
  /* 白名单（**必须带理由**）：文档里的"观感建议"允许不是 schema 约束值 */
  const DOC_WHITELIST = new Map([
    [14, '9:16 竖屏观感建议（要点每条 ≤14 字）；**非 schema 约束** —— 批 B 实测 9:16 判据后应改为真值/advisory'],
  ])
  for (const m of doc.matchAll(/(\d{1,4})\s*字/g)) {
    const v = Number(m[1])
    if (v >= 4 && !allowed.has(v) && !DOC_WHITELIST.has(v)) {
      const line = doc.slice(0, m.index).split('\n').length
      out.push(`AI-PROMPT.md:${line} 出现 "${v} 字" ⇒ **不是任何 schema 约束值**（陈旧/自造）⇒ 改成 schema 的值，或加白名单+理由`)
    }
  }
  return out
}
const i5doc = i5docViolations()

/* 覆盖：schema 里有硬上限的叶子是否都在实测表里出现过 */
const measured = new Set((limits.limits || []).map((x) => x.jsonPointer))
const uncovered = [...leaves.keys()].filter((p) => leaves.get(p).maxLength !== undefined && !measured.has(p))
console.log(`=== schema ↔ 实测上限 一致性（I1–I4${STRICT ? ' · --strict-coverage' : ''}）===`)
console.log(`  实测表条目 ${(limits.limits || []).length} · schema 含上限叶子 ${leaves.size} · K_MAX=${K_MAX}`)
for (const s of noted) console.log(`  · ${s}`)
if (i5.length) {
  console.log(`\n  ⚠ **I5（enforced 上限只许一处真源）违规 ${i5.length} 条**：`)
  for (const s of i5) console.log(`     · ${s}`)
}
/* I5 **条数版**的债务清单：显著打印（不静默；棘轮上限见上） */
if (COUNT_DEBT.length) {
  console.log(`\n  ℹ **I5 条数版**：validate-deck 尚有 **${COUNT_DEBT.length}** 处**手写条数**（基准 = 「debt-baseline.json」，**只许减不许增**）：`)
  for (const s of COUNT_DEBT) console.log(`     · ${s}`)
}
if (i5doc.length) {
  console.log(`\n  ⚠ **I5-文档（AI-PROMPT 数字同源）违规 ${i5doc.length} 条**：`)
  for (const s of i5doc.slice(0, 12)) console.log(`     · ${s}`)
}
if (q11.length) {
  console.log(`\n  ⚠ **④ ASCII 引号 lint 违规 ${q11.length} 条**（JSON 散文字段不许有 ASCII 直引号）：`)
  for (const s of q11.slice(0, 12)) console.log(`     · ${s}`)
}
console.log(`\n  ④b 编号序列：invariants.json I 序号 ${seq.out.length ? '✗ ' + seq.out.length + ' 条问题' : '✓ 连续且唯一'}`)
for (const s of seq.info) console.log(`     ℹ ${s}`)
for (const s of seq.out.slice(0, 12)) console.log(`     · ${s}`)
/* ---------- ★ 体检：**旧上限的机械复核**（team-lead ②：不许靠人读散文） ---------- */
{
  const hist = (limits._history && Array.isArray(limits._history.items)) ? limits._history.items : []
  const unsafe = hist.filter((h) => h.judgeLimit != null && h.schemaBefore > h.judgeLimit)
  const tight = hist.filter((h) => h.judgeLimit != null && h.schemaBefore < Math.floor(0.9 * h.judgeLimit))
  console.log(`\n  体检（旧上限机械复核 · ${hist.length} 条变更史）：`)
  console.log(`    ① **不安全清单**（过去契约允许 > 判据的字段）= **${unsafe.length}**${unsafe.length ? '' : ' ✓'}`)
  for (const u of unsafe) console.log(`       · ${u.jsonPointer}：旧 ${u.schemaBefore} > 判据 ${u.judgeLimit}（现 ${u.schemaAfter}）`)
  console.log(`    ② **曾被偏紧压过**（旧上限 < ⌊0.9×判据⌋ ⇒ 无端限制写作）= **${tight.length}**`)
  for (const t of tight) console.log(`       · ${t.jsonPointer}：旧 ${t.schemaBefore} → 判据 ${t.judgeLimit}（现 ${t.schemaAfter}）`)
  /* 若**当前**仍有 > 判据 的硬上限 ⇒ 真红（I2 已覆盖，这里再点名一次便于体检） */
  for (const h of hist) { const n = get(h.jsonPointer); if (n && n.maxLength !== undefined && h.judgeLimit != null && n.maxLength > h.judgeLimit) viol.push(`体检：${h.jsonPointer} 现 maxLength=${n.maxLength} > 判据 ${h.judgeLimit} ⇒ **仍不安全**`) }
}
/* ---------- ★ **I5-表**：表内散文不许过期（team-lead ③：表自己也不许"人能读到的旧数字"） ----------
   事故：`meta.issuer.twoPath` 曾写"放宽到 **756**"（旧口径 ⌊0.9×840⌋），而现行承诺是 **744**（⌊0.9×827⌋）
   —— 权威判定没错（从 judgeLimit 现算），错的是散文 ⇒ 现在散文由 `measure-table --update-limits` **程序生成**。
   断言：**已生成**的条目（有 `kEnforced`）里，散文出现的 3~4 位数字必须是**可派生值**
   （判据 / 判据+1 / 承诺 / 承诺+1 / 元素口径 / 偏移 / 历史旧值 / 年份）；否则 ⇒ 红（防手改过期）。 */
{
  const hist = (limits._history && Array.isArray(limits._history.items)) ? limits._history.items : []
  const before = new Map(hist.map((h) => [h.jsonPointer, h.schemaBefore]))
  let done = 0, pending = 0, nullJ = 0
  const susp = []
  for (const e of (limits.limits || [])) {
    const J = e.judgeLimit
    if (J == null) { nullJ++; continue }
    if (e.kEnforced == null) pending++; else done++
    const allowed = new Set([J, J + 1, Math.floor(0.9 * J), Math.floor(0.9 * J) + 1, e.judgeElement, e.offset, before.get(e.jsonPointer)].filter((x) => x != null).map(Number))
    const prose = [e.twoPath, e.schemaNow, e.readback, e.note].filter(Boolean).join(' ')
    for (const m of prose.matchAll(/(?<![\d.])(\d{3,4})(?![\d.])/g)) {
      if (/^(19|20)\d\d$/.test(m[1])) continue
      if (!allowed.has(Number(m[1]))) susp.push({ ptr: e.jsonPointer, v: m[1], generated: e.kEnforced != null, sentence: prose.slice(Math.max(0, m.index - 40), m.index + 20).trim() })
    }
  }
  console.log(`\n  体检·表散文：**已程序生成 ${done} 条** · 待补第二路 ${pending} 条 · 判据 null（未测）${nullJ} 条`)
  const hard = susp.filter((s) => s.generated)
  if (hard.length) {
    console.log(`    ⚠ **已生成条目仍含非派生数字 ${hard.length} 个**（疑似手改过期）⇒ 判红：`)
    for (const s of hard.slice(0, 8)) console.log(`       · ${s.ptr}：…${s.sentence}…（数字 ${s.v}）`)
    viol.push(...hard.map((s) => `I5-表：${s.ptr} 已程序生成却含非派生数字 ${s.v}`))
  } else console.log(`    ✓ 已生成条目的散文数字全部可派生（未生成条目待补第二路后由 --update-limits 自动重写）`)
}
const AUDIT = process.argv.includes('--audit')
const SELFTEST = process.argv.includes('--self-test-walker')
/* ---------- ★ (A) **手写字面量审计 + $ref 解析 + 负控**（team-lead ★）------------------------------------
   要求：① 遍历器**必须解析 `$ref`**（`pages` 用 `prefixItems`/`items` 指向各页型；`compareSide` 也是 `$ref`）；
        ② 报"某叶子无约束"时**必须区分"真无约束"与"$ref 未解析"**（未解析 ⇒ 红并打印指针）；
        ③ 负控 = **故意不解析 `$ref`** ⇒ 必须出现 ≥1 条假结论（否则说明负控没造对）。
   team-lead 实测：不解析 ref 会报 3 处假"无约束"（pageChart.series / compareSide.label / .points）。 */
function schemaLeafIndex(useRef) {
  const idx = new Map()
  const seen = new Set()
  const rec = (node, ptr, depth) => {
    if (!node || typeof node !== 'object' || depth > 30) return
    if (node.$ref) {
      if (!useRef) { idx.set('__UNRESOLVED__', (idx.get('__UNRESOLVED__') || 0) + 1); return }   // 负控：不解析 ⇒ 直接停
      const t = get(node.$ref)
      if (!t) { idx.set('__UNRESOLVED__', (idx.get('__UNRESOLVED__') || 0) + 1); return }
      rec(t, node.$ref, depth + 1)
      return
    }
    const leaf = ptr.split('/').pop()
    const keys = ['maxLength', 'minLength', 'maxItems', 'minItems', 'recommendedMax'].filter((k) => node[k] !== undefined)
    if (keys.length) {
      if (!idx.has(leaf)) idx.set(leaf, [])
      idx.get(leaf).push({ ptr, node })
      /* ★ 数组**元素**节点再挂一个"两段键"（`<field>/items`）—— 字面量常写在数组字段上（如 `cp(t)` 在
         `steps`/`items` 的 forEach 里），约束却在元素节点；只按单段叶名索引会**归属不到** ⇒ 被误当"无约束"。 */
      const segs = ptr.split('/')
      if (leaf === 'items' && segs.length >= 3) {
        const two = `${segs[segs.length - 2]}/items`   /* ⚠️ 是 len−2（数组字段名）：len−3 会取到 `properties` ⇒ 键错 ⇒ 仍归属不到 */
        if (!idx.has(two)) idx.set(two, [])
        idx.get(two).push({ ptr, node })
      }
    }
    /* ⚠️ 必须**递归进每个子对象**：第一版只对 `properties`/`items`/`$defs`/`prefixItems` 这几个**键名**递归
       ⇒ 进到 `…/properties` 后，字段名（`title`/`items`…）不是那几个键 ⇒ **不再下钻** ⇒ 索引全空
       ⇒ 审计报"50 处全无约束"（**假结论**，被本审计自己暴露）。改为"任何对象值都下钻"。 */
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (v && typeof v === 'object') rec(v, `${ptr}/${k}`, depth + 1)
    }
    void seen
  }
  rec(schema, '#', 0)
  return idx
}
function auditLiterals(useRef) {
  const vd = readFileSync(join(DECK_DIR, 'validate-deck.mjs'), 'utf8')
  const idx = schemaLeafIndex(useRef)
  const out = []
  const lines = vd.split('\n')
  /* ⚠️ 有些位点用**局部变量**（`if (n < 8)` / `cp(t) > 24`）⇒ 行内取不到叶名。
     第一版直接给 `leaf=null` ⇒ 8 处被报"无约束"（**假异常**，审计自己暴露）。
     ⇒ 用**所在函数的上下文映射**归属（checkToc→items · checkSteps→steps · checkQuote→quote · checkSummary→closing…）。 */
  const FN_LEAF = {
    checkToc: 'items', checkSteps: 'steps', checkQuote: 'quote', checkSummary: 'items', checkBullets: 'items',
    checkChart: 'series', checkCompare: 'points',
    /* 数组**条数**判定常写成 `side.points.length` / `p.secondary.length`（局部变量、行内无 `${path}`）⇒ 用所在函数归属 */
    checkSide: 'points', checkData: 'secondary',
  }
  let curFn = ''
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]
    const fm = /^function\s+(\w+)\s*\(/.exec(L)
    if (fm) curFn = fm[1]
    const leafOf = (s, line) => {
      const t = String(s || '').trim()
      /* ⚠️ 归属顺序（三次踩坑后定稿）：① 行内 **`${path}.field`** 最可靠 —— 如 `cp(t)` 那行的 add() 里就有
         `${path}.items[${i}]` ⇒ 真叶名是 items（不是局部变量 t）；② `'meta.xxx'` 形态；③ 数组形态 `X.length` 取 X；
         ④ 实在没有才用"所在函数"的上下文映射。
         （第一版只认点前缀 ⇒ 裸 `pages.length` 归不出 ⇒ 假"无约束"；第二版把**任何裸标识符**当叶名
          ⇒ 把局部变量 `t` 当字段名 ⇒ 6 处假异常。两次都是"归属规则过窄/过宽"。） */
      /* 取 `${path}.` 之后的**整段**（含下标，如 `secondary[${i}].label`）再取**最后一段**：
         第一版 `([\w.]+)` 会在 `[` 处停 ⇒ `${path}.secondary[${i}].label` 只拿到 `secondary`（10 处假异常）；
         改 `([^\`',\n]+)` 贯通下标后再取最后一段 ⇒ 得到 `label` ✓。 */
      /* 先**去掉 `${i}` 之类插值**，再剥 `[]`，最后取最后一段：
         `secondary[${i}].label` ⇒ `secondary.label` ⇒ `label` ✓；`items[${i}]` ⇒ `items` ✓
         （前两版直接对原文取段 ⇒ 得到 `itemsi`/`secondary` 之类的**假叶名** ⇒ 假异常）。 */
      const pm = /\$\{path\}\.([^`',\n]+)/.exec(line || '')
      if (pm) {
        const segs = pm[1].replace(/\$\{[^}]*\}/g, '').split('.')
          .map((x) => x.replace(/\[[^\]]*\]/g, '')).filter(Boolean)
        if (segs.length) return segs[segs.length - 1]
      }
      const sm = /'(meta\.[\w]+|pages(?:\.\w+)*)'/.exec(line || '')
      if (sm) return sm[1].split('.').pop()
      const lm = /([\w]+)\.length\b/.exec(t) || (/^\w+$/.test(t) ? t.match(/^(\w+)$/) : null)
      if (lm && !/^(t|n|it|s|v|c|i|k|j|x|y)$/.test(lm[1])) return lm[1]
      return FN_LEAF[curFn] || null
    }
    let m
    if ((m = /checkString\([^,]+,\s*(?:`\$\{path\}\.([\w.]+)`|'([\w.]+)')\s*,\s*(\d+)\s*,\s*(\d+)/.exec(L))) {
      out.push({ line: i + 1, kind: 'checkString', leaf: (m[1] || m[2]).split('.').pop(), min: Number(m[3]), max: Number(m[4]) })
    } else if ((m = /cp\(([^)]*)\)\s*([<>])=?\s*(\d+)/.exec(L))) {
      out.push({ line: i + 1, kind: 'cp', leaf: leafOf(m[1], L), cmp: m[2], v: Number(m[3]) })
    } else if ((m = /([\w.]+?)\.length\s*([<>])=?\s*(\d+)/.exec(L))) {
      out.push({ line: i + 1, kind: 'length', leaf: leafOf(m[1], L), cmp: m[2], v: Number(m[3]) })
    }
  }
  for (const s of out) {
    /* ⚠️ **数组元素兜底**：字面量若作用在"数组本身"上（如 `steps`/`items`），真实约束常在**元素节点**
       （`<field>/items`）⇒ 先查 `leaf`，再查 `leaf + '/items'`；两处都没有才敢说"无约束"。
       （否则会把"我归属不到"说成"schema 真无约束"—— 这正是把"工具缺陷"当"事实"的那类。） */
    const cands = (idx.get(s.leaf) || []).concat(idx.get(s.leaf + '/items') || [])
    const unresolved = (idx.get('__UNRESOLVED__') || 0)
    if (!cands.length) {
      s.verdict = useRef
        ? (unresolved ? '⚠ **无约束（但 schema 有未解析 $ref ⇒ 可能假结论）**' : '⚠ 无约束（真）')
        : '⚠ 无约束（**$ref 未解析 ⇒ 假结论**）'
    } else {
      /* ⚠️ **必须看比较方向**：`cp(x) < 8` 是 **min**（对 schema 的 minLength），`cp(x) > 20` 是 **max**（对 maxLength）；
         数组的 `<`/`>` 同理对 `minItems`/`maxItems`。第一版一律拿字面量比 `maxLength` ⇒ 19 处**假异常**
         （自己被审计暴露）⇒ 现按方向取对应字段。 */
      const dir = (s.kind === 'checkString') ? 'both' : (s.cmp === '<' || s.cmp === '<=' ? 'min' : 'max')
      const keyOf = (node, d) => d === 'min'
        ? (s.kind === 'length' ? node.minItems : node.minLength)
        : (s.kind === 'length' ? node.maxItems : node.maxLength)
      const ok = s.kind === 'checkString'
        ? cands.some((c) => Number(c.node.maxLength) === s.max && Number(c.node.minLength ?? s.min) === s.min)
        : cands.some((c) => Number(keyOf(c.node, dir)) === s.v)
      const cap = s.kind === 'checkString' ? `[${s.min},${s.max}]` : `${s.cmp}${s.v}`
      s.verdict = ok ? `✓ 一致（${cap}）` : `✗ **不一致**（字面量 ${cap} ↔ schema ${cands.map((c) => `${c.ptr}=[${[
        s.kind === 'length' ? (c.node.minItems ?? '-') : (c.node.minLength ?? '-'),
        s.kind === 'length' ? (c.node.maxItems ?? '-') : (c.node.maxLength ?? '-'),
      ].join('..')}]`).slice(0, 3).join(' / ')}）`
    }
  }
  return out
}
if (AUDIT) {
  const a = auditLiterals(true)
  const bad = a.filter((s) => s.verdict.includes('✗') || s.verdict.includes('无约束'))
  console.log(`\n  ★ 手写字面量审计（**$ref 已解析**）：共 **${a.length} 处** · 一致 ${a.length - bad.length} · 异常 ${bad.length}`)
  for (const s of a) console.log(`     L${String(s.line).padStart(4)} ${s.kind.padEnd(11)} ${String(s.leaf).padEnd(14)} ${s.verdict}`)
  if (bad.length) viol.push(...bad.map((s) => `审计：validate-deck L${s.line}（${s.leaf}）${s.verdict}`))
}
if (SELFTEST) {
  /* ★ 负控**必须可判伪**：第一版用"不解析 ref ⇒ 出现假『无约束』结论"当判据，但归属规则改进后那些位点
     不再需要 ref 就能解析 ⇒ 假结论归零 ⇒ **负控自己失效**（"负控要能失败"这条纪律反噬到负控本身）。
     现改用**结构性对比**：解析 ref 后的**约束节点数必须严格多于**不解析 ⇒ 否则 ref 解析没起作用 ⇒ 判红。 */
  const cnt = (idx) => [...idx.entries()].filter(([k]) => k !== '__UNRESOLVED__').reduce((n, [, v]) => n + v.length, 0)
  const withRef = schemaLeafIndex(true)
  const withoutRef = schemaLeafIndex(false)
  const cw = cnt(withRef), cn = cnt(withoutRef)
  const onlyRefPtrs = [...withRef.keys()].filter((k) => k !== '__UNRESOLVED__' && !withoutRef.has(k))
  const unresolved = (withoutRef.get('__UNRESOLVED__') || 0)
  /* ⚠️ 模板串里**不许嵌反引号**（本项目已多次因此报错）：用引号代替 */
  console.log(`\n  ★ 负控（$ref 解析）：解析后约束节点 **${cw}** · 不解析 **${cn}**（差 ${cw - cn}）· 遇 $ref 未解析跳过的次数 **${unresolved}**`)
  console.log(`     仅解析后可见的叶：${onlyRefPtrs.slice(0, 8).join(', ') || '(无)'}`)
  console.log(`     ⇒ ${cw > cn ? '✓ 负控成立（**不解析 \$ref 会整片漏掉约束** —— 正是 team-lead 实测到的 3 处假结论的机制）' : '✗ **负控失败**（解析 ref 未增加任何约束 ⇒ 审计对 ref 不敏感）'}`)
  if (!(cw > cn)) viol.push('负控失败：解析 $ref 后的约束节点数**没有严格多于**不解析的情况 ⇒ 审计对 ref 不敏感（负控不可信）')
  const noRef = auditLiterals(false)
  const falseNeg = noRef.filter((s) => s.verdict.includes('假结论'))
  console.log(`     另：不解析时按"审计判定"口径的假"无约束"结论 = ${falseNeg.length} 处（**仅作观察**，不作判据 —— 上一版拿它当判据才发现它会被归属规则改进"消掉"）`)
}
const HANDCHECKS = process.argv.includes('--selftest-handchecks')
/* ============ ★ **自证判据：`--selftest-handchecks`**（team-lead ②：三段对账，防"永远红 ⇒ 被放宽"） ============
   目的：证"**没有手写判定在拦 override**" —— 对每个**已测**叶子跑 `--raise-max <leaf>=judge+2`，断言 **k=judge 能渲染**。
   ⚠️ 若照"受检集合 == 全部 maxLength 叶子"实现 ⇒ 今天**不可能通过**（31 个叶子没有判据、根本跑不了）
     ⇒ 迟早有人把断言放宽（静默降级）。故按**三段对账**：
       (a) **已测**：N/N 全跑且全过（抬得起来）；
       (b) **未测**：打印个数 + 清单，且必须与 `--strict-coverage` 的清单**逐项一致**（同一来源 ⇒ 显式债务）；
       (c) **数量**：`已测 + 未测 == schema 里全部 maxLength 叶子数`（少一个即红 ⇒ 不能偷偷缩小受检面）。
   归因：失败时点名 **字段 + 手写站点行号**（复用 `--audit` 的映射）。
   档位：**独立全量检查**（与 `--strict-coverage` 同级、发版前必跑）· **不进** 12 分钟快速闸门 · 结果可写文件（机器通道）。 */
if (HANDCHECKS) {
  const argvOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : '' }
  const lim = Number(argvOf('--limit') || 0)
  const outFile = argvOf('--out') || ''
  /* ★ team-lead ②：叶子分**两类**，构造输入方式不同 ——
     长度类（`maxLength`/`minLength`）⇒ 填字符串；**条数类（`maxItems`/`minItems`）⇒ 增删数组元素**。
     若自证只处理字符串 ⇒ `p.items.length > 5` / `side.points.length > 4` 这类**整片漏检**（最容易被漏的一批）。
     ⚠️ 现状：**条数类构造器尚未实现** ⇒ 不能静默跳过，必须**显式计入待办段**（否则就是"范围缩小 ⇒ 全绿"）。 */
  /* ⚠️ **第一版枚举错了**：`leaves` 只收了**带 `maxLength`** 的节点 ⇒ `maxItems` 类的叶子**根本不出现**
     ⇒ `cntLeaves = 0` ⇒ 条数类**静默漏检**，且 (c) 对账会 **假绿（0 == 0）**
     （正是 team-lead 警告的"条数类整片漏检"）。⇒ 改用 `schemaLeafIndex`（`$ref` 已解析）的**指针枚举**，
     按节点上实际存在的关键字分类：string 长度类 vs array 条数类。 */
  const idxAll = schemaLeafIndex(true)
  const ptrNodes = new Map()
  for (const [k, arr] of idxAll) { if (k === '__UNRESOLVED__') continue; for (const c of arr) ptrNodes.set(c.ptr, c.node) }
  const lenPtrs = [...ptrNodes].filter(([, n]) => n.maxLength !== undefined || n.minLength !== undefined).map(([p]) => p)
  const cntPtrs = [...ptrNodes].filter(([, n]) => n.maxItems !== undefined || n.minItems !== undefined).map(([p]) => p)
  const leafType = (p) => (ptrNodes.get(p) && (ptrNodes.get(p).maxItems !== undefined || ptrNodes.get(p).minItems !== undefined)) ? 'count' : 'length'
  const allLeaves = lenPtrs
  const cntLeaves = cntPtrs
  const measured = (limits.limits || []).filter((e) => e.judgeLimit != null && e.detectPoint && e.field)
  const auditByLeaf = new Map()
  for (const s of auditLiterals(true)) if (s.leaf && s.verdict.includes('一致')) auditByLeaf.set(s.leaf, s.line)
  const targets = lim ? measured.slice(0, lim) : measured
  const res = []
  for (const e of targets) {
    const leaf = e.jsonPointer.split('/').pop()
    const k = e.judgeLimit
    /* ★ team-lead ③(a)：**禁静默兜底** —— 档必须显式登记（`e.deck` 或 `_decks[指针]`）；缺失 ⇒ **红**，绝不用默认值替换。
       （原先 `e.deck || 'examples/deck.master-v1.json'`：叶子不在该档时会**静默测错档**；`setPath` 还会凭空造页 ⇒ **平凡通过**。） */
    const deck = e.deck || (limits._decks && limits._decks[e.jsonPointer]) || ''
    if (!deck) { res.push({ ptr: e.jsonPointer, leaf, k, okRender: false, noDeck: true, handLine: auditByLeaf.get(leaf) || null }); continue }
    const r = spawnSync(process.execPath, [join(DECK_DIR, 'crosscheck-deck-json.mjs'),
      '--json', deck, '--field', e.field, '--cls', e.detectPoint,
      '--ks', `${k},${k + 1}`, '--raise-max', `${leaf}=${k + 2}`], { encoding: 'utf8', cwd: DECK_DIR })
    const out = String(r.stdout || '') + String(r.stderr || '')
    const okRender = new RegExp(`k= ?${k} · 渲染 ok`).test(out)
    /* ★ ③(b)：**每格打印** 档/页/cls/**读回**（原先完全不打印档 ⇒ 出问题看不见） */
    const rb = /k=\s*\d+ · 渲染 ok · 读回 (\d+)\/(\d+)[^\n]*?页 (\d+)/.exec(out)
    console.log(`     · ${e.jsonPointer.split('/').slice(-1)[0]} ← **${deck}** · 页 ${rb ? rb[3] : '?'} · cls=${e.detectPoint} · 读回 ${rb ? rb[1] + '/' + rb[2] : '—'}`)
    res.push({ ptr: e.jsonPointer, leaf, k, okRender, deck, handLine: auditByLeaf.get(leaf) || null })
  }
  const pass = res.filter((x) => x.okRender).length
  const bad = res.filter((x) => !x.okRender)
  const noDeck = res.filter((x) => x.noDeck)   /* ★ ③(a)：档没登记 ⇒ 红（禁静默默认） */
  if (noDeck.length) viol.push(...noDeck.map((x) => `自证：${x.ptr} **未登记源档**（禁静默默认 ⇒ 必须显式给 deck/_decks）`))
  console.log(`\n  ★ 自证（handchecks）：受检 **${res.length}**${lim ? `（--limit ${lim}）` : ''} · 通过 **${pass}** · 失败 **${bad.length}**`)
  for (const x of bad) console.error(`     ✗ ${x.ptr}：k=${x.k} **渲染不出来** ⇒ **还有手写判定在拦**${x.handLine ? `（疑似 L${x.handLine}）` : ''}`)
  /* (b) 未测清单（与 --strict-coverage 同源 ⇒ 逐项一致） */
  const unmeasured = allLeaves.filter((p) => !measured.some((e) => e.jsonPointer === p))
  const strictList = uncovered   /* 同一个计算 ⇒ 断言它们相等（防"两处口径分叉"） */
  const sameList = strictList.length === unmeasured.length && strictList.every((p) => unmeasured.includes(p))
  /* ★ 按**类型**分段（team-lead ②）：长度类与条数类分开计数、分开对账 */
  const measLen = measured.filter((e) => leafType(e.jsonPointer) === 'length')
  const measCnt = measured.filter((e) => leafType(e.jsonPointer) === 'count')
  const unmCnt = cntLeaves.filter((p) => !measured.some((e) => e.jsonPointer === p))
  console.log(`     (a) **长度类**已测 **${res.length === 0 ? 0 : pass}/${res.length}**${bad.length ? ' ✗' : ' ✓'}（填字抬得起 ⇒ 无手写判定在拦）`)
  console.log(`     (a') **条数类**已测 **${measCnt.length}** ⇒ ⏳ **构造器（按数组增删元素）尚未实现 ⇒ 本段未跑，显式计入待办**（不许静默跳过）`)
  console.log(`     (b) 未测：长度 **${unmeasured.length}**（与 --strict-coverage 清单**逐项一致 = ${sameList ? '✓' : '✗'}**）· 条数 **${unmCnt.length}**`)
  console.log(`     (c) 分类对账：长度 已测 ${measLen.length} + 未测 ${unmeasured.length} = **${measLen.length + unmeasured.length}** ↔ schema 长度叶子 **${allLeaves.length}** ⇒ ${measLen.length + unmeasured.length === allLeaves.length ? '✓' : '✗'}`)
  console.log(`        条数 已测 ${measCnt.length} + 未测 ${unmCnt.length} = **${measCnt.length + unmCnt.length}** ↔ schema 条数叶子 **${cntLeaves.length}** ⇒ ${measCnt.length + unmCnt.length === cntLeaves.length ? '✓' : '✗'}`)
  if (measCnt.length) viol.push(`自证：**条数类**已测 ${measCnt.length} 个（${measCnt.map((e) => e.jsonPointer).join(', ')}）但**构造器未实现 ⇒ 它们未被检验**（不许当"通过"）`)
  if (outFile) { try { writeFileSync(outFile, JSON.stringify({ checked: res.length, pass, bad, unmeasured: unmeasured.length, total: allLeaves.length }, null, 2), 'utf8'); console.log(`     （机器通道已写文件：${outFile}）`) } catch (e) { console.error(`✗ 写文件失败：${e.message} ⇒ exit 2`); process.exit(2) } }
  if (bad.length) viol.push(...bad.map((x) => `自证：${x.ptr} 的 k=${x.k} 渲不出来（还有手写判定${x.handLine ? ` 疑似 L${x.handLine}` : ''}）`))
  if (!sameList) viol.push('自证：未测清单与 --strict-coverage 清单**不一致**（两处口径分叉）')
  if (measured.length + unmeasured.length !== allLeaves.length) viol.push(`自证：数量对账失败（已测 ${measured.length} + 未测 ${unmeasured.length} ≠ schema 叶子 ${allLeaves.length}）`)
}
/* ★ team-lead ①(ii)：`_decks` 登记表**双向**断言 —— 每个键必须对应**存在的**条目 jsonPointer（`_doc` 等 `_` 前缀豁免）
   ⇒ 防"登记表自己长出没人用的条目"（与"负控归零""宽允许项"同族：**两边集合必须相等**）。 */
{
  const ptrs = new Set((limits.limits || []).map((e) => e.jsonPointer))
  const orphans = Object.keys(limits._decks || {}).filter((k) => !k.startsWith('_') && !ptrs.has(k))
  if (orphans.length) viol.push(...orphans.map((k) => `_decks 孤儿键：${k} ⇒ 没有对应的 limits 条目（两边集合必须相等）`))
}
/* ★★ team-lead msg4 ④：**I10 汇总行（机读 + 与"未实测硬上限"对账）** ——
   目的：不许出现"两套统计"（今天已因"两套结论不同源"吃过一次）⇒ 两个数字必须**相加/互补**，且恒等式成立。 */
{
  const totalCells = (limits.limits || []).length
  const asserted = IT_ASSERTED.length
  const recordOnly = totalCells - asserted
  const unmLen = uncovered.length
  const identity = (asserted + recordOnly === totalCells)
  const disjoint = new Set([...IT_ASSERTED]).size === asserted
  console.log(`\n  **I10 汇总（机读）**：表条目 **${totalCells}** · **已测且已断言 ${asserted}** · **只记录未断言 ${recordOnly}**`)
  console.log(`     对账：已断言 ${asserted} + 未实测硬上限 ${unmLen} = **${asserted + unmLen}**（互补 ⇒ 断言分母）· 恒等式(已断言+只记录==条目) = ${identity ? '✓' : '✗'} · 无重复计入 = ${disjoint ? '✓' : '✗'}`)
  if (!identity) viol.push(`I10：已断言 ${asserted} + 只记录 ${recordOnly} ≠ 表条目 ${totalCells}（汇总与逐格**不同源**）`)
  if (!disjoint) viol.push(`I10：同一格被**重复计入断言**（${asserted} vs 去重 ${new Set(IT_ASSERTED).size}）`)
  if (recordOnly > 0) noted.push(`I10：**只记录未断言 ${recordOnly} 条**（列名见上；发版前应逐条给断言或标 status）⇒ ${(limits.limits || []).filter((e) => !IT_ASSERTED.includes(e.field || e.jsonPointer)).map((e) => e.field || e.jsonPointer).join(', ')}`)
}
/* ---------- ★★ team-lead msg4 ③：`--verify-cell` —— **表的自证**（照抄该格 `source` 跑一遍，断言读数与表内值一致）----------
   五条细化逐条实现：
   1) **原样跑 `source`**（只解析出「脚本 + argv」，**不叠加任何参数**）；
   2) 断言 **exit=0 且 tag=（无）**（表声称的是"成功读数" ⇒ 非 0 或带 tag ⇒ 红）；
   3) ★ **`sweepMax` 与 `capacityAtLeast` 分开**（一个字段一个语义）：比对 `source` 里的 `--nmax` ↔ `sweepMax`，
      这样"N_MAX 变了但 `capacityAtLeast` 恰好没变"的漂移能被发现；
   4) **轮转抽样**（按运行序号取模，N 次内每格都被抽到；状态存 `out-tmp-verify/` ⇒ 不入库）；
   5) 只进 `--strict-coverage`（**常态闸门不跑**）；`--verify-cell <field>` 可显式指定单格。
   成本：count 格 ~100s · 长度格 ~2×20s ⇒ 按抽样跑。 */
const ARG_VC = (() => { const i = process.argv.indexOf('--verify-cell'); return i >= 0 ? process.argv[i + 1] : '' })()
const ROTATE = process.argv.includes('--verify-rotate')
if (ARG_VC || ROTATE) {
  const cells = limits.limits || []
  const ROT_DIR = join(HERE, 'out-tmp-verify')
  const ROT_F = join(ROT_DIR, 'rotate.json')
  let st = { cursor: 0, covered: [], lastFullSweep: null }
  try { st = { ...st, ...JSON.parse(readFileSync(ROT_F, 'utf8')) } } catch { /* 首次运行 */ }
  /* ★ msg6 ②：**轮转记账必须累积 field + 时间 + SHA**（旧格式是裸字符串 ⇒ 规范化）。
     事故（team-lead 实测）：`covered` **恒空**，因为只有"轮转模式"才 push ⇒ 显式 `--verify-cell` 那次不记账
     ⇒ "已覆盖 n/14" 永远 0、"覆盖满一轮"永不成立 ⇒ 只剩 cursor 在动 ⇒ **无法证明每格都被抽到**。 */
  st.covered = (Array.isArray(st.covered) ? st.covered : []).map((x) => (typeof x === 'string' ? { field: x, at: '（旧格式）', sha: '?', ok: null } : x))
  const VC_SHA = String(spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).stdout || '').trim() || 'n/a'
  let cell = ARG_VC ? cells.find((x) => x.field === ARG_VC) : cells[st.cursor % cells.length]
  if (!cell) { console.error(`✗ --verify-cell：表里没有 \`field=${ARG_VC}\` ⇒ exit 2`); process.exit(2) }
  const tok = (s) => (s.match(/'[^']*'|"[^"]*"|\S+/g) || []).map((t) => t.replace(/^['"]|['"]$/g, ''))
  const src = String(cell.source || '')
  const mm = /^node\s+(\S+\.mjs)\s*([\s\S]*)$/.exec(src.trim())
  let vcOut = ''
  const why = []
  if (!mm) why.push('`source` 不是可执行的 node 命令行形式')
  else {
    const r = spawnSync(process.execPath, [join(HERE, mm[1]), ...tok(mm[2] || '')], { cwd: HERE, encoding: 'utf8', maxBuffer: 1 << 26 })
    const out = String(r.stdout || '') + String(r.stderr || '')
    vcOut = out
    const tags = [...new Set([...out.matchAll(/\[([A-Z][A-Z_]{2,})\]/g)].map((x) => x[1]))]
    if (r.status !== 0) why.push(`exit=${r.status}（表声称**成功读数**；非 0 即矛盾）`)
    if (tags.length) why.push(`带 tag [${tags.join(', ')}]（成功读数不该有）`)
    const off = Number(cell.offset || 0)
    if (cell.unit === 'count' || cell.capacityAtLeast !== undefined) {
      /* ⚠️ **条数格 source 会跑多个 N**（例：`--min 3 --max 6 --stride 27` ⇒ N=3 与 N=30 两行）⇒
         取**第一个** `页内=` 会误报（我第一版就是这么写的，幸好在跑之前自查到）⇒ 改为**逐行**断言 `页内 == N`，
         并对 `max(N)` / `max(页内)` 与表内 `sweepMax` / `capacityAtLeast` 对账。 */
      const rowsC = [...out.matchAll(/N=\s*(\d+)\s*·[^\n]*?页内=(\d+)/g)].map((x) => ({ N: Number(x[1]), inPage: Number(x[2]) }))
      const nm = /--nmax\s+(\d+)/.exec(src)
      /* ★★ team-lead ④(1)：**降级档（弱档）** —— source 的工具**不是 `measure-count`**（例：`pages` 格的 source 是
         `render-deck`）⇒ **读数字段根本不会出现在输出里** ⇒ 此时**不许沉默、也不许按"缺读数"判红**（那是**误红** ✗）。
         改为：只断言"**源可跑通**"（上面已核 `exit` 与 tag ⇒ exit 0 / 无 tag 即过），并把**强度缺口明写**出来。 */
      if (!/measure-count\.mjs$/.test(mm[1])) {
        console.log(`  [VERIFY-CELL-WEAK] ${cell.field || cell.jsonPointer}：source 工具 = \`${mm[1]}\`（**非 measure-count**）⇒ **不核对读数**（只验"源可跑通"：exit 0 / 无 tag）`)
      } else if (!rowsC.length) why.push('输出里没有 `N= … 页内=` 行（条数读数缺失）')
      else {
        for (const rc of rowsC) if (rc.inPage !== rc.N) why.push(`N=${rc.N} 但页内=${rc.inPage}（条数读回 ≠ N）`)
        const maxN = Math.max(...rowsC.map((x) => x.N)), maxIn = Math.max(...rowsC.map((x) => x.inPage))
        /* ★★ msg33 ②：**固定窗口**（minItems == maxItems）的格**没有** `capacityAtLeast` ⇒ 预期值 = **契约值**本身。
           判据：读数必须**覆盖到**契约值（`maxIn >= fixed`）；**越契约仍渲染**（maxIn > fixed，如强注 30）**不算错**
           —— 那是"越契约可渲染"的旁证，不是容量（我第一版把 `undefined` 拿去比 ⇒ 自证当场红，已修）。 */
        /* ★ msg35 ②：**真表路径走同一个纯函数**（"必须覆盖契约值 / 越契约不算错"都在它里面，且已被合成负控证伪过）。
           ⇒ 只在"无容量"时需先算契约值（有容量时函数自己判）——**这一段不再自带任何比较逻辑**（消除两份实现）。 */
        let fixed = null      /* ★ 声明**外提**到 if 之外（否则下面统一裁决处引用它 ⇒ ReferenceError；语法检查抓不到这类错） */
        if (cell.capacityAtLeast === undefined) {
          let rcFail = 0     /* ⚠️ catch **必须会说话**（计数）：静默 catch 会被"哑 catch 棘轮"咬 —— 我已第四次踩它 */
          try { const n3 = get(String(cell.jsonPointer || '')); fixed = (n3 && n3.minItems !== undefined && Number(n3.minItems) === Number(n3.maxItems)) ? Number(n3.maxItems) : null } catch { fixed = null; rcFail++ }
          if (rcFail) why.push('契约值读取失败（无法判定固定窗口的预期值）')
        }
        /* ★ 单一实现：无论有无容量，最终都由**同一个纯函数**裁决（它已被 8 例合成负控/正控证伪过） */
        {
          /* ★ **唯一实现**：两个分支都在纯函数里（"有容量 ⇒ 必须相等 / 固定窗口 ⇒ 必须覆盖契约值"），
             已被 8 例合成负控/正控证伪过 ⇒ 此处**不再有任何自带比较**（我上一版在这里留了重复推送 ⇒ 容量格被误报"口径不全"） */
          const vcWhy = verifyCoverageVerdict(cell, maxIn, fixed)
          if (vcWhy) why.push(vcWhy)
        }
        if (cell.sweepMax !== undefined && maxN !== Number(cell.sweepMax)) why.push(`max N=${maxN} ≠ sweepMax=${cell.sweepMax}`)
      }
      if (nm && cell.sweepMax === undefined) why.push('`source` 带 `--nmax` 但表**缺 `sweepMax` 字段**（一个语义一个字段 ⇒ 请补）')
      else if (nm && Number(nm[1]) !== Number(cell.sweepMax)) why.push(`source 的 --nmax=${nm[1]} ≠ sweepMax=${cell.sweepMax}`)
    } else {
      const rows = [...out.matchAll(/k=\s*(\d+) · 渲染 ok · 读回 (\d+)\/(\d+)/g)]
      if (!rows.length) why.push('未解析到任何"渲染 ok"行 ⇒ 无法自证')
      for (const rr of rows) {
        if (Number(rr[2]) !== Number(rr[1]) + off) why.push(`k=${rr[1]} 读回=${rr[2]} ≠ k+offset=${Number(rr[1]) + off}`)
        if (Number(rr[3]) !== Number(rr[1]) + off) why.push(`k=${rr[1]} 分母=${rr[3]} ≠ k+offset=${Number(rr[1]) + off}`)
      }
      const pages = [...new Set([...out.matchAll(/页 (\d+) ✓/g)].map((x) => Number(x[1])))]
      if (cell.page !== undefined && pages.length && !pages.every((p) => p === Number(cell.page))) why.push(`命中页 [${pages.join(',')}] ≠ 表内 page=${cell.page}`)
    }
  }
  console.log(`\n  ★ **--verify-cell ${cell.field}**：${why.length ? '✗' : '✓'} ${why.length ? why.join(' · ') : '读数与表内值**逐项一致**（exit=0 · 无 tag）'}`)
  /* ⚠️ **不许丢失败输出**（§25a）：失败时打印子进程原样末 6 行 —— 否则"为什么红"只能靠猜（我第一版就没打，白跑一轮）。 */
  if (why.length && typeof vcOut === 'string') for (const l of vcOut.split('\n').filter(Boolean).slice(-6)) console.log(`        ↳ ${l.trim().slice(0, 170)}`)
  if (why.length) viol.push(`--verify-cell ${cell.field}：${why.join(' / ')}（表与实测**不同源** ⇒ 要么改表、要么改实现）`)
  /* ★ msg6 ②：**任何一次 verify 都记账**（显式或轮转）⇒ `已覆盖 n/14` 才有意义；覆盖满一轮即记 sha+时间并**保留明细**。 */
  st.covered = st.covered.filter((x) => x.field !== cell.field)
  st.covered.push({ field: cell.field, at: new Date().toISOString(), sha: VC_SHA, ok: why.length === 0, why: why.join(' / ') })
  const allCovered = st.covered.length >= cells.length
  if (allCovered) st.lastFullSweep = `${VC_SHA} @ ${new Date().toISOString()}`
  if (ROTATE) st.cursor = (st.cursor + 1) % cells.length
  try { mkdirSync(ROT_DIR, { recursive: true }); writeFileSync(ROT_F, JSON.stringify(st, null, 2), 'utf8') } catch { /* ignore */ }
  console.log(`     轮转记账：**已覆盖 ${st.covered.length}/${cells.length}**${ROTATE ? `（cursor=${st.cursor}）` : ''} · 本次记入 ${cell.field}（SHA=${VC_SHA} · ${why.length ? '✗' : '✓'}）· 上次全格覆盖：**${st.lastFullSweep || '尚未（继续轮转直到每格都被抽到）'}**`)
}
console.log(`\n  覆盖：**未被实测的硬上限 ${uncovered.length} 个**${uncovered.length ? '（发版前必须开 --strict-coverage 清空）' : ''}`)
for (const p of uncovered.slice(0, 20)) console.log(`     · ${p} = ${leaves.get(p).maxLength}`)
if (viol.length) {
  console.error(`\n✗ 违规 ${viol.length} 条：`)
  for (const v of viol) console.error(`   · ${v}`)
}
if (i5.length) viol.push(...i5.map((s) => `I5 ${s}`))
if (i5doc.length) viol.push(...i5doc.map((s) => `I5-文档 ${s}`))
if (q11.length) viol.push(...q11.map((s) => `④ASCII引号 ${s}`))
if (seq.out.length) viol.push(...seq.out.map((s) => `④b编号序列 ${s}`))
if (!viol.length && !(STRICT && uncovered.length)) { console.log('\n✓ 一致（每个已测硬上限都有判据支撑且留有余量）'); process.exit(0) }
if (!viol.length && STRICT && uncovered.length) { console.error(`\n✗ --strict-coverage：仍有 ${uncovered.length} 个硬上限**没有实测支撑**`); process.exit(1) }
process.exit(1)
