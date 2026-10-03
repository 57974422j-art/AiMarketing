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
    if (has) viol.push(`${label} ⇒ **I3**：判据未触发（到 K_MAX=${K_MAX} 无上限证据，status=${it.status || '-'}）却仍有 maxLength=${node.maxLength}（无据的硬上限会无端限制写作）`)
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
  const arr = /if\s*\(\s*n\s*>\s*(\d+)\s*\)\s*add\(\s*'(\w+)'/.exec(vd)
  if (arr) {
    const lvl = arr[2]
    const node = get('#/$defs/pageBullets/properties/items/items')
    const cap = node ? node.maxLength : undefined
    const adv = node ? node.recommendedMax : undefined
    if (lvl === 'error' && cap === undefined) out.push(`**validate-deck 硬编码（error 级）** items 长度 > ${arr[1]}，而 schema 该指针**无 maxLength** ⇒ 两处真源：渲染器会拒收 schema 允许的输入`)
    else if (lvl === 'error' && Number(cap) !== Number(arr[1])) out.push(`**两处不一致（error 级）**：validate-deck items > ${arr[1]} ↔ schema maxLength=${cap}`)
    else if (lvl !== 'error' && adv !== undefined && Number(adv) !== Number(arr[1])) out.push(`**advisory 不一致**：validate-deck items 建议 > ${arr[1]} ↔ schema recommendedMax=${adv}`)
  }
  return out
}
const i5 = i5Violations()

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
console.log(`\n  覆盖：**未被实测的硬上限 ${uncovered.length} 个**${uncovered.length ? '（发版前必须开 --strict-coverage 清空）' : ''}`)
for (const p of uncovered.slice(0, 20)) console.log(`     · ${p} = ${leaves.get(p).maxLength}`)
if (viol.length) {
  console.error(`\n✗ 违规 ${viol.length} 条：`)
  for (const v of viol) console.error(`   · ${v}`)
}
if (i5.length) viol.push(...i5.map((s) => `I5 ${s}`))
if (!viol.length && !(STRICT && uncovered.length)) { console.log('\n✓ 一致（每个已测硬上限都有判据支撑且留有余量）'); process.exit(0) }
if (!viol.length && STRICT && uncovered.length) { console.error(`\n✗ --strict-coverage：仍有 ${uncovered.length} 个硬上限**没有实测支撑**`); process.exit(1) }
process.exit(1)
