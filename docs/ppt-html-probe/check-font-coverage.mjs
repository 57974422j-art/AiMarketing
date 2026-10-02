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
const ROOT = resolve(HERE, '..')
const args = process.argv.slice(2)
const valOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const EXTRA = valOf('--extra') || ''
const DECK = valOf('--deck') ? resolve(valOf('--deck')) : null

const MASTERS = ['master-v1', 'master-v2'].map((id) => ({ id, dir: join(ROOT, 'masters', id) }))

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

/* ---------------- 全量体检模式 ---------------- */
console.log('=== 字体覆盖闸门（全量体检 · cmap 逐字查）===')
for (const m of MASTERS) {
  const { man, srcDir, files, err } = masterFonts(m.dir)
  if (err) { console.error(`✗ ${err}`); bad++; continue }
  const fonts = {}
  console.log(`\n${man.id}  共用字体目录: ${srcDir.replace(ROOT + '\\', '')}`)
  for (const f of files) {
    const cov = loadCoverage(join(srcDir, f))
    fonts[f] = cov
    console.log(`  ${f.padEnd(26)} ${cov ? cov.kb.toFixed(1) + 'KB  覆盖码点 ' + cov.set.size : '(缺失)'}`)
    if (!cov) bad++
  }
  const need = new Map()
  const charsFile = join(srcDir, 'chars-cmn.txt')
  if (existsSync(charsFile)) {
    charsOf(readFileSync(charsFile, 'utf8'), need)
    console.log(`  chars-cmn.txt             ${(readFileSync(charsFile).length / 1024).toFixed(1)}KB`)
  } else { console.log('  !! 缺 chars-cmn.txt（字表必须入库）'); bad++ }
  for (const f of ['master-16x9.html', 'master-9x16.html', join('assets', 'master.css'), join('assets', 'master.js')]) {
    const p = join(m.dir, f)
    if (existsSync(p)) charsOf(readFileSync(p, 'utf8'), need)
  }
  const ex = join(HERE, 'examples')
  const decks = existsSync(ex) ? readdirSync(ex).filter((f) => f.endsWith('.json')) : []
  for (const f of decks) charsOf(readFileSync(join(ex, f), 'utf8'), need)
  if (EXTRA) charsOf(EXTRA, need)
  const none = report(fonts, need, `chars-cmn + 母版源码 + ${decks.length} 个 deck${EXTRA ? ' + --extra' : ''}`)
  if (none.length) bad++
}

console.log(`\n结论: ${bad === 0
  ? 'PASS（chars-cmn.txt / 母版源码 / 全部 deck 的文本都在内嵌字体覆盖内）'
  : `FAIL（${bad} 项不达标 ⇒ 缺字会在服务器上静默渲成豆腐块）`}`)
process.exit(bad ? 1 : 0)
