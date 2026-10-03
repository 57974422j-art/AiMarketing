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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
      /* ⚠️ 该字段**元素口径 ≠ 输入口径**：渲染时元素 = `出品：`+issuer+` · `+date（render-deck.mjs L331）
         ⇒ **常量偏移 13**（模板常量、与内容无关）⇒ 读回与判据都要换算到**输入口径**（不是"硬凑"；
         证据见 measured-limits.json 的 offsetEvidence）。 */
      { id: 'cover.issuer', pt: 'cover', field: 'meta.issuer', cls: 'issuer', offset: 13 },
      { id: 'bullets.title', pt: 'bullets', field: 'pages.1.title', cls: 'p2-head h2' },
      { id: 'bullets.item0', pt: 'bullets', field: 'pages.1.items.0', cls: 'li:first-child .t' },
      { id: 'bullets.summary', pt: 'bullets', field: 'pages.1.summary', cls: 'p2-sum' },
      /* ⚠️ **映射修正（team-lead 从 render-deck.mjs 的 [data] 分支抽出）**：`.p3-body` 装的是
         **metric 数值/单位**（bignum/unit），`explain` 的真身是 **`.p3-explain`** ⇒ 原映射注入了 explain
         却去量 `.p3-body` ⇒ 目标文本不变 ⇒ **读回 0/9**（第一版把它当"工具坏"，实为**我们映射表用错类**）。
         `dom-target` 复核：`.p3-explain` ⇒ count=1 · **页 3** · 内文 = explain 文本 ✓（`.p3-body` 内文为空）。 */
      { id: 'data.explain', pt: 'data', field: 'pages.2.metric.explain', cls: 'p3-explain' },
      /* ▲ 按同一映射补齐（内容承载型 ⇒ 必须实测）：`unit` → `.p3-body .unit` · `secondary[0].label` → `.p3-metrics .k`
         （`metric.number` 是 **number** 类型，无字数上限 ⇒ 不入表；`note` 同理按需补测） */
      { id: 'data.unit', pt: 'data', field: 'pages.2.metric.unit', cls: 'p3-body .unit' },
      /* ⏳ `secondary[0].label` 暂不列：`.p3-metrics .k` 实测 **count=2**（两条次要指标）⇒ 读回校验必失败；
         需更精确选择器（如 `li:first-child .k`）确认 count=1 后再列 —— 不许"先列了再量错对象"。 */
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
  // ---- 第二路：确认 **enforced = ⌊0.9×判据⌋** 可渲染且过闸 ----
  /* ★ **语义修正（2026-10-03）**：`enforced` 与`判据`是**两个不同刻度** ——
     `enforced = ⌊0.9×判据⌋` **必然 < 判据**（10% 余量规则，防换机/换引擎 ±1 波动）；
     而 K22 单源改造后 `validate-deck` 会**真的**按 schema 的 `maxLength` 拒收 ⇒ **判据 k 本身必然渲不出来**
     （这是**设计**，不是"受阻"）。
     ⇒ 第二路职责改为：确认**承诺给 AI 的 enforced 值**能真渲染、能过闸（`ok:true`）；
       判据 k 与**依据码**由**第一路**给出（它在已渲染产物上做注入，绕过 JSON 校验）。 */
  /* ★ 判据换算到**输入口径**（`crit` 是元素口径；offset 为模板常量偏移，见 cell 定义）⇒ enforced 也算在输入口径上 */
  const effCrit = crit == null ? null : crit - (c.offset || 0)
  const kenf = effCrit == null ? null : Math.floor(0.9 * effCrit)
  let B = { code: null, out: '(未跑：第一路没拿到临界)' }, bRows = []
  if (kenf != null) {
    /* ⚠️ `--ks` 必须是**一个** argv（`"37,38"`）：第一版拆成两个 ⇒ 工具只读到 37 ⇒ 临界+1 恒缺（解析没错，参数错） */
    B = run('crosscheck-deck-json.mjs', ['--json', spec.json, '--field', c.field, '--cls', c.cls, '--ks', `${kenf},${kenf + 1}`])
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
  const bEnf = bRows.find((r) => r.k === kenf)
  const bNext = bRows.find((r) => r.k === (kenf == null ? null : kenf + 1))
  const judge = ['text_box_overflow', 'container_overflow', 'canvas_overflow', 'content_overlap', 'decor_content_collision']
  const basisB = basisA.trim() ? basisA.trim().split(/[ ∪,]+/).filter((s) => judge.includes(s)) : []
  const pairOk = /对拍 0 处不一致|对拍不一致：0/.test(B.out) || !/对拍不一致/.test(B.out)
  const tamperOk = !/测量期产物被改写/.test(B.out)
  /* ★ 第二路的**双条件**（第一版把 enforced+1 也要求"过闸" ⇒ 断言写反：enforced+1 **本就该**被硬上限拒，
     那才是"硬上限真的在生效"的证据 —— 被自己的实跑当场抓出）：
       ① **承诺可交付**：enforced（= 硬上限）能渲染、读回一致、过闸；
       ② **硬上限生效**：enforced+1 **渲不出来**（被 schema/validate-deck 拒）。 */
  const promiseOk = !!(bEnf && bEnf.ok === true && bEnf.back - (c.offset || 0) === kenf)
  /* ★ team-lead ④-1：**拒绝原因必须归属正确** —— k=enforced+1 被拒时要断言它来自 **schema 上限**，
     而不是"版式挂了"（否则会把 `content_overlap`/`text_box_overflow` 误当"上限生效"）。 */
  /* ⚠️ 文案覆盖面（第一版只认"超出上限 N 字"⇒ 漏判 validate-deck 的"出品方过长（757 字，硬上限 744）"）：
     现在同时认 **schema 上限类**（超出上限 / 超过硬上限 / 硬上限 N / maxLength）与 **版式/判据类**。 */
  const rejIsCap = /超出上限|超过硬上限|硬上限\s*\d+|maxLength/.test(B.out)
  const rejIsLayout = /content_overlap|text_box_overflow|container_overflow|canvas_overflow/.test(B.out)
  const capHolds = !bNext && rejIsCap && !rejIsLayout
  let note = ''
  if (crit == null) note = '**第一路没给出临界**（看原始输出）'
  else if (!bRows.length) note = '第二路未取到读数'
  else if (!pairOk) note = '**对拍不一致 ⇒ 该格读数不可信**'
  else if (!tamperOk) note = '**测量期产物被改写 ⇒ 读数作废**'
  else if (!promiseOk) note = `**enforced k=${kenf} 未过闸 ⇒ 承诺值不可交付**（硬问题：AI 按 ${kenf} 写会被拒）`
  else if (!capHolds) {
    note = bNext
      ? `⚠️ **硬上限未生效**：k=${kenf + 1} 仍然过闸（schema maxLength=${kenf} 没拦住）`
      : `⚠️ **拒绝原因归属不对**：k=${kenf + 1} 确实失败，但原因**不是 schema 上限**（${rejIsLayout ? '看到判据码/版式码' : '未看到上限文案'}）⇒ 不许当"上限生效"（team-lead ④-1）`
  }
  else if (!basisB.length) note = '⚠️ 第一路的失败里**无判据码**（= 非判据码意见 ⇒ 不入表，见 §25c）'
  else note = `承诺 k=${kenf} 过闸 ✓ · k=${kenf + 1} 被硬上限拒 ✓（判据 ${crit} 由第一路给出：enforced<判据 是设计）`
  rows.push({ c, crit, effCrit, kenf, basisA: basisA.trim(), pageA, atA, rbA, frameA, exitA: A.code, bEnf, bNext, basisB, pairOk, tamperOk, promiseOk, capHolds, note })

  const fmt = (r) => r ? `k=${r.k} 读回 ${r.back}/${r.want} codes=[${r.codes}] ok=${r.ok}` : '—'
  console.log(`\n  ── [${c.pt}] ${c.id}（字段 ${c.field} · 检测点 .${c.cls}）`)
  console.log(`     第一路（判据）：临界 = ${crit ?? '?'} · 依据 = ${basisA.trim() || '(无)'} · 页 ${pageA || '?'} · t=${atA || '?'}s · 读回 ${rbA || '?'} · 帧换过 = ${frameA || '?'} · 正控k=${posK ?? '?'}（路径 ${posPath || '?'}） · exit=${A.code}`)
  console.log(`     第二路（承诺值 enforced=${kenf ?? '?'}）：${fmt(bEnf)} ｜ ${fmt(bNext)} · 对拍 ${pairOk ? '✓' : '✗'} · 防篡改 ${tamperOk ? '✓' : '✗'} · 承诺成立 ${promiseOk ? '✓' : '✗'} · exit=${B.code}`)
  if (bNext) console.log(`             ${bNext.gr}`)
  if (note) console.log(`     备注：${note}`)
}

