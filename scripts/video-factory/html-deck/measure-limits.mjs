#!/usr/bin/env node
/**
 * measure-limits.mjs —— 内容上限实测（第 0 步：**先证明"溢出检测器"能失败**）
 *
 * 为什么先做这一步：契约里一堆 `maxLength` 是**拍脑袋写的**（没测过）。要改成"实测临界值 × 0.9"，
 * 第一步不是量，而是**确认量具是真的**：拿一个**故意超长**的产物让引擎的 `hyperframes check`
 * （描述："Inspect rendered composition layout for text/container overflow"）报出来；
 * 同时拿**未改动**的同一产物，确认它**不报**。一正一反都成立，后面的数字才可信。
 *
 * ★ 重写说明（2026-10-03）：原文件**乱码损坏**（`oonst`/`mmport`/`deok` 一类替换式损坏，语法 ✗）。
 *   本版按它**可读的中文文档 + 代码形状**忠实重建，并做两件收口：
 *     ① 路径 import `paths.mjs`（不再自己 `resolve(HERE,'..')`）
 *     ② 引擎 bin import `engine-bin.mjs`（不再自带一套 HF 解析 —— K17）
 *   两个数字的定义（**我重建时的口径，需 team-lead 确认**）：
 *     · **被裁 N px** = 引擎 layout 里各 `bottom` 超出画布高 `--H` 的**最大越界量**（如 768.41 > 720 ⇒ 48.41）
 *     · **像素截断** = 引擎 JSON 里任何"像素级裁剪/截断"信号（键名或值含 clip/truncat/pixel + overflow）的**条目数**
 *   取不到就**明说"未取到"**（不许编数）。
 *
 * 用法: node measure-limits.mjs
 * 退出码: 0 = 一正一反都成立（量具可信）· 1 = 判据不成立 · 2 = 环境/输入不完整（§25b）
 */
import { readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ENGINE_ROOT, DECK_DIR, selfCheck } from './paths.mjs'
import { resolveHyperframes, resolveFfmpeg } from './engine-bin.mjs'
/* ★ K17-ff 清扫：本文件此前用**裸 `ffmpeg`**（无视渲染器钉住的那个）⇒ 现同走唯一实现。 */

selfCheck({ quiet: true })
const HF = resolveHyperframes().p

const SRC = join(DECK_DIR, 'out', 'deck.master-v1')       // 已有产物：deck-page.html + assets
const TMP = join(ENGINE_ROOT, 'out-limits-demo')          // 注入演示目录（每次重造，避免残留）
const AT = '1.0'                                          // 封面页全就位后
const strip = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '')

/** 调引擎：`hyperframes check`（`inspect` 已废弃：v0.8.111 明确提示 "Use 'hyperframes check' instead"）。
 *  ★ 且 check/inspect **没有 -o/--composition** 选项，只认默认名 `index.html` ⇒ 演示目录里放一份同名副本。 */
function inspect(dir) {
  const r = spawnSync(HF, ['check', dir, '--json', '--at', AT, '--no-contrast'], { encoding: 'utf8', shell: true })
  const out = strip(r.stdout), err = strip(r.stderr)
  let json = null
  const i = out.indexOf('{')
  if (i >= 0) { try { json = JSON.parse(out.slice(i)) } catch { /* 解析失败就保留 raw */ } }
  return { code: r.status, json, raw: (out + err).trim() }
}

/** 深挖：把结构里任何"提到 overflow"的字段/值都收集出来（不必先知道 schema） */
function findOverflow(o, path = '$', acc = []) {
  if (o == null) return acc
  if (Array.isArray(o)) { o.forEach((v, i) => findOverflow(v, `${path}[${i}]`, acc)); return acc }
  if (typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      const p = `${path}.${k}`
      if (/overflow|clip|truncat|pixel/i.test(k)) acc.push(`${p} = ${typeof v === 'object' ? JSON.stringify(v).slice(0, 240) : String(v)}`)
      else if (typeof v === 'string' && /overflow|clip|truncat/i.test(v)) acc.push(`${p} = ${v.slice(0, 200)}`)
      findOverflow(v, p, acc)
    }
  }
  return acc
}
/** 溢出条目：**以引擎的 `layout.findings` 为准**（`errorCount`/`totalIssueCount` 兜底打印）。
 *  ★ 第一版踩的坑：把所有数组长度相加 ⇒ 把 `samples`/`transitionSamples`（**采样元数据**）当成溢出 ✗ */
