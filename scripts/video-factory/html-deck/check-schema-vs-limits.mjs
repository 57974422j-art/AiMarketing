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
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DECK_DIR } from './paths.mjs'

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

const viol = [], noted = []
for (const it of (limits.limits || [])) {
  const node = get(it.jsonPointer)
  if (!node) { viol.push(`${it.jsonPointer} ⇒ 实测表指向的 schema 节点不存在（表/schema 不同源）`); continue }
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
function i5Violations() {
  const out = []
  const p = join(DECK_DIR, 'validate-deck.mjs')
  if (!existsSync(p)) return out
  const vd = readFileSync(p, 'utf8')
  const leafHasMax = (leaf) => [...leaves.entries()].filter(([q, n]) => q.endsWith('/' + leaf) && n.maxLength !== undefined)
  for (const m of vd.matchAll(/checkString\(\s*[^,]+,\s*`\$\{path\}\.([\w.]+)`\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']*)'/g)) {
    const [, leaf, min, max, label] = m
    const hits = leafHasMax(leaf)
    if (!hits.length) { out.push(`**validate-deck 有硬编码** ${leaf} ∈ [${min}, ${max}]（${label}），而 schema 里该字段**无 maxLength** ⇒ 两处真源（渲染器会拒收 schema 允许的输入）`); continue }
    if (!hits.some(([, n]) => Number(n.minLength ?? min) === Number(min) && Number(n.maxLength) === Number(max))) {
      out.push(`**两处不一致**：validate-deck ${leaf} ∈ [${min}, ${max}]（${label}）↔ schema ${hits.map(([q, n]) => `${q}=[${n.minLength ?? '-'}, ${n.maxLength}]`).join(' / ')}`)
    }
  }
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
if (i5doc.length) {
  console.log(`\n  ⚠ **I5-文档（AI-PROMPT 数字同源）违规 ${i5doc.length} 条**：`)
  for (const s of i5doc.slice(0, 12)) console.log(`     · ${s}`)
}
console.log(`\n  覆盖：**未被实测的硬上限 ${uncovered.length} 个**${uncovered.length ? '（发版前必须开 --strict-coverage 清空）' : ''}`)
for (const p of uncovered.slice(0, 20)) console.log(`     · ${p} = ${leaves.get(p).maxLength}`)
if (viol.length) {
  console.error(`\n✗ 违规 ${viol.length} 条：`)
  for (const v of viol) console.error(`   · ${v}`)
}
if (i5.length) viol.push(...i5.map((s) => `I5 ${s}`))
if (i5doc.length) viol.push(...i5doc.map((s) => `I5-文档 ${s}`))
if (!viol.length && !(STRICT && uncovered.length)) { console.log('\n✓ 一致（每个已测硬上限都有判据支撑且留有余量）'); process.exit(0) }
if (!viol.length && STRICT && uncovered.length) { console.error(`\n✗ --strict-coverage：仍有 ${uncovered.length} 个硬上限**没有实测支撑**`); process.exit(1) }
process.exit(1)
