const { chromium } = require('playwright')
const COVER = 'E:/ai-marketing/storage/cover_1788928821192.jpg'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[XC] ' + m)
  // 图片上传 input（accept 含 image）
  let imgIn = await page.$('input.upload-input[accept*="image"]')
  if (!imgIn) imgIn = await page.$('input[type="file"][accept*="image"]')
  if (!imgIn) { log('未找到图片 input（面板没开？先点编辑封面/设置封面）'); await b.close(); return }
  log('找到图片 input: accept=' + (await imgIn.getAttribute('accept')))
  await imgIn.setInputFiles(COVER)
  log('✅ 已 setInputFiles 封面')
  await sleep(4000)
  // 面板内按钮
  const btns = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    return Array.from(new Set(Array.from(document.querySelectorAll('button,span,div')).filter(vis)
      .map((e) => (e.innerText || '').trim()).filter((t) => t && t.length <= 8 && /完成|确定|保存|应用|裁剪|上传/.test(t))))
  })
  log('面板按钮: ' + JSON.stringify(btns))
  for (const t of ['完成', '确定', '保存']) {
    const btn = page.getByText(t, { exact: true }).first()
    if (await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 2500 }).catch(() => {}); log('✅ 点了「' + t + '」'); await sleep(2500); break }
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
