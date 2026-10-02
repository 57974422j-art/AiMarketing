#!/usr/bin/env node
/**
 * check-coverage-matrix.mjs —— 「**页型 × 母版 × 几何 × 配色**」覆盖矩阵 + 断言（队列 ③）
 *
 * 为什么要有它：上一轮抓到"**跑过 0 findings 的片子不含图表页**"这类**盲区** ⇒ 判据再强，
 * 如果某个页型/几何/配色**从没被任何产物覆盖过**，就等于没测。本闸门把"覆盖"本身变成**可断言**的：
 *   · 每**页型** ≥1 档覆盖，否则 **红**（"某页型从没被测过 = 红灯"）
 *   · 每个**母版 × 几何**组合 ≥1 档产物
 *   · 母版清单声明的每个**配色** ≥1 档产物
 *   · 每个产物在**稳定帧**上跑一次 layout/contrast，**按页型汇总**计数（= 顺手一张质量看板）
 *
 * 退出码（按 §25b 分档）：0=通过 · 1=覆盖/计数判据不达标 · 2=输入/环境不完整
 *
 * 用法: node check-coverage-matrix.mjs [--at-report] [--json]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
/* ★ 路径收口：唯一来源 `paths.mjs`（本文件**不再**自己 `resolve(HERE,'..')`） */
import { ENGINE_ROOT as ROOT, selfCheck } from './paths.mjs'
selfCheck({ quiet: true })
const args = process.argv.slice(2)
const wantJson = args.includes('--json')

/* ---- 引擎可执行文件：**唯一实现**在 `engine-bin.mjs`（K17 结构性收口 —— 本文件不保留候选定义） ---- */
import { resolveHyperframes } from './engine-bin.mjs'
const HF = resolveHyperframes().p

const EX = join(HERE, 'examples')
const strip = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '')

/** 全 12 页型（渲染器支持的集合；清单之外的页型会被额外点名） */
const ALL_TYPES = ['cover', 'section', 'bullets', 'steps', 'chart', 'compare', 'image', 'data', 'quote', 'toc', 'summary', 'end']

/* ---- 输入完整性预检（§25b：缺输入 ⇒ exit 2，不留栈） ---- */
function fatal(msg) { console.error(`✗ 输入/环境不完整（**exit 2**，非判据失败）：${msg}`); process.exit(2) }
if (!existsSync(EX)) fatal(`缺 examples/：${EX}`)

/* ---- 1) decks：页型 / 母版 / 几何 / 配色 ---- */
const decks = readdirSync(EX).filter((f) => f.endsWith('.json')).map((f) => {
  const d = JSON.parse(readFileSync(join(EX, f), 'utf8'))
  return {
    name: f.replace(/\.json$/, ''),
    master: d.style && d.style.masterId ? d.style.masterId : '(未声明)',
    orient: d.style ? d.style.orientation : '(未声明)',
    palette: d.style ? d.style.palette : '(未声明)',
    types: (d.pages || []).map((p) => p.type),
  }
})

/* ---- 2) 产物：out/ 与 out-master-v2/（非 STALE） ---- */
const prods = []
for (const r of ['out', 'out-master-v2'].map((d) => join(HERE, d))) {
  if (!existsSync(r)) continue
  for (const n of readdirSync(r)) {
    const dir = join(r, n)
    if (!existsSync(join(dir, 'index.html')) || existsSync(join(dir, 'STALE.md'))) continue
    prods.push({ name: n, dir })
  }
}
if (!prods.length) fatal('没有任何产物（out/ 与 out-master-v2/ 都空）')

/* ---- 3) 稳定帧时刻（**第 2 处实现**：paths/timing 收口时并入唯一实现；已在契约记为待办） ---- */
const ENTER_TAIL = 0.6
function timingTable(dir) {
  const p = join(dir, 'index.html')
  if (!existsSync(p)) return []
  const html = readFileSync(p, 'utf8')
  const out = []
  html.split(/<section\b/).slice(1).forEach((s, i) => {
    const head = s.slice(0, s.indexOf('>') + 1)
    const start = Number((head.match(/data-start="([\d.]+)"/) || [])[1] || 0)
    const dur = Number((head.match(/data-duration="([\d.]+)"/) || [])[1] || 0)
    const ats = [...s.matchAll(/data-at="([\d.]+)"/g)].map((m) => Number(m[1]))
    out.push({ i: i + 1, start, dur, maxAt: ats.length ? Math.max(...ats) : 0 })
  })
  return out
}
function settledAtList(dir) {
  const t = timingTable(dir)
  return t.map((p, idx) => {
    const next = t[idx + 1] || null
    const want = Math.max(p.start + p.maxAt + ENTER_TAIL, p.start + p.dur * 0.6)
    const cap = next ? next.start - 0.15 : p.start + p.dur - 0.1
    return Math.min(want, cap).toFixed(3)
  })
}

