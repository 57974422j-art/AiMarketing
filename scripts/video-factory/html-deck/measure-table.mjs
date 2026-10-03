#!/usr/bin/env node
/**
 * measure-table.mjs —— 内容上限表的**批量驱动器**（team-lead ③ 的"成本解法"）
 *
 * 口径（team-lead 裁定）：
 *   · **第一路（HTML 注入 `measure-sweep.mjs`）用来"找边界"**（快：二分 + ±1 验证）；
 *   · **第二路（deck JSON 真渲染 `crosscheck-deck-json.mjs`）只确认 临界 / 临界+1 两个点**（每格 2 次渲染）；
 *   · **以第二路为准**（源头路）；第一路作一致性复核（两路不一致 ⇒ 先查注入方式是否引入偏差）。
 *
 * 每格输出列：页型 / 字段 / 检测点 / 临界 / 临界+1 / 依据判据码 / 页号+时刻 / 读回 / 帧是否换过 / 备注
 *   并附 **第二路的 `GATE-RESULT` 原文**（可追溯）与**对拍结论**（工具 exit ↔ 闸门自报）。**两路各自 exit** 一并打印。
 *
 * 用法：
 *   node measure-table.mjs --deck master-v1 [--cells cover.title,cover.sub,…] [--out <md 路径>]
 * 说明：本文件只声明"格子清单"（页型 + 字段路径 + 检测点 class）；**不许**在这里另写判据（判据的唯一实现在闸门/量表）。
 */
import { existsSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DECK_DIR } from './paths.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const NODE = process.execPath
const args = process.argv.slice(2)
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const DECK = arg('--deck', 'master-v1')
const ONLY = arg('--cells', '')
const OUTMD = arg('--out', '')

/* ---------- 格子清单（唯一来源；页型 → 字段路径 → 检测点）----------
   ⚠️ 已知缺口（如实记，不掩盖）：**同一 class 跨页**（如两个 `.h2`）时，现有工具取**首个匹配** ⇒
   本清单**故意不列** data 页的 `title`（2 号 `.h2`），改用该页**唯一 class**（`.bignum` / `.p3-body`）。
   要覆盖它需给量表/工具加 **`--occur <n>`（第 n 个匹配）**，届时再补这一格。 */
const DECKS = {
  'master-v1': {
    json: 'examples/deck.master-v1.json',
    product: 'out/deck.master-v1',
    cells: [
      { id: 'cover.title', pt: 'cover', field: 'meta.title', cls: 'cover-title' },
      { id: 'cover.sub', pt: 'cover', field: 'meta.subtitle', cls: 'cover-sub' },
      { id: 'cover.kicker', pt: 'cover', field: 'pages.0.kicker', cls: 'kicker' },
      { id: 'cover.issuer', pt: 'cover', field: 'meta.issuer', cls: 'issuer' },
      { id: 'bullets.title', pt: 'bullets', field: 'pages.1.title', cls: 'p2-head h2' },
      { id: 'bullets.item0', pt: 'bullets', field: 'pages.1.items.0', cls: 'li:first-child .t' },
      { id: 'bullets.summary', pt: 'bullets', field: 'pages.1.summary', cls: 'p2-sum' },
      { id: 'data.explain', pt: 'data', field: 'pages.2.metric.explain', cls: 'p3-body' },
      /* ⚠️ data 页还有两处**待确认 class↔字段映射**（本批不列，避免量错对象）：
         `metric.number`（大数字 → `.bignum`/`span.digit`）· `secondary[0].label`/`.note`（次要指标）。
         确认映射后补格（读回校验会自动挡住"量错对象"，但仍先确认再列）。 */
      { id: 'end.line1', pt: 'end', field: 'pages.3.line1', cls: 'p4-line:first-child' },
      { id: 'end.cta', pt: 'end', field: 'pages.3.cta', cls: 'p4-cta' },
      { id: 'end.en', pt: 'end', field: 'pages.3.en', cls: 'p4-en' },
    ],
  },
}

