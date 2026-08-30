const { chromium } = require('playwright')
const { pathToFileURL } = require('url')
const path = require('path')
;(async () => {
  let browser
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9333') } catch (e) { console.log('CDP 失败:', e.message); return }
  const ctx = browser.contexts()[0]
  const page = ctx.pages().find(p => p.url().includes('creator.douyin.com'))
  if (!page) { console.log('无抖音页'); return }
  // 用页内 fetch 直接测 create_v2（真实请求——看返回什么）
  const res = await page.evaluate(async () => {
    try {
      const r = await fetch('https://creator.douyin.com/web/api/media/aweme/create_v2/?read_aid=2906&aid=1128&cookie_enabled=true&screen_width=1512&screen_height=982&browser_language=zh-CN&browser_platform=MacIntel&browser_name=Mozilla&browser_online=true&timezone_name=Asia%2FTokyo', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { common: { text: '测试', caption: '', item_title: '测试', activity: '[]', text_extra: '[]', challenges: '[]', mentions: '[]', hashtag_source: '', hot_sentence: '', interaction_stickers: '[]', visibility_type: 0, download: 0, timing: Math.floor(Date.now()/1000), creation_id: 't' + Date.now(), media_type: 4, video_id: 'v0300fg10000da7qes7og65pmb63s3o0', music_source: 0, music_id: null }, cover: { poster: '', custom_cover_image_height: 1280, custom_cover_image_width: 720, poster_delay: 0, cover_tools_info: '{}' }, mix: {}, chapter: { chapter: JSON.stringify({ chapter_abstract: '', chapter_details: [], chapter_type: 0 }) }, anchor: {}, sync: { should_sync: false, sync_to_toutiao: 0 }, open_platform: {}, assistant: { is_preview: 0, is_post_assistant: 1 }, declare: { user_declare_info: '{}' } } }),
        signal: AbortSignal.timeout(40000)
      })
      const text = await r.text()
      return { status: r.status, body: text.slice(0, 500) }
    } catch (e) { return { status: 'err', body: String(e.message).slice(0, 300) } }
  })
  console.log('create_v2 真实返回:', JSON.stringify(res))
  await browser.close().catch(() => {})
})()
