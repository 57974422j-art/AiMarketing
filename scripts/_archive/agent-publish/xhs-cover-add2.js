const { chromium } = require('playwright')
const COVER = 'E:/ai-marketing/storage/cover_1788928821192.jpg'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[XC] ' + m)
  const sel = '.pk-cover-list-add-btn, .pk-cover-list-add-icon, [class*="cover-list-add"]'
  log('元素数=' + (await page.$$(sel)).length)
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
    page.locator(sel).first().click({ timeout: 4000 }).catch((e) => log('click err ' + e.message.slice(0, 50))),
  ])
  if (fc) {
    await fc.setFiles(COVER)
    log('✅ 文件框已设封面')
    await sleep(4000)
    for (const t of ['完成', '确定', '保存']) {
      const btn = page.getByText(t, { exact: true }).first()
      if (await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 2500 }).catch(() => {}); log('✅ 点了「' + t + '」'); await sleep(2000); break }
    }
  } else {
    log('⚠️ 点＋号没触发文件框')
    const has = await page.$('input.upload-input[accept*="image"]')
    log('图片 input=' + (has ? '有' : '无'))
    if (has) { await has.setInputFiles(COVER); log('✅ 改用 input 上传'); await sleep(3500) }
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
