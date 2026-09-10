const { chromium } = require('playwright')
const COVER = 'E:/ai-marketing/storage/cover_1788928821192.jpg'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[XC] ' + m)
  // 点「＋」号（pk-cover-list-add-btn）
  const clicked = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const el = Array.from(document.querySelectorAll('.pk-cover-list-add-btn, .pk-cover-list-add-icon, [class*="cover-list-add"]')).filter(vis)[0]
    if (el) { el.click(); return true }
    return false
  })
  log('点＋号=' + clicked)
  await sleep(2500)
  // 看 filechooser / 图片 input
  let imgIn = await page.$('input.upload-input[accept*="image"]')
  if (!imgIn) imgIn = await page.$('input[type="file"][accept*="image"]')
  log('图片 input=' + (imgIn ? '有' : '无'))
  if (imgIn) {
    await imgIn.setInputFiles(COVER); log('✅ 封面已上传')
    await sleep(4000)
    for (const t of ['完成', '确定', '保存', '应用']) {
      const btn = page.getByText(t, { exact: true }).first()
      if (await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 2500 }).catch(() => {}); log('✅ 点了「' + t + '」'); await sleep(2000); break }
    }
  } else {
    // 可能弹了文件框（用 filechooser 兜底）
    log('无 input，看是否有面板/弹窗…')
    const btns = await page.evaluate(() => {
      const vis = (e) => !!(e && e.offsetParent !== null)
      return Array.from(new Set(Array.from(document.querySelectorAll('button,span,div')).filter(vis).map((e) => (e.innerText || '').trim()).filter((t) => t && t.length <= 8 && /完成|确定|保存|上传|应用|选择/.test(t))))
    })
    log('可见按钮: ' + JSON.stringify(btns))
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
