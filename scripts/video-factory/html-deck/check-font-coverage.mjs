#!/usr/bin/env node
/**
 * check-font-coverage.mjs —— **字体覆盖闸门**（坑 28 / 第六条纪律）
 *
 * 纪律：**自带内容的资产必须验证"内容覆盖"**。内嵌字体是子集，缺字的字形缺失时浏览器会
 *   **静默回退系统字体** —— 开发机（装了 CJK 字体）永远看不出来，服务器上直接渲成豆腐块。
 *   所以：**渲染前必须过这道闸门**（`render-deck.mjs` 已内联调用它）。
 *
 * 字体来源：**两套母版共用的唯一一份** `fonts/`（由母版清单 `fonts.src` 声明，见 masters/<id>/master.json）。
 *
 * 用法：
 *   node check-font-coverage.mjs                     # 全量体检：chars-cmn.txt + 母版源码 + 全部 examples/*.json
 *   node check-font-coverage.mjs --deck <deck.json>  # 渲染前闸门：只查这一个 deck（缺字 → 报错 + 可执行建议）
 *   node check-font-coverage.mjs --extra "龘🙂"      # 敏感性自证：注入必然缺字的字符
 *
 * ★ 退出码映射（**别把脚本的码当成引擎的码**）：
 *     本脚本：0=覆盖通过 · 1=有缺字 · 2=用法或读取错
 *     渲染入口 render-deck.mjs：内部调用本脚本，把"缺字"统一映射为 **EXIT.FONT = 8（stage=fonts）**
 *   ⇒ 契约（ENGINE-CONTRACT.md）承诺的是 8；服务端只应看渲染入口的码。详见 fonts/README.md §5。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// fontkit 是 CJS（无 default 导出）⇒ 用 createRequire 取
const fontkit = createRequire(import.meta.url)('fontkit')

const HERE = dirname(fileURLToPath(import.meta.url))
/* ★ 路径收口：唯一来源 `paths.mjs`（本文件**不再**自己 `resolve(HERE,'..')`） */
import { ENGINE_ROOT as ROOT, selfCheck } from './paths.mjs'
selfCheck({ quiet: true })
const args = process.argv.slice(2)
const valOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const EXTRA = valOf('--extra') || ''
const DECK = valOf('--deck') ? resolve(valOf('--deck')) : null

/** `--masters-root <dir>`：指向母版副本（**负向自证**用：在副本上加写入点 ⇒ 必须红；不动真源） */
const MASTERS_ROOT = valOf('--masters-root') ? resolve(valOf('--masters-root')) : join(ROOT, 'masters')
const MASTERS = ['master-v1', 'master-v2'].map((id) => ({ id, dir: join(MASTERS_ROOT, id) }))

/* —— 输入完整性**预检**：把"判据失败(1)"与"输入/环境错误(2)"彻底分开（K16）——
   ★ 教训（team-lead 亲历）：`--masters-root` 指向**不完整树**（只放 master-v1）时，脚本抛 **ENOENT 栈**，
   而读到的 `exit=1` **不是断言触发的**，是**崩溃** ⇒ 把"崩"读成"红"（也可能反向：把崩读成"通过的前置失败"）。
   ⇒ 不完整输入一律 **exit 2 + 点名缺哪个路径**，绝不留栈。 */