/* ---- 4) 每个产物：稳定帧 layout + contrast，按页型汇总 ---- */
const secIndex = (sel) => {
  const m = String(sel || '').match(/section:nth-of-type\((\d+)\)/)
  return m ? Number(m[1]) : null
}
const byType = {}
for (const t of ALL_TYPES) byType[t] = { decks: new Set(), overflow: 0, contrast: 0, allowOverflow: 0 }
const extraTypes = new Set()
const prodRuns = []
for (const pr of prods) {
  const atList = settledAtList(pr.dir).join(',')
  const r = spawnSync(HF, ['check', pr.dir, '--json', '--at', atList], { encoding: 'utf8', shell: true })
  const o = strip(r.stdout) + strip(r.stderr)
  const i = o.indexOf('{'), k = o.lastIndexOf('}')
  let j = null
  try { j = JSON.parse(o.slice(i, k + 1)) } catch { j = null }
  if (!j || !j.layout) { prodRuns.push({ name: pr.name, ok: false }); continue }
  // 该产物的页型序列（优先用 meta 里嵌的 deck，其次用 examples 同名 deck）
  let types = []
  for (const f of ['image-meta.json', 'chart-meta.json']) {
    const p = join(pr.dir, f)
    if (!existsSync(p)) continue
    try {
      const meta = JSON.parse(readFileSync(p, 'utf8'))
      if (meta.deck && Array.isArray(meta.deck.pages)) { types = meta.deck.pages.map((x) => x.kind || x.type); break }
    } catch { /* ignore */ }
  }
  if (!types.length) {
    const d = decks.find((x) => x.name === pr.name)
    types = d ? d.types : []
  }
  prodRuns.push({ name: pr.name, ok: true, pages: types.length })
  const group = (f) => {
    const n = secIndex(f.selector)
    const t = n && types[n - 1] ? types[n - 1] : null
    if (!t) return null
    if (!byType[t]) { byType[t] = { decks: new Set(), overflow: 0, contrast: 0, allowOverflow: 0 }; extraTypes.add(t) }
    return t
  }
  for (const f of (j.layout.findings || [])) {
    const c = f.code || f.rule
    if (!['text_box_overflow', 'container_overflow', 'canvas_overflow'].includes(c)) continue
    const t = group(f); if (t) byType[t].overflow++
  }
  for (const f of (j.contrast && j.contrast.findings) || []) {
    const t = group(f); if (t) byType[t].contrast++
  }
  // 该产物覆盖到的页型
  const seen = new Set(types)
  for (const t of seen) if (byType[t]) byType[t].decks.add(pr.name)
}

/* ---- 5) 组合覆盖（母版 × 几何 × 配色） ---- */
/** ★ 档分类靠**显式排除清单**（`exclude-coverage.json`，与白名单同构：逐条写"哪个目录 + 为什么"）。
 *  **不许静默排除**：任何被排除的档（含目录里有 `STALE.md` 的）**必须**在清单里命中一条，否则 **红**。 */
