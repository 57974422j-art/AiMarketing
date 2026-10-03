#!/usr/bin/env node
/* check-probe-drift.mjs —— **本地守卫（不进发版闸门）**：两树同名文件 MD5 必须相等
 *
 * 为什么需要（team-lead ⑤.4，本次事故的**结构性根治**）：
 *   本会话我三次把"真源判错"：① 拿探针树当基线判 docs 该删；② 报告版本判错；③ PARAMS 查错路径。
 *   根因都一样 —— **改动/判断落在不可分发的探针树，而没人能发现**。
 *   ⇒ 加这道守卫：同一逻辑在两树里必须**逐字节相同**，不等即红（而不是"靠我记住两处都改"）。
 *
 * 布局映射表（与 `check-docs-fork.mjs` 同一套，避免每次重新猜）：
 *   · **flat（入库树）**：脚本直接在 `<repo>/scripts/video-factory/html-deck/` ⇒ `ENGINE_ROOT === 入库根`
 *   · **bridge-dev（探针树）**：脚本在 `<probe>/deck-contract/`、引擎根是 `<probe>/`
 *     ⇒ 入库根 = `<ENGINE_ROOT>/../../scripts/video-factory/html-deck`
 *   探针侧候选路径（同一个 `rel` 依次试）：`<probe>/deck-contract/<rel>` · `<probe>/<rel>` ·
 *     `<probe>/masters/<rel>` · `<probe>/fonts/<rel>` · `<probe>/master-v1/<rel>` · `<probe>/master-v2/<rel>`
 *
 * 判定：入库树每个文件 ⇒ 探针树若有对应物，**MD5 必须相等**；不等 ⇒ 红（exit 1），并打印"哪边更新（mtime）"。
 *      探针树有、入库树没有 ⇒ **提示级**（exit 0），提示"该文件没进可分发树"。
 * 例外：`DRIFT_OK` 表（**每条必须写 reason**）——默认空。
 * 退出码：0 = 无漂移 · 1 = 有漂移（红）· 2 = 环境/用法错（§25b）
 * 环境：`LANDING_DIR` / `PROBE_DIR` 可覆盖。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, resolve, basename, sep } from 'node:path'
import { ENGINE_ROOT, selfCheck } from './paths.mjs'

selfCheck({ quiet: true })

const LANDING_DIR = process.env.LANDING_DIR || (basename(ENGINE_ROOT) === 'html-deck'
  ? ENGINE_ROOT
  : resolve(ENGINE_ROOT, '..', '..', 'scripts', 'video-factory', 'html-deck'))
/* flat 时入库根 = `<repo>/scripts/video-factory/html-deck` ⇒ 探针树 = `<repo>/dist-rel/probe-hf`
   （从入库根上溯**三层**：html-deck → video-factory → scripts → `<repo>`；第一版只上溯两层 ⇒ 指到了 `scripts/dist-rel/…` ✗） */
const PROBE_DIR = process.env.PROBE_DIR || (basename(ENGINE_ROOT) === 'html-deck'
  ? resolve(ENGINE_ROOT, '..', '..', '..', 'dist-rel', 'probe-hf')
  : ENGINE_ROOT)

if (!existsSync(LANDING_DIR)) {
  console.error(`✗ 入库树不存在：${LANDING_DIR}（§25b ⇒ exit 2）`)
  process.exit(2)
}
/* ④ **服务器/全新克隆没有探针树**（`dist-rel/` 被 gitignore）⇒ **跳过 + exit 0**（本机守卫，不该让发版闸门永远红） */
if (!existsSync(PROBE_DIR)) {
  console.log('\n两树漂移检查（本地守卫，**不进发版闸门**）')
  console.log(`  入库树 = ${LANDING_DIR}`)
  console.log(`  ⚠ 探针树不存在（${PROBE_DIR}）⇒ **跳过（本机守卫）** · exit 0 —— 服务器/全新克隆没有探针树是正常的`)
  process.exit(0)
}
/* ★ 负控断言：探针树 == 入库树 ⇒ 守卫静默失效 ⇒ 判红（不许绿灯） */
if (resolve(PROBE_DIR) === resolve(LANDING_DIR)) {
  console.error(`✗ 探针树 == 入库树（${PROBE_DIR}）⇒ 漂移守卫**静默失效** ⇒ exit 2（配置错）`)
  process.exit(2)
}

