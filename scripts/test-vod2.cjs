const { chromium } = require('playwright')
const { pathToFileURL } = require('url')
const path = require('path')
;(async () => {
  let browser
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9333') } catch (e) { console.log('CDP 失败:', e.message); return }
  const ctx = browser.contexts()[0]
  const page = ctx.pages().find(p => p.url().includes('creator.douyin.com'))
  if (!page) { console.log('无抖音页'); return }
  const base = pathToFileURL(path.join('D:/AiMarketing/dist-rel/win-unpacked/resources/app.asar.unpacked', 'node_modules', '@jackwener', 'opencli', 'clis', 'douyin', '_shared')).href + '/'
  try {
    const vod = await import(base + 'vod-upload.js')
    const cred = await vod.getUploadAuthV5Credentials({ evaluate: (js) => page.evaluate(js), timeout: 60000 })
    console.log('鉴权 OK')
    const info = await vod.applyVideoUploadInner(1000000, cred)
    console.log('applyVideoUploadInner:', JSON.stringify(info).slice(0, 300))
  } catch (e) { console.log('异常:', e.message, e.stack ? e.stack.slice(0, 300) : '') }
  await browser.close().catch(() => {})
})()