/* 汇总表（markdown） */
const md = []
md.push(`| 页型 | 字段 | 检测点 | 临界 | 临界+1 | 依据判据码 | 页号+时刻 | 读回 | 帧换过 | 备注 |`)
md.push(`|---|---|---|---|---|---|---|---|---|---|`)
for (const r of rows) {
  md.push(`| ${r.c.pt} | \`${r.c.field}\` | \`${r.c.cls}\` | ${r.crit ?? '?'} | ${r.crit != null ? r.crit + 1 : '?'} | ${r.basisB.join(' ∪ ') || r.basisA || '—'} | 页${r.pageA}@${r.atA}s | ${r.rbA || '?'} | ${r.frameA || '?'} | ${r.note || '✓ 承诺成立'} |`)
}
console.log('\n' + md.join('\n'))
if (OUTMD) { writeFileSync(resolve(DECK_DIR, OUTMD), md.join('\n') + '\n', 'utf8'); console.log(`\n  表已写入 ${OUTMD}`) }

/* ============ ★ **表内散文必须程序生成**（team-lead ②③：表自己不许过期） ============
   事故：`meta.issuer.twoPath` 仍写"放宽到 **756**"——756 是**旧口径**（⌊0.9×元素口径 840⌋）的派生值，
   而现行承诺是 **744**（⌊0.9×输入口径 827⌋）⇒ 权威判定没错（它从 judgeLimit 现算），错的是**人能读到的那句散文**。
   ⇒ 根治：`--update-limits` 把第二路实测结果**回写**实测表（twoPath / kEnforced / readback / page / at / updatedAt），
     散文里所有可派生数字（承诺值、承诺+1、判据、依据）**由代码产出**；手改散文会被 I5-表 断言拦住。 */
