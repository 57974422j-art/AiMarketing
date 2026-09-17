const { chromium } = require('playwright')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[PK] ' + m)
  // dump PK 相关元素
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const out = []
    for (const e of Array.from(document.querySelectorAll('[class*="pk-cover"], [class*="pk-title"], [class*="PK"], *'))) {
      if (!vis(e)) continue
      const t = (e.innerText || '').trim()
      const cls = String(e.className || '')
      if (/pk/i.test(cls) && t.length <= 20) {
        const b = e.getBoundingClientRect()
        out.push({ tag: e.tagName, cls: cls.slice(0, 55), text: t.slice(0, 20), x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) })
      }
      if (out.length > 15) break
    }
    return out
  })
  console.log(JSON.stringify(r, null, 1))
  // 找含 PK封面 的可见元素（开关/按钮）并点
  const hit = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const el = Array.from(document.querySelectorAll('*')).filter(vis).find((e) => {
      const t = (e.innerText || '').trim()
      return t === 'PK封面' || t.indexOf('PK封面') === 0
    }) || Array.from(document.querySelectorAll('.pk-title-switch')).filter(vis).find(() => true)
    })
    if (el) { el.click(); return { clicked: true, cls: String(el.className).slice(0, 50), text: (el.innerText || '').trim().slice(0, 20) } }
    return { clicked: false }
  })
  log('点PK封面=' + JSON.stringify(hit))
  await sleep(2500)
  const after = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    return { 加号: Array.from(document.querySelectorAll('.pk-cover-list-add-btn')).filter(vis).length, 封面项: Array.from(document.querySelectorAll('[class*="artistic-bg"]')).filter(vis).length }
  })
  log('点后: ' + JSON.stringify(after))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
