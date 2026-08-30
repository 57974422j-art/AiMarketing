const { chromium } = require('playwright')
const { pathToFileURL } = require('url')
const path = require('path')
const fs = require('fs')
;(async () => {
  let browser
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9333') } catch (e) { console.log('CDP 失败:', e.message); return }
  const ctx = browser.contexts()[0]
  const page = ctx.pages().find(p => p.url().includes('creator.douyin.com'))
  if (!page) { console.log('无抖音页'); return }
  const base = pathToFileURL(path.join('D:/AiMarketing/dist-rel/win-unpacked/resources/app.asar.unpacked', 'node_modules', '@jackwener', 'opencli', 'clis', 'douyin', '_shared')).href + '/'
  try {
    const vod = await import(base + 'vod-upload.js')
    const tos = await import(base + 'tos-upload.js')
    const cred = await vod.getUploadAuthV5Credentials({ evaluate: (js) => page.evaluate(js), timeout: 60000 })
    // 小测试文件（1MB 假数据——仅测上传通道，不真发）
    const tmp = path.join(require('os').tmpdir(), 'aim-test-vod.mp4')
    fs.writeFileSync(tmp, Buffer.alloc(1024 * 1024, 7))
    const size = fs.statSync(tmp).size
    const info = await vod.applyVideoUploadInner(size, cred)
    console.log('apply OK, video_id:', info.video_id)
    const t0 = Date.now()
    await tos.tosUpload({ filePath: tmp, uploadInfo: info, credentials: cred, onProgress: () => {} })
    console.log('tosUpload 成功，耗时', ((Date.now() - t0) / 1000).toFixed(1), 's')
    // commit（提交上传完成——不 create_v2 真发）
    const committed = await vod.commitVideoUploadInner(info, cred)
    console.log('commit OK, poster_uri:', committed.poster_uri || '(空——假文件无封面)')
    console.log('✅ 上传链路全通（鉴权→apply→tos→commit）——未真发')
  } catch (e) { console.log('❌ 失败于:', e.message, (e.stack || '').split('\n').slice(0, 3).join(' | ')) }
  await browser.close().catch(() => {})
})()
