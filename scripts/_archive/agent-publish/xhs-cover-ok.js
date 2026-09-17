const { chromium } = require('playwright')
const COVER = 'E:/ai-marketing/storage/cover_1788928821192.jpg'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[XC] ' + m)
  // ＋号是否在
  log('＋号数=' + (await page.$$('.pk-cover-list-add-btn')).length)
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
    page.locator('.pk-cover-list-add-btn').first().click({ timeout: 4000 }).catch((e) => log('＋点击异常 ' + e.message.slice(0, 50))),
  ])
  if (fc) { await fc.setFiles(COVER); log('✅ 封面已上传（＋→文件框）'); await sleep(4000) }
  else {
    const ci = await page.$('input.upload-input[accept*="image"]')
    if (ci) { await ci.setInputFiles(COVER); log('✅ 封面已上传(input兜底)'); await sleep(4000) }
    else log('❌ 上传失败')
  }
  // 完成/应用
  for (const t of ['完成', '确定', '保存']) {
    const btn = page.getByText(t, { exact: true }).first()
    if (await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 2500 }).catch(() => {}); log('✅ 点了「' + t + '」'); await sleep(2000); break }
  }
  log('结束后 ＋号数=' + (await page.$$('.pk-cover-list-add-btn')).length)
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
