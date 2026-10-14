#!/usr/bin/env node
/**
 * temp/_exp/daily/probe-theme.mjs —— 量**"皮肤是否真的可读"**（★VF_DAILY_V23 扩皮肤库的配套探针）。
 * 为什么需要它：闸门只看"字号≥22px / 不溢出"，**不看颜色对比**；而新加 14 套皮肤最容易出的问题
 * 恰恰是"某种底色下标题发灰"（配方台只算了 token 的理论对比度，真产物里还有暗衬带/图片压字/半透明底）。
 * 所以这里在**真浏览器**里量：每个段落的 h2 实际颜色、它所在层的实际背景、以及两者对比度。
 * 跑法：node temp/_exp/daily/probe-theme.mjs <产物.html> [w] [h]
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
if (!file) { console.log('用法：node temp/_exp/daily/probe-theme.mjs <产物.html> [w] [h]'); process.exit(2) }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] })
const page = await browser.newPage()
await page.setViewport({ width: W, height: H })
await page.goto('file:///' + path.resolve(file).replace(/\\/g, '/'), { waitUntil: 'load', timeout: 120000 })
// 把动效钉到完成态（否则量到的是淡入中的半透明字，结论会错 —— 我第一次肉眼复核就栽在这上面）
await page.addStyleTag({ content: '.kick,.stamp,.col,h2 span{opacity:1 !important;transform:none !important}' })
await new Promise((r) => setTimeout(r, 400))

const rows = await page.evaluate(() => {
  const parse = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); return m ? [+m[1], +m[2], +m[3]] : null }
  // 找"实际背景"：从元素本身往上找第一个非透明背景色
  const bgOf = (el) => {
    let n = el
    while (n && n !== document.documentElement) {
      const b = parse(getComputedStyle(n).backgroundColor)
      const a = /rgba\([^)]*,\s*([\d.]+)\)/.exec(getComputedStyle(n).backgroundColor)
      if (b && (!a || parseFloat(a[1]) > 0.5)) return b
      n = n.parentElement
    }
    return parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255]
  }
  return Array.from(document.querySelectorAll('section.sec')).map((sec, i) => {
    const h2 = sec.querySelector('h2')
    const span = h2 ? h2.querySelector('span') : null
    const el = span || h2
    const cs = el ? getComputedStyle(el) : null
    return {
      seg: Number(sec.getAttribute('data-seg') || i + 1),
      theme: sec.getAttribute('data-type') || '',
      color: cs ? cs.color : '',
      opacity: cs ? cs.opacity : '1',
      bg: el ? bgOf(el) : null,
      text: el ? String(el.textContent || '').trim().slice(0, 12) : '',
    }
  })
})
const lum = (c) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const contrast = (a, b) => { if (!a || !b) return 0; const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }
const rgbToHex = (c) => (c ? '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('') : '-')

console.log(`  ${W}×${H} · 文字色 vs 实际背景（正文要 ≥4.5 才算可读）`)
let bad = 0
for (const r of rows) {
  const c = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(r.color)
  const fg = c ? [+c[1], +c[2], +c[3]] : null
  const k = contrast(fg, r.bg)
  const mark = k >= 4.5 ? '✓' : (k >= 3.0 ? '△' : '✗')
  if (k < 4.5) bad++
  console.log(`   段${String(r.seg).padStart(2)} 文字 ${rgbToHex(fg)} 底 ${rgbToHex(r.bg)} 对比 ${k.toFixed(2)} ${mark}  opacity=${r.opacity}  「${r.text}」`)
}
await browser.close()
console.log('\n  结论：' + (bad
  ? `✗ ${bad} 段的标题对比度 < 4.5 —— 这不是动效/缩图造成的，就是"颜色配错了"（浅底皮肤上的 overlay 白字就是典型）`
  : '✓ 每段标题对比都 ≥4.5（深底白字 / 浅底墨字两条路都验过）'))
process.exit(bad ? 1 : 0)
