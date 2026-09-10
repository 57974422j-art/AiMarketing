const { chromium } = require('playwright')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  // 点「设置封面」
  await page.getByText('设置封面', { exact: true }).first().click({ timeout: 4000 }).catch((e) => console.log('点击异常 ' + e.message.slice(0,40)))
  await sleep(3000)
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const out = {}
    out.buttons = Array.from(new Set(Array.from(document.querySelectorAll('button,[role="button"],span,div,label'))
      .filter(vis).map((e) => (e.innerText || '').trim()).filter((t) => t && t.length <= 12))).slice(0, 50)
    out.fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((e) => ({
      accept: (e.getAttribute('accept') || '').slice(0, 45), visible: vis(e), cls: String(e.className || '').slice(0, 45),
    }))
    out.upLike = Array.from(document.querySelectorAll('[class*="upload"],[class*="Upload"]')).filter(vis).map((e) => ({
      tag: e.tagName, cls: String(e.className || '').slice(0, 55), text: (e.innerText || '').trim().slice(0, 20),
    })).slice(0, 20)
    out.panel = Array.from(document.querySelectorAll('[class*="modal"],[class*="dialog"],[class*="drawer"],[class*="panel"]')).filter(vis)
      .map((e) => ({ cls: String(e.className || '').slice(0, 60), text: (e.innerText || '').trim().slice(0, 120) })).slice(0, 6)
    return out
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
