const { chromium } = require('playwright')
const COVER = 'E:/ai-marketing/storage/cover_1788928821192.jpg'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[XC] ' + m)
  // ① hover 封面区容器（实测这层才会出「编辑封面」）
  const box = await page.evaluate(() => {
    const e = document.querySelector('.publish-page-content-cover-content') || document.querySelector('.cover-plugin-preview')
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  if (!box) { log('未找到封面区容器'); await b.close(); return }
  await page.mouse.move(box.x, box.y); await sleep(500); await page.mouse.move(box.x + 5, box.y + 5); await sleep(1400)
  log('已 hover 封面区 ' + JSON.stringify(box))
  // ② 点「编辑封面」
  const clicked = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const el = Array.from(document.querySelectorAll('*')).filter(vis).find((e) => (e.innerText || '').trim() === '编辑封面')
    if (el) { el.click(); return true }
    return false
  })
  log('点编辑封面=' + clicked)
  if (!clicked) { await b.close(); return }
  await sleep(3000)
  // ③ 图片 input 上传
  let imgIn = await page.$('input.upload-input[accept*="image"]')
  if (!imgIn) imgIn = await page.$('input[type="file"][accept*="image"]')
  if (!imgIn) { log('❌ 未找到图片 input'); await b.close(); return }
  await imgIn.setInputFiles(COVER)
  log('✅ 封面已上传')
  await sleep(4000)
  // ④ 完成
  for (const t of ['完成', '确定', '保存']) {
    const btn = page.getByText(t, { exact: true }).first()
    if (await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 2500 }).catch(() => {}); log('✅ 点了「' + t + '」'); await sleep(2500); break }
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