const spec = DECKS[DECK]
if (!spec) { console.error(`✗ 未知 deck 规格「${DECK}」（可选：${Object.keys(DECKS).join(', ')}）⇒ exit 2`); process.exit(2) }
const product = resolve(DECK_DIR, spec.product)
if (!existsSync(join(product, 'index.html'))) { console.error(`✗ 产物不存在：${spec.product}（先跑闸门 --render）⇒ exit 2`); process.exit(2) }
const cells = ONLY ? spec.cells.filter((c) => ONLY.split(',').map((s) => s.trim()).includes(c.id)) : spec.cells
if (!cells.length) { console.error('✗ --cells 没匹配到任何格子 ⇒ exit 2'); process.exit(2) }

const run = (script, argv) => {
  const r = spawnSync(NODE, [join(HERE, script), ...argv], { cwd: HERE, encoding: 'utf8' })
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') }
}

console.log(`=== 内容上限表（批量驱动）· deck=${DECK} · 产物=${spec.product} · ${cells.length} 格 ===`)
const rows = []
for (const c of cells) {
  // ---- 第一路：找边界（快） ----
  const A = run('measure-sweep.mjs', [spec.product, c.cls, '120'])
  const mA = /临界字数 = (\d+) 字/.exec(A.out)
  const crit = mA ? Number(mA[1]) : null
  /* 解析（收窄，避免把 markdown 星号/括号吃进来）：依据只取标识符序列；页号/时刻/读回/帧换过按字面取 */
  const basisA = (/依据 = ([a-z_,\s]+)/.exec(A.out) || [])[1] || ''
  const pageA = (/\u9875\u53f7 = (\d+)/.exec(A.out) || [])[1] || ''
  const atA = (/时刻 = ([\d.]+)s/.exec(A.out) || [])[1] || ''
  const rbA = (/读回 = (\d+)\//.exec(A.out) || [])[1] || ''
  const frameA = ((/帧是否换过 = (是|否)/.exec(A.out) || [])[1]) || ((/帧换过 = (是|否)/.exec(A.out) || [])[1]) || ''
  /* ★ 记 **正控 k**（team-lead ③-3）：正控 k 与临界的量级关系本身就是"字段容量"的有用数据 */
  const posK = (Number((/触发于 \*\*k=(\d+)\*\*/.exec(A.out) || [])[1]) || null)
  const posPath = ((/正控：倍增路径 (.+?) ⇒/.exec(A.out) || [])[1] || '')
  // ---- 第二路：只确认 临界 / 临界+1 ----
  let B = { code: null, out: '(未跑：第一路没拿到临界)' }, bRows = []
  if (crit != null) {
    /* ⚠️ `--ks` 必须是**一个** argv（`"37,38"`）：第一版拆成两个 ⇒ 工具只读到 37 ⇒ 临界+1 恒缺（解析没错，参数错） */
    B = run('crosscheck-deck-json.mjs', ['--json', spec.json, '--field', c.field, '--cls', c.cls, '--ks', `${crit},${crit + 1}`])
    /* 逐行扫描更稳（行式解析，不靠跨行滑窗）：
       行 A：`k= 37 · … 读回 37/37 ✓ · … codes = []`
       行 B（下一行）：`闸门真源：GATE-RESULT {…}` */
    const bl = B.out.split('\n').map((s) => s.trim())
    for (let i = 0; i < bl.length; i++) {
      const m = /^k=\s*(\d+)\b.*?读回 (\d+)\/(\d+).*?codes = \[([^\]]*)\]/.exec(bl[i])
      if (!m) continue
      const grLine = (bl[i + 1] || '').startsWith('闸门真源：') ? bl[i + 1] : (bl.slice(i + 1).find((s) => s.includes('GATE-RESULT')) || '')
      const gm = /GATE-RESULT\s+(\{[^\n]*\})/.exec(grLine)
      let ok = null
      try { ok = gm ? JSON.parse(gm[1]).ok : null } catch { ok = null }
      bRows.push({ k: Number(m[1]), back: Number(m[2]), want: Number(m[3]), codes: m[4].trim(), gr: gm ? `GATE-RESULT ${gm[1]}` : '(无 GATE-RESULT)', ok })
    }
  }
  const bCrit = bRows.find((r) => r.k === crit)
  const bNext = bRows.find((r) => r.k === (crit + 1))
  const judge = ['text_box_overflow', 'container_overflow', 'canvas_overflow', 'content_overlap', 'decor_content_collision']
  const basisB = bNext ? bNext.codes.split(',').map((s) => s.trim()).filter((s) => judge.includes(s)) : []
  const pairOk = /对拍 0 处不一致|对拍不一致：0/.test(B.out) || !/对拍不一致/.test(B.out)
  const tamperOk = !/测量期产物被改写/.test(B.out)
  let note = ''
  if (crit == null) note = '**第一路没给出临界**（看原始输出）'
  else if (!bRows.length) note = '第二路未取到读数'
  else if (!pairOk) note = '**对拍不一致 ⇒ 该格读数不可信**'
  else if (!tamperOk) note = '**测量期产物被改写 ⇒ 读数作废**'
  else if (!basisB.length) note = '⚠️ 临界+1 的失败里**无判据码**（= 非判据码意见 ⇒ 不入表，见 §25c）'
  rows.push({ c, crit, basisA: basisA.trim(), pageA, atA, rbA, frameA, exitA: A.code, bCrit, bNext, basisB, pairOk, tamperOk, note })

  const fmt = (r) => r ? `k=${r.k} 读回 ${r.back}/${r.want} codes=[${r.codes}] ok=${r.ok}` : '—'
  console.log(`\n  ── [${c.pt}] ${c.id}（字段 ${c.field} · 检测点 .${c.cls}）`)
  console.log(`     第一路：临界 = ${crit ?? '?'} · 依据 = ${basisA.trim() || '(无)'} · 页 ${pageA || '?'} · t=${atA || '?'}s · 读回 ${rbA || '?'} · 帧换过 = ${frameA || '?'} · 正控k=${posK ?? '?'}（路径 ${posPath || '?'}） · exit=${A.code}`)
  console.log(`     第二路：${fmt(bCrit)} ｜ ${fmt(bNext)} · 两路对拍 ${pairOk ? '✓' : '✗'} · 防篡改 ${tamperOk ? '✓' : '✗'} · exit=${B.code}`)
  if (bNext) console.log(`             ${bNext.gr}`)
  if (note) console.log(`     备注：${note}`)
}

