/**
 * 登录态保活（★KEEP_LOGIN_ALIVE_V1，2026-09-17）
 *
 * Why：视频号（微信）的 sessionid 会【每天更换】——长时间不访问时，服务端会把旧值作废，
 *      用户第二天发现"登录态又丢了"。客户端不一定开着，所以不能靠客户端定时。
 *      本脚本刻意做成【可由 Windows 计划任务直接调用】的独立进程：
 *        schtasks /create /tn "AiMarketing-KeepLogin" /sc daily /st 11:30 ^
 *          /tr "node \"<安装目录>\resources\app.asar\...\scripts\keep-login-alive.mjs\" --data \"<安装目录>\data\""
 *
 * What：列出 data/accounts.json 里的账号 × 目标平台 → 逐个用该账号的 Chrome profile
 *       打开平台页面并停留若干秒（让平台刷新 cookie）→ 用 CDP 只关掉【自己启动的那个】浏览器。
 *
 * 安全设计（勿改）：
 *   · 独立调试端口 9223（不抢发布的 9222）
 *   · 窗口最小化到屏幕外（--window-position=-32000,-32000），不打扰用户
 *   · 只关自己启动的实例（先记 PID，再 CDP Browser.close 兜底），绝不动用户正在用的 Chrome
 *   · 任一账号/平台失败都不中断其它（每天一次，尽量多保住就多保住）
 *
 * 用法：
 *   node scripts/keep-login-alive.mjs --data "E:\ai-marketing\data"
 *   node scripts/keep-login-alive.mjs --data "..." --platforms shipinhao,kuaishou --wait 15000
 *   node scripts/keep-login-alive.mjs --data "..." --dry-run     # 只打印计划，不真开浏览器
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const PORT = 9223                     // ★ 独立端口，不抢发布用的 9222
const CHROME_CANDS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
]

// 目标平台：默认只做"会自己失效"的视频号；可用 --platforms 扩
const PLATFORM_URLS = {
  shipinhao: 'https://channels.weixin.qq.com/platform/post/create',
  kuaishou: 'https://cp.kuaishou.com/article/publish/video',
  douyin: 'https://creator.douyin.com/creator-micro/content/upload',
  xiaohongshu: 'https://creator.xiaohongshu.com/publish/publish',
  weibo: 'https://weibo.com/upload/channel',
  bilibili: 'https://member.bilibili.com/platform/upload/video/frame',
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1]
  return def
}
const hasFlag = (name) => process.argv.includes('--' + name)

const DATA = arg('data', '') || process.env.AIMKT_DATA || ''
const PLATS = String(arg('platforms', 'shipinhao')).split(',').map((s) => s.trim()).filter(Boolean)
const WAIT_MS = parseInt(arg('wait', '15000'), 10) || 15000
const DRY = hasFlag('dry-run')

function log(m) {
  const t = new Date().toLocaleString('zh-CN')
  const line = '[keepalive ' + t + '] ' + m
  console.log(line)
  try {
    if (DATA) fs.appendFileSync(path.join(DATA, 'keep-login-alive.log'), line + '\n', 'utf8')
  } catch (e) {}
}

function findChrome() {
  for (const p of CHROME_CANDS) {
    try { if (p && fs.existsSync(p)) return p } catch (e) {}
  }
  return ''
}

/** 读 data/accounts.json → [{userId}]；读不到就退化为"扫 browser-profile 下的数字目录" */
function listAccounts(dataDir) {
  const ids = []
  try {
    const f = path.join(dataDir, 'accounts.json')
    if (fs.existsSync(f)) {
      const arr = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (Array.isArray(arr)) for (const a of arr) if (a && a.userId != null) ids.push(String(a.userId))
    }
  } catch (e) {}
  if (!ids.length) {
    try {
      const root = path.join(dataDir, 'browser-profile')
      if (fs.existsSync(root)) {
        for (const nm of fs.readdirSync(root)) {
          if (/^\d+$/.test(nm)) ids.push(nm)
        }
      }
    } catch (e) {}
  }
  return [...new Set(ids)]
}

async function httpJson(url, timeoutMs) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ac.signal })
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

/** 用 CDP 让浏览器自杀（只影响这一个调试端口的实例） */
async function closeViaCDP(port) {
  try {
    const v = await httpJson('http://127.0.0.1:' + port + '/json/version', 3000)
    if (!v || !v.webSocketDebuggerUrl) return false
    const ws = new WebSocket(v.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.onopen = () => {
        try { ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })) } catch (e) { rej(e) }
        setTimeout(res, 1200)
      }
      ws.onerror = () => rej(new Error('ws error'))
    })
    try { ws.close() } catch (e) {}
    return true
  } catch (e) {
    return false
  }
}

