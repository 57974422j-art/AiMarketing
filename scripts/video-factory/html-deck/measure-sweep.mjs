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
const AT = process.env.SWEEP_AT || '1.0'        // 稳定帧时刻（封面页默认 1.0；其它页型可用 SWEEP_AT 覆盖）
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

/** 跑引擎 lint（稳定帧时刻），返回该时刻的 findings（判据口径） */
function probe(dir) {
  const r = spawnSync(HF, ['check', dir, '--json', '--at', AT, '--no-contrast'], { encoding: 'utf8', shell: true })
  const out = strip(r.stdout)
  const i = out.indexOf('{')
  let j = null
  if (i >= 0) { try { j = JSON.parse(out.slice(i)) } catch { /* 保留 raw */ } }
  // ★ 不许静默：引擎**没给可解析 JSON** 时不能当成"装得下"（第一版就踩了 ⇒ 报出假的 120 ✗）
  if (!j || !j.layout) {
    return {
      exit: r.status, findings: [], hits: [], unknown: true,
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
    return {
      exit: r.status, findings: fs, hits, unknown: true,
      bad: [{ code: `(引擎自报不通过：ok=${j.layout.ok} errorCount=${j.layout.errorCount}，但无判据内 findings ⇒ 视为未通过，保守)`, fixHint: strip(stderrOf(r)).slice(0, 300), overflow: null }],
      raw: strip(stderrOf(r)).slice(0, 400),
    }
  }
  // ★ 白名单匹配必须与**真闸门同口径**（`check-engine-lint.mjs` L266-269）：
  //   `(!a.code || a.code === f.code) && (!a.selector || f.selector.includes(a.selector))`
  //   ⚠️ 我第一版写成 `a.className`，而清单字段是 `selector` ⇒ `!a.className` 恒真 ⇒ **每条 finding 都被豁免** ⇒
  //      判据恒空 ⇒ sweep 一路"过"到搜索上限（**假绿**，又被我自己的正控抓出来）。
  const allowHit = (x) => ALLOW.some((a) => (!a.code || a.code === String(x.code || '')) && (!a.selector || String(x.selector || '').includes(a.selector)))
  const bad = hits.filter((x) => !allowHit(x))
  return { exit: r.status, findings: fs, hits, bad, raw: strip(r.stderr).slice(0, 400) }
}

console.log(`=== 临界字数实测（二分）===`)
console.log(`  产物 = ${dirArg} · 字段 = .${cls} · 稳定帧时刻 = ${AT}s · 上限搜索 k ≤ ${MAXK} · 工作目录 = ${WORK}`)
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
  if (pp.unknown) { console.error(`✗ 临界+1 探测时判据不可用（引擎无 JSON）⇒ exit 2`); process.exit(2) }
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
  console.log(`     稳定帧时刻 = ${AT}s · 依据 = ${pFail.hits.map((f) => f.code).join(' ∪ ')}`)
  if (pPass.bad.length !== 0 || pFail.bad.length === 0) { console.error('  ✗ ±1 验证失败 ⇒ **不报临界值**（先修判据/单调性）'); process.exit(1) }
}
console.log(`     **上限建议（×0.9）= ${Math.floor(best * 0.9)} 字**`)
console.log(`     方法：稳定帧(${AT}s) 引擎 lint · 判据 = (三码 ∪ content_overlap) − 白名单 = 0 · 填充字 = '汉'（等宽 CJK）· 日期 = ${new Date().toISOString().slice(0, 10)}`)
process.exit(0)
