const { chromium } = require('playwright')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const dump = async (tag) => {
    const r = await page.evaluate(() => {
      const vis = (e) => !!(e && e.offsetParent !== null)
      const hit = (kw) => Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => (e.innerText || '').trim() === kw)
        .map((e) => ({ tag: e.tagName, cls: String(e.className || '').slice(0, 50), box: (() => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y)] })() })).slice(0, 5)
      return { 编辑封面: hit('编辑封面'), 设置封面: hit('设置封面'), coverContainerCls: (() => { const c = document.querySelector('.cover-container'); return c ? String(c.className) : '无' })() }
    })
    console.log('[' + tag + '] ' + JSON.stringify(r))
  }
  await dump('初始')
  // hover cover-container（视频区）
  const cc = await page.$('.cover-container')
  if (cc) {
    await cc.hover({ timeout: 3000 }).catch((e) => console.log('hover 异常 ' + e.message.slice(0, 40)))
    await sleep(1500)
    await dump('hover .cover-container 后')
  }
  // hover 视频元素
  const v = await page.$('video')
  if (v) { await v.hover({ timeout: 3000 }).catch(() => {}); await sleep(1500); await dump('hover video 后') }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
