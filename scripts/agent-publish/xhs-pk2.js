const { chromium } = require('playwright')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[PK] ' + m)
  const count = () =>
    page.evaluate(() => {
      const vis = (e) => !!(e && e.offsetParent !== null)
      return {
        加号: Array.from(document.querySelectorAll('.pk-cover-list-add-btn')).filter(vis).length,
        封面项: Array.from(document.querySelectorAll('[class*="artistic-bg"]')).filter(vis).length,
        开关: Array.from(document.querySelectorAll('.pk-title-switch')).filter(vis).length,
      }
    }).catch(() => ({}))
  log('点前: ' + JSON.stringify(await count()))
  const clicked = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const sw = Array.from(document.querySelectorAll('.pk-title-switch')).filter(vis)[0]
    if (sw) { sw.click(); return 'switch' }
    const el = Array.from(document.querySelectorAll('*')).filter(vis).find((e) => (e.innerText || '').trim() === 'PK封面')
    if (el) { el.click(); return 'text' }
    return 'none'
  })
  log('点击目标=' + clicked)
  await sleep(2500)
  log('点后: ' + JSON.stringify(await count()))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