/* 例外表：**每条必须写 reason**（不许无声豁免） */
const DRIFT_OK = {
  // 'README.md': '两份 README 面向不同读者（引擎总说明 vs 探针侧索引），内容按需各自演进',
  /* ⚠️ **误配**（2026-10-04）：`examples/.gitignore`（入库树：临时变体保险）被**按 basename 兜底**
     配到了探针树的 `deck-contract/.gitignore`（另一份、角色不同）⇒ 报"MD5 不等"的**假漂移**。
     深层修法（下一步）：**dotfile 不走 basename 兜底**（点文件通常按角色各自存在）；此处先按例外登记（带 reason）。
     —— 这也再次说明"兜底匹配"要按最小粒度（与"宽允许项 = 静默掩盖"同族，只是反过来是**假红**）。 */
  'examples/.gitignore': {
    reason: '探针树没有同角色的这份文件（deck-contract/.gitignore 是另一份）；本条是 basename 兜底的**误配**',
    /* ★ team-lead ④：**例外必须自带死期** —— 机制落地后本例外应删除，且断言**例外条数随之归零**
       （我们刚亲眼见过"永久白名单"的危害：`^examples/` 整目录放行掩盖了临时残留）。 */
    expiresWhen: 'dotfile 不走 basename 兜底（精确路径配对）落地后 ⇒ 删除本例外；届时例外表条数应回到 0',
  },
}

const isFile = (p) => { try { return statSync(p).isFile() } catch { return false } }

/** 探针树按 basename 建索引（★ **兜底匹配**：legacy 布局如 `<probe>/master-v1/PARAMS.md` 用路径拼不出来，
 *   必须按**同名**兜底 —— 第一版只按路径拼 ⇒ 漏了 v1 PARAMS，且把目录当文件读（EISDIR）。
 *   ⚠️ **惰性构建**：`walk` 在本文件下方才定义（第一版在这里直接调用 ⇒ TDZ ReferenceError）。 */
let probeByName = null
const probeCandidates = (rel) => {
  if (!probeByName) {
    probeByName = new Map()
    for (const r of walk(PROBE_DIR)) {
      const n = basename(r)
      if (!probeByName.has(n)) probeByName.set(n, [])
      probeByName.get(n).push(join(PROBE_DIR, r))
    }
  }
  const byPath = [
    join(PROBE_DIR, 'deck-contract', rel),
    join(PROBE_DIR, rel),
    join(PROBE_DIR, 'masters', rel),
    join(PROBE_DIR, 'fonts', rel),
    join(PROBE_DIR, 'master-v1', rel),
    join(PROBE_DIR, 'master-v2', rel),
  ].filter(isFile)
  const byName = (probeByName.get(basename(rel)) || []).filter(isFile)
  return byPath.length || !byName.length ? byPath : byName
}

const SKIP = /^(out|node_modules|evidence|\.)/
function walk(dir, base = dir, out = []) {
  let es = []
  try { es = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    if (e.isDirectory()) { if (!SKIP.test(e.name)) walk(join(dir, e.name), base, out) }
    else out.push(relative(base, join(dir, e.name)).split(sep).join('/'))
  }
  return out
}
const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex')

const landFiles = walk(LANDING_DIR)
const drift = []
const probeOnly = []
const missingInProbe = []
/* ★ team-lead ①（守卫的**文件集盲区**）：原先"入库树有、探针树无" ⇒ `continue`（**静默忽略**）。
   而我保留双份的**唯一价值**就是"锚点完整性" ⇒ 文件集恰好是守卫唯一没覆盖的维度。
   ⇒ 入库树的 `*.mjs`/`*.json` 没有对应物 ⇒ **红**（除允许表，**每条必须写 reason**）。 */
const PROBE_MISSING_OK = (rel) => (
  /* ⚠️ **收紧（2026-10-04 事故）**：原写 `^examples/` 整目录 ⇒ **掩盖**了混进提交的临时变体
     `examples/__tmp_xcheck-k432.json`（锚点检查没报它）。⇒ 只放行 **声明档**，`__tmp_*` 一律**判红**。 */
  /^examples\//.test(rel) && !/^examples\/__tmp_/.test(rel) ? '例档（探针侧只用产物，不入库例档）' :
  /^examples\/__tmp_/.test(rel) ? null :   /* 临时变体/自证残留 ⇒ 必须红（不许留痕） */
  /^out/.test(rel) ? '出片产物（SKIP 已滤，防御性）' :
  null
)
for (const rel of landFiles) {
  const cands = probeCandidates(rel)
  if (!cands.length) {
    if (/\.(mjs|json)$/.test(rel) && !PROBE_MISSING_OK(rel)) missingInProbe.push(rel)
    continue
  }
  const lh = md5(join(LANDING_DIR, rel))
  const hits = cands.map((p) => ({ p, h: md5(p) }))
  const same = hits.find((x) => x.h === lh)
  if (same) continue
  if (DRIFT_OK[rel]) continue
  const newest = hits.map((x) => statSync(x.p).mtimeMs).reduce((a, b) => Math.max(a, b), 0)
  const lm = statSync(join(LANDING_DIR, rel)).mtimeMs
  drift.push(`${rel} ⇒ 入库树 ${lh.slice(0, 12)}${lm >= newest ? '（**更新**，探针树旧）' : '（探针树更新 ⇒ **改完没同步**）'} · 探针侧 ${hits.map((x) => x.p.replace(PROBE_DIR + sep, '') + ' ' + x.h.slice(0, 12)).join(' / ')}`)
}

