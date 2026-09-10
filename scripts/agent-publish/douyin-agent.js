/**
 * AGENT 抖音发布入口——复用已调好的 douyin-publish.js（不改原文件）
 * 连接登记的 bu_profile 浏览器（CDP 9222），不需要 AI 决策。
 *
 * 用法:
 *   node douyin-agent.js --video "E:\path\a.mp4" --title "标题" --topics "#话题1 #话题2" --cover cover_xxx.jpg --userId 1
 *   （cover 传仓库文件名——脚本会从服务器下载；留空用平台默认）
 */
const path = require('path')
const fs = require('fs')
const http = require('http')
const { chromium } = require('playwright')

// 直接引用指纹模板里已调好的 7 步流程（不修改原文件）
const { executeDouyinPublish } = require(path.join(__dirname, 'douyin-publish.agent.js'))  // 副本（仅改封面方向单选，原指纹脚本未动）

function imgOrientation(file) {
  try {
    const b = fs.readFileSync(file)
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20)
      return h >= w ? 'portrait' : 'landscape'
    }
    let i = 2
    while (i < b.length - 9) {
      if (b[i] !== 0xFF) { i++; continue }
      const m = b[i + 1]
      if (m >= 0xC0 && m <= 0xC2) {
        const h = b.readUInt16BE(i + 5), w = b.readUInt16BE(i + 7)
        return h >= w ? 'portrait' : 'landscape'
      }
      if (m === 0xD8 || m === 0xD9 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue }
      const seg = b.readUInt16BE(i + 2)
      i += 2 + seg
    }
  } catch (e) {}
  return 'portrait'
}

function parseArgs() {
  const a = {}
  for (let i = 2; i < process.argv.length - 1; i++) {
    const k = process.argv[i]
    if (k.startsWith('--')) a[k.replace(/^--/, '')] = process.argv[i + 1]
  }
  return a
}

async function main() {
  const a = parseArgs()
  const params = {
    videoPath: a.video || '',
    title: a.title || '',
    description: a.desc || '',
    topics: a.topics || '',
    coverImage: a.cover || '',      // 仓库文件名（脚本内部下载）；留空 → 平台默认
    userId: a.userId || '1',
    coverDir: (a['cover-file'] && fs.existsSync(a['cover-file'])) ? imgOrientation(a['cover-file']) : (a['cover-dir'] || 'portrait'),
    publishNow: 'true',
    autoMusic: '',
    location: '',
  }
  // 封面走本地：--cover-file 传本地封面路径 → 起临时服务供脚本"下载"（免鉴权，绕过 /api/storage/file 401）
  let coverSrv = null
  if (a['cover-file'] && fs.existsSync(a['cover-file'])) {
    const buf = fs.readFileSync(a['cover-file'])
    coverSrv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' })
      res.end(buf)
    })
    await new Promise((r) => coverSrv.listen(0, '127.0.0.1', r))
    process.env.SERVER_URL = 'http://127.0.0.1:' + coverSrv.address().port
    params.coverImage = path.basename(a['cover-file'])
  }

  // 带时间戳日志——便于观察每步（用户要求看得到步骤）
  const log = (m) => console.log('[' + new Date().toLocaleTimeString('zh-CN') + '] ' + m)

  if (!params.videoPath || !fs.existsSync(params.videoPath)) {
    console.error('[AGENT] 视频文件不存在: ' + params.videoPath)
    process.exit(1)
  }
  log('视频=' + params.videoPath)
  log('标题=' + params.title + ' 话题=' + params.topics + ' 封面=' + (params.coverImage || '平台默认'))

  let browser = null
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  } catch (e) {
    console.error('[AGENT] 连接登记浏览器失败（先用客户端点登记打开浏览器）: ' + e.message)
    process.exit(1)
  }
  const ctx = browser.contexts()[0]
  const page = (ctx.pages() && ctx.pages()[0]) || (await ctx.newPage())
  await page.bringToFront().catch(() => {})
  log('已连接登记浏览器 当前URL=' + page.url())

  const r = await executeDouyinPublish(page, params, log)  // 签名=(page, params, log)
  if (coverSrv) { try { coverSrv.close() } catch (_) {} }
  log('结果: ' + JSON.stringify(r))
  // 只断开 CDP，不关闭浏览器
  await browser.close().catch(() => {})
}

main().catch((e) => {
  console.error('[AGENT] 异常: ' + (e && e.message))
  process.exit(1)
})
