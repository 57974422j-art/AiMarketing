#!/usr/bin/env node
/**
 * measure-sweep.mjs —— **临界字数实测（递增 + 二分）**，产出"内容上限"那把尺子的原始数据
 *
 * 判据（team-lead 定）：**稳定帧上** (`text_box_overflow` ∪ `container_overflow` ∪ `canvas_overflow` ∪ `content_overlap`)
 *   **减白名单** = 0 才算"该字段装得下" ⇒ 临界字数 = 仍满足判据的**最大字数**。
 *
 * 为什么要它：`measure-limits.mjs` 只做到"证明量具能失败"（步骤 0）。本脚本把"固定注入一次"升级为
 *   **按字数递增 → 二分收敛**，逐字段求出临界值；再 `×0.9` 落进 `deck.schema.json` 的 `maxLength`。
 *
 * 注入方式：把目标元素的文本整体替换为 **等宽 CJK 填充字**（`汉` × k）——
 *   ① 统一字形宽度 ⇒ "字数"可比（schema 的 maxLength 本来就是以字计 ✓）
 *   ② 只改文本、不动版式参数 ⇒ 变量单一（这是"重新测一把尺子"而不是"改设计"）
 *
 * 运行目录：**系统临时目录**（`<tmp>/html-deck-sweep/`）⇒ 不弄脏仓库（K18 纪律）
 *
 * 用法: node measure-sweep.mjs <productDir> <cssClass> [maxK]
 *      例: node measure-sweep.mjs out/deck.master-v1 cover-title 240
 *      `productDir` 相对**引擎根**（入库树扁平后 = 本目录）；`cssClass` 是产物 HTML 里的类名（不含点）
 * 退出码: 0 = 量到临界 · 1 = 判据不成立（连最小字数都装不下）· 2 = 输入/环境不完整（§25b）
 */
import { readFileSync, writeFileSync, existsSync, cpSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ENGINE_ROOT, DECK_DIR, selfCheck } from './paths.mjs'
import { resolveHyperframes } from './engine-bin.mjs'
/* ★ 时序**唯一实现**（team-lead ②）：本文件不再硬编码 `--at 1.0`，也不再自带时序公式 */
import { settledAt, settledAtList, pageNoOfSelector, pageOfTime, timingTable } from './timing.mjs'

selfCheck({ quiet: true })
const HF = resolveHyperframes().p
const strip = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '')
const stderrOf = (r) => (r && (r.stderr || r.stdout)) || ''

const argv = process.argv.slice(2)

/* ---------- `--calibrate <productDir> <cssClass> <k>`：用**已知校准点**证"读法对不对" ----------
   team-lead 定的三条检查（都在这里做，且都打印原始证据）：
     ① 注入**真的生效**：改完读回目标元素文本长度，**必须 == k**（否则一切读数无意义）
     ② 两种取 JSON 路径：`--json` 与 `--json --at <时刻>` ⇒ 打印 **layout 分节的 ok/errorCount/totalIssueCount/findings 条数与 code**
     ③ 不复现就不许二分：把 `--at` 版的 findings 与基准期望（84 字 ⇒ 3 条：text_box_overflow/overlap/canvas）对比，**不匹配就停** */
