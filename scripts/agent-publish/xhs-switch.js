const { chromium } = require('playwright')
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const r = await page.evaluate(() => {
    const sw = document.querySelector('.pk-title-switch .d-switch') || document.querySelector('.pk-title-switch')
    const inner = sw ? (sw.getAttribute('class') || '') : ''
    const aria = sw ? (sw.getAttribute('aria-checked') || '') : ''
    // 找所有 d-switch 相关
    const all = Array.from(document.querySelectorAll('.pk-title-switch *')).slice(0, 5).map((e) => ({ tag: e.tagName, cls: String(e.className || '').slice(0, 70), aria: e.getAttribute('aria-checked') || '' }))
    return { 外层cls: inner, aria, 子元素: all }
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