function fatal(msg) { console.error(`✗ 输入/环境不完整（**exit 2**，非判据失败）：${msg}`); process.exit(2) }
{
  const rootsArg = valOf('--products-root') ? valOf('--products-root').split(',') : null
  for (const id of ['master-v1', 'master-v2']) {
    const dir = join(MASTERS_ROOT, id)
    if (!existsSync(dir)) fatal(`缺母版目录：${dir}`)
    const manPath = join(dir, 'master.json')
    if (!existsSync(manPath)) fatal(`缺母版清单：${manPath}`)
    if (!existsSync(join(dir, 'assets', 'master.js'))) fatal(`缺母版脚本：${join(dir, 'assets', 'master.js')}`)
    let man = null
    try { man = JSON.parse(readFileSync(manPath, 'utf8')) } catch (e) { fatal(`母版清单解析失败：${manPath}（${e.message}）`) }
    const f = man.fonts
    if (!f || !f.src || !Array.isArray(f.files) || !f.files.length) fatal(`母版 ${id} 的 master.json 未声明 fonts{src,files}`)
    const srcDir = resolve(dir, f.src)
    if (!existsSync(srcDir)) fatal(`缺字体目录：${srcDir}`)
    for (const fn of f.files) if (!existsSync(join(srcDir, fn))) fatal(`缺字体文件：${join(srcDir, fn)}`)
    if (!existsSync(join(srcDir, 'chars-cmn.txt'))) fatal(`缺字表：${join(srcDir, 'chars-cmn.txt')}`)
  }
  for (const r0 of (rootsArg || ['out', 'out-master-v2'])) {
    const r = rootsArg ? resolve(r0) : join(HERE, r0)
    if (!existsSync(r)) fatal(`产物根不存在：${r}`)
  }
}

/** 从母版清单解出"共用字体放在哪、有哪些文件"（清单是唯一真源） */
function masterFonts(dir) {
  const man = JSON.parse(readFileSync(join(dir, 'master.json'), 'utf8'))
  const f = man.fonts
  if (!f || !f.src || !Array.isArray(f.files) || !f.files.length) {
    return { man, err: `母版 ${man.id} 的 master.json 没声明 fonts{src,files}` }
  }
  return { man, srcDir: resolve(dir, f.src), files: f.files }
}

function loadCoverage(p) {
  if (!existsSync(p)) return null
  const font = fontkit.openSync(p)
  const set = new Set(font.characterSet || [])
  return { set, kb: readFileSync(p).length / 1024, has: (cp) => set.has(cp) || (font.hasGlyphForCodePoint ? font.hasGlyphForCodePoint(cp) : false) }
}

/** 收集文本里的字符（跳过换行/制表） */
function charsOf(text, into) {
  for (const ch of String(text)) {
    if (ch === '\n' || ch === '\r' || ch === '\t') continue
    if (!into.has(ch)) into.set(ch, new Set())
    into.get(ch).add('')
  }
  return into
}

/** 判定并打印；返回缺失字符数组 */
function report(fonts, need, label) {
  const none = [], one = []
  for (const [ch, from] of need) {
    const cp = ch.codePointAt(0)
    const covered = Object.keys(fonts).filter((f) => fonts[f] && fonts[f].has(cp))
    if (covered.length === 0) none.push([ch, cp, [...from].filter(Boolean)])
    else if (covered.length === 1) one.push([ch, cp, covered[0]])
  }
  const fmt = (arr, n) => arr.slice(0, n).map(([ch, cp]) => `${JSON.stringify(ch)}(U+${cp.toString(16).toUpperCase()})`).join(' ')
  console.log(`  ${label}：待覆盖字符 ${need.size} 个 · **两套都没有 ${none.length} 个** · 只被一套覆盖 ${one.length} 个`)
  if (none.length) console.log(`     缺字: ${fmt(none, 40)}${none.length > 40 ? ` … 共 ${none.length} 个` : ''}`)
  if (one.length) console.log(`     单套: ${fmt(one, 20)}`)
  return none
}

let bad = 0