function overflowFindings(j) {
  const f = j && j.layout && j.layout.findings
  return Array.isArray(f) ? f : []
}
function overflowCount(j) {
  if (!j) return { n: 0, shape: '(非 JSON)', byCode: {} }
  const lay = j.layout
  if (!lay) return { n: 0, shape: '无 layout 段', byCode: {} }
  const fs = Array.isArray(lay) ? lay : overflowFindings(j)
  const byCode = {}
  for (const x of fs) { const c = (x && x.code) || '(无 code)'; byCode[c] = (byCode[c] || 0) + 1 }
  const declared = Number.isFinite(lay.errorCount) ? lay.errorCount : (Number.isFinite(lay.totalIssueCount) ? lay.totalIssueCount : null)
  return { n: fs.length, declared, byCode, shape: `findings=${fs.length}${declared !== null ? ` · errorCount=${declared}` : ''} · layout 键=[${Object.keys(lay).join(', ')}]` }
}
/** 画布高 H（从产物 CSS 的 `--H:` 读） */
function canvasH(htmlPath) {
  const s = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : ''
  const m = s.match(/--H:\s*(\d+)px/)
  return m ? Number(m[1]) : null
}
/** ★ 被裁 N px：**优先**取引擎 finding 里现成的 `overflow` 数值（引擎自报 "overflows by up to Npx"）；
 *  取不到再回落"`bottom` 超出画布高 H"的推算，并在 where 里标明来源。 */
function maxOverflowPx(j, H) {
  const fs = overflowFindings(j)
  let best = null
  for (const x of fs) {
    const ov = x && x.overflow
    if (ov && typeof ov === 'object') {
      for (const [k, v] of Object.entries(ov)) {
        const d = Number(v)
        if (Number.isFinite(d) && (!best || Math.abs(d) > Math.abs(best.px))) best = { px: d, where: `${x.code}.overflow.${k}（引擎自报）` }
      }
    }
  }
  if (best) return best
  if (!j || !H) return null
  let worst = null
  const walk = (o, path = '$') => {
    if (o == null) return
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${path}[${i}]`)); return }
    if (typeof o === 'object') {
      const b = Number(o.bottom ?? NaN)
      if (Number.isFinite(b) && b > H) { const d = +(b - H).toFixed(2); if (!worst || d > worst.px) worst = { px: d, where: `${path}.bottom=${b} − H=${H}（推算）` } }
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`)
    }
  }
  walk(j)
  return worst
}
/** 引擎**布局层**判据条目 = findings 里 code 含 overflow 的。
 *  ⚠️ 这只是**引擎的 DOM/布局判定**，**不是独立像素证据**（team-lead ① 指出的正是这点）⇒ 像素层见下面一组函数。 */
function pixelTruncations(j) {
  return overflowFindings(j)
    .filter((x) => x && /overflow/i.test(String(x.code || '')))
    .map((x) => `${x.code} · ${String(x.fixHint || '').slice(0, 120)}`)
}
/** ★ 主数字：**目标元素自身**那条 overflow（= `code === text_box_overflow`，即"文本框自己装不下"），
 *  **排除** `canvas_overflow`（那是多元素叠加的极值，不代表"这个字段被裁了多少"）。
 *  实测：本注入档 `text_box_overflow.overflow.bottom = 41.58` vs `canvas_overflow = 305.48`（team-lead 已确认口径）。 */
function targetOverflowPx(j, codeHint = 'text_box_overflow') {
  const fs = overflowFindings(j)
  const pick = fs.filter((x) => x && String(x.code || '') === codeHint)
  const scan = (list) => {
    let best = null
    for (const x of list) {
      const ov = x && x.overflow
      if (!ov || typeof ov !== 'object') continue
      for (const [, v] of Object.entries(ov)) { const d = Number(v); if (Number.isFinite(d) && (best === null || d > best)) best = d }
    }
    return best
  }
  return scan(pick.length ? pick : fs.filter((x) => !/canvas/i.test(String(x.code || ''))))
}
/** 找 finding 上的 rect（不同版本可能叫 rect / bbox / box） */
function findingRect(j) {
  for (const x of overflowFindings(j)) {
    const r = x.rect || x.bbox || x.box
    if (r && typeof r === 'object') {
      const w = r.width ?? r.w, h = r.height ?? r.h
      if (Number.isFinite(Number(w)) && Number.isFinite(Number(h))) return r
    }
  }
  return null
}

