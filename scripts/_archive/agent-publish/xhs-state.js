const { chromium } = require('playwright')
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const find = (kw) => Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => (e.innerText || '').trim() === kw)
      .map((e) => { const b = e.getBoundingClientRect(); return { tag: e.tagName, cls: String(e.className || '').slice(0, 45), x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } }).slice(0, 4)
    const sw = Array.from(document.querySelectorAll('.pk-title-switch')).filter(vis)[0]
    return {
      开关: sw ? { cls: String(sw.className).slice(0, 60), html: sw.outerHTML.slice(0, 180) } : null,
      PK已开_判据: { 加号: Array.from(document.querySelectorAll('.pk-cover-list-add-btn')).filter(vis).length, 推荐项: Array.from(document.querySelectorAll('[class*="artistic-bg"]')).filter(vis).length },
      主封面: find('主封面'),
      编辑封面: find('编辑封面'),
      设置封面: find('设置封面'),
      PK封面: find('PK封面'),
    }
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
