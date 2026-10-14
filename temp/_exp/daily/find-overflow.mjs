#!/usr/bin/env node
/**
 * temp/_exp/daily/find-overflow.mjs —— 闸门只说"溢出 x11 · 越界 1"，**不说是谁**。
 * 这支工具把越界/溢出的元素**点名**出来（标签/类名/矩形/根因提示），修版面时不用猜。
 * 跑法：node temp/_exp/daily/find-overflow.mjs <产物.html> [w] [h]
 */
import path from 'node:path'
import { createRequire } from 'node:module'
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const file = process.argv[2]
const W = Number(process.argv[3] || 720), H = Number(process.argv[4] || 1280)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] })
const page = await browser.newPage()
await page.setViewport({ width: W, height: H })
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
await page.goto('file:///' + path.resolve(file).replace(/\\/g, '/'), { waitUntil: 'load', timeout: 120000 })
await new Promise((r) => setTimeout(r, 200))
const out = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth
  const rows = []
  document.querySelectorAll('body *').forEach((el) => {
    if (getComputedStyle(el).position === 'fixed') return
    const b = el.getBoundingClientRect()
    if (b.width < 1 || b.height < 1) return
    const over = Math.round(b.right - vw)
    if (over > 1 || b.left < -1) {
      const cls = (el.className && typeof el.className === 'string') ? el.className : ''
      // 顺带把祖先链的矩形也带上 —— 溢出往往是"祖先被挤出去了"，只看最内层会修错地方
      const chain = []
      let n = el.parentElement
      while (n && n !== document.body) {
        const nb = n.getBoundingClientRect()
        const st = getComputedStyle(n)
        chain.push(`${n.tagName.toLowerCase()}.${String(n.className || '').slice(0, 18)}[${Math.round(nb.left)}~${Math.round(nb.right)} w${Math.round(nb.width)} ${st.display}/${st.writingMode || 'horizontal-tb'}]`)
        n = n.parentElement
      }
      rows.push({
        tag: el.tagName.toLowerCase(), cls: cls.slice(0, 40),
        left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width),
        over, txt: String(el.textContent || '').trim().slice(0, 12),
        parent: el.parentElement ? (el.parentElement.tagName.toLowerCase() + '.' + String(el.parentElement.className || '').slice(0, 24)) : '',
        chain,
      })
    }
  })
  return { vw, rows }
})
await browser.close()
console.log(`  ${W}×${H} · 视口宽 ${out.vw} · 越界元素 ${out.rows.length} 个`)
out.rows.slice(0, 12).forEach((r) => {
  console.log(`   ${r.tag}.${r.cls}  left ${r.left} right ${r.right} w ${r.w} over ${r.over} 「${r.txt}」 ← 父 ${r.parent}`)
  if (r.chain && r.chain.length) console.log('      祖先链：' + r.chain.join('  <  '))
})
if (out.rows.length) {
  const t = out.rows[0]
  console.log(`  → 最外那个：${t.tag}.${t.cls}（超 ${t.over}px）；修的时候先看它的宽是"文字撑出来的"还是"显式宽度"`)
}