/* ---------- 像素层**独立证据**（真抽帧，不靠引擎的布局判定）----------
   ① `hyperframes render` 注入目录 → mp4（基线复用 `evidence/tmp-rendercheck/deck.master-v1/frames/` 的整帧）
   ② ffmpeg 抽同一时刻的帧 ③ 两件事：
      · **帧差分**：基线帧 vs 注入帧逐像素通道差的最大值 + 差异像素数（老版口径：基线 max≈25/亮像素 0；注入 max≈242/亮像素 6575）
      · **最底 4 行**：各帧在画布**底边**的非背景像素数（老版口径：0 → 1369 = 内容被画布切断的直接像素证据）
   ⚠️ 定义是我按老版数字重建的 ⇒ 需 team-lead 确认口径。 */
function renderDir(dir, outMp4) {
  // ★ 参数对齐 render-deck.mjs（`--non-interactive` 引擎不认 ⇒ "Unknown flag" ✗）
  const r = spawnSync(HF, ['render', dir, '-c', 'index.html', '-o', outMp4, '--fps', '25', '--quality', 'looks'], { encoding: 'utf8', shell: true })
  return { exit: r.status, raw: (strip(r.stdout || '') + strip(r.stderr || '')).slice(0, 800), mp4: existsSync(outMp4) ? outMp4 : null }
}
function extractFrame(src, at, outPng) {
  const r = spawnSync(resolveFfmpeg().p, ['-v', 'error', '-y', '-ss', String(at), '-i', src, '-frames:v', '1', outPng], { encoding: 'utf8' })
  return r.status === 0 && existsSync(outPng) ? outPng : null
}
function rawRgb(png) {
  const r = spawnSync(resolveFfmpeg().p, ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 27 })
  return r && r.status === 0 && r.stdout && r.stdout.length ? r.stdout : null
}
/** 帧差分：max 通道差 + 差异像素数（阈值 tol） */
function frameDiff(a, b, tol = 24) {
  const A = rawRgb(a), B = rawRgb(b)
  if (!A || !B || A.length !== B.length) return null
  let max = 0, bright = 0
  for (let i = 0; i < A.length; i += 3) {
    const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]))
    if (d > max) max = d
    if (d > tol) bright++
  }
  return { max, bright, pixels: A.length / 3 }
}
/** 画布**最底 n 行**的非背景像素数（背景 = 该带内出现最多的量化色） */
function bottomRows(png, W, H, n = 4, tol = 24) {
  const b = rawRgb(png)
  if (!b) return null
  const y = Math.max(0, H - n)
  const rows = []
  const key = (i) => (b[i] >> 5) + ',' + (b[i + 1] >> 5) + ',' + (b[i + 2] >> 5)
  const hist = {}
  for (let row = 0; row < n; row++) for (let col = 0; col < W; col++) { const i = ((y + row) * W + col) * 3; if (i + 2 < b.length) hist[key(i)] = (hist[key(i)] || 0) + 1 }
  const bg = Object.entries(hist).sort((p, q) => q[1] - p[1])[0][0].split(',').map(Number)
  for (let row = 0; row < n; row++) {
    let cnt = 0
    for (let col = 0; col < W; col++) {
      const i = ((y + row) * W + col) * 3
      if (i + 2 >= b.length) break
      const d = Math.abs((b[i] >> 5) - bg[0]) + Math.abs((b[i + 1] >> 5) - bg[1]) + Math.abs((b[i + 2] >> 5) - bg[2])
      if (d * 8 > tol) cnt++
    }
    rows.push(cnt)
  }
  return { rows, y, n }
}

let bad = 0
console.log('=== 内容上限实测 · 第 0 步：溢出检测器"能失败"吗 ===\n')

