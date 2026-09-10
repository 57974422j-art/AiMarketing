const { chromium } = require('playwright')
const COVER = 'E:/ai-marketing/storage/cover_1788928821192.jpg'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[XC] ' + m)
  log('URL=' + page.url())

  // 找"编辑封面"文本元素（用户说第一个就叫编辑封面）
  const found = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    return Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => (e.innerText || '').trim() === '编辑封面')
      .map((e) => ({ tag: e.tagName, cls: String(e.className || '').slice(0, 50) }))
  })
  log('"编辑封面" 元素: ' + JSON.stringify(found))

  // 尝试点：编辑封面 → 设置封面 → hover 视频区
  // ★实测：必须 hover 视频区，「编辑封面」才出现（默认 column 浮层）
  try {
    const box = await page.evaluate(() => {
      const v = document.querySelector('video') || document.querySelector('.cover-container')
      if (!v) return null
      const b = v.getBoundingClientRect()
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) }
    })
    // 优先用"视频文件/重新上传"区（cover-container）bbox；其次诊断坐标 (455,340)
    const cc = await page.$('.cover-container')
    const cbox = cc ? await cc.boundingBox() : null
    const pt = cbox && cbox.width > 20 ? { x: Math.round(cbox.x + cbox.width / 2), y: Math.round(cbox.y + Math.min(cbox.height / 3, 120)) } : { x: 455, y: 340 }
    await page.mouse.move(pt.x, pt.y)
    await sleep(700); await page.mouse.move(pt.x + 6, pt.y + 6); await sleep(1500)
    log('真实鼠标移到 ' + JSON.stringify(pt) + ' (box=' + JSON.stringify(box) + ')')
  } catch (e) { log('鼠标移动异常: ' + e.message.slice(0, 50)) }
  // 直接在页面内 click「编辑封面」（hover 后出现；绕过 playwright 可见性判定）
  let clickedIn = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const el = Array.from(document.querySelectorAll('*')).filter(vis).find((e) => (e.innerText || '').trim() === '编辑封面')
    if (el) { el.click(); return true }
    return false
  })
  console.log('[XC] 页面内点击编辑封面=' + clickedIn)
  if (clickedIn) await sleep(2500)
  if ((await page.$$('input.upload-input[accept*="image"]')).length > 0) { console.log('[XC] 面板已开(图片input可见)'); }
  let opened = (await page.$$('input.upload-input[accept*="image"]')).length > 0
  for (const t of opened ? [] : ['编辑封面', '设置封面']) {
    try {
      const el = page.getByText(t, { exact: true }).first()
      if (await el.isVisible().catch(() => false)) {
        await el.click({ timeout: 3000 }).catch(() => {})
        log('已点「' + t + '」')
        await sleep(2500)
        const n = (await page.$$('input.upload-input[accept*="image"]')).length
        log('  图片 input 数=' + n)
        if (n > 0) { opened = true; break }
      } else log('「' + t + '」不可见')
    } catch (e) { log('点 ' + t + ' 异常: ' + e.message.slice(0, 50)) }
  }
  if (!opened) {
    // hover 视频区试
    try {
      const vc = await page.$('.cover-container, video, [class*="video"]')
      if (vc) { await vc.hover({ timeout: 3000 }).catch(() => {}); await sleep(1500); log('已 hover 视频区') }
      const el2 = page.getByText('编辑封面', { exact: true }).first()
      if (await el2.isVisible().catch(() => false)) { await el2.click({ timeout: 3000 }).catch(() => {}); log('hover 后点编辑封面'); await sleep(2500) }
    } catch (_) {}
  }
  let imgIn = await page.$('input.upload-input[accept*="image"]')
  if (!imgIn) { log('❌ 仍无图片 input（面板未开）'); await b.close(); return }
  await imgIn.setInputFiles(COVER)
  log('✅ 封面已塞入 image input')
  await sleep(4000)
  for (const t of ['完成', '确定', '保存']) {
    const btn = page.getByText(t, { exact: true }).first()
    if (await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 2500 }).catch(() => {}); log('✅ 点了「' + t + '」'); await sleep(2500); break }
  }
  log('结束；图片 input 残留=' + (await page.$$('input.upload-input[accept*="image"]')).length)
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