if (argv[0] === '--calibrate') {
  const [, cDirArg, cCls, cK] = argv
  if (!cDirArg || !cCls || !cK) { console.error('用法: node measure-sweep.mjs --calibrate <productDir> <cssClass> <k>'); process.exit(2) }
  const k = Number(cK)
  const src = join(ENGINE_ROOT, cDirArg)
  const c = build(k, src, cCls)
  if (!c.dir) { console.error(`✗ ${c.why}`); process.exit(2) }
  // ① 读回：把注入后的产物再解析一次，数目标元素的**文本长度**
  const back = readFileSync(join(c.dir, 'index.html'), 'utf8')
  const br = new RegExp(`<([a-z0-9]+)\\b[^>]*class="[^"]*\\b${cCls}\\b[^"]*"[^>]*>([\\s\\S]*?)</\\1>`, 'i').exec(back)
  const backLen = br ? br[2].replace(/<[^>]+>/g, '').trim().length : -1
  console.log(`\n=== 校准：${cDirArg} · .${cCls} · k=${k} ===`)
  console.log(`  ① 注入读回：目标元素文本长度 = ${backLen} ${backLen === k ? '✓ 生效' : `✗ 期望 ${k} ⇒ **注入没生效，读数无意义**`}`)
  console.log(`  ② 引擎 JSON 两种取法：`)
  for (const withAt of [false, true]) {
    const r = spawnSync(HF, ['check', c.dir, '--json', ...(withAt ? ['--at', (process.env.SWEEP_AT || '1.0')] : []), '--no-contrast'], { encoding: 'utf8', shell: true })
    const out = strip(r.stdout)
    const i = out.indexOf('{')
    let j = null
    if (i >= 0) { try { j = JSON.parse(out.slice(i)) } catch { /* raw */ } }
    const lay = j && j.layout
    const fs = (lay && Array.isArray(lay.findings)) ? lay.findings : []
    console.log(`   · ${withAt ? `--at ${process.env.SWEEP_AT || '1.0'}` : '（无 --at）'} ⇒ exit=${r.status} · layout=${lay ? `ok=${lay.ok} errorCount=${lay.errorCount} totalIssueCount=${lay.totalIssueCount} findings=${fs.length}[${fs.slice(0, 6).map((x) => x.code).join(', ')}${fs.length > 6 ? ', …' : ''}]` : '**无 layout 段**'}`)
    if (fs.length) {
      const t = fs.find((x) => /text_box_overflow/.test(String(x.code))) || fs[0]
      console.log(`       首条：code=${t.code} · selector=${t.selector || '-'} · overflow=${JSON.stringify(t.overflow || null)} · fixHint=${String(t.fixHint || '').slice(0, 120)}`)
    }
    if (!j) console.log(`       ⚠️ JSON 不可解析 ⇒ stdout 前 200 字：${out.slice(0, 200).replace(/\s+/g, ' ')}`)
  }
  console.log(`  ⇒ 基准期望（84 字那档）：findings=3 · code 含 text_box_overflow + content_overlap + canvas_overflow · text_box_overflow.overflow.bottom ≈ 41.58`)
  console.log(`  ⇒ 判读：若本档 k=${k} 与基准的"同 k 同产物"结果不一致 ⇒ **是读法/口径问题，先别二分**（team-lead 口径 ③）`)
  process.exit(0)
}

const [dirArg, cls, maxArg] = argv
if (!dirArg || !cls) {
  console.error('用法: node measure-sweep.mjs <productDir> <cssClass> [maxK]')
  console.error('      node measure-sweep.mjs --calibrate <productDir> <cssClass> <k>')
  process.exit(2)
}
const SRC = join(ENGINE_ROOT, dirArg)
const MAXK = Number(maxArg || 240)
/* ★ 时刻**不硬编码**（team-lead ②）：默认由 `timing.mjs` 按"该字段所在页"算；`SWEEP_AT` 仅作**显式覆盖**（自证/对比用） */
const AT_FORCE = process.env.SWEEP_AT || ''
let SUBFAIL = 0   // ⊆ 断言失败标记（决定最终退出码）
// 工作目录：**仓库内** `out-sweep/`（已被 `.gitignore` 的 `out*/` 覆盖 ⇒ 不弄脏提交集 ✓；
//  实测：放到系统临时目录时引擎会因"字体映射不可解析"给出空 findings 的假绿 ✗)
const WORK = join(ENGINE_ROOT, 'out-sweep')
function WORKROOT() { return process.env.TEMP || process.env.TMP || '/tmp' }

if (!existsSync(join(SRC, 'index.html'))) {
  console.error(`✗ 输入不完整：${SRC}/index.html 不存在（§25b ⇒ exit 2，非判据失败）`)
  process.exit(2)
}

/** 白名单（引擎三码的"设计性裁剪"；本脚本只做**减白名单**这一步，与闸门同口径） */
/** ★ 白名单 = **溢出白名单 ∪ 重叠白名单**（`allowlist-overflow.json` + `allowlist-overlap.json`）——
 *  必须与闸门（`check-engine-lint.mjs --assert-overlap`）**同一集合**，否则"内容上限"两处口径不同 ⇒ 不可复核。 */
const ALLOW = (() => {
  const load = (f) => {
    try { return JSON.parse(readFileSync(join(DECK_DIR, f), 'utf8')).allow || [] } catch { return [] }
  }
  return [...load('allowlist-overflow.json'), ...load('allowlist-overlap.json')]
})()
const JUDGE = new Set(['text_box_overflow', 'container_overflow', 'canvas_overflow', 'content_overlap'])

