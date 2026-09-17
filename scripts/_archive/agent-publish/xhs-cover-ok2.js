const { chromium } = require('playwright')
const COVER = 'E:/ai-marketing/storage/cover_1788928821192.jpg'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[XC] ' + m)
  const addN = () => page.$$eval('.pk-cover-list-add-btn', (els) => els.filter((e) => e.offsetParent !== null).length).catch(() => 0)
  log('初始＋号数=' + (await addN()))
  // 若没有＋号：真实点击开关，轮询等它出现
  if ((await addN()) === 0) {
    log('点 PK 开关（真实点击）…')
    await page.locator('.pk-title-switch').first().click({ timeout: 4000 }).catch((e) => log('开关点击异常 ' + e.message.slice(0, 40)))
    for (let i = 0; i < 8; i++) { await sleep(1000); const n = await addN(); if (n > 0) { log('＋号出现（' + (i + 1) + 's）'); break } }
  }
  const n = await addN()
  log('＋号数=' + n)
  if (n === 0) { log('❌ 仍无＋号'); await b.close(); return }
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
    page.locator('.pk-cover-list-add-btn').first().click({ timeout: 4000 }).catch(() => {}),
  ])
  if (fc) { await fc.setFiles(COVER); log('✅ 封面已上传（＋→文件框）'); await sleep(4000) }
  else {
    const ci = await page.$('input.upload-input[accept*="image"]')
    if (ci) { await ci.setInputFiles(COVER); log('✅ 封面已上传(input)'); await sleep(4000) } else log('❌ 上传失败')
  }
  for (const t of ['完成', '确定', '保存']) {
    const btn = page.getByText(t, { exact: true }).first()
    if (await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 2500 }).catch(() => {}); log('✅ 点了「' + t + '」'); await sleep(2000); break }
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
