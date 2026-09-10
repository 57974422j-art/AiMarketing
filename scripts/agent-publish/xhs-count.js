const { chromium } = require('playwright')
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const cnt = (sel) => Array.from(document.querySelectorAll(sel)).filter(vis).length
    const list = Array.from(document.querySelectorAll('.pk-cover-list-add-btn, [class*="cover-list"] > *, [class*="artistic-bg"], .cover-image.column'))
      .filter(vis).map((e) => {
        const b = e.getBoundingClientRect()
        return { cls: String(e.className || '').slice(0, 45), text: (e.innerText || '').trim().slice(0, 12), x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
      })
    return {
      加号: cnt('.pk-cover-list-add-btn'),
      封面项_artistic: cnt('[class*="artistic-bg"]'),
      封面项_coverImage: cnt('.cover-image.column'),
      列表: list.slice(0, 15),
      pkMode: cnt('[class*="pk-cover"]'),
    }
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