/* ---------------- 渲染前闸门模式：只查一个 deck ---------------- */
if (DECK) {
  const deck = JSON.parse(readFileSync(DECK, 'utf8'))
  const mid = deck.style?.masterId
  const dir = join(ROOT, 'masters', mid || '')
  if (!existsSync(join(dir, 'master.json'))) {
    console.error(`✗ --deck 给了未知母版 "${mid}"（列不出字体）`)
    process.exit(2)
  }
  const { man, srcDir, files, err } = masterFonts(dir)
  if (err) { console.error(`✗ ${err}`); process.exit(2) }
  const fonts = {}
  for (const f of files) fonts[f] = loadCoverage(join(srcDir, f))
  console.log(`=== 字体覆盖闸门（渲染前）=== deck=${DECK.split(/[\\/]/).pop()}  母版=${man.id}  字体=${srcDir}`)
  const need = new Map()
  charsOf(JSON.stringify(deck), need)          // 整份 deck 的文本（含 meta/style 的值，宁可从严）
  if (EXTRA) charsOf(EXTRA, need)
  const none = report(fonts, need, 'deck 文本')
  if (none.length) {
    bad++
    console.error(`\n✗ 字体覆盖闸门：deck 里有 ${none.length} 个字符**两套内嵌字体都没有** → 服务器上会渲成豆腐块（本机有 CJK 字体所以看不出来）`)
    console.error(`  可执行建议：① 改写这一处（换近义字/去掉 emoji）；② 去掉 emoji 与生僻符号；③ 若确需保留，把该字加进 fonts/chars-cmn.txt 后重跑 python fonts/make-fonts.py`)
    console.error(`  缺字清单: ${none.slice(0, 60).map(([ch, cp]) => `${JSON.stringify(ch)}(U+${cp.toString(16).toUpperCase()})`).join(' ')}`)
    process.exit(1)
  }
  console.log('结论: PASS（deck 文本 ⊆ 内嵌字体覆盖）')
  process.exit(0)
}

/* ---------------- 全量体检模式（**口径见 K14**） ----------------
   ★ 判据建立在**产物侧**：产物 `index.html` 的文本节点/属性 + 该档 meta 里嵌的 deck 文本 = **真会画出来的字**。
   ★ 源码侧（母版 HTML/CSS/JS、chars-cmn.txt）**只作提前预警**，**不判红**；`*.md` 一律不进判据。
   ★ `--legacy`：按**旧口径**（源码侧也算缺字 ⇒ 判红）跑一次，用于出**对照证据**。 */
const LEGACY = args.includes('--legacy')

