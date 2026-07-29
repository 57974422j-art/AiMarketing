/**
 * 指纹浏览器发布脚本 · 公共工具模块
 *
 * 提取各平台发布脚本共用的健壮能力（参照 MPP 的「数据管线 + 登录检测 + 等待兜底」思路）：
 *   1. resolveLocalVideoPath   —— 把素材仓库里的视频名解析/下载为本地绝对路径（修复“缺少 videoPath”断点）
 *   2. checkLoginState         —— 按平台判断当前 URL 是否落在登录页（返回 needLogin）
 *   3. waitForSelectorRetry    —— 带重试的等待选择器（替换硬等/写死等待）
 *   4. smartType               —— 健壮输入文本
 *   5. downloadFile            —— 从素材仓库/服务端下载文件到本地
 *
 * 所有发布脚本统一 require 本模块，避免每个平台重复造轮子。
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const SERVER_URL = (process.env.SERVER_URL || 'http://120.55.43.195:3000').replace(/\/$/, '')

/**
 * 把视频定位为本地绝对路径。
 *  - 若 params.videoPath 已存在，直接使用（前端已下载到本地的情况）
 *  - 否则用 storageFileName + userId 从素材仓库下载到临时目录，并写回 params.videoPath
 * @returns {Promise<string>} 本地视频路径
 */
async function resolveLocalVideoPath(params, log) {
  if (params.videoPath && fs.existsSync(params.videoPath)) {
    log('[common] 使用本地视频: ' + params.videoPath)
    return params.videoPath
  }
  if (!params.storageFileName || !params.userId) {
    throw new Error('缺少 videoPath 或 storageFileName/userId，无法定位视频文件')
  }
  const url = `${SERVER_URL}/api/storage/file?userId=${encodeURIComponent(params.userId)}&name=${encodeURIComponent(params.storageFileName)}`
  const dir = path.join(os.tmpdir(), 'aimarketing-videos')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const safe = path.basename(params.storageFileName).replace(/[^\w.\-]/g, '_')
  const local = path.join(dir, safe)
  log('[common] 从素材仓库下载视频: ' + params.storageFileName)
  await downloadFile(url, local, params.authToken)
  if (!fs.existsSync(local)) throw new Error('视频下载失败: ' + params.storageFileName)
  const kb = (fs.statSync(local).size / 1024).toFixed(1)
  log(`[common] 视频已下载: ${local} (${kb}KB)`)
  params.videoPath = local
  return local
}

/**
 * 把素材仓库里的图片（封面等）解析/下载为本地绝对路径。
 * @returns {Promise<string|null>} 本地路径，或 null（无文件名时）
 */
async function resolveLocalImagePath(fileName, userId, authToken, log) {
  if (!fileName) return null
  // 已是本地路径
  if (fs.existsSync(fileName)) return fileName
  const url = `${SERVER_URL}/api/storage/file?userId=${encodeURIComponent(userId || '')}&name=${encodeURIComponent(fileName)}`
  const dir = path.join(os.tmpdir(), 'aimarketing-images')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const safe = path.basename(fileName).replace(/[^\w.\-]/g, '_')
  const local = path.join(dir, safe)
  log('[common] 从素材仓库下载图片: ' + fileName)
  await downloadFile(url, local, authToken)
  if (!fs.existsSync(local)) { log('[common] 图片下载失败，跳过: ' + fileName); return null }
  return local
}

/** 从服务端下载文件（带 token Cookie 兜底鉴权） */
function downloadFile(url, dest, authToken) {
  return new Promise((resolve, reject) => {
    const mod = require(url.startsWith('https') ? 'https' : 'http')
    const headers = {}
    if (authToken) headers['Cookie'] = 'token=' + authToken
    const req = mod.get(url, { headers, timeout: 180000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume && res.resume()
        return reject(new Error('HTTP ' + res.statusCode))
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try { fs.writeFileSync(dest, Buffer.concat(chunks)); resolve() }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')) })
  })
}

/**
 * 按平台判断当前 URL 是否落在登录/授权页。
 * @returns {{loggedIn:boolean, needLogin:boolean}}
 */
function checkLoginState(platform, url) {
  if (!url) return { loggedIn: true, needLogin: false }
  const loginPatterns = {
    douyin: ['passport.douyin.com', '/login', 'sso.douyin', 'douyin.com/passport'],
    xiaohongshu: ['/login', 'signin', 'xiaohongshu.com/login', 'onelink'],
    kuaishou: ['/login', 'passport', 'user.kuaishou', 'login.kuaishou'],
    shipinhao: ['/login', 'weixin.qq.com', 'connect', 'channels.weixin.qq.com/login'],
    bilibili: ['/login', 'passport.bilibili', 'bilibili.com/login'],
  }
  const pats = loginPatterns[platform] || ['/login']
  const isLogin = pats.some((p) => url.includes(p))
  return { loggedIn: !isLogin, needLogin: isLogin }
}

/** 带重试的等待选择器（超时后返回 false 而非抛错） */
async function waitForSelectorRetry(page, selector, { timeout = 8000, retries = 3, state = 'visible' } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      await page.waitForSelector(selector, { timeout, state })
      return true
    } catch (_) {
      if (i === retries - 1) return false
      await page.waitForTimeout(1000)
    }
  }
  return false
}

/** 健壮输入：定位元素 → 清空 → 输入。定位失败返回 false */
async function smartType(page, selector, text, { clear = true, delay = 20 } = {}) {
  const el = await page.$(selector)
  if (!el) return false
  try {
    if (clear) {
      await el.click({ timeout: 2000 }).catch(() => {})
      await page.keyboard.down('Control').catch(() => {})
      await page.keyboard.press('A').catch(() => {})
      await page.keyboard.up('Control').catch(() => {})
    }
    await el.type(text, { delay })
    return true
  } catch (_) {
    return false
  }
}

module.exports = {
  SERVER_URL,
  resolveLocalVideoPath,
  resolveLocalImagePath,
  downloadFile,
  checkLoginState,
  waitForSelectorRetry,
  smartType,
}