// 产物 HTML：**老引擎叫 `deck-page.html`、新引擎叫 `index.html`** ⇒ 两者都接受（用实际存在的那个）
const HTML_NAME = ['index.html', 'deck-page.html'].find((f) => existsSync(join(SRC, f)))
if (!HTML_NAME) {
  console.error(`✗ 缺 ${SRC}/index.html | deck-page.html（先跑一次 render-deck 生成产物）`)
  process.exit(2)
}

// 干净副本（每次重造，避免上次注入残留）
cpSync(SRC, TMP, { recursive: true, force: true })
// check/inspect 只认默认 composition 名 `index.html`（老产物叫 deck-page.html）⇒ 缺则放一份同名副本
if (!existsSync(join(TMP, 'index.html'))) cpSync(join(TMP, HTML_NAME), join(TMP, 'index.html'), { force: true })

console.log(`  产物 HTML = ${HTML_NAME}`)
const H = canvasH(join(TMP, 'index.html'))
console.log(`  画布高（从产物 CSS 的 --H 读）= ${H === null ? '未取到' : H + 'px'}\n`)

/* ---------- ① 反例（正）：不改动 → 不该报溢出 ---------- */
const a = inspect(TMP)
console.log('① 未改动产物：exit=' + a.code)
const ca = overflowCount(a.json)
const fa = findOverflow(a.json)
console.log('   layout 形态: ' + ca.shape + ' · 溢出计数 ' + ca.n)
console.log('   提到 overflow|clip|truncat|pixel 的字段: ' + fa.length + ' 处')
for (const s of fa.slice(0, 5)) console.log('     · ' + s)
if (ca.n !== 0) { bad++; console.log('   ✗ 未改动产物就报溢出 ⇒ 量具不可信（或产物本身有溢出）') }
else console.log('   ✓ 未改动产物：0 条溢出（反例（正）成立）')

/* ---------- ② 反例（反）：注入超长标题 → 必须报 ---------- */
const html = join(TMP, HTML_NAME)
let s = readFileSync(html, 'utf8')
const m = /<(h1|div) class="cover-title"[^>]*>([\s\S]*?)<\/\1>/.exec(s)
if (!m) { console.error('✗ 找不到 .cover-title（检测点失效）'); process.exit(2) }
const LONG = '很长的测试标题'.repeat(12)      // 84 字，远超任何合理标题
const before = m[2].replace(/<[^>]+>/g, '').length
const open = m[0].slice(0, m[0].indexOf('>') + 1)
s = s.slice(0, m.index) + open + LONG + `</${m[1]}>` + s.slice(m.index + m[0].length)
writeFileSync(html, s, 'utf8')
// 若产物用的是 deck-page.html，`index.html` 是它的副本 ⇒ 注入后必须重新同步（否则 check 读到旧内容）
if (html !== join(TMP, 'index.html')) cpSync(html, join(TMP, 'index.html'), { force: true })
console.log(`\n② 已注入超长封面标题（${LONG.length} 字，原 ${before} 字）`)

const b = inspect(TMP)
console.log('   exit=' + b.code)
const cb = overflowCount(b.json)
const fb = findOverflow(b.json)
const pxCanvas = maxOverflowPx(b.json, H)                     // 旁证：canvas 极值（多元素叠加，**不代表该字段被裁多少**）
const pxTarget = targetOverflowPx(b.json, 'cover-title')      // ★ 主数字：**目标元素自身**
const clip = pixelTruncations(b.json)
console.log('   layout 形态: ' + cb.shape + ' · 溢出计数 ' + cb.n)
console.log('   按 code 分类: ' + JSON.stringify(cb.byCode))
console.log(`   ★ 主数字（目标元素 h1.cover-title **自身** overflow 最大越界）= ${pxTarget !== null ? pxTarget + 'px' : '未取到（不许编数）'}`)
console.log(`   ☆ 旁证（canvas 极值，多元素叠加）= ${pxCanvas && pxCanvas.px !== null ? (pxCanvas.px + 'px（' + pxCanvas.where + '）') : '未取到'}`)
console.log(`   · 引擎**布局层**判据条目 = ${clip.length}（findings 里 code 含 overflow —— 这是 DOM/布局判定，**不是像素证据**）`)
for (const l of clip.slice(0, 5)) console.log('     · ' + l)
for (const l of fb.slice(0, 8)) console.log('     · ' + l)

