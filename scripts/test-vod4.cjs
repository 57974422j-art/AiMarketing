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
    const tmp = path.join(require('os').tmpdir(), 'aim-test-vod.mp4')
    fs.writeFileSync(tmp, Buffer.alloc(1024 * 1024, 7))
    const size = fs.statSync(tmp).size
    const info = await vod.applyVideoUploadInner(size, cred)
    await tos.tosUpload({ filePath: tmp, uploadInfo: info, credentials: cred, onProgress: () => {} })
    const committed = await vod.commitVideoUploadInner(info, cred)
    console.log('上传链路 OK, video_id:', info.video_id)
    // create_v2（真发——验证最后一步；假文件抖音可能拒绝或接受）
    const browserFetch = (method, url, options) => page.evaluate(({ m, u, o }) => {
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ status_code: -1, status_msg: 'timeout' }), 40000)
        fetch(u, { method: m, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, ...(o.body ? { body: JSON.stringify(o.body) } : {}) })
          .then(r => r.text()).then(t => { clearTimeout(timer); try { resolve(JSON.parse(t)) } catch { resolve({ status_code: -2, status_msg: t.slice(0, 300) }) } })
          .catch(e => { clearTimeout(timer); resolve({ status_code: -1, status_msg: String(e && e.message || e) }) })
      })
    }, { m: method, u: url, o: options })
    const DEVICE = 'aid=1128&cookie_enabled=true&screen_width=1512&screen_height=982&browser_language=zh-CN&browser_platform=MacIntel&browser_name=Mozilla&browser_online=true&timezone_name=Asia%2FTokyo&support_h265=1'
    const publishUrl = 'https://creator.douyin.com/web/api/media/aweme/create_v2/?read_aid=2906&' + DEVICE
    const body = { item: { common: { text: '链路验证测试', caption: '', item_title: '链路验证', activity: '[]', text_extra: '[]', challenges: '[]', mentions: '[]', hashtag_source: '', hot_sentence: '', interaction_stickers: '[]', visibility_type: 0, download: 0, timing: Math.floor(Date.now() / 1000), creation_id: String(Date.now()) + Math.random().toString(36).slice(2, 10), media_type: 4, video_id: info.video_id, music_source: 0, music_id: null }, cover: { poster: committed.poster_uri || '', custom_cover_image_height: 1280, custom_cover_image_width: 720, poster_delay: 0, cover_tools_info: '{}' }, mix: {}, chapter: { chapter: JSON.stringify({ chapter_abstract: '', chapter_details: [], chapter_type: 0 }) }, anchor: {}, sync: { should_sync: false, sync_to_toutiao: 0 }, open_platform: {}, assistant: { is_preview: 0, is_post_assistant: 1 }, declare: { user_declare_info: '{}' } } }
    const res = await browserFetch('POST', publishUrl, { body })
    console.log('create_v2 返回:', JSON.stringify(res).slice(0, 400))
    if (res.aweme_id || res.item_id) console.log('✅✅ 发布成功！aweme_id:', res.aweme_id || res.item_id)
    else console.log('❌ 发布未成功（看上面返回判断原因——可能假文件无视频流被拒，真视频会不同）')
  } catch (e) { console.log('❌ 异常:', e.message, (e.stack || '').split('\n').slice(0, 3).join(' | ')) }
  await browser.close().catch(() => {})
})()
