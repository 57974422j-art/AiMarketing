const { chromium } = require('playwright')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[PUB] ' + m)
  log('URL=' + page.url())
  // 当前状态：标题/正文/封面 是否已填
  const st = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const ti = Array.from(document.querySelectorAll('input')).filter(vis).find((e) => (e.getAttribute('placeholder') || '').indexOf('标题') >= 0)
    return { 标题值: ti ? ti.value : '(无)', 有发布按钮: Array.from(document.querySelectorAll('*')).filter(vis).some((e) => (e.innerText || '').trim() === '发布笔记') }
  })
  log('当前: ' + JSON.stringify(st))
  // 点发布笔记
  try {
    const pb = page.locator('div.publish-video span.btn-text').first()
    await pb.click({ timeout: 5000 })
    log('✅ 已点「发布笔记」')
  } catch (e) {
    try { await page.getByText('发布笔记', { exact: true }).first().click({ timeout: 4000 }); log('✅ 已点「发布笔记」(文本)') } catch (e2) { log('❌ 点发布失败: ' + e2.message.slice(0, 60)) }
  }
  // 等结果
  for (let i = 0; i < 10; i++) {
    await sleep(3000)
    const u = page.url()
    const txt = await page.evaluate(() => (document.body.innerText || '').slice(0, 400)).catch(() => '')
    log('  [' + ((i + 1) * 3) + 's] url=' + u + (txt.indexOf('发布成功') >= 0 ? ' [看到"发布成功"]' : ''))
    if (!/publish\/publish/.test(u) || txt.indexOf('发布成功') >= 0) break
  }
  log('结束 URL=' + page.url())
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
