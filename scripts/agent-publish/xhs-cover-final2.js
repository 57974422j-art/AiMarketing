const { chromium } = require('playwright')
const COVER = 'E:/ai-marketing/storage/cover_1788928821192.jpg'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[XC] ' + m)
  const hasEdit = () => page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    return Array.from(document.querySelectorAll('*')).filter(vis).some((e) => (e.innerText || '').trim() === '编辑封面')
  }).catch(() => false)

  // 候选：封面区容器 / 预览 / 封面列表 第一项
  const cands = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const out = []
    for (const e of Array.from(document.querySelectorAll('.publish-page-content-cover-content, .cover-plugin-preview, .cover-container, [class*="cover"] img, [class*="cover-image"]'))) {
      if (!vis(e)) continue
      const r = e.getBoundingClientRect()
      if (r.width < 40 || r.height < 40) continue
      out.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), cls: String(e.className || '').slice(0, 40) })
      if (out.length >= 10) break
    }
    return out
  })
  let hitPt = null
  for (const c of cands) {
    await page.mouse.move(c.x, c.y); await sleep(400); await page.mouse.move(c.x + 4, c.y + 4); await sleep(1100)
    if (await hasEdit()) { hitPt = c; log('命中: ' + c.cls + ' @' + c.x + ',' + c.y); break }
  }
  if (!hitPt) { log('❌ 没命中（编辑封面未出现）'); await b.close(); return }
  // 点编辑封面
  const clicked = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const el = Array.from(document.querySelectorAll('*')).filter(vis).find((e) => (e.innerText || '').trim() === '编辑封面')
    if (el) { el.click(); return true }
    return false
  })
  log('点编辑封面=' + clicked)
  if (!clicked) { await b.close(); return }
  await sleep(3000)
  let imgIn = await page.$('input.upload-input[accept*="image"]')
  if (!imgIn) imgIn = await page.$('input[type="file"][accept*="image"]')
  if (!imgIn) { log('❌ 未找到图片 input'); await b.close(); return }
  await imgIn.setInputFiles(COVER)
  log('✅ 封面已上传')
  await sleep(4000)
  for (const t of ['完成', '确定', '保存']) {
    const btn = page.getByText(t, { exact: true }).first()
    if (await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 2500 }).catch(() => {}); log('✅ 点了「' + t + '」'); await sleep(2000); break }
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