/* ---------- ★★ 像素层**独立证据**（真抽帧 + 基线/注入同位置对比）---------- */
const W = H ? Math.round(H * (1280 / 720)) : 1280
const BASE_PNG = join(ENGINE_ROOT, 'deck-contract', 'evidence', 'tmp-rendercheck', 'deck.master-v1', 'frames', 'p1-full.png')
const basePng = existsSync(BASE_PNG) ? BASE_PNG : null
console.log('\n③ 像素层（真抽帧）：基线帧 = ' + (basePng ? 'probe-hf/deck-contract/evidence/tmp-rendercheck/deck.master-v1/frames/p1-full.png' : '**缺**'))
const rnd = renderDir(TMP, join(TMP, '_injected.mp4'))
console.log('   注入版渲染（hyperframes render）: exit=' + rnd.exit + (rnd.mp4 ? '  mp4=' + rnd.mp4 : '  **无 mp4**'))
console.log('   渲染器输出末 3 行（原样，§25a）: ' + (rnd.raw ? rnd.raw.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 280) : '(空)'))
const injPng = rnd.mp4 ? extractFrame(rnd.mp4, AT, join(TMP, '_injected-p1.png')) : null
if (basePng && injPng) {
  const d = frameDiff(basePng, injPng)
  const rb = bottomRows(basePng, W, H)
  const ri = bottomRows(injPng, W, H)
  const sum = (r) => (r ? r.rows.reduce((s, x) => s + x, 0) : '?')
  console.log(`   ★ 帧差分（基线 vs 注入，t=${AT}s）: max 通道差 = ${d ? d.max : '未取到'} · 差异像素 = ${d ? d.bright : '未取到'}（共 ${d ? d.pixels : '?'} px；阈值 24）`)
  console.log(`   ★ 最底 4 行非背景像素: 基线 = ${rb ? JSON.stringify(rb.rows) + '（合计 ' + sum(rb) + '）' : '未取到'} · 注入 = ${ri ? JSON.stringify(ri.rows) + '（合计 ' + sum(ri) + '）' : '未取到'}`)
  console.log(`   ⇒ 判定：${d && d.bright > 0 ? '注入版与基线**有像素级差异** ⇒ 内容确被画布切断（不是仅布局层报警）' : '⚠️ 帧差分 0 ⇒ 像素层**未复现**切断（需查）'}`)
} else { bad++; console.error('   ✗ 像素层取不到（基线帧或注入帧缺）⇒ **不算通过**，也**不许**用引擎的布局数字顶替') }
if (cb.n === 0) { bad++; console.log('   ✗ 注入超长标题后**仍然 0 条溢出** ⇒ 检测器不能失败 ⇒ 后面的数字全不可信') }
else console.log('   ✓ 注入后报出溢出（反例（反）成立）')

/* ---------- 存证 ---------- */
const ev = join(TMP, '_measure.json')
writeFileSync(ev, JSON.stringify({ at: AT, canvasH: H, baseline: { exit: a.code, count: ca.n, shape: ca.shape, fields: fa }, injected: { exit: b.code, count: cb.n, shape: cb.shape, byCode: cb.byCode, targetOverflowPx: pxTarget, canvasOverflowPx: (pxCanvas && pxCanvas.px) ?? null, layoutFindings: clip, fields: fb, pixelLayer: { renderExit: rnd.exit, injectedFrame: injPng, frameDiff: (basePng && injPng) ? frameDiff(basePng, injPng) : null, bottom4_baseline: (basePng ? bottomRows(basePng, H ? Math.round(H * (1280 / 720)) : 1280, H) : null), bottom4_injected: (injPng ? bottomRows(injPng, H ? Math.round(H * (1280 / 720)) : 1280, H) : null) } }, raw: { baseline: a.raw.slice(0, 4000), injected: b.raw.slice(0, 4000) } }, null, 2))
console.log(`\n  证据（原始 JSON + 两个数字）: ${ev}`)

bad += m ? 0 : 1
console.log(`\n结论: ${bad === 0 ? 'PASS（"不报/报"一正一反都成立 ⇒ 溢出检测器是真的，可以开始量临界值）' : `FAIL（${bad} 项不成立 ⇒ 先修量具再量）`}`)
process.exit(bad === 0 ? 0 : 1)