/** 造一个"注入 k 字"的临时产物目录 */
function build(k, srcDir, clsHint) {
  // ★ 目录层级敏感（实测）：`<引擎根>/out-sweep-kN`（**一层**）能被引擎正常检查；
  //   放到 `<引擎根>/out-sweep/kN`（两层）时引擎给出**空 findings 的假绿** ✗ ⇒ 必须一层。
  const dir = join(ENGINE_ROOT, `out-sweep-k${k}`)
  const base = srcDir || SRC
  cpSync(base, dir, { recursive: true, force: true })
  const f = join(dir, 'index.html')
  let html = readFileSync(f, 'utf8')
  const useCls = clsHint || cls
  const re = new RegExp(`(<([a-z0-9]+)\\b[^>]*class="[^"]*\\b${useCls}\\b[^"]*"[^>]*>)([\\s\\S]*?)(</\\2>)`, 'i')
  const m = re.exec(html)
  if (!m) return { dir: null, why: `产物 HTML 里找不到 .${useCls}（检测点失效）` }
  html = html.slice(0, m.index) + m[1] + '汉'.repeat(k) + m[4] + html.slice(m.index + m[0].length)
  writeFileSync(f, html, 'utf8')
  return { dir, why: 'ok' }
}

/** 跑引擎 lint（**稳定帧时刻 = `timing.mjs` 唯一实现**：该字段**所在页**的稳定帧）
 *  ★ team-lead ② 护栏 1/2：**时刻不许硬编码**（旧版写死 `--at 1.0`）⇒ 按"该字段所在页"算，并**打印页号+时刻**。 */
function probe(dir) {
  const no = pageNoOfSelector(dir, cls) || 1
  const st = settledAt(dir, no)
  if (!st) {                                   // ★ 算不出时刻 ⇒ **不许退回硬编码**（§25b：环境/输入不完整 ⇒ exit 2）
    console.error(`✗ 无法从产物解析时序（${dir}）⇒ 时刻不可确定 ⇒ **不许硬编码**（exit 2）`)
    process.exit(2)
  }
  const at = AT_FORCE || st.at.toFixed(3)
  const r = spawnSync(HF, ['check', dir, '--json', '--at', at, '--no-contrast'], { encoding: 'utf8', shell: true })
  const out = strip(r.stdout)
  const i = out.indexOf('{')
  let j = null
  if (i >= 0) { try { j = JSON.parse(out.slice(i)) } catch { /* 保留 raw */ } }
  // ★ 不许静默：引擎**没给可解析 JSON** 时不能当成"装得下"（第一版就踩了 ⇒ 报出假的 120 ✗）
  if (!j || !j.layout) {
    return {
      exit: r.status, findings: [], hits: [], unknown: true, at, no, violation: st ? st.violation : null,
      bad: [{ code: '(未知：引擎没有可解析 JSON 输出)', fixHint: `${strip(stderrOf(r)).slice(0, 300)}`, overflow: null }],
      raw: strip(stderrOf(r)).slice(0, 400),
    }
  }
  // ★ 第二处"不许静默"（第一处修完仍报假 200 ⇒ 这次补上）：引擎自报 **ok=false / errorCount>0** 时
  //   即便 findings 为空也算**未通过**（实测 tmp 目录里引擎会警告字体映射不可解析 ⇒ 那种"空 findings"是假绿 ✗）
  const fs = (j && j.layout && Array.isArray(j.layout.findings)) ? j.layout.findings : []
  const layoutBad = (j.layout.ok === false) || (Number(j.layout.errorCount || 0) > 0)
  const hits = fs.filter((x) => x && JUDGE.has(String(x.code || '')))
  if (layoutBad && hits.length === 0) {
    /* ★ 保守：**引擎自报不通过** ⇒ 一律算"该格不过"（绝不当成装得下）。
       ⚠️ 旧版这里返回 `unknown: true` ⇒ 二分里遇到就**中止**；实测在"页边界"稳定帧（cap = 下一页淡入 − 0.15s）
       上这很常见 ⇒ 会让整个量表跑不动。现改为**保守失败 + 计数**（不中止），并在小结里打印 `engineNotOk` 格数。 */
    return {
      exit: r.status, findings: fs, hits, unknown: false, engineNotOk: true, at, no, violation: st ? st.violation : null,
      bad: [{ code: `(引擎自报不通过：ok=${j.layout.ok} errorCount=${j.layout.errorCount}，但无判据内 findings ⇒ 保守算不过)`, fixHint: strip(stderrOf(r)).slice(0, 300), overflow: null }],
      raw: strip(stderrOf(r)).slice(0, 400),
    }
  }
  // ★ 白名单匹配必须与**真闸门同口径**（`check-engine-lint.mjs` L266-269）：
  //   `(!a.code || a.code === f.code) && (!a.selector || f.selector.includes(a.selector))`
  //   ⚠️ 我第一版写成 `a.className`，而清单字段是 `selector` ⇒ `!a.className` 恒真 ⇒ **每条 finding 都被豁免** ⇒
  //      判据恒空 ⇒ sweep 一路"过"到搜索上限（**假绿**，又被我自己的正控抓出来）。
  const allowHit = (x) => ALLOW.some((a) => (!a.code || a.code === String(x.code || '')) && (!a.selector || String(x.selector || '').includes(a.selector)))
  const bad = hits.filter((x) => !allowHit(x))
  return { exit: r.status, findings: fs, hits, bad, raw: strip(r.stderr).slice(0, 400), at, no, violation: st ? st.violation : null }
}

