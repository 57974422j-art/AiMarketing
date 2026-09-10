/** 小红书：模拟操作一次（上传视频→等编辑页→读结构，不发布） */
const { chromium } = require('playwright')
const VIDEO = 'E:/ai-marketing/storage/20260807_001.mp4'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  const log = (m) => console.log('[XHS] ' + m)
  log('URL=' + page.url())

  // ① 上传视频（可见的 .upload-input）
  const fi = await page.$('input.upload-input') || await page.$('input[type="file"]')
  if (!fi) { log('未找到上传 input'); await b.close(); return }
  await fi.setInputFiles(VIDEO)
  log('✅ 视频已设置，等转码/编辑页…')

  // ② 等编辑页（标题框/正文出现 或 URL 变化）
  let ready = false
  for (let i = 0; i < 40; i++) {
    await sleep(3000)
    const st = await page.evaluate(() => {
      const vis = (e) => !!(e && e.offsetParent !== null)
      const t = Array.from(document.querySelectorAll('[contenteditable="true"],input[type="text"],textarea')).filter(vis)
      const body = (document.body.innerText || '').slice(0, 3000)
      return { n: t.length, hasTitle: body.indexOf('标题') >= 0, hasCover: body.indexOf('封面') >= 0 }
    }).catch(() => ({ n: 0, hasTitle: false, hasCover: false }))
    log('  [' + ((i + 1) * 3) + 's] 可编辑元素=' + st.n + ' 标题=' + st.hasTitle + ' 封面=' + st.hasCover + ' url=' + page.url())
    if (st.n > 0 && st.hasTitle) { ready = true; break }
  }
  log(ready ? '✅ 编辑页就绪' : '⚠️ 超时')
  await sleep(3000)

  // ③ 读编辑页结构
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const out = {}
    out.editable = Array.from(document.querySelectorAll('[contenteditable="true"],input[type="text"],textarea')).map((e) => ({
      tag: e.tagName, ph: e.getAttribute('placeholder') || '', cls: String(e.className || '').slice(0, 45), visible: vis(e),
    })).slice(0, 15)
    out.fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((e) => ({
      accept: (e.getAttribute('accept') || '').slice(0, 40), visible: vis(e), cls: String(e.className || '').slice(0, 40),
    }))
    out.coverOrPublish = Array.from(document.querySelectorAll('button,[role="button"],span,div')).filter(vis).filter((e) => {
      const t = (e.innerText || '').trim()
      return t && t.length <= 12 && /封面|发布笔记|发布|存草稿|添加话题|话题/.test(t)
    }).map((e) => ({ tag: e.tagName, cls: String(e.className || '').slice(0, 50), text: (e.innerText || '').trim().slice(0, 20) })).slice(0, 25)
    return out
  })
  log('编辑页结构:')
  console.log(JSON.stringify(r, null, 1))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
