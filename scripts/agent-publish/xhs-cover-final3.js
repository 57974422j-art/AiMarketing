const { chromium } = require('playwright')
const COVER = 'E:/ai-marketing/storage/cover_1788928821192.jpg'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[XC] ' + m)
  // 用 JS 在封面区元素上派发 mouseenter/mouseover（触发 React 浮层）
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const hosts = Array.from(document.querySelectorAll('.publish-page-content-cover-content, .cover-plugin-preview, .cover-container, [class*="cover"]'))
      .filter(vis).slice(0, 8)
    let fired = 0
    for (const h of hosts) {
      for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
        try { h.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); fired++ } catch (_) {}
      }
    }
    return { hosts: hosts.length, fired }
  })
  log('派发事件 hosts=' + r.hosts + ' fired=' + r.fired)
  await sleep(2000)
  let hasEdit = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    return Array.from(document.querySelectorAll('*')).filter(vis).some((e) => (e.innerText || '').trim() === '编辑封面')
  }).catch(() => false)
  log('编辑封面出现=' + hasEdit)
  if (!hasEdit) {
    // 退一步：直接看有没有图片 input（万一面板已在 DOM）
    const n = (await page.$$('input.upload-input[accept*="image"]')).length
    log('图片 input 数=' + n)
    if (n === 0) { log('❌ 面板未开&无 input——小红书封面入口需真实 hover（浮层）'); await b.close(); return }
  }
  const clicked = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const el = Array.from(document.querySelectorAll('*')).filter(vis).find((e) => (e.innerText || '').trim() === '编辑封面')
    if (el) { el.click(); return true }
    return false
  })
  log('点编辑封面=' + clicked)
  if (clicked) await sleep(3000)
  const imgIn = (await page.$('input.upload-input[accept*="image"]')) || (await page.$('input[type="file"][accept*="image"]'))
  if (!imgIn) { log('❌ 无图片 input'); await b.close(); return }
  await imgIn.setInputFiles(COVER); log('✅ 封面已上传')
  await sleep(4000)
  for (const t of ['完成', '确定', '保存']) {
    const btn = page.getByText(t, { exact: true }).first()
    if (await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 2500 }).catch(() => {}); log('✅ 点了「' + t + '」'); break }
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