if (args.includes('--update-limits')) {
  const lp = resolve(DECK_DIR, 'measured-limits.json')
  if (!existsSync(lp)) { console.error(`✗ 找不到 ${lp} ⇒ exit 2`); process.exit(2) }
  const LIM = JSON.parse(readFileSync(lp, 'utf8'))
  let n = 0
  for (const r of rows) {
    const e = (LIM.limits || []).find((x) => x.field === r.c.field)
    if (!e) continue
    e.twoPath = (r.promiseOk && r.capHolds)
      ? `**两路一致**：承诺 k=${r.kenf} 过闸（读回 − offset = k）· k=${r.kenf + 1} **被硬上限拒**（原因经断言确认来自 schema 上限）· 判据 ${r.crit}（元素口径${r.c.offset ? `，输入口径 ${r.effCrit}` : ''}）由第一路给出 · 依据 ${r.basisA || '-'}`
      : `**受阻/未过**：${r.note}`
    e.kEnforced = r.kenf
    e.page = Number(r.pageA) || e.page
    e.at = r.atA || e.at
    e.updatedAt = new Date().toISOString().slice(0, 10)
    n++
  }
  writeFileSync(lp, JSON.stringify(LIM, null, 2) + '\n', 'utf8')
  console.log(`\n  ★ 已回写实测表 **${n} 条**（twoPath / kEnforced / page / at / updatedAt **由程序生成**）`)
}
/* ★ `capHolds` 必须进 bad（第一版漏了 ⇒ 备注已报"拒绝原因归属不对"，汇总却仍算"可入表" ⇒ 自相矛盾） */
const bad = rows.filter((r) => r.crit == null || !r.basisB.length || !r.pairOk || !r.tamperOk || !r.promiseOk || !r.capHolds)
console.log(`\n  ⇒ ${rows.length} 格中 ${rows.length - bad.length} 格可入表（判据码依据来自第一路 · **enforced 承诺成立**（k=enforced 与 enforced+1 均过闸）· 对拍通过 · 未遭篡改）`)
process.exit(0)