/** ★KEEPALIVE_SINGLETON_V1：判断该 profile 是否已有 Chrome 在跑
 *  （Chrome 单例：同 user-data-dir 再启动只会开个标签页，不会开新调试端口） */
function profileLocked(profileDir) {
  for (const f of ['SingletonLock', 'SingletonCookie', 'lockfile']) {
    try {
      if (fs.existsSync(path.join(profileDir, f))) return true
    } catch (e) {}
  }
  return false
}

async function touchOne(chrome, profileDir, url, port) {
  // ★ 启动前：若 9223 已在监听（上次没关干净），先关掉，避免端口被占
  try {
    const v0 = await httpJson('http://127.0.0.1:' + port + '/json/version', 1500)
    if (v0 && v0.webSocketDebuggerUrl) {
      log('  端口 ' + port + ' 被上次残留实例占用 → 先关掉')
      await closeViaCDP(port)
      await sleep(2500)
    }
  } catch (e) {}

  const args = [
    '--user-data-dir=' + profileDir,
    '--remote-debugging-port=' + port,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-position=-32000,-32000',   // ★ 挪到屏幕外，不打扰用户
    '--window-size=1200,800',
    url,
  ]
  let pid = 0
  try {
    const ch = spawn(chrome, args, { detached: true, stdio: 'ignore', windowsHide: false })
    pid = ch.pid || 0
    ch.unref()
  } catch (e) {
    log('  启动 Chrome 失败: ' + String(e).slice(0, 80))
    return false
  }
  // 等调试端口就绪（最多 20s）
  let up = false
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    try {
      const v = await httpJson('http://127.0.0.1:' + port + '/json/version', 1500)
      if (v && v.webSocketDebuggerUrl) { up = true; break }
    } catch (e) {}
  }
  if (!up) {
    // ★ Chrome 单例：该账号的浏览器【已经在跑】（用户正开着）→ 新进程只会开个标签页。
    //   这种情况【不算失败】：正在被访问 = 登录态本来就在刷新。
    if (profileLocked(profileDir)) {
      log('  该账号浏览器已在运行（视为正在访问，登录态已在刷新）→ 跳过')
      return true
    }
    log('  ⚠️ 调试端口未就绪且未检测到占用（pid=' + pid + '），跳过本次')
    return false
  }
  log('  已打开页面，停留 ' + Math.round(WAIT_MS / 1000) + ' 秒让平台刷新 cookie…')
  await sleep(WAIT_MS)
  const closed = await closeViaCDP(port)
  if (!closed && pid) {
    try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch (e) {}
  }
  log('  关闭浏览器: ' + (closed ? 'CDP 已请求关闭' : '已 taskkill 兜底（pid=' + pid + '）'))
  return true
}

async function main() {
  if (!DATA) {
    console.error('缺少 --data <安装目录\\data>（或设置 AIMKT_DATA）')
    process.exit(2)
  }
  const chrome = findChrome()
  if (!chrome) {
    log('❌ 未找到 chrome.exe，无法保活')
    process.exit(3)
  }
  const accounts = listAccounts(DATA)
  if (!accounts.length) {
    log('⚠️ 未发现任何账号（accounts.json / browser-profile 都空），跳过')
    return
  }
  log('开始保活：账号=' + accounts.join(',') + ' | 平台=' + PLATS.join(',') + ' | 端口=' + PORT + (DRY ? ' | [dry-run]' : ''))
  for (const uid of accounts) {
    const profileDir = path.join(DATA, 'browser-profile', uid)
    if (!fs.existsSync(profileDir)) {
      log('账号 ' + uid + '：无 profile 目录，跳过')
      continue
    }
    for (const plat of PLATS) {
      const url = PLATFORM_URLS[plat]
      if (!url) { log('账号 ' + uid + ' 平台 ' + plat + '：无 URL 映射，跳过'); continue }
      if (DRY) { log('  [dry] ' + uid + ' → ' + plat + ' ' + url); continue }
      log('账号 ' + uid + ' → ' + plat + '（' + url + '）')
      try {
        await touchOne(chrome, profileDir, url, PORT)
      } catch (e) {
        log('  ❌ 失败: ' + String(e).slice(0, 100))
      }
      await sleep(2000)
    }
  }
  log('保活结束')
}

main().catch((e) => { log('异常: ' + String(e && e.stack || e).slice(0, 300)); process.exit(1) })
