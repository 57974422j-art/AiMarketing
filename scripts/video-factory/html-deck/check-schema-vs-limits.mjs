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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'   /* ★ --selftest-handchecks：逐叶子跑第二路 */
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
  const allLeaves = [...leaves.keys()].filter((p) => leaves.get(p).maxLength !== undefined)
  const measured = (limits.limits || []).filter((e) => e.judgeLimit != null && e.detectPoint && e.field)
  const auditByLeaf = new Map()
  for (const s of auditLiterals(true)) if (s.leaf && s.verdict.includes('一致')) auditByLeaf.set(s.leaf, s.line)
  const targets = lim ? measured.slice(0, lim) : measured
  const res = []
  for (const e of targets) {
    const leaf = e.jsonPointer.split('/').pop()
    const k = e.judgeLimit
    const r = spawnSync(process.execPath, [join(DECK_DIR, 'crosscheck-deck-json.mjs'),
      '--json', e.deck || 'examples/deck.master-v1.json', '--field', e.field, '--cls', e.detectPoint,
      '--ks', `${k},${k + 1}`, '--raise-max', `${leaf}=${k + 2}`], { encoding: 'utf8', cwd: DECK_DIR })
    const out = String(r.stdout || '') + String(r.stderr || '')
    const okRender = new RegExp(`k= ?${k} · 渲染 ok`).test(out)
    res.push({ ptr: e.jsonPointer, leaf, k, okRender, handLine: auditByLeaf.get(leaf) || null })
  }
  const pass = res.filter((x) => x.okRender).length
  const bad = res.filter((x) => !x.okRender)
  console.log(`\n  ★ 自证（handchecks）：受检 **${res.length}**${lim ? `（--limit ${lim}）` : ''} · 通过 **${pass}** · 失败 **${bad.length}**`)
  for (const x of bad) console.error(`     ✗ ${x.ptr}：k=${x.k} **渲染不出来** ⇒ **还有手写判定在拦**${x.handLine ? `（疑似 L${x.handLine}）` : ''}`)
  /* (b) 未测清单（与 --strict-coverage 同源 ⇒ 逐项一致） */
  const unmeasured = allLeaves.filter((p) => !measured.some((e) => e.jsonPointer === p))
  const strictList = uncovered   /* 同一个计算 ⇒ 断言它们相等（防"两处口径分叉"） */
  const sameList = strictList.length === unmeasured.length && strictList.every((p) => unmeasured.includes(p))
  console.log(`     (a) 已测 **${res.length === 0 ? 0 : pass}/${res.length}**${bad.length ? ' ✗' : ' ✓'}（抬得起来 ⇒ 无手写判定在拦）`)
  console.log(`     (b) 未测 **${unmeasured.length}**（与 --strict-coverage 清单**逐项一致 = ${sameList ? '✓' : '✗'}**）`)
  console.log(`     (c) 数量对账：已测 ${measured.length} + 未测 ${unmeasured.length} = **${measured.length + unmeasured.length}** ↔ schema 叶子 **${allLeaves.length}** ⇒ ${measured.length + unmeasured.length === allLeaves.length ? '✓' : '✗ 少受检'}`)
  if (outFile) { try { writeFileSync(outFile, JSON.stringify({ checked: res.length, pass, bad, unmeasured: unmeasured.length, total: allLeaves.length }, null, 2), 'utf8'); console.log(`     （机器通道已写文件：${outFile}）`) } catch (e) { console.error(`✗ 写文件失败：${e.message} ⇒ exit 2`); process.exit(2) } }
  if (bad.length) viol.push(...bad.map((x) => `自证：${x.ptr} 的 k=${x.k} 渲不出来（还有手写判定${x.handLine ? ` 疑似 L${x.handLine}` : ''}）`))
  if (!sameList) viol.push('自证：未测清单与 --strict-coverage 清单**不一致**（两处口径分叉）')
  if (measured.length + unmeasured.length !== allLeaves.length) viol.push(`自证：数量对账失败（已测 ${measured.length} + 未测 ${unmeasured.length} ≠ schema 叶子 ${allLeaves.length}）`)
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