console.log(`=== 临界字数实测（二分）===`)
console.log(`  产物 = ${dirArg} · 字段 = .${cls} · 稳定帧时刻 = **按 timing.mjs 唯一实现（该字段所在页）**${AT_FORCE ? `（显式覆盖 SWEEP_AT=${AT_FORCE}s）` : ''} · 上限搜索 k ≤ ${MAXK} · 工作目录 = ${WORK}`)
mkdirSync(WORK, { recursive: true })

// 先确认"最小字数也过"（否则判据不成立）
const minCase = build(1)
if (!minCase.dir) { console.error(`✗ ${minCase.why}（§25b ⇒ exit 2）`); process.exit(2) }
const p1 = probe(minCase.dir)
console.log(`  基准（k=1）：findings=${p1.findings.length} · 判据内=${p1.hits.length} · 非白名单=${p1.bad.length} ⇒ ${p1.bad.length ? '✗ 连 1 字都不过（判据/白名单可疑）' : '✓ 过'}`)
if (p1.bad.length) { console.error(`  ✗ 判据不成立：k=1 就红 ⇒ 先修判据再量（不要拿它当临界值）`); process.exit(1) }

// ★ 正控（"量具必须先证明能失败"）：故意超长 ⇒ **必须报红**。若不报 ⇒ 判据/白名单/注入有配置错误 ⇒ exit 2
const KPOS = Math.min(MAXK, 200)
const cPos = build(KPOS)
if (!cPos.dir) { console.error(`✗ ${cPos.why}（§25b ⇒ exit 2）`); process.exit(2) }
const pPos = probe(cPos.dir)
console.log(`  正控（k=${KPOS}）：判据内=${pPos.hits.length} · 非白名单=${pPos.bad.length} ⇒ ${pPos.bad.length ? '✓ 能失败（量具有效）' : '✗ 超长都不报 ⇒ **量具失效**（白名单/注入/判据配置错）'}`)
if (pPos.bad.length === 0) {
  console.error('  ✗ 正控失败：故意超长（k=' + KPOS + '）也读成"过" ⇒ 不许往下二分（先修判据/白名单/注入）')
  process.exit(2)
}

// 二分：找"仍过"的最大 k
let lo = 1, hi = MAXK, best = 1, bestEvidence = null, firstFail = null
while (lo < hi) {
  const mid = Math.ceil((lo + hi) / 2)
  const c = build(mid)
  if (!c.dir) { console.error(`✗ ${c.why}`); process.exit(2) }
  const p = probe(c.dir)
  if (p.bad.length === 0) { lo = mid; best = mid }
  else { hi = mid - 1; if (!firstFail) firstFail = { k: mid, f: p.bad[0], all: p.bad.length } }
}
/* ★★ ±1 双向验证（team-lead 口径：二分依赖单调性 ⇒ **必须**用"临界"与"临界+1"两次实测证明）：
   ① 先**线性上探**（防单调性被破坏：二分给出的 best 之后可能还有能过的 k）
   ② 再显式测 best 与 best+1 ⇒ 前者必须过、后者必须**不过**（并打印后者的 finding 原文 + rect + 时刻） */
