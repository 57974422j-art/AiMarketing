const { chromium } = require('playwright')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const hasEditCover = () => page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    return Array.from(document.querySelectorAll('*')).filter(vis).some((e) => (e.innerText || '').trim() === '编辑封面')
  }).catch(() => false)
  // 列出所有封面相关候选（容器/img）
  const cands = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const out = []
    for (const e of Array.from(document.querySelectorAll('[class*="cover"] img, [class*="cover"] div, .cover-container, [class*="preview"] img'))) {
      if (!vis(e)) continue
      const r = e.getBoundingClientRect()
      if (r.width < 40 || r.height < 40) continue
      out.push({ tag: e.tagName, cls: String(e.className || '').slice(0, 55), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) })
      if (out.length >= 12) break
    }
    return out
  })
  console.log('候选元素(' + cands.length + '):')
  cands.forEach((c, i) => console.log('  [' + i + '] ' + c.tag + '.' + c.cls + ' @' + c.x + ',' + c.y + ' ' + c.w + 'x' + c.h))
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i]
    await page.mouse.move(c.x, c.y)
    await sleep(400)
    await page.mouse.move(c.x + 4, c.y + 4)
    await sleep(1200)
    const ok = await hasEditCover()
    console.log('hover [' + i + '] ' + c.cls.slice(0, 35) + ' → 编辑封面出现=' + ok)
    if (ok) { console.log('>>> 命中: ' + c.tag + '.' + c.cls + ' @' + c.x + ',' + c.y); break }
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