/* 汇总表（markdown） */
const md = []
md.push(`| 页型 | 字段 | 检测点 | 临界 | 临界+1 | 依据判据码 | 页号+时刻 | 读回 | 帧换过 | 备注 |`)
md.push(`|---|---|---|---|---|---|---|---|---|---|`)
for (const r of rows) {
  md.push(`| ${r.c.pt} | \`${r.c.field}\` | \`${r.c.cls}\` | ${r.crit ?? '?'} | ${r.crit != null ? r.crit + 1 : '?'} | ${r.basisB.join(' ∪ ') || r.basisA || '—'} | 页${r.pageA}@${r.atA}s | ${r.rbA || '?'} | ${r.frameA || '?'} | ${r.note || '✓ 两路一致'} |`)
}
console.log('\n' + md.join('\n'))
if (OUTMD) { writeFileSync(resolve(DECK_DIR, OUTMD), md.join('\n') + '\n', 'utf8'); console.log(`\n  表已写入 ${OUTMD}`) }
const bad = rows.filter((r) => r.crit == null || !r.basisB.length || !r.pairOk || !r.tamperOk)
console.log(`\n  ⇒ ${rows.length} 格中 ${rows.length - bad.length} 格可入表（临界+1 有判据码 · 两路对拍通过 · 未遭篡改）`)
process.exit(0)
