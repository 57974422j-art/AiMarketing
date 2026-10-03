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
import { domTarget } from './dom-target.mjs'
/* ★ 装饰×内容碰撞判据（**唯一实现**，与闸门 `check-engine-lint.mjs` 同一模块 ⇒ 不会出现"上限比闸门严/松"） */
import { classifyOcclusions, crossCheckNote } from './decor-collision.mjs'

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
  /* ★ team-lead ②-A：对照运行的时刻**也走唯一实现**（"稳定帧 vs 引擎原采样"才有对照意义）。
     旧版 `process.env.SWEEP_AT || '1.0'` 是**活代码**：SWEEP_AT 未设时这次"带 --at"的运行悄悄用 1.0s
     —— 那正是产出**错值 37 字**的那个时刻。现：算不出就 exit 2，**不许数字兜底**。 */
  const cNo = pageNoOfSelector(c.dir, cCls) || 1
  const cSt = settledAt(c.dir, cNo)
  const cAt = process.env.SWEEP_AT || (cSt ? cSt.at.toFixed(3) : '')
  if (!cAt) { console.error('✗ 对照运行需要"该字段所在页的稳定帧"，但算不出来 ⇒ exit 2（**不许数字兜底**）'); process.exit(2) }
  console.log(`   对照运行时刻 = ${cAt}s（页 ${cNo}${process.env.SWEEP_AT ? ' · 显式 SWEEP_AT 覆盖' : ' · timing.mjs 唯一实现'}）`)
  for (const withAt of [false, true]) {
    const r = spawnSync(HF, ['check', c.dir, '--json', ...(withAt ? ['--at', cAt] : []), '--no-contrast'], { encoding: 'utf8', shell: true })
    const out = strip(r.stdout)
    const i = out.indexOf('{')
    let j = null
    if (i >= 0) { try { j = JSON.parse(out.slice(i)) } catch { /* raw */ } }
    const lay = j && j.layout
    const fs = (lay && Array.isArray(lay.findings)) ? lay.findings : []
    console.log(`   · ${withAt ? `--at ${cAt}` : '（无 --at）'} ⇒ exit=${r.status} · layout=${lay ? `ok=${lay.ok} errorCount=${lay.errorCount} totalIssueCount=${lay.totalIssueCount} findings=${fs.length}[${fs.slice(0, 6).map((x) => x.code).join(', ')}${fs.length > 6 ? ', …' : ''}]` : '**无 layout 段**'}`)
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
let MAXK = Number(maxArg || 240)      // ★ let：正控倍增可能放宽它（见下方"搜索上限必须包住正控触发点"）
/* ★ 时刻**不硬编码**（team-lead ②）：默认由 `timing.mjs` 按"该字段所在页"算；`SWEEP_AT` 仅作**显式覆盖**（自证/对比用） */
const AT_FORCE = process.env.SWEEP_AT || ''
let SUBFAIL = 0   // ⊆ 断言失败标记（决定最终退出码）
let OBS_COUNT = 0 // ★ 观察清单打印次数（非判据码 · 每次打印都计数 ⇒ 引擎意见既不会静默增长，也不会被整包采纳）
/** ★ 重采样失败 = **显式阻塞项**（team-lead ①：不许静默变成一个小上限） */
function dieIfUnmeasurable(pv, what) {
  if (!pv || !pv.unmeasurable) return
  console.error(`  ⛔ 「${what}」**该格无法稳定测量**：候选帧（${pv.at}，共 ${pv.cands} 个）全部不可靠 ⇒ **显式阻塞**（exit 2）—— 不是"不过"`)
  process.exit(2)
}
// 工作目录：**仓库内** `out-sweep/`（已被 `.gitignore` 的 `out*/` 覆盖 ⇒ 不弄脏提交集 ✓；
//  实测：放到系统临时目录时引擎会因"字体映射不可解析"给出空 findings 的假绿 ✗)
const WORK = join(ENGINE_ROOT, 'out-tmp-sweep')
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
  // ★ 目录层级敏感（实测）：`<引擎根>/out-tmp-sweep-kN`（**一层**）能被引擎正常检查；
  //   放到 `<引擎根>/out-tmp/sweep-kN`（两层）时引擎给出**空 findings 的假绿** ✗ ⇒ 必须一层。
  //   ⚠️ 因此**不能**把临时目录收敛成嵌套的 `out-tmp/`（team-lead 建议的"单一临时根"与这条实测冲突）；
  //   改用**统一前缀** `out-tmp-*`：仍然一层，但一次 glob 就能清完（清理只需一次审批）。
  const dir = join(ENGINE_ROOT, `out-tmp-sweep-k${k}`)
  const base = srcDir || SRC
  cpSync(base, dir, { recursive: true, force: true })
  const f = join(dir, 'index.html')
  let html = readFileSync(f, 'utf8')
  const useCls = clsHint || cls
  /* ★ **唯一命中断言**（team-lead ③-1）：目标必须恰好命中 1 个元素，否则"注给谁"不明确 ⇒ 读数无意义 ⇒ exit 2。
     用**唯一实现** `dom-target.mjs`（支持 `li:first-child .t` / `p2-head h2` 这类唯一形态）。 */
  const tg = domTarget(html, useCls)
  if (!tg.count) return { dir: null, why: `产物 HTML 里找不到目标「${useCls}」（检测点失效）` }
  if (tg.count !== 1) return { dir: null, why: `**选择器不唯一**（命中 ${tg.count} 个）⇒ 目标不明确 ⇒ 读数无意义（改用唯一形态，如 li:first-child .t / p2-head h2）` }
  html = html.slice(0, tg.openEnd) + '汉'.repeat(k) + html.slice(tg.closeStart)
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
  /* ★★ team-lead ① 裁定 **(b) + 重采样**（明确否 (a)）：
   *   (a) 会把引擎的**非判据意见**整包纳入（`timeline_track_too_dense` / `nested_structure_needs_subcomposition` /
   *   `text_occluded` …）⇒ 要么永远红、要么再建一份"引擎码白名单" ⇒ 等于把刻意排除的引擎判断请回来 ⇒ **不许**。
   *   判据 = **只认 JUDGE 码**（与闸门同一集合、同一白名单）；但若该帧**不可靠**（引擎 not ok / 边界太近）⇒
   *   **换时刻重采**（有限次）；只有**所有候选都不稳定**才报「该格无法稳定测量」= **显式阻塞项**（不是"不过"，
   *   绝不许静默变成一个小上限）。 */
  const p = st.p
  const cap = st.next ? st.next.start - 0.05 : p.start + p.dur - 0.05
  const inPage = (t) => t > p.start + 1e-6 && t < p.start + p.dur - 1e-6
  const cands = AT_FORCE
    ? [{ at: AT_FORCE, why: '显式 SWEEP_AT 覆盖' }]
    : [
      { at: st.at.toFixed(3), why: '稳定帧（timing.mjs 唯一实现）' },
      { at: (st.at - 0.05).toFixed(3), why: '稳定帧−0.05（更早一帧，避开边界）' },
      { at: (st.at - 0.10).toFixed(3), why: '稳定帧−0.10' },
      { at: (p.start + p.dur / 2).toFixed(3), why: '页中点' },
    ].filter((c, idx, arr) => inPage(Number(c.at)) && arr.findIndex((q) => q.at === c.at) === idx)
  const obs = []                              // ★ 观察清单：非判据码（**不判红**，但逐条打印 + 计数每次打印）
  for (let ci = 0; ci < cands.length; ci++) {
    const cd = cands[ci]
    const r = spawnSync(HF, ['check', dir, '--json', '--at', cd.at, '--no-contrast'], { encoding: 'utf8', shell: true })
    const out = strip(r.stdout)
    const i = out.indexOf('{')
    let j = null
    if (i >= 0) { try { j = JSON.parse(out.slice(i)) } catch { /* 保留 raw */ } }
    // ★ 不许静默：引擎**没给可解析 JSON** 时不能当成"装得下"（第一版就踩了 ⇒ 报出假的 120 ✗）
    if (!j || !j.layout) {
      if (ci < cands.length - 1) { console.log(`     · t=${cd.at} 引擎无可解析 JSON（${cd.why}）⇒ 换时刻重采`); continue }
      return {
        exit: r.status, findings: [], hits: [], unknown: true, at: cd.at, no, tries: ci + 1, resampled: ci > 0, usedWhy: cd.why, cands: cands.length,
        bad: [{ code: '(未知：引擎没有可解析 JSON 输出)', fixHint: `${strip(stderrOf(r)).slice(0, 300)}`, overflow: null }],
        raw: strip(stderrOf(r)).slice(0, 400),
      }
    }
    const fs = (j && j.layout && Array.isArray(j.layout.findings)) ? j.layout.findings : []
    const layoutBad = (j.layout.ok === false) || (Number(j.layout.errorCount || 0) > 0)
    /* ★ team-lead 裁定：**装饰×内容碰撞**进判据（与闸门**同一实现** `decor-collision.mjs`）。
       ⇒ 引擎 `text_occluded` 若遮挡者命中装饰白名单，则以 `decor_content_collision` 计入 hits（判据码）；
         未命中的仍留观察清单；我们用 crossCheckNote 做独立锚点交叉校验。 */
    const decorRes = classifyOcclusions(fs)
    if (decorRes.counts.occlusions) {
      console.log(`     [装饰判据] 遮挡 ${decorRes.counts.occlusions} 条 = 装饰碰撞 ${decorRes.counts.collisions} + 非装饰 ${decorRes.counts.nonDecor}${crossCheckNote(decorRes.counts) ? ' ⇒ ' + crossCheckNote(decorRes.counts) : ''}`)
    }
    const hits = [...fs.filter((x) => x && JUDGE.has(String(x.code || ''))), ...decorRes.collisions]
    const nonJudge = fs.filter((x) => x && !JUDGE.has(String(x.code || '')) && String(x.code) !== 'text_occluded')
    /* ★ 观察清单（team-lead ①-3）：非判据码在**稳定帧**上出现时逐条打印 + 计数（可见但**不判红**）；
       `text_occluded` 另加提示（真遮挡 = 用户可见缺陷 vs 边界帧瞬态，需人工判）。 */
    if (ci === 0 && nonJudge.length) {
      for (const nf of nonJudge) {
        obs.push(nf)
        OBS_COUNT++
        console.log(`     [观察清单 #${OBS_COUNT}] code=${nf.code} · sel=${nf.selector || '-'} · t=${nf.time} · rect=${JSON.stringify(nf.rect || nf.bbox || null)}${/text_occluded/.test(String(nf.code)) ? ' ← ⚠️ text_occluded：需判"真遮挡(用户可见缺陷) vs 边界帧瞬态"' : ''}`)
      }
    }
    if (hits.length > 0) {
      return { exit: r.status, findings: fs, hits, bad: hits.filter((x) => !ALLOW.some((a) => (!a.code || a.code === String(x.code || '')) && (!a.selector || String(x.selector || '').includes(a.selector)))), raw: strip(r.stderr).slice(0, 400), at: cd.at, no, tries: ci + 1, resampled: ci > 0, usedWhy: cd.why, cands: cands.length, violation: st.violation }
    }
    if (!layoutBad) {
      return { exit: r.status, findings: fs, hits: [], bad: [], raw: strip(r.stderr).slice(0, 400), at: cd.at, no, tries: ci + 1, resampled: ci > 0, usedWhy: cd.why, cands: cands.length, violation: st.violation, nonJudge: nonJudge.length }
    }
    /* 该帧不可靠 ⇒ **点名让 ok=false 的 code**，然后换时刻（不是"不过"！） */
    console.log(`     · t=${cd.at} 该帧不可靠（ok=${j.layout.ok} errorCount=${j.layout.errorCount}）· **点名 code = [${nonJudge.map((c) => c.code).join(', ') || '无 findings'}]**（${cd.why}）⇒ 换时刻重采${ci < cands.length - 1 ? ` → ${cands[ci + 1].at}` : '（无候选）'}`)
  }
  return { unmeasurable: true, no, cands: cands.length, at: cands.map((c) => c.at).join(' / '), findings: [], hits: [], bad: [] }
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
dieIfUnmeasurable(p1, '基准 k=1')
console.log(`  基准（k=1）：findings=${p1.findings.length} · 判据内=${p1.hits.length} · 非白名单=${p1.bad.length} ⇒ ${p1.bad.length ? '✗ 连 1 字都不过（判据/白名单可疑）' : '✓ 过'}`)
if (p1.bad.length) { console.error(`  ✗ 判据不成立：k=1 就红 ⇒ 先修判据再量（不要拿它当临界值）`); process.exit(1) }

/* ★★ 正控 k **倍增上探**（team-lead ③-2）：列表项这类"盒子能撑开"的字段，120 可能**太小**
   （既不溢出也不重叠 ⇒ 判据 0 条 ⇒ 看起来像"量具坏了"，其实只是**故意超长的量还不够**）。
   ⇒ 120 → 240 → 480 … 直到触发判据；到 K_MAX 仍不触发 ⇒ **exit 2「该字段正控未证明」**并报"上限 > K_MAX"
      （既不许当成"量具坏了"，也不许当成"这字段没问题"）。 */
const K_MAX = Math.max(1920, MAXK * 4)
let KPOS = 0, pPos = null
const posPath = []
for (let kk = 120; kk <= K_MAX; kk *= 2) {
  const c = build(kk)
  if (!c.dir) { console.error(`✗ ${c.why}（§25b ⇒ exit 2）`); process.exit(2) }
  const p = probe(c.dir)
  dieIfUnmeasurable(p, `正控 k=${kk}`)
  posPath.push(`${kk}(非白名单 ${p.bad.length})`)
  if (p.bad.length) { KPOS = kk; pPos = p; break }
}
if (!KPOS) {
  console.error(`  ✗ **该字段正控未证明**：k 从 120 倍增到 ${K_MAX} 仍不触发判据 ⇒ **该字段上限 > ${K_MAX}**`)
  console.error(`     （既不当"量具坏了"，也不当"这字段没问题"；该格按"无上限（k≤${K_MAX} 未触发判据）"记录）`)
  process.exit(2)
}
console.log(`  正控：倍增路径 ${posPath.join(' → ')} ⇒ 触发于 **k=${KPOS}** · 判据内=${pPos.hits.length} · 非白名单=${pPos.bad.length} ⇒ ✓ 能失败（量具有效）`)
/* ★ 搜索上限必须**包住**正控触发点，否则临界会被截在搜索上限上（例：真上限 300、而上限写 120 ⇒ 报 120 ✗） */
if (KPOS > MAXK) { console.log(`  · 搜索上限从 ${MAXK} **放宽到 ${KPOS}**（正控触发点必须落在搜索区间内）`); MAXK = KPOS }

/* ★ 被阻塞档登记（team-lead ①/④）：**无法稳定测量 ≠ 不过**，也**不许当"过"** ⇒ 二分里按"不作为过"保守处理
   （避免**高估**上限），但**必须逐条记录并打印**，最终在 ±1 步骤里点名（含 code 与候选帧）。 */
const BLOCKED = []
// 二分：找"仍过"的最大 k
let lo = 1, hi = MAXK, best = 1, bestEvidence = null, firstFail = null
while (lo < hi) {
  const mid = Math.ceil((lo + hi) / 2)
  const c = build(mid)
  if (!c.dir) { console.error(`✗ ${c.why}`); process.exit(2) }
  const p = probe(c.dir)
  if (p.unmeasurable) {
    BLOCKED.push({ k: mid, at: p.at, cands: p.cands })
    console.log(`     ⚠ k=${mid} **无法稳定测量**（候选 ${p.cands} 帧全不可靠：${p.at}）⇒ 不作为"过"（记录，非结论）`)
    hi = mid - 1
    continue
  }
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
  if (pp.unmeasurable) {
    BLOCKED.push({ k: kPass + 1, at: pp.at, cands: pp.cands })
    console.log(`     ⚠ 线性上探 k=${kPass + 1} **无法稳定测量**（${pp.at}）⇒ 不作为"过"，停止上探（记录，非结论）`)
    break
  }
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
  let cFail = build(best + 1); let pFail = probe(cFail.dir)
  let kFail = best + 1
  dieIfUnmeasurable(pPass, `临界 k=${best}`)
  if (pFail.unmeasurable) {
    BLOCKED.push({ k: best + 1, at: pFail.at, cands: pFail.cands })
    console.log(`     ② k=${best + 1}（临界+1）⇒ **无法稳定测量**（候选 ${pFail.cands} 帧全不可靠：${pFail.at}）—— 不作为"不过"（team-lead ①：显式阻塞，不许变成一个小上限）`)
    console.log(`        ⇒ team-lead ④「依据必须是判据码」⇒ **向上探最近的判据码失败点**（k=${best + 2} … ${Math.min(MAXK, best + 12)}）`)
    let found = false
    for (let kk = best + 2; kk <= Math.min(MAXK, best + 12); kk++) {
      const cf = build(kk); const pf = probe(cf.dir)
      if (pf.unmeasurable) { BLOCKED.push({ k: kk, at: pf.at, cands: pf.cands }); console.log(`        · k=${kk} 同样无法稳定测量（记录，跳过）`); continue }
      if (pf.bad.length) { pFail = pf; cFail = cf; kFail = kk; found = true; break }
    }
    if (!found) {
      console.error(`  ✗ k=${best + 1} 被阻塞，且上探 ${Math.min(MAXK, best + 12)} 内找不到**判据码**失败点 ⇒ 本格**无 JUDGE 依据 ⇒ 不入表**（exit 2）`)
      process.exit(2)
    }
    console.log(`        ⇒ **判据码失败点 = k=${kFail}**（被阻塞的是 k=${best + 1}；临界仍取 k=${best}，但"不过"的依据来自 k=${kFail}）`)
  }
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
  const frame = (p) => `页号 = ${p.no}（.${cls} 所在页）· 时刻 = ${p.at}s · **帧是否换过 = ${p.resampled ? `是（第 ${p.tries}/${p.cands} 个候选：${p.usedWhy}）` : '否（首个候选=稳定帧）'}**`
  console.log(`        ① ${frame(pPass)}${pPass.violation ? '  ⚠ ' + pPass.violation : ''}`)
  console.log(`     ② ${frame(pFail)}${pFail.violation ? '  ⚠ ' + pFail.violation : ''}`)
  /* ★ team-lead ② 护栏 3：**量表单点 findings ⊆ 闸门该页聚合**（多出的逐条打印 —— 那才是"过渡帧假象"的来源证据） */
  {
    /* ⚠️ **必须与"单点"同一产物**（`cFail`，即判据码失败点那一档）：第一版误用 `cPass`（k=36 产物）
       ⇒ 拿 k=36 的聚合去比 k=38 的单点 ⇒ **苹果比橘子** ⇒ 报出假的"多出 1 条"（被本断言自己抓出）。 */
    const tbl = timingTable(cFail.dir)
    const aggList = settledAtList(cFail.dir)
    const ar = spawnSync(HF, ['check', cFail.dir, '--json', '--at', aggList.join(','), '--no-contrast'], { encoding: 'utf8', shell: true })
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
      const bySel = pageNoOfSelector(cFail.dir, String(f.selector || '').split('>')[0].trim())
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
    console.log(`     ⊆ 断言（量表单点 ⊆ 闸门该页聚合）：单点 ${onlyJudge(pFail.findings).length} 条（k=${kFail}，页 ${pFail.no}）· 该页聚合 ${inPage.length} 条 · 多出 **${extra.length}** 条 · **归属不出 ${unattributed.length} 条**（不计入）· 聚合时刻 = [${aggList.join(',')}]`)
    for (const x of unattributed.slice(0, 6)) console.log(`        ? 归属不出（不计入）：${key(x.f)} t=${x.f.time}（selector 与 time 都映射不到页）`)
    for (const f of extra.slice(0, 6)) console.log(`        · 多出：${key(f)} t=${f.time} rect=${JSON.stringify(f.rect || f.bbox || null)}`)
    if (extra.length) {
      console.error('  ✗ 单点读到"该页聚合里没有"的 finding ⇒ **可能是过渡帧假象或口径漂移**（逐条见上；已计入退出码）')
      SUBFAIL = 1
    }
  }
  if (rb1 !== best || rb2 !== kFail) {
    console.error(`  ✗ 读回校验未过（注入未生效/量错对象）⇒ **不报临界值**（§25b：先过读回校验再谈读数；exit 2）`)
    process.exit(2)
  }
  console.log(`     判据码失败点 k=${kFail} 的逐条判据内 findings（${pFail.hits.length} 条）：`)
  for (const f of pFail.hits) {
    console.log(`       · code=${f.code} · selector=${f.selector || '-'} · t=${f.time} · rect=${JSON.stringify(f.rect || f.bbox || null)} · overflow=${JSON.stringify(f.overflow || null)}`)
    console.log(`         fixHint=${String(f.fixHint || '').slice(0, 160)}`)
  }
  console.log(`     稳定帧时刻 = ${pFail.at}s（页 ${pFail.no}）· **依据 = ${pFail.hits.map((f) => f.code).join(' ∪ ')}**（判据码）· 帧换过 = ${pFail.resampled ? '是' : '否'} · 观察清单打印次数 = ${OBS_COUNT}`)
  if (BLOCKED.length) {
    console.log(`     ⚠ **被阻塞（无法稳定测量）的档**：${BLOCKED.map((b) => `k=${b.k}（候选帧 ${b.at}）`).join(' · ')} ⇒ 既不是"过"也不是"不过"（已在上面逐条点名 code）`)
  }
  /* ★ team-lead ④：**只有依据是 JUDGE 码的格子，才允许进六字段表** ⇒ 硬断言（无依据 ⇒ 不入表 exit 2） */
  if (pFail.hits.length === 0) {
    console.error('  ✗ k=' + kFail + ' 的失败里**没有任何判据码**（只有引擎非判据意见）⇒ 本格**无 JUDGE 依据 ⇒ 不入表**（exit 2）')
    process.exit(2)
  }
  if (pPass.bad.length !== 0 || pFail.bad.length === 0) { console.error('  ✗ ±1 验证失败 ⇒ **不报临界值**（先修判据/单调性）'); process.exit(1) }
}
console.log(`     **上限建议（×0.9）= ${Math.floor(best * 0.9)} 字**`)
console.log(`     方法：稳定帧(**按 timing.mjs 唯一实现、该字段所在页**) 引擎 lint · 判据 = (三码 ∪ content_overlap ∪ decor_content_collision) − (溢出 ∪ 重叠白名单) = 0 · 装饰判据与闸门**同一实现**(decor-collision.mjs) · 填充字 = '汉'（等宽 CJK）· 日期 = ${new Date().toISOString().slice(0, 10)}`)
process.exit(SUBFAIL ? 1 : 0)
