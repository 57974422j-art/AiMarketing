const { chromium } = require('playwright')
const { pathToFileURL } = require('url')
const path = require('path')
;(async () => {
  let browser
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9333') } catch (e) { console.log('CDP 连接失败:', e.message); return }
  const ctx = browser.contexts()[0]
  let page = ctx.pages().find(p => p.url().includes('creator.douyin.com'))
  if (!page) { console.log('无抖音页'); return }
  console.log('抖音页:', page.url())
  const base = pathToFileURL(path.join('D:/AiMarketing/dist-rel/win-unpacked/resources/app.asar.unpacked', 'node_modules', '@jackwener', 'opencli', 'clis', 'douyin', '_shared')).href + '/'
  try {
    const vod = await import(base + 'vod-upload.js')
    const cred = await vod.getUploadAuthV5Credentials({ evaluate: (js) => page.evaluate(js), timeout: 60000 })
    console.log('鉴权结果 keys:', Object.keys(cred || {}).join(','))
    console.log('success:', cred?.success !== false ? 'yes' : 'no', JSON.stringify(cred).slice(0, 400))
  } catch (e) { console.log('鉴权异常:', e.message) }
  await browser.close().catch(() => {})
})()
