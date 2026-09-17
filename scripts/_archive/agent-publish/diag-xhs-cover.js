const { chromium } = require('playwright')
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const out = {}
    out.coverText = Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => {
      const t = (e.innerText || '').trim()
      return t && t.length <= 16 && /封面/.test(t)
    }).map((e) => ({ tag: e.tagName, cls: String(e.className || '').slice(0, 55), text: (e.innerText || '').trim().slice(0, 25) })).slice(0, 25)
    out.coverCls = Array.from(document.querySelectorAll('[class*="cover"],[class*="Cover"]')).filter(vis).map((e) => ({
      tag: e.tagName, cls: String(e.className || '').slice(0, 60), text: (e.innerText || '').trim().slice(0, 20),
    })).slice(0, 20)
    out.imgInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((e) => ({
      accept: (e.getAttribute('accept') || '').slice(0, 45), visible: vis(e), cls: String(e.className || '').slice(0, 40),
    }))
    return out
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