let kPass = best
while (kPass < MAXK) {
  const cc = build(kPass + 1)
  if (!cc.dir) { console.error(`✗ ${cc.why}`); process.exit(2) }
  const pp = probe(cc.dir)
  if (pp.unknown) {
    console.error(`✗ 临界+1 探测时**引擎没有可解析 JSON** ⇒ exit 2（§25a：**原始输出原样贴出**）`)
    console.error(`  · 时刻 = ${pp.at}s（页 ${pp.no}）· exit=${pp.exit}`)
    console.error(`  · bad[0] = ${JSON.stringify(pp.bad && pp.bad[0] || null)}`)
    console.error(`  · raw = ${String(pp.raw || '').slice(0, 600)}`)
    process.exit(2)
  }
  if (pp.bad.length) break
  kPass++
}
best = kPass
console.log(`\n  ⇒ **临界字数 = ${best} 字**（±1 双向验证：k=${best} 过 · k=${best + 1} ${best + 1 > MAXK ? '未测（撞上限）' : '不过'}）`)
if (best + 1 <= MAXK) {
  const cPass = build(best); const pPass = probe(cPass.dir)
  const cFail = build(best + 1); const pFail = probe(cFail.dir)
  /* ★ team-lead ① 固化三条：① 打印 `sourceFile` + **注入读回长度 == k**；② **禁止只打印单条被钳住的字段**
     当结论（就是它骗过我一次）⇒ 必须打印**随 k 变化的量**；③ 双路交叉校验（至少一格，用 deck JSON 复核）。 */
  const htmlOf = (dir) => join(dir, 'index.html')
  const readback = (dir) => { try { return (readFileSync(htmlOf(dir), 'utf8').match(/汉/g) || []).length } catch { return -1 } }
  const srcOf = (pf) => (pf.findings[0] && pf.findings[0].sourceFile) || '(无 sourceFile 字段)'
  const varying = (pf) => {
    const g = (c) => pf.findings.filter((f) => String(f.code || '') === c)
    const c0 = g('canvas_overflow')[0], t0 = g('text_box_overflow')[0]
    const h = (o) => (o && o.rect ? o.rect.height : '-')
    const ob = (o) => (o && o.overflow ? JSON.stringify(o.overflow) : '-')
    return `canvas_overflow{rect.h=${h(c0)}, overflow=${ob(c0)}} · text_box_overflow{rect.h=${h(t0)}, overflow=${ob(t0)}} · content_overlap=${g('content_overlap').length}`
  }
  const rb1 = readback(cPass.dir), rb2 = readback(cFail.dir)
  console.log(`     ① k=${best}（临界）：非白名单 = ${pPass.bad.length} ⇒ ${pPass.bad.length === 0 ? '✓ 过（临界成立）' : '✗ 竟不过 ⇒ 结果不可信'}`)
  console.log(`        读回 = ${rb1}/${best} · sourceFile = ${srcOf(pPass)} · ${varying(pPass)}`)
  console.log(`     ② k=${best + 1}（临界+1）：非白名单 = ${pFail.bad.length} ⇒ ${pFail.bad.length > 0 ? '✓ 不过（临界成立）' : '✗ 竟然过 ⇒ 单调性被破坏，结果不可信'}`)
  console.log(`        读回 = ${rb2}/${best + 1} · sourceFile = ${srcOf(pFail)} · ${varying(pFail)}`)
  console.log(`        页号 = ${pPass.no}（.${cls} 所在页）· 稳定帧时刻 = ${pPass.at}s（timing.mjs 唯一实现）${pPass.violation ? '  ⚠ ' + pPass.violation : ''}`)
  console.log(`     ② 页号 = ${pFail.no} · 稳定帧时刻 = ${pFail.at}s${pFail.violation ? '  ⚠ ' + pFail.violation : ''}`)
  /* ★ team-lead ② 护栏 3：**量表单点 findings ⊆ 闸门该页聚合**（多出的逐条打印 —— 那才是"过渡帧假象"的来源证据） */
  {
    const tbl = timingTable(cPass.dir)
    const aggList = settledAtList(cPass.dir)
    const ar = spawnSync(HF, ['check', cPass.dir, '--json', '--at', aggList.join(','), '--no-contrast'], { encoding: 'utf8', shell: true })
    const ao = strip(ar.stdout); const ai = ao.indexOf('{')
    let aj = null
    if (ai >= 0) { try { aj = JSON.parse(ao.slice(ai)) } catch { aj = null } }
    const afs = (aj && aj.layout && Array.isArray(aj.layout.findings)) ? aj.layout.findings : []
    /* ★ 口径与判据一致：只比 **JUDGE 码**（第一版比了全部 findings ⇒ 被非判据码 `text_occluded` 假报过）。
       ★ team-lead ②：闸门聚合是**多时刻×全档**、量表是**单页单点** ⇒ 必须先把闸门 findings **按"属于哪一页"归属**：
         ① 优先 **selector → 页号**（`pageNoOfSelector`）；② 退化为 **time → 页号**；
         ③ **归属不出来 ⇒ 打印 + 不计入**（不许默默丢掉，也不许当成通过）。 */
    const onlyJudge = (fs) => fs.filter((f) => f && JUDGE.has(String(f.code || '')))
    const pageOfFinding = (f) => {
      const bySel = pageNoOfSelector(cPass.dir, String(f.selector || '').split('>')[0].trim())
      if (bySel) return { no: bySel, how: 'selector→页' }
      const p = pageOfTime(tbl, f.time)
      return p ? { no: p.i, how: 'time→页' } : null
    }
    const attr = onlyJudge(afs).map((f) => ({ f, a: pageOfFinding(f) }))
    const unattributed = attr.filter((x) => !x.a)
    const inPage = attr.filter((x) => x.a && x.a.no === (pFail.no || 1)).map((x) => x.f)
    const key = (f) => `${f.code}|${f.selector}`
    const aggKeys = new Set(inPage.map(key))
    /* ★ 用**临界+1**那一格来验 ⊆：单点读到的判据内 findings，闸门**在该页**的聚合里必须也有 */
    const extra = onlyJudge(pFail.findings).filter((f) => !aggKeys.has(key(f)))
    console.log(`     ⊆ 断言（量表单点 ⊆ 闸门该页聚合）：单点 ${onlyJudge(pFail.findings).length} 条（k=${best + 1}，页 ${pFail.no}）· 该页聚合 ${inPage.length} 条 · 多出 **${extra.length}** 条 · **归属不出 ${unattributed.length} 条**（不计入）· 聚合时刻 = [${aggList.join(',')}]`)
    for (const x of unattributed.slice(0, 6)) console.log(`        ? 归属不出（不计入）：${key(x.f)} t=${x.f.time}（selector 与 time 都映射不到页）`)
    for (const f of extra.slice(0, 6)) console.log(`        · 多出：${key(f)} t=${f.time} rect=${JSON.stringify(f.rect || f.bbox || null)}`)
    if (extra.length) {
      console.error('  ✗ 单点读到"该页聚合里没有"的 finding ⇒ **可能是过渡帧假象或口径漂移**（逐条见上；已计入退出码）')
      SUBFAIL = 1
    }
  }
  if (rb1 !== best || rb2 !== best + 1) {
    console.error(`  ✗ 读回校验未过（注入未生效/量错对象）⇒ **不报临界值**（§25b：先过读回校验再谈读数；exit 2）`)
    process.exit(2)
  }
  const f1 = pFail.bad[0]
  console.log(`     临界+1 的逐条判据内 findings（${pFail.hits.length} 条）：`)
  for (const f of pFail.hits) {
    console.log(`       · code=${f.code} · selector=${f.selector || '-'} · t=${f.time} · rect=${JSON.stringify(f.rect || f.bbox || null)} · overflow=${JSON.stringify(f.overflow || null)}`)
    console.log(`         fixHint=${String(f.fixHint || '').slice(0, 160)}`)
  }
  console.log(`     稳定帧时刻 = ${pFail.at}s（页 ${pFail.no}）· 依据 = ${pFail.hits.map((f) => f.code).join(' ∪ ')}`)
  if (pPass.bad.length !== 0 || pFail.bad.length === 0) { console.error('  ✗ ±1 验证失败 ⇒ **不报临界值**（先修判据/单调性）'); process.exit(1) }
}
console.log(`     **上限建议（×0.9）= ${Math.floor(best * 0.9)} 字**`)
console.log(`     方法：稳定帧(**按 timing.mjs 唯一实现、该字段所在页**) 引擎 lint · 判据 = (三码 ∪ content_overlap) − 白名单 = 0 · 填充字 = '汉'（等宽 CJK）· 日期 = ${new Date().toISOString().slice(0, 10)}`)
process.exit(SUBFAIL ? 1 : 0)
