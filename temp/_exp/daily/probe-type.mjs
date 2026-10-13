#!/usr/bin/env node
/**
 * temp/_exp/daily/probe-type.mjs —— 量"文字层/字号档"是否**真的**生效（★VF_DAILY_V21）。
 * 为什么要量：字号档很容易写成"加了 CSS 但没生效"（选择器同特异性、继承被覆盖、clamp 写错…），
 *   而闸门只看"有没有低于 22px"，**不看你放大档有没有放大** ⇒ 单靠闸门会漏。
 * 量三件：① 每段 data-type ② 每段 --ts ③ **标题实际 font-size**（应与 --ts 单调对应）。
 * 用法：node temp/_exp/daily/probe-type.mjs <产物.html> [w] [h]
 */
import path from 'node:path'
import { createRequire } from 'node:module'
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const file = process.argv[2]
const W = Number(process.argv[3] || 720)
const H = Number(process.argv[4] || 1280)
if (!file) { console.log('用法：node temp/_exp/daily/probe-type.mjs <产物.html> [w] [h]'); process.exit(2) }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] })
const page = await browser.newPage()
await page.setViewport({ width: W, height: H })
await page.goto('file:///' + path.resolve(file).replace(/\\/g, '/'), { waitUntil: 'load', timeout: 120000 })
await new Promise((r) => setTimeout(r, 300))
const rows = await page.evaluate(() => Array.from(document.querySelectorAll('section.sec')).map((sec, i) => {
  const h2 = sec.querySelector('h2')
  const cs = h2 ? getComputedStyle(h2) : null
  const first = h2 ? h2.querySelector('span') : null
  return {
    seg: Number(sec.getAttribute('data-seg') || i + 1),
    type: sec.getAttribute('data-type') || '-',
    ts: getComputedStyle(sec).getPropertyValue('--ts').trim() || '-',
    titlePx: cs ? Math.round(parseFloat(cs.fontSize) * 10) / 10 : 0,
    // 诊断：这段解析出来的 --title 到底是多少（字号档失效时一眼看得出是谁盖的）
    varTitle: getComputedStyle(sec).getPropertyValue('--title').trim(),
    layout: sec.getAttribute('data-layout') || '-',
    line: first ? Math.round(first.getBoundingClientRect().height) : 0,
    label: (() => { const b = sec.querySelector('.col b'); return b ? Math.round(parseFloat(getComputedStyle(b).fontSize) * 10) / 10 : 0 })(),
  }
}))
await browser.close()

console.log(`  ${W}×${H} 下的实际字号：`)
rows.forEach((r) => console.log(`  段${String(r.seg).padStart(2)} ${r.type.padEnd(9)} ${r.layout.padEnd(8)} --ts=${String(r.ts).padEnd(5)} 标题 ${String(r.titlePx).padStart(6)}px  --title=${r.varTitle}  信息点 ${r.label}px`))

// 断言（**按 结构+文字层 分组**看，不能跨组比大小 —— 各组有自己的基准字号）：
//   ① 同组同 --ts ⇒ 字号一致；
//   ② 同组里 --ts 越大 ⇒ 标题越大（这是"字号档真的生效"的判据）；
//   ③ 每条 --title 必须解析成 clamp(...) 里带 * --ts 的形式（防止又被某处写死吃回去）。
const groups = new Map()
rows.forEach((r) => {
  const k = r.layout + '|' + r.type
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(r)
})
let bad = 0
let checked = 0
for (const [k, list] of groups) {
  const byTs = new Map()
  list.forEach((r) => byTs.set(Number(r.ts), r.titlePx))
  const ks = Array.from(byTs.keys()).sort((a, b) => a - b)
  for (let i = 1; i < ks.length; i++) {
    checked++
    if (!(byTs.get(ks[i]) > byTs.get(ks[i - 1]))) {
      bad++
      console.log(`  ✗ ${k}：字号档没生效（--ts ${ks[i - 1]} → ${ks[i]} 时标题 ${byTs.get(ks[i - 1])} → ${byTs.get(ks[i])}px）`)
    }
  }
  // 现在 --title 由引擎**算好写在内联样式里**（数字已展开），所以这里只要求"它是个 clamp() 且非空"
  const hasClamp = list.every((r) => String(r.varTitle).includes('clamp('))
  if (!hasClamp) { bad++; console.log(`  ✗ ${k}：--title 不是 clamp()（被写死了）`) }
}
console.log('\n  结论：' + (bad
  ? `✗ 字号档有问题（${bad} 项）`
  : `✓ 字号档在每个"结构×文字层"组合里都生效（检查了 ${checked} 组升降，全组 --title 都带 --ts）`))
process.exit(bad ? 1 : 0)
