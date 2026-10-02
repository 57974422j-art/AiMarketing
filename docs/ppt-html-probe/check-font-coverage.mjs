#!/usr/bin/env node
/**
 * check-font-coverage.mjs —— **字体覆盖闸门**（"核 hyperframes-localize-fonts" 的落地）
 *
 * 背景：引擎（hyperframes v0.8.111）**没有** `localize-fonts` 命令、包内也 0 命中
 *   （两条独立证据：CLI 命令表 + 源码 grep）⇒ "字体本地化"必须由我们自己在管道里保证。
 *
 * 为什么必须查：内嵌字体是**子集**（woff2）。若某字的字形不在子集里，
 *   浏览器会**回退到系统字体** —— 本机有 CJK 字体时看不出来（静默通过），
 *   **服务器上没有就会渲成豆腐块（tofu）**：典型的"平台默认值"地雷 + 静默降级。
 *   本脚本把这件事变成**可量化**的：逐字查 cmap。
 *
 * 判据：
 *   - 某字**两套字体都没有** → 必然 tofu ⇒ **拦**（error）
 *   - 某字只被其中一套覆盖 → 取决于该字的文本用的是哪套族（serif/sans）⇒ **警告**（warn）
 * 用法：
 *   node check-font-coverage.mjs                 # 扫母版源码 + 全部 examples/*.json
 *   node check-font-coverage.mjs --extra "龘🙂"  # 额外注入字符（做敏感性自证用）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
// fontkit 是 CJS（无 default 导出）⇒ 用 createRequire 取，别跟打包器较劲
const fontkit = createRequire(import.meta.url)('fontkit')

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const args = process.argv.slice(2)
const extraIdx = args.indexOf('--extra')
const EXTRA = extraIdx >= 0 ? (args[extraIdx + 1] || '') : ''

/** 与 subset-fonts.py 的安全集保持一致（ASCII 可见 + 常用中文标点/符号） */
const SAFE = (() => {
  let s = ''
  for (let c = 0x20; c < 0x7f; c++) s += String.fromCharCode(c)
  return s + '　、。，；：？！…—～·《》〈〉「」『』（）【】〔〕“”‘’％＋－×÷≈≤≥→←↑↓°￥$€¥'
})()

const MASTERS = [
  { id: 'master-v1', dir: join(ROOT, 'masters', 'master-v1') },
  { id: 'master-v2', dir: join(ROOT, 'masters', 'master-v2') },
]
const FONT_FILES = ['NotoSerifSC-sub.woff2', 'NotoSansSC-sub.woff2']

function loadCoverage(p) {
  if (!existsSync(p)) return null
  const font = fontkit.openSync(p)
  const set = new Set()
  // fontkit: characterSet 是码点数组；Woff2 走 brotli 解压（本仓库已装 brotli）
  for (const cp of font.characterSet || []) set.add(cp)
  return { font, set, has: (cp) => set.has(cp) || (font.hasGlyphForCodePoint ? font.hasGlyphForCodePoint(cp) : false) }
}

/** 收集"必须被覆盖"的字符：母版源码（生成期的模板文本）+ 全部 deck（AI 实际会写的文本）+ 安全集 */
function collectChars(mdir) {
  const out = new Map()   // char → 来源标签集合
  const add = (text, from) => {
    for (const ch of String(text)) {
      if (ch === '\n' || ch === '\r' || ch === '\t') continue
      if (!out.has(ch)) out.set(ch, new Set())
      out.get(ch).add(from)
    }
  }
  for (const f of ['master-16x9.html', 'master-9x16.html',
    join('assets', 'master.css'), join('assets', 'master.js')]) {
    const p = join(mdir, f)
    if (existsSync(p)) add(readFileSync(p, 'utf8'), `母版源码:${f}`)
  }
  return { chars: out, add }
}

const deckDir = join(HERE, 'examples')
const decks = existsSync(deckDir) ? readdirSync(deckDir).filter((f) => f.endsWith('.json')) : []
const deckText = decks.map((f) => ({ f, text: readFileSync(join(deckDir, f), 'utf8') }))

let errors = 0, warns = 0
console.log('=== 字体覆盖闸门（cmap 逐字查）===')
for (const m of MASTERS) {
  const fonts = {}
  for (const fn of FONT_FILES) {
    const p = join(m.dir, 'assets', fn)
    const cov = loadCoverage(p)
    fonts[fn] = cov
    const kb = cov ? (readFileSync(p).length / 1024).toFixed(1) + 'KB' : '(缺失)'
    console.log(`\n${m.id} · ${fn}  ${kb}  覆盖码点 ${cov ? cov.set.size : 0}`)
  }
  const { chars, add } = collectChars(m.dir)
  add(SAFE, '安全集(与 subset-fonts.py 一致)')
  for (const { f, text } of deckText) add(text, `deck:${f}`)
  if (EXTRA) add(EXTRA, '--extra 注入')

  const noneOf = [], oneOf = []
  for (const [ch, from] of chars) {
    const cp = ch.codePointAt(0)
    const covered = FONT_FILES.filter((fn) => fonts[fn] && fonts[fn].has(cp))
    if (covered.length === 0) noneOf.push([ch, cp, from])
    else if (covered.length === 1) oneOf.push([ch, cp, covered[0], from])
  }
  console.log(`  待覆盖字符 ${chars.size} 个（母版源码 + ${decks.length} 个 deck + 安全集${EXTRA ? ' + --extra' : ''}）`)
  console.log(`  ★ 两套字体都没有（**必然 tofu**）：${noneOf.length} 个`)
  if (noneOf.length) {
    errors++
    const show = noneOf.slice(0, 40).map(([ch, cp]) => `${JSON.stringify(ch)}(U+${cp.toString(16).toUpperCase()})`)
    console.log(`     ${show.join(' ')}${noneOf.length > 40 ? ` … 共 ${noneOf.length} 个` : ''}`)
    console.log(`     来源举例: ${[...noneOf[0][2]].slice(0, 3).join(' / ')}`)
  }
  console.log(`  只被一套覆盖（取决于文本用 serif/sans，**条件性 tofu**）：${oneOf.length} 个`)
  if (oneOf.length) {
    warns++
    const byFont = {}
    for (const [, , f] of oneOf) byFont[f] = (byFont[f] || 0) + 1
    console.log(`     分布: ${Object.entries(byFont).map(([k, v]) => `${k}=${v}`).join(' · ')}`)
    const show = oneOf.slice(0, 20).map(([ch, cp]) => `${JSON.stringify(ch)}(U+${cp.toString(16).toUpperCase()})`)
    console.log(`     举例: ${show.join(' ')}${oneOf.length > 20 ? ` …` : ''}`)
  }
}
console.log(`\n结论: ${errors === 0
  ? `PASS（无"必然 tofu"字符${warns ? `；但有 ${warns} 个母版存在"条件性 tofu"字符，见上` : ''}）`
  : `FAIL（${errors} 个母版存在"两套字体都没有"的字符 ⇒ 本机可能靠系统字体蒙过，服务器上会渲成豆腐块）`}`)
process.exit(errors ? 1 : 0)