/** 带"来源 + 行号"的收集（源码侧预警要**点名到文件:行号**） */
function charsOfLocated(text, file, into) {
  String(text).split(/\r?\n/).forEach((ln, i) => {
    for (const ch of ln) {
      if (ch === '\t') continue
      if (!into.has(ch)) into.set(ch, new Set())
      into.get(ch).add(`${file}:${i + 1}`)
    }
  })
  return into
}
/** 剥掉 CSS 注释（`/* … *\/`）—— 注释**不渲染**，不许进判据（K14 的教训） */
function stripCSSComments(s) { return String(s).replace(/\/\*[\s\S]*?\*\//g, ' ') }
/** 从 CSS 文本抽 `content:` 的**会渲染文本**（单双引号两种写法） */
function charsOfContent(css, into) {
  for (const m of stripCSSComments(css).matchAll(/content\s*:\s*(?:'([^']*)'|"([^"]*)")/g)) charsOf(m[1] ?? m[2] ?? '', into)
  return into
}
/** 产物侧需覆盖字符：**覆盖范围** = HTML 文本节点 + 会渲染的属性值（title/alt/aria-label/placeholder）
 *  + inline `<style>` 与产物 `assets/master.css` 的 `content:` 值 + 该档 meta 里嵌的 deck 文本。
 *  ★ **已知缺口**见 REPORT.md（K14 段末）：如 `content: counter()`/CSS 变量拼接、运行期 JS 才写入的文本、
 *    画在 canvas 里的字、外部图片内的字 —— 这些**目前扫不到**（不许当作"不存在"）。 */
function productNeed(dir) {
  const need = new Map()
  const ip = join(dir, 'index.html')
  if (existsSync(ip)) {
    let h = readFileSync(ip, 'utf8')
    h = h.replace(/<!--[\s\S]*?-->/g, ' ')            // HTML 注释不渲染
    charsOfContent(h, need)                            // inline <style> 的 content:
    h = h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    for (const m of h.matchAll(/(?:title|alt|aria-label|placeholder)="([^"]*)"/gi)) charsOf(m[1], need)
    charsOf(h.replace(/<[^>]*>/g, ' '), need)
  }
  charsOfContent(existsSync(join(dir, 'assets', 'master.css')) ? readFileSync(join(dir, 'assets', 'master.css'), 'utf8') : '', need)
  for (const f of ['image-meta.json', 'chart-meta.json']) {
    const p = join(dir, f)
    if (!existsSync(p)) continue
    try { charsOf(JSON.stringify(JSON.parse(readFileSync(p, 'utf8')).deck || {}), need) } catch { /* ignore */ }
  }
  return need
}

console.log('=== 字体覆盖闸门（全量体检）===')
console.log('★ 口径（K14）：**产物侧缺字 ⇒ 红**；**源码/注释/文档缺字 ⇒ 仅预警**（点名到 文件:行号）；`*.md` 不进判据。\n')

const FONTS_BY_MASTER = {}
for (const m of MASTERS) {
  const { man, srcDir, files, err } = masterFonts(m.dir)
  if (err) { console.error(`✗ ${err}`); bad++; continue }
  const fonts = {}
  console.log(`${man.id}  共用字体目录: ${srcDir}`)
  for (const f of files) {
    const cov = loadCoverage(join(srcDir, f))
    fonts[f] = cov
    console.log(`  ${f.padEnd(26)} ${cov ? cov.kb.toFixed(1) + 'KB  覆盖码点 ' + cov.set.size : '(缺失)'}`)
    if (!cov) bad++
  }
  FONTS_BY_MASTER[m.id] = { man, srcDir, files, fonts }
}
const anyFont = (cp) => MASTERS.some((m) => {
  const F = FONTS_BY_MASTER[m.id]
  return F && Object.keys(F.fonts).some((k) => F.fonts[k] && F.fonts[k].has(cp))
})

/* —— 产物侧（**判据**）—— */
/** `--products-root <dir[,dir]>`：扫指定根（**负向自证**要在临时副本上跑，见 K14 附） */
const PROD_ROOTS = valOf('--products-root')
  ? valOf('--products-root').split(',')
  : ['out', 'out-master-v2'].map((d) => join(HERE, d))
const prods = []
for (const r0 of PROD_ROOTS) {
  const r = /[\\/]/.test(r0) || /^[A-Za-z]:/.test(r0) ? resolve(r0) : join(HERE, r0)
  if (!existsSync(r)) { console.log(`  ⚠ 产物根不存在，跳过：${r}`); continue }
  for (const n of readdirSync(r)) {
    const dir = join(r, n)
    if (!existsSync(join(dir, 'index.html')) || existsSync(join(dir, 'STALE.md'))) continue
    prods.push(dir)
  }
}
console.log(`\n产物侧（**判据**）：${prods.length} 个产物`)
let prodMissing = 0
for (const dir of prods) {
  let mid = 'master-v1'
  for (const f of ['image-meta.json', 'chart-meta.json']) {
    const p = join(dir, f)
    if (!existsSync(p)) continue
    try { const j = JSON.parse(readFileSync(p, 'utf8')); if (j.masterId) { mid = j.masterId; break } } catch { /* ignore */ }
  }
  const need = productNeed(dir)
  const none = []
  for (const [ch] of need) if (!anyFont(ch.codePointAt(0))) none.push([ch, ch.codePointAt(0)])
  prodMissing += none.length
  console.log(`  ${none.length ? '✗' : '✓'} ${dir.replace(HERE + '\\', '').padEnd(40)} ${mid} · 需要 ${need.size} · **两套都没有 ${none.length}**${none.length ? '  ' + none.slice(0, 20).map(([ch, cp]) => `${JSON.stringify(ch)}(U+${cp.toString(16).toUpperCase()})`).join(' ') : ''}`)
  if (none.length) bad++
}
console.log(`产物侧合计：**缺失 = ${prodMissing}**${prodMissing === 0 ? '  ✓ PASS' : '  ✗ 真缺陷（服务器上会渲成豆腐块）'}`)

/* —— 源码侧（**仅预警**，不判红；`--legacy` 时按旧口径判红）—— */
const srcNeed = new Map()
for (const m of MASTERS) {
  const F = FONTS_BY_MASTER[m.id]
  if (!F) continue
  const sf = join(F.srcDir, 'chars-cmn.txt')
  if (existsSync(sf)) charsOfLocated(readFileSync(sf, 'utf8'), 'fonts/chars-cmn.txt', srcNeed)
  for (const f of ['master-16x9.html', 'master-9x16.html', join('assets', 'master.css'), join('assets', 'master.js')]) {
    const p = join(m.dir, f)
    if (existsSync(p)) charsOfLocated(readFileSync(p, 'utf8'), `${m.id}/${f}`, srcNeed)
  }
}
const srcMiss = []
for (const [ch, where] of srcNeed) if (!anyFont(ch.codePointAt(0))) srcMiss.push([ch, ch.codePointAt(0), [...where]])
console.log(`\n源码侧（${LEGACY ? '**旧口径：判红**' : '**仅预警，不判红**'}）：待覆盖 ${srcNeed.size} · 缺 ${srcMiss.length}`)
for (const [ch, cp, where] of srcMiss) {
  console.log(`  ⚠ ${JSON.stringify(ch)}(U+${cp.toString(16).toUpperCase()}) 出现在 ${where.slice(0, 5).join(' / ')}${where.length > 5 ? ` … 共 ${where.length} 处` : ''}`)
}
if (srcMiss.length && !LEGACY) console.log('  ⇒ 都在**注释/文档/字表**里，不会画到画面 ⇒ 按 K14 **不判红**（要严就用 `--legacy` 复现旧口径）')
if (LEGACY && srcMiss.length) bad++

/* —— 运行期写入点清单 = **断言**（"验证过一次 ≠ 会一直成立"；将来改 JS 必须被拦住）——
   期望：每套母版 **恰好 1 个**写入点，且其内容来自 `i % 10`（= **纯数字 0–9**，已在产物侧覆盖内）。
   新增写入点 / 生成式变化 ⇒ **红 + 要求人复核**（因为"会被写入的字符集"可能变宽）。 */
console.log('\n运行期写入点断言（每套母版 · 期望 1 个 + `i % 10`）：')
const WRITE_RE = /(textContent|innerText|innerHTML|insertAdjacentHTML|document\.write)\s*=/g
for (const m of MASTERS) {
  const p = join(m.dir, 'assets', 'master.js')
  if (!existsSync(p)) { console.log(`  ⚠ ${m.id}: 无 assets/master.js，跳过`); continue }
  const js = readFileSync(p, 'utf8')
  const hits = [...js.matchAll(WRITE_RE)]
  const digits = /i\s*%\s*10/.test(js)
  const okA = hits.length === 1
  const okB = digits
  console.log(`  ${okA && okB ? '✓' : '✗'} ${m.id}: 写入点 ${hits.length} 个（期望 **1**）· 数字生成式 \`i % 10\` = ${digits ? '在' : '**不在**'}`)
  if (!(okA && okB)) {
    bad++
    console.error(`      ✗ ${m.id} 的运行期写入点清单**变了** ⇒ **必须人复核**：写入点变化意味着"会被写入的字符集"可能变宽（新字符必须纳入产物侧判据）`)
    for (const h of hits) console.error(`        · ${h[0]}（第 ${js.slice(0, h.index).split('\n').length} 行）`)
  }
}

console.log(`\n结论: ${bad === 0
  ? `PASS（**产物侧缺字 = ${prodMissing}**；源码侧缺字 ${srcMiss.length} 个仅预警）`
  : `FAIL（${bad} 项不达标）`}`)
process.exit(bad ? 1 : 0)
