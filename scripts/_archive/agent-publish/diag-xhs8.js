const { chromium } = require('playwright')
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const out = {}
    // 封面列表项（artistic-bg / cover-image column / default）
    out.items = Array.from(document.querySelectorAll('[class*="artistic-bg"], [class*="cover-image"], [class*="cover--column"] > *'))
      .filter(vis).map((e) => {
        const b = e.getBoundingClientRect()
        return { tag: e.tagName, cls: String(e.className || '').slice(0, 60), text: (e.innerText || '').trim().slice(0, 20), x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), w: Math.round(b.width) }
      }).slice(0, 20)
    // 含 + / ＋ 的元素
    out.plus = Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => {
      const t = (e.innerText || '').trim()
      return t === '+' || t === '＋' || t === '添加' || /add|plus|upload/i.test(String(e.className))
    }).map((e) => { const b = e.getBoundingClientRect(); return { tag: e.tagName, cls: String(e.className || '').slice(0, 55), text: (e.innerText || '').trim().slice(0, 12), x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } }).slice(0, 15)
    // 封面区所有 img
    out.imgs = Array.from(document.querySelectorAll('.cover-plugin-preview img, [class*="cover"] img')).filter(vis).map((e) => { const b = e.getBoundingClientRect(); return { cls: String(e.className || '').slice(0, 40), x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), w: Math.round(b.width) } }).slice(0, 12)
    return out
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
