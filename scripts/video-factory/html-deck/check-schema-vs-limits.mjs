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
/* 覆盖：schema 里有硬上限的叶子是否都在实测表里出现过 */
const measured = new Set((limits.limits || []).map((x) => x.jsonPointer))
const uncovered = [...leaves.keys()].filter((p) => leaves.get(p).maxLength !== undefined && !measured.has(p))
console.log(`=== schema ↔ 实测上限 一致性（I1–I4${STRICT ? ' · --strict-coverage' : ''}）===`)
console.log(`  实测表条目 ${(limits.limits || []).length} · schema 含上限叶子 ${leaves.size} · K_MAX=${K_MAX}`)
for (const s of noted) console.log(`  · ${s}`)
console.log(`\n  覆盖：**未被实测的硬上限 ${uncovered.length} 个**${uncovered.length ? '（发版前必须开 --strict-coverage 清空）' : ''}`)
for (const p of uncovered.slice(0, 20)) console.log(`     · ${p} = ${leaves.get(p).maxLength}`)
if (viol.length) {
  console.error(`\n✗ 违规 ${viol.length} 条：`)
  for (const v of viol) console.error(`   · ${v}`)
}
if (!viol.length && !(STRICT && uncovered.length)) { console.log('\n✓ 一致（每个已测硬上限都有判据支撑且留有余量）'); process.exit(0) }
if (!viol.length && STRICT && uncovered.length) { console.error(`\n✗ --strict-coverage：仍有 ${uncovered.length} 个硬上限**没有实测支撑**`); process.exit(1) }
process.exit(1)