/* 反向：探针侧有、入库树没有（提示级：可能"没进可分发树"） */
const landSet = new Set(landFiles)
for (const rel of walk(join(PROBE_DIR, 'deck-contract'))) {
  if (!landSet.has(rel) && /\.(mjs|json|md)$/.test(rel)) probeOnly.push(`deck-contract/${rel}`)
}
for (const rel of walk(join(PROBE_DIR, 'masters'))) {
  if (!landSet.has(`masters/${rel}`) && /\.(mjs|json|md)$/.test(rel)) probeOnly.push(`masters/${rel}`)
}

/* ② **报告以 docs 为准**（team-lead ②）：`docs/ppt-html-probe/probe-REPORT.md` 是唯一**可分发**真源
   （`git ls-files` 已确认入库树没有 REPORT.md）⇒ 探针树 `<probe>/REPORT.md` 只是**工作副本**，必须与 docs 一致。 */
const DOCS_DIR = process.env.DOCS_DIR || (basename(ENGINE_ROOT) === 'html-deck'
  ? resolve(ENGINE_ROOT, '..', '..', '..', 'docs', 'ppt-html-probe')
  : resolve(ENGINE_ROOT, '..', '..', 'docs', 'ppt-html-probe'))
const docsReport = join(DOCS_DIR, 'probe-REPORT.md')
const probeReport = join(PROBE_DIR, 'REPORT.md')
let reportNote = '（两份报告不在场，跳过）'
if (existsSync(docsReport) && existsSync(probeReport)) {
  const a = md5(docsReport), b = md5(probeReport)
  if (a === b) reportNote = `✓ docs ↔ 探针工作副本一致（${a.slice(0, 12)}）`
  else {
    reportNote = `✗ 不一致：docs ${a.slice(0, 12)} ≠ 探针 ${b.slice(0, 12)} ⇒ **以 docs 为准**（把 docs 版刷给探针，或人工判定）`
    drift.push(`probe-REPORT.md / REPORT.md ⇒ docs(权威) ${a.slice(0, 12)} ≠ 探针工作副本 ${b.slice(0, 12)}`)
  }
}

console.log(`\n两树漂移检查（本地守卫，**不进发版闸门**）`)
console.log(`  入库树 = ${LANDING_DIR}（${landFiles.length} 文件）`)
console.log(`  探针树 = ${PROBE_DIR}`)
console.log(`  报告一致性（**docs 为准**）：${reportNote}`)
if (probeOnly.length) {
  console.log(`\n  提示级（探针树有、入库树无 ⇒ 确认是否该入库）：${probeOnly.length} 个`)
  for (const p of probeOnly.slice(0, 20)) console.log(`    ? ${p}`)
}
if (missingInProbe.length) {
  console.error(`\n✗ **锚点不完整**：入库树有、探针树无的 \`*.mjs\`/\`*.json\` = **${missingInProbe.length}** 个（team-lead ①）`)
  for (const p of missingInProbe.slice(0, 20)) console.error(`    · ${p}`)
  console.error('  处置：同步到探针树；若确属"不必进探针树"，写进 `PROBE_MISSING_OK` 并附 reason。')
}
if (drift.length) {
  console.error(`\n✗ **漂移**：${drift.length} 个同名文件两侧 MD5 不等（§25a：原始清单，未过滤）`)
  for (const d of drift) console.error(`    · ${d}`)
  console.error('  处置：把**权威版**同步到入库树（并核 MD5/`node --check`）；若确属"两份不同文档"，写进 DRIFT_OK 并附 reason。')
  process.exit(1)
}
if (missingInProbe.length) process.exit(1)
console.log(`\n✓ 无漂移：两树同名文件 MD5 全部相等（例外表 ${Object.keys(DRIFT_OK).length} 条）`)