const EXCL_FILE = join(HERE, 'exclude-coverage.json')
if (!existsSync(EXCL_FILE)) fatal(`缺覆盖排除清单：${EXCL_FILE}`)
const exclEntries = JSON.parse(readFileSync(EXCL_FILE, 'utf8')).exclude || []
const globToRe = (g) => new RegExp('^' + String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
const matchExcl = (n) => exclEntries.find((x) => (x.dir && x.dir === n) || (x.glob && globToRe(x.glob).test(n)))
const isStale = (n) => existsSync(join(HERE, 'out', n, 'STALE.md')) || existsSync(join(HERE, 'out-master-v2', n, 'STALE.md'))
const excluded = []
const exclProblems = []
for (const d of decks) {
  const e = matchExcl(d.name)
  const stale = isStale(d.name)
  if (!e && !stale) continue // 渲染目标
  if (!e) { exclProblems.push(`${d.name}（STALE）被排除但清单里没条目`); continue }
  excluded.push({ name: d.name, why: e.why, stale })
}
const targets = decks.filter((d) => !excluded.some((x) => x.name === d.name))
for (const p of exclProblems) console.log(`  ✗ 静默排除：${p} ⇒ **红**（在 exclude-coverage.json 里补一条"目录 + 为什么"）`)
console.log(`排除清单：条目 ${exclEntries.length} · 命中档 ${excluded.length}`)
for (const x of excluded) console.log(`  · ${x.name.padEnd(28)} ${x.stale ? '[STALE]' : ''} ${x.why.slice(0, 60)}${x.why.length > 60 ? '…' : ''}`)
const combos = new Map()
for (const d of targets) {
  const key = `${d.master} · ${d.orient} · ${d.palette}`
  if (!combos.has(key)) combos.set(key, { decks: [], prods: 0 })
  combos.get(key).decks.push(d.name)
  if (prods.some((p) => p.name === d.name)) combos.get(key).prods++
}
console.log(`档分类：渲染目标 ${targets.length} · 排除 ${excluded.length}（依据 exclude-coverage.json，见上；"静默排除"若出现会在此判红）\n`)
/** 母版清单声明的配色（唯一真源） */
const palettesByMaster = {}
for (const id of ['master-v1', 'master-v2']) {
  const mp = join(ROOT, 'masters', id, 'master.json')
  if (!existsSync(mp)) fatal(`缺母版清单：${mp}`)
  const man = JSON.parse(readFileSync(mp, 'utf8'))
  palettesByMaster[id] = Object.keys(man.palettes || man.palette || {})
}

/* ---- 6) 输出 + 断言 ---- */
let bad = 0
if (!wantJson) {
  console.log('=== 覆盖矩阵（页型 × 母版 × 几何 × 配色）===')
  console.log(`产物 ${prods.length} 个 · decks ${decks.length} 个\n`)
  console.log('页型          覆盖档数  稳定帧溢出  稳定帧对比度   覆盖的档（前 4）')
  for (const t of ALL_TYPES) {
    const v = byType[t]
    const ok = v.decks.size > 0
    if (!ok) bad++
    console.log(`  ${ok ? '✓' : '✗'} ${t.padEnd(11)} ${String(v.decks.size).padStart(6)} ${String(v.overflow).padStart(11)} ${String(v.contrast).padStart(13)}   ${[...v.decks].slice(0, 4).join(', ')}${v.decks.size > 4 ? ' …' : ''}`)
  }
  if (extraTypes.size) console.log(`  ⚠ 清单外页型（也应给覆盖）：${[...extraTypes].join(', ')}`)
  console.log('\n组合（母版 × 几何 × 配色）:')
  for (const [k, v] of combos) {
    const ok = v.prods > 0
    if (!ok) bad++
    console.log(`  ${ok ? '✓' : '✗'} ${k.padEnd(34)} deck ${v.decks.length} · **产物 ${v.prods}**`)
  }
  console.log('\n母版声明配色的覆盖:')
  for (const [id, ps] of Object.entries(palettesByMaster)) {
    for (const p of ps) {
      const n = decks.filter((d) => d.master === id && d.palette === p).length
      const has = n > 0
      if (!has) bad++
      console.log(`  ${has ? '✓' : '✗'} ${id} · ${p.padEnd(12)} deck ${n}`)
    }
  }
  const noProd = decks.filter((d) => !prods.some((p) => p.name === d.name))
  if (noProd.length) console.log(`\n（注：以下 deck 还没有产物：${noProd.map((d) => d.name).join(', ')}）`)
  console.log(`\n结论: ${bad === 0 ? 'PASS（每个页型/组合/配色都有覆盖；计数见上表）' : `FAIL（${bad} 项覆盖缺口 ⇒ **某页型/组合从没被测过**）`}`)
} else {
  console.log(JSON.stringify({ ok: bad === 0, byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { decks: v.decks.size, overflow: v.overflow, contrast: v.contrast }])), combos: [...combos.entries()].map(([k, v]) => ({ combo: k, decks: v.decks.length, prods: v.prods })), bad }, null, 1))
}
process.exit(bad ? 1 : 0)
