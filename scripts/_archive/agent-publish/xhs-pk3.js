const { chromium } = require('playwright')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[PK] ' + m)
  const count = () => page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    return { 加号: Array.from(document.querySelectorAll('.pk-cover-list-add-btn')).filter(vis).length, 封面项: Array.from(document.querySelectorAll('[class*="artistic-bg"]')).filter(vis).length }
  }).catch(() => ({}))
  log('点前: ' + JSON.stringify(await count()))
  // playwright 真实点击开关
  try {
    await page.locator('.pk-title-switch').first().click({ timeout: 4000 })
    log('已 playwright 点击 .pk-title-switch')
  } catch (e) { log('click 异常: ' + e.message.slice(0, 60)) }
  await sleep(2500)
  log('点后: ' + JSON.stringify(await count()))
  // 若仍无加号——试点 PK封面 文本（真实点击）
  if ((await count()).加号 === 0) {
    try { await page.getByText('PK封面', { exact: true }).first().click({ timeout: 3000 }); log('已点 PK封面 文本'); } catch (e) { log('文本点击异常') }
    await sleep(2500)
    log('再点后: ' + JSON.stringify(await count()))
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
