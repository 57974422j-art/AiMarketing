const { app, BrowserWindow, ipcMain, dialog, session } = require('electron')
// 2026-08-07：允许无手势自动播放（TTS 朗读回复不被浏览器策略拦截）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// 2026-08-06：授予麦克风/媒体权限（否则 getUserMedia 被拒，声纹球点击无响应）
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone' || permission === 'audioCapture')
  })
  // 2026-08-18: 补权限检查（Electron 33 需要）——远程页面 getUserMedia 之前先"检查"，
  // 缺 CheckHandler 时 Chromium 不暴露音频设备 → Requested device not found
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ['media', 'microphone', 'audioCapture'].includes(permission)
  })
})
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execSync, spawn } = require('child_process')

// ── 自动更新 ──
const { autoUpdater } = require('electron-updater')

// ── 指纹浏览器模板 ──
const { executeDouyinPublish } = require('./fp-templates/douyin-publish')
const { executeXiaohongshuPublish } = require('./fp-templates/xiaohongshu-publish')
const { executeKuaishouPublish } = require('./fp-templates/kuaishou-publish')
const { executeShipinhaoPublish } = require('./fp-templates/shipinhao-publish')
const { executeBilibiliPublish } = require('./fp-templates/bilibili-publish')
const { executeWeiboPublish } = require('./fp-templates/weibo-publish')

let mainWindow
// ── 2026-08-12 单实例锁：防止多开（多实例抢 3377/缓存导致白屏）──
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  console.log('[main] 已有客户端实例运行，退出本次启动')
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// ── 本地 standalone server（阶段0 客户端本地化）──
// 打包后 .next/standalone 位于 resources/standalone（extraResources，asar 外），
// 用 Electron 自身的 node（ELECTRON_RUN_AS_NODE）启动，页面本地渲染、/api/* 经 Next rewrites 代理到服务器。
let localServerProc = null
const LOCAL_SERVER_PORT = 3377

function startLocalServer() {
  return new Promise((resolve) => {
    try {
      // 2026-08-12 v1.0.26：standalone 在 app.asar.unpacked/.next/standalone（asar+unpack，.next 真实文件）
      // 兼容旧 extraResources 路径（resources/standalone）
      const unpackPath = path.join(process.resourcesPath, 'app.asar.unpacked', '.next', 'standalone', 'server.js')
      const legacyPath = path.join(process.resourcesPath, 'standalone', 'server.js')
      const serverPath = fs.existsSync(unpackPath) ? unpackPath : legacyPath
      if (!fs.existsSync(serverPath)) {
        console.error('[local] 找不到 standalone/server.js，回退远程加载:', serverPath)
        return resolve(false)
      }
      localServerProc = spawn(process.execPath, [serverPath], {
        cwd: path.dirname(serverPath),
        env: {
          // 2026-08-11：客户端正式版连服务器——API 代理到服务器（登录/计费/数据统一），页面本地渲染
          API_TARGET: process.env.API_TARGET || 'https://ai-niuma.cc',
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          NODE_ENV: 'production',
          PORT: String(LOCAL_SERVER_PORT),
          HOSTNAME: '127.0.0.1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let done = false
      const finish = (ok) => { if (!done) { done = true; resolve(ok) } }
      localServerProc.stdout.on('data', (d) => {
        const s = d.toString()
        process.stdout.write('[local] ' + s)
        if (s.includes('Ready')) finish(true)
      })
      localServerProc.stderr.on('data', (d) => process.stderr.write('[local-err] ' + d.toString()))
      localServerProc.on('exit', (code) => { console.log('[local] server 退出', code); finish(false) })
      // 兜底：3.5 秒后视为就绪（Next standalone 启动较快）
      setTimeout(() => finish(true), 3500)
    } catch (e) {
      console.error('[local] 启动本地 server 失败:', e.message)
      resolve(false)
    }
  })
}

// ── 让 Playwright 从安装包内找浏览器 ──
if (app.isPackaged) {
  const bundledBrowsers = path.join(process.resourcesPath, 'ms-playwright')
  if (fs.existsSync(bundledBrowsers)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = bundledBrowsers
    console.log('[FP] 使用打包内浏览器:', bundledBrowsers)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 2026-08-12 v1.0.27: 应用随行 iframe（open_page embed）需要 preload 注入子 frame
      // 否则 iframe 内 window.electronAPI undefined -> "请在客户端中使用"
      nodeIntegrationInSubFrames: true,
    },
    icon: path.join(__dirname, '../public/icon.png'),
  })

  // 外链/新窗口策略（阶段1 Scene 卡片外链）：http(s) 外链走系统浏览器，内部路径留在本地壳
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const { shell } = require('electron')
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const cur = mainWindow.webContents.getURL()
    // 2026-08-12 #20: 拦截非 http(s) 导航（file:// 等），防配合 preload 面的本地文件访问
    if (!/^https?:/.test(url)) { e.preventDefault(); return }
    if (url.startsWith('http') && !url.startsWith(cur.split('/').slice(0, 3).join('/'))) {
      e.preventDefault()
      const { shell } = require('electron')
      shell.openExternal(url)
    }
  })

  // 2026-08-13 v1.0.30 纯壳：客户端不再内置后端/standalone/代理——直接加载服务器页面
  // 页面/功能永远服务器最新；AI 能力全在服务器；本地能力（指纹/语音/摄像头）走 preload 桥
  const isDev = process.env.NODE_ENV !== 'production'
  if (app.isPackaged && !process.env.SERVER_URL) {
    mainWindow.loadURL('https://ai-niuma.cc')
  } else {
    // 开发模式 / 显式指定 SERVER_URL：加载远程或本地 dev server
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000'
    mainWindow.loadURL(serverUrl)
  }

  // ── 自动更新检测（打包后的生产环境）──
  if (app.isPackaged) {
    setupAutoUpdater(mainWindow)
  }

  // ── 2026-08-18: 客户端常驻自动发布——定时检查 pending 任务，自动打开指纹浏览器页执行 ──
  setupAutoPublish()
}

/**
 * 客户端常驻自动发布：Electron 后台定时拉取 pending 发布任务，
 * 有任务时自动打开（隐藏窗口）指纹浏览器页 → 页面 3s 轮询自动导入并执行（自动启动浏览器+发布）。
 * 用户无需手动打开页面；主窗口保持当前页面不动。
 */
function setupAutoPublish() {
  if (global.__autoPublishStarted) return
  global.__autoPublishStarted = true
  let fpWindow = null
  const checkPending = async () => {
    try {
      const cookies = await session.defaultSession.cookies.get({ name: 'token' })
      if (!cookies.length) return // 未登录
      const serverUrl = process.env.SERVER_URL || 'https://ai-niuma.cc'
      const res = await fetch(`${serverUrl}/api/agent/publish-tasks?status=pending`, {
        headers: { cookie: `token=${encodeURIComponent(cookies[0].value)}` },
      })
      const d = await res.json()
      const hasPending = d && d.success && Array.isArray(d.data) && d.data.length > 0
      if (!hasPending) {
        if (fpWindow && !fpWindow.isDestroyed()) { try { fpWindow.close() } catch {} fpWindow = null }
        return
      }
      // 有 pending 任务 → 打开指纹浏览器页（隐藏窗口，后台轮询执行）
      if (!fpWindow || fpWindow.isDestroyed()) {
        fpWindow = new BrowserWindow({
          width: 1200, height: 800, show: true, // 2026-08-19: 可见——用户能确认客户端正在执行发布（不再隐藏，避免"没打开"困惑）
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: true,
            // 2026-08-18: 隐藏窗口必须禁后台节流——否则页面 setInterval 轮询被暂停，任务不会自动执行
            backgroundThrottling: false,
          },
        })
        fpWindow.loadURL(`${serverUrl}/my-fingerprint`)
        fpWindow.on('closed', () => { fpWindow = null })
      }
    } catch (e) { /* 静默：网络/未登录等 */ }
  }
  setInterval(checkPending, 6000)
  setTimeout(checkPending, 5000)
}

// ════════════════════════════════════════
//  自动更新（electron-updater）
// ════════════════════════════════════════

function setupAutoUpdater(win) {
  if (process.env.DISABLE_AUTO_UPDATE === '1') { console.log('[Updater] 已禁用（DISABLE_AUTO_UPDATE=1）'); return }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // 2026-08-21: 更新弹窗+进度窗口——打开客户端检测到更新即弹独立小窗显示下载进度，不再依赖主页面（太隐蔽）
  let updWin = null
  const showUpdateWindow = () => {
    if (updWin && !updWin.isDestroyed()) { updWin.show(); return }
    updWin = new BrowserWindow({
      width: 400, height: 260, resizable: false, maximizable: false, minimizable: false,
      title: 'AI 营销助手更新', autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })
    updWin.setMenuBarVisibility(false)
    updWin.loadFile(path.join(__dirname, 'renderer', 'update.html'))
    updWin.on('closed', () => { updWin = null })
    return updWin
  }
  const setUpd = (js) => { try { updWin?.webContents.executeJavaScript(js) } catch {} }

  // 检测到有新版本 → 弹窗显示
  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] 发现新版本:', info.version)
    showUpdateWindow()
    setTimeout(() => setUpd(`document.getElementById('status').textContent='发现新版本 v${info.version}，正在下载...'`), 400)
    win?.webContents.send('app:update-status', { status: 'available', version: info.version, releaseNotes: info.releaseNotes })
  })

  // 新版本下载进度 → 进度条实时更新
  autoUpdater.on('download-progress', (progressObj) => {
    const pct = Math.floor(progressObj.percent || 0)
    setUpd(`document.getElementById('bar').style.width='${pct}%';document.getElementById('pct').textContent='${pct}%';document.getElementById('status').textContent='正在下载更新...'`)
    win?.webContents.send('app:update-status', { status: 'downloading', percent: pct })
  })

  // 下载完成，弹窗提示重启并自动安装
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] 下载完成:', info.version)
    setUpd(`document.getElementById('status').textContent='更新完成 v${info.version}，即将重启安装...';document.getElementById('pct').textContent='100%';document.getElementById('bar').style.width='100%'`)
    win?.webContents.send('app:update-status', { status: 'ready', version: info.version, releaseNotes: info.releaseNotes })
    // 留 12 秒让用户看提示；若未手动操作，自动退出并安装重启
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(true, true)
      } catch (e) {
        console.error('[Updater] 自动安装失败:', e.message)
      }
    }, 12000)
  })

  // 没有新版本
  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] 当前已是最新版:', info.version)
    win?.webContents.send('app:update-status', { status: 'up-to-date' })
  })

  // 出错
  autoUpdater.on('error', (err) => {
    console.error('[Updater] 错误:', err.message)
    win?.webContents.send('app:update-status', { status: 'error', error: err.message })
  })

  // 启动后延迟 5 秒检查更新（2026-08-08：加 catch，更新检查失败不再导致进程崩溃退出）
  setTimeout(() => {
    console.log('[Updater] 正在检查更新...')
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[Updater] 检查失败（忽略，不影响使用）:', err?.message || err)
    })
  }, 5000)
}

// 暴露客户端版本信息给渲染进程（导航栏显示版本号 + 发布日期）
// 必须注册在顶层，不能放在 setupAutoUpdater 内部：
// 打包后的 app 因 NODE_ENV 未设为 'production' 导致 isDev 恒为 true，
// setupAutoUpdater 在 isDev 时不执行，app:get-version 永不注册 → 导航栏「版本加载中…」。
ipcMain.handle('app:get-version', async () => {
  try {
    const vPath = path.join(__dirname, 'version.json')
    if (fs.existsSync(vPath)) {
      const v = JSON.parse(fs.readFileSync(vPath, 'utf-8'))
      const version = v.version || app.getVersion()
      return { version, buildDate: v.buildDate || null }
    }
    return { version: app.getVersion(), buildDate: null }
  } catch (e) {
    console.error('[Version] 读取失败:', e.message)
    try { return { version: app.getVersion(), buildDate: null } } catch { return null }
  }
})

// IPC：手动触发检查更新
ipcMain.handle('updater:check', async () => {
  try {
    const result = await autoUpdater.checkForUpdates()
    return { success: true, updateInfo: result.updateInfo }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// IPC：立即下载并安装更新
ipcMain.handle('updater:install', async () => {
  try {
    autoUpdater.quitAndInstall(true, true)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})


// ── 找脚本目录 ──
function getScriptsDir() {
  const candidates = [
    path.join(process.resourcesPath, 'scripts'),
    path.join(__dirname, '..', 'scripts'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'platform-tools'))) return c
  }
  return candidates[1]
}

// ── 找 adb.exe ──
function findAdb() {
  const scriptsDir = getScriptsDir()
  const candidates = [
    path.join(scriptsDir, 'platform-tools', 'adb.exe'),
    path.join(scriptsDir, 'platform-tools', 'adb'),
    'adb.exe',
    'adb',
  ]
  for (const c of candidates) {
    if (c === 'adb.exe' || c === 'adb') return c
    if (fs.existsSync(c)) return c
  }
  return process.platform === 'win32' ? 'adb.exe' : 'adb'
}

// ════════════════════════════════════════
//  ADB IPC（原有，不动）
// ════════════════════════════════════════

ipcMain.handle('adb:devices', async () => {
  try {
    const adb = findAdb()
    const out = execSync('"' + adb + '" devices', { timeout: 5000, encoding: 'utf-8' })
    const lines = out.trim().split('\n').slice(1)
    const devices = lines.filter(l => l.trim() && !l.includes('adb')).map(l => {
      const [id, status] = l.split('\t')
      const isWifi = id.includes(':')
      return { id: id.trim(), status: status?.trim() || 'unknown', type: isWifi ? 'wifi' : 'usb', name: isWifi ? 'WiFi-' + id.split(':')[0].slice(-4) : 'USB-' + id.slice(0, 6) }
    })
    return { success: true, data: devices }
  } catch (e) {
    return { success: false, error: e.message, data: [] }
  }
})

ipcMain.handle('adb:shell', async (_event, { deviceId, command }) => {
  try {
    // 2026-08-12 #7: 防命令注入（nodeIntegrationInSubFrames 下 iframe JS 可调此 IPC）
    if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9.:_-]+$/.test(deviceId)) return { success: false, error: 'deviceId 非法' }
    if (typeof command !== 'string' || command.length > 500 || /[;&|`$<>()]/.test(command)) return { success: false, error: '命令含非法字符' }
    const adb = findAdb()
    const out = execSync('"' + adb + '" -s ' + deviceId + ' shell ' + command, { timeout: 15000, encoding: 'utf-8' })
    return { success: true, data: out.trim() }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('adb:screenshot', async (_event, { deviceId }) => {
  try {
    const adb = findAdb()
    const safeName = deviceId.replace(/[^a-zA-Z0-9]/g, '_')
    const tmpFile = path.join(os.tmpdir(), 'screenshot_' + safeName + '.png')
    execSync('"' + adb + '" -s ' + deviceId + ' shell screencap -p /sdcard/screen_tmp.png', { timeout: 15000 })
    execSync('"' + adb + '" -s ' + deviceId + ' pull /sdcard/screen_tmp.png "' + tmpFile + '"', { timeout: 15000 })
    execSync('"' + adb + '" -s ' + deviceId + ' shell rm /sdcard/screen_tmp.png', { timeout: 5000 })
    const { shell } = require('electron')
    shell.openPath(tmpFile)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('adb:tap', async (_event, { deviceId, x, y }) => {
  try {
    const adb = findAdb()
    execSync('"' + adb + '" -s ' + deviceId + ' shell input tap ' + x + ' ' + y, { timeout: 5000 })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('adb:input', async (_event, { deviceId, text }) => {
  try {
    const adb = findAdb()
    const safe = text.replace(/"/g, '\\"').replace(/ /g, '%s')
    execSync('"' + adb + '" -s ' + deviceId + ' shell input text "' + safe + '"', { timeout: 5000 })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('adb:swipe', async (_event, { deviceId, x1, y1, x2, y2, duration }) => {
  try {
    const adb = findAdb()
    const dur = duration ? ' ' + duration : ''
    execSync('"' + adb + '" -s ' + deviceId + ' shell input swipe ' + x1 + ' ' + y1 + ' ' + x2 + ' ' + y2 + dur, { timeout: 5000 })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('adb:mirror', async (_event, { deviceId }) => {
  try {
    const scriptsDir = getScriptsDir()
    const scrcpyPath = path.join(scriptsDir, 'scrcpy', 'scrcpy.exe')
    if (!fs.existsSync(scrcpyPath)) {
      return { success: false, error: '未找到 scrcpy，请先下载' }
    }
    spawn(scrcpyPath, ['-s', deviceId, '--max-size', '1080', '--window-title', deviceId, '--always-on-top'], {
      cwd: path.dirname(scrcpyPath),
      detached: true,
      stdio: 'ignore',
    }).unref()
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('adb:push', async (_event, { deviceId, localPath, remotePath }) => {
  try {
    const adb = findAdb()
    const dest = remotePath || '/sdcard/'
    execSync('"' + adb + '" -s ' + deviceId + ' push "' + localPath + '" ' + dest, { timeout: 30000 })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})


// ═══════════════════════════════════════════════════════════════
//  🌐 指纹浏览器 IPC（Fingerprint Browser via Playwright）
// ═══════════════════════════════════════════════════════════════

// 延迟加载 Playwright（避免拖慢启动）
let _chromium = null

/** 获取 Playwright Chromium 实例 */
async function getChromium() {
  if (!_chromium) {
    const pw = await import('playwright')
    // 快速校验浏览器可执行文件是否存在
    const exePath = pw.chromium.executablePath()
    if (!exePath || !fs.existsSync(exePath)) {
      throw new Error(
        `Playwright Chromium 未安装！\n` +
        `找不到浏览器: ${exePath || '(未知路径)'}\n\n` +
        `请在项目目录执行以下命令后重新打包：\n` +
        `  npx playwright install chromium`
      )
    }
    _chromium = pw.chromium
  }
  return _chromium
}

/** Map<port, { browserContext, page, accountId, platform, startedAt, proxy }> */
const activeBrowsers = new Map()

/** 获取用户数据目录 */
function getUserDataDir(port) {
  return path.join(app.getPath('userData'), `browser-profiles`, String(port))
}

/** 反检测启动参数 */
const FP_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-first-run',
  '--no-default-browser-check',
  '--lang=zh-CN',
]

const FP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'


// ── 启动指纹浏览器窗口 ──
ipcMain.handle('fp:start', async (_event, { port, userId, accountId, platform, proxy }) => {
  try {
    if (activeBrowsers.has(port)) {
      const existing = activeBrowsers.get(port)
      if (existing.browserContext && !existing.browserContext._closed) {
        return { success: false, error: `端口 ${port} 已有浏览器在运行` }
      }
      // 清理残留
      cleanupBrowser(existing).catch(() => {})
      activeBrowsers.delete(port)
    }

    const chromium = await getChromium()
    // 登录态按「账号维度」持久化：accountId 即 Account.id（稳定唯一），
    // 不再用 userId-platform，避免同用户多同平台账号争用同一 profile 目录（原“保存不住”根因之一）
    const profileKey = accountId ? String(accountId) : (userId ? `${userId}-${platform}` : String(port))
    const userDataDir = getUserDataDir(profileKey)
    fs.mkdirSync(userDataDir, { recursive: true })

    const launchOptions = {
      headless: false,              // ⭐ 有头模式：用户能看到真实浏览器窗口
      args: [
        ...FP_LAUNCH_ARGS,
        `--remote-debugging-port=${port}`,
        `--user-agent=${FP_USER_AGENT}`,
        '--start-maximized',
      ],
      // 视口自适应屏幕：窗口最大化 + viewport:null，
      // 页面按真实窗口尺寸渲染，出现真实滚动条，
      // 人工可像普通浏览器一样滚动查看发布键/位置等底部内容。
      // 脚本 click() 仍会自动滚动到目标元素，自动发布不受影响。
      viewport: null,
      locale: 'zh-CN',
    }

    // 代理支持
    if (proxy && proxy.trim()) {
      launchOptions.proxy = { server: proxy.trim() }
      console.log(`[FP] 端口${port} 使用代理: ${proxy}`)
    }

    const browserContext = await chromium.launchPersistentContext(userDataDir, launchOptions)

    // 创建页面并导航到平台登录页
    const page = await browserContext.newPage()
    const defaultUrl = getDefaultUrl(platform || 'douyin')
    await page.goto(defaultUrl, { timeout: 60000, waitUntil: 'domcontentloaded' }).catch(() => {})

    const instance = {
      browserContext,
      page,
      accountId: accountId || null,
      platform: platform || 'douyin',
      proxy: proxy || null,
      startedAt: Date.now(),
    }
    activeBrowsers.set(port, instance)

    console.log(`[FP] ✅ 启动成功 - 端口:${port} 平台:${platform} 代理:${proxy || '无'}`)

    return {
      success: true,
      data: {
        port,
        url: defaultUrl,
        profileDir: userDataDir,
        startedAt: instance.startedAt,
      },
    }
  } catch (e) {
    console.error(`[FP] ❌ 启动失败:`, e.message)
    return { success: false, error: e.message }
  }
})


// ── 停止指纹浏览器 ──
ipcMain.handle('fp:stop', async (_event, { port }) => {
  try {
    const instance = activeBrowsers.get(port)
    if (!instance) return { success: false, error: `端口 ${port} 没有运行中的浏览器` }

    await cleanupBrowser(instance)
    activeBrowsers.delete(port)
    console.log(`[FP] ⏹ 已停止 - 端口:${port}`)

    return { success: true }
  } catch (e) {
    activeBrowsers.delete(port)
    return { success: false, error: e.message }
  }
})


// ── 列出所有活跃浏览器 ──
ipcMain.handle('fp:list', async () => {
  const list = []
  for (const [port, inst] of activeBrowsers) {
    list.push({
      port,
      accountId: inst.accountId,
      platform: inst.platform,
      proxy: inst.proxy,
      running: !!(inst.browserContext && !inst.browserContext._closed),
      startedAt: inst.startedAt,
      currentUrl: inst.page?.url() || '',
    })
  }
  return { success: true, data: list }
})


// ── 截图 ──
ipcMain.handle('fp:screenshot', async (_event, { port }) => {
  try {
    const instance = activeBrowsers.get(port)
    if (!instance?.page || instance.page.isClosed()) throw new Error('页面不可用')

    const buf = await instance.page.screenshot({ type: 'png', fullPage: false })
    return {
      success: true,
      data: 'data:image/png;base64,' + buf.toString('base64'),
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})


// ── 在页面上点击坐标 ──
ipcMain.handle('fp:click', async (_event, { port, x, y }) => {
  try {
    const instance = activeBrowsers.get(port)
    if (!instance?.page || instance.page.isClosed()) throw new Error('页面不可用')

    await instance.page.mouse.click(x, y)
    await instance.page.waitForTimeout(800)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})


// ── 在页面上输入文字 ──
ipcMain.handle('fp:type', async (_event, { port, x, y, text }) => {
  try {
    const instance = activeBrowsers.get(port)
    if (!instance?.page || instance.page.isClosed()) throw new Error('页面不可用')

    await instance.page.mouse.click(x, y)
    await instance.page.waitForTimeout(300)
    await instance.page.keyboard.press('Control+a')
    await instance.page.waitForTimeout(100)
    await instance.page.keyboard.press('Backspace')
    await instance.page.waitForTimeout(100)
    // 逐字输入模拟真人
    for (const char of text) {
      await instance.page.keyboard.type(char, { delay: 40 + Math.random() * 70 })
    }
    await instance.page.waitForTimeout(300)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})


// ── 按 Enter 键 ──
ipcMain.handle('fp:enter', async (_event, { port }) => {
  try {
    const instance = activeBrowsers.get(port)
    if (!instance?.page || instance.page.isClosed()) throw new Error('页面不可用')
    await instance.page.keyboard.press('Enter')
    await instance.page.waitForTimeout(1500)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})


// ── 导航到指定 URL ──
ipcMain.handle('fp:navigate', async (_event, { port, url }) => {
  try {
    const instance = activeBrowsers.get(port)
    if (!instance?.page || instance.page.isClosed()) throw new Error('页面不可用')
    await instance.page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' })
    await instance.page.waitForTimeout(2000)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})


// ── 获取当前 URL / Cookie / 标题等信息 ──
ipcMain.handle('fp:info', async (_event, { port }) => {
  try {
    const instance = activeBrowsers.get(port)
    if (!instance?.browserContext) throw new Error('浏览器不存在')

    const cookies = await instance.browserContext.cookies().catch(() => [])
    return {
      success: true,
      data: {
        url: instance.page?.url() || '',
        title: await instance.page?.title().catch(() => '') || '',
        cookieCount: cookies.length,
        hasSessionCookie: cookies.some(c => c.name.toLowerCase().includes('session') || c.name.toLowerCase().includes('token')),
        running: !instance.browserContext._closed,
      },
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})


// ── 登录态持久化（按账号维度，本地标记文件）──
// 解决「扫码登录后保存不住」：登录态落在 Account.id 维度 profile 目录，
// 并用 .loggedin 标记文件记录有效登录，前端刷新后通过 fp:loginState 重新读取。
ipcMain.handle('fp:markLogin', async (_event, { accountId }) => {
  try {
    if (!accountId) return { success: false, error: '缺少 accountId' }
    const dir = getUserDataDir(String(accountId))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '.loggedin'), new Date().toISOString())
    console.log(`[FP] 标记账号 ${accountId} 已登录`)
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('fp:loginState', async (_event, { accountId }) => {
  try {
    if (!accountId) return { success: true, data: { loggedIn: false } }
    const dir = getUserDataDir(String(accountId))
    const loggedIn = fs.existsSync(path.join(dir, '.loggedin'))
    return { success: true, data: { loggedIn } }
  } catch (e) { return { success: false, error: e.message, data: { loggedIn: false } } }
})

ipcMain.handle('fp:logout', async (_event, { accountId }) => {
  try {
    if (!accountId) return { success: false, error: '缺少 accountId' }
    const dir = getUserDataDir(String(accountId))
    const marker = path.join(dir, '.loggedin')
    if (fs.existsSync(marker)) fs.unlinkSync(marker)
    console.log(`[FP] 清除账号 ${accountId} 登录标记`)
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})


// ── 停止当前执行的模板脚本（不是停止浏览器）──
ipcMain.handle('fp:scriptStop', () => {
  global.__fpAbort = true
  return { success: true, message: '已发送停止信号' }
})

// ── 执行自动化模板脚本（核心）──
// templateType: 'douyin-publish' | 'douyin-comment' | ...
// params: 模板所需的参数（文案、目标用户等）
/**
 * 从素材仓库下载视频到本地临时目录（5 个平台共用）。
 *  - 优先复用本地缓存（temp/aimarketing-videos）：反复测试同一文件时，即便 OSS 上文件已被清理也能继续发布
 *  - storage/file 端点免鉴权（middleware 白名单放行），不携带 cookie，避免巨型 JWT 触发 HTTP 431
 *  - 失败时把完整 URL 带进错误，便于在浏览器直接核对 userId / name
 */
async function downloadStorageFile(userId, storageFileName, log) {
  const serverUrl = process.env.SERVER_URL || 'https://ai-niuma.cc'  // 2026-08-13 纯壳
  const tmpDir = path.join(os.tmpdir(), 'aimarketing-videos')
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
  if (typeof storageFileName !== 'string' || !/^[a-zA-Z0-9._\-]+$/.test(storageFileName)) { log('文件名非法，已拒绝'); return false }
  const localPath = path.join(tmpDir, storageFileName)
  // 本地已有有效缓存 → 直接复用，不再打 OSS
  if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
    const kb = (fs.statSync(localPath).size / 1024 / 1024).toFixed(1)
    log(`[缓存] 复用本地视频: ${localPath} (${kb}MB)`)
    return localPath
  }
  const downloadUrl = `${serverUrl}/api/storage/file?userId=${encodeURIComponent(userId || '')}&name=${encodeURIComponent(storageFileName)}`
  log(`从素材仓库下载: ${storageFileName}（${serverUrl}）`)
  await new Promise((resolve, reject) => {
    const urlObj = new URL(downloadUrl)
    // 2026-08-13: 下载需带登录 cookie（storage/file 已加鉴权，#5）——从主窗口 session 拿 cookie，就绪后再发起下载
    const startDownload = (reqHeaders) => {
      const urlObj = new URL(downloadUrl)
      const mod = require(urlObj.protocol === 'https:' ? 'https' : 'http')
      mod.get(downloadUrl, { timeout: 120000, headers: reqHeaders }, (res) => {
        if (res.statusCode !== 200) {
          res.resume && res.resume()
          // 404 多为该文件在素材仓库已不存在（被清理/未上传）；带上 URL 便于浏览器核对
          return reject(new Error(`HTTP ${res.statusCode}（请在浏览器打开核对: ${downloadUrl}）`))
        }
        const chunks = []
        res.on('data', (ch) => chunks.push(ch))
        res.on('end', () => {
          try { fs.writeFileSync(localPath, Buffer.concat(chunks)); resolve() }
          catch (e) { reject(e) }
        })
      }).on('error', reject).on('timeout', () => reject(new Error('下载超时')))
    }
    try {
      const s = mainWindow && mainWindow.webContents ? mainWindow.webContents.session : null
      if (s && s.cookies) {
        const ckList = s.cookies.get({ url: serverUrl })
        if (ckList && typeof ckList.then === 'function') {
          ckList.then((cks) => {
            const cs = cks.map((ck) => ck.name + '=' + ck.value).join('; ')
            startDownload(cs ? { Cookie: cs } : {})
          }).catch(() => startDownload({}))
        } else startDownload({})
      } else startDownload({})
    } catch (e) { log('[下载] 取 cookie 失败: ' + (e && e.message ? e.message : e)); startDownload({}) }
  })
  const stat = fs.statSync(localPath)
  log(`✅ 已下载到本地 (${(stat.size / 1024 / 1024).toFixed(1)}MB)`)
  if (stat.size < 10000) log(`⚠️ 文件过小(${stat.size}B)，可能下载不完整`)
  return localPath
}

ipcMain.handle('fp:execute', async (_event, { port, templateType, params }) => {
  try {
    const instance = activeBrowsers.get(port)
    if (!instance?.page || instance.page.isClosed()) throw new Error('浏览器未运行')
    // 2026-08-13: 注入登录 cookie（发布脚本下载素材需要鉴权）
    try {
      if (mainWindow && mainWindow.webContents && mainWindow.webContents.session && mainWindow.webContents.session.cookies) {
        const cks = await mainWindow.webContents.session.cookies.get({ url: 'https://ai-niuma.cc' })
        const cs = cks.map((ck) => ck.name + '=' + ck.value).join('; ')
        if (cs) { params = params || {}; params.cookie = cs }
      }
    } catch (e) { console.log('[FP] 取 cookie 失败', e && e.message) }

    const logs = []
    const log = (msg) => {
      logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`)
      console.log(`[FP-Script][${templateType}] ${msg}`)
    }

    log(`开始执行模板: ${templateType}`)

    // 重置停止标志
    global.__fpAbort = false
    // 2026-08-20: 发布执行超时保护——脚本卡住（平台未登录等元素/上传卡死）120s 强制终止，
    // 否则任务永远 pending → 客户端循环开窗执行（已实测卡死循环）
    const withTimeout = (p, ms) =>
      Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('发布执行超时(120s)，已终止——请确认平台已登录后重试')), ms))])
    let result
    switch (templateType) {
      case 'douyin-publish':
        // 如果是从素材仓库选择视频，先下载到本地（含本地缓存复用；404 多为文件在仓库已不存在）
        if (params.storageFileName && !params.videoPath) {
          try {
            params.videoPath = await downloadStorageFile(params.userId, params.storageFileName, log)
          } catch (e) {
            log(`❌ 视频下载失败: ${e.message}`)
            return { success: false, logs, message: `素材仓库下载失败: ${e.message}` }
          }
        }
        result = await withTimeout(executeDouyinPublish(instance.page, params, log), 120000)
        break
      case 'douyin-like':
        result = await executeDouyinLike(instance.page, params, log)
        break
      case 'douyin-comment':
        result = await executeDouyinComment(instance.page, params, log)
        break
      case 'xiaohongshu-publish':
        // 如果是从素材仓库选择视频，先下载到本地（含本地缓存复用；404 多为文件在仓库已不存在）
        if (params.storageFileName && !params.videoPath) {
          try {
            params.videoPath = await downloadStorageFile(params.userId, params.storageFileName, log)
          } catch (e) {
            log(`❌ 视频下载失败: ${e.message}`)
            return { success: false, logs, message: `素材仓库下载失败: ${e.message}` }
          }
        }
        result = await withTimeout(executeXiaohongshuPublish(instance.page, params, log), 120000)
        break
      case 'kuaishou-publish':
        // 如果是从素材仓库选择视频，先下载到本地（含本地缓存复用；404 多为文件在仓库已不存在）
        if (params.storageFileName && !params.videoPath) {
          try {
            params.videoPath = await downloadStorageFile(params.userId, params.storageFileName, log)
          } catch (e) {
            log(`❌ 视频下载失败: ${e.message}`)
            return { success: false, logs, message: `素材仓库下载失败: ${e.message}` }
          }
        }
        result = await withTimeout(executeKuaishouPublish(instance.page, params, log), 120000)
        break
      case 'shipinhao-publish':
        // 如果是从素材仓库选择视频，先下载到本地（含本地缓存复用；404 多为文件在仓库已不存在）
        if (params.storageFileName && !params.videoPath) {
          try {
            params.videoPath = await downloadStorageFile(params.userId, params.storageFileName, log)
          } catch (e) {
            log(`❌ 视频下载失败: ${e.message}`)
            return { success: false, logs, message: `素材仓库下载失败: ${e.message}` }
          }
        }
        result = await withTimeout(executeShipinhaoPublish(instance.page, params, log), 120000)
        break
      case 'bilibili-publish':
        // 如果是从素材仓库选择视频，先下载到本地（含本地缓存复用；404 多为文件在仓库已不存在）
        if (params.storageFileName && !params.videoPath) {
          try {
            params.videoPath = await downloadStorageFile(params.userId, params.storageFileName, log)
          } catch (e) {
            log(`❌ 视频下载失败: ${e.message}`)
            return { success: false, logs, message: `素材仓库下载失败: ${e.message}` }
          }
        }
        result = await withTimeout(executeBilibiliPublish(instance.page, params, log), 120000)
        break
      case 'weibo-publish':
        // 微博脚本内部自行处理素材仓库下载与登录检测
        result = await withTimeout(executeWeiboPublish(instance.page, params, log), 120000)
        break
      default:
        throw new Error(`未知模板类型: ${templateType}`)
    }

    // 发布成功后，标记该账号已登录（持久化本地登录态，解决“保存不住”）
    if (result && result.success && instance.accountId) {
      try {
        const dir = getUserDataDir(String(instance.accountId))
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, '.loggedin'), new Date().toISOString())
      } catch (_) {}
    }

    log(`执行完成: ${result.success ? '成功' : '失败'} ${result.message || ''}`)

    return {
      success: !!result.success,
      error: result.success ? undefined : (result.message || '执行失败'),
      needLogin: !!result.needLogin,
      data: {
        ...result,
        logs,
        executedAt: Date.now(),
      },
    }
  } catch (e) {
    return { success: false, error: e.message, logs: [e.message] }
  }
})


// ════════════════════════════════════════
//  自动化模板实现
// ════════════════════════════════════════

async function executeDouyinLike(page, params, log) {
  try {
    const count = Math.min(params.count || 3, 10)
    const urls = params.targetUrls || []

    if (urls.length > 0) {
      for (let i = 0; i < Math.min(urls.length, count); i++) {
        log(`打开第 ${i + 1} 个视频: ${urls[i]}`)
        await page.goto(urls[i], { timeout: 20000 })
        await page.waitForTimeout(3000)

        // 点赞
        const likeSel = ['[class*="like"] span', 'svg[class*="like"]', '[data-e2e="video-like-icon"]']
        for (const sel of likeSel) {
          try {
            const el = await page.$(sel)
            if (el && await el.isVisible()) {
              await el.click()
              log(`已点赞`)
              break
            }
          } catch (_) {}
        }
        await page.waitForTimeout(1000)
      }
    } else {
      // 当前页面滚动点赞模式
      log('当前页面浏览+点赞模式')
      for (let i = 0; i < count; i++) {
        await page.mouse.wheel(0, 600) // 向下滚
        await page.waitForTimeout(2000)
        // 尝试点赞
        try {
          const likeBtn = await page.$('[class*="like"]:not([class*="active"])')
          if (likeBtn) {
            await likeBtn.click()
            log(`滚动点赞 #${i + 1}`)
          }
        } catch (_) {}
      }
    }

    return { success: true, message: `已完成 ${count} 次点赞操作` }
  } catch (e) {
    log(`出错: ${e.message}`)
    return { success: false, message: e.message }
  }
}

/**
 * 抖音评论模板
 * params: { comment, targetUrl? }
 */
async function executeDouyinComment(page, params, log) {
  try {
    if (!params.comment) throw new Error('评论内容不能为空')

    if (params.targetUrl) {
      log(`打开目标页面: ${params.targetUrl}`)
      await page.goto(params.targetUrl, { timeout: 20000 })
      await page.waitForTimeout(3000)
    }

    // 找评论框
    const commentSels = [
      'textarea[placeholder*="评论"]',
      'input[placeholder*="评论"]',
      '[class*="comment-input"] textarea',
      '[data-e2e="comment-input"]',
    ]

    let commented = false
    for (const sel of commentSels) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible()) {
          await el.click()
          await el.fill(params.comment)
          // 发送按钮
          await page.waitForTimeout(500)
          const sendSel = ['text=发送', 'button:has-text("发送")', '[class*="send"]']
          for (const ss of sendSel) {
            try {
              const sendBtn = await page.$(ss)
              if (sendBtn && await sendBtn.isVisible()) {
                await sendBtn.click()
                commented = true
                break
              }
            } catch (_) {}
          }
          break
        }
      } catch (_) {}
    }

    if (!commented) log('未找到评论框，可能需要手动定位')

    return {
      success: commented,
      message: commented ? '评论已发送' : '未找到评论框，请手动操作',
    }
  } catch (e) {
    log(`出错: ${e.message}`)
    return { success: false, message: e.message }
  }
}




// ════════════════════════════════════════
//  工具函数
// ════════════════════════════════════════

/** 清理浏览器实例资源 */
async function cleanupBrowser(instance) {
  try {
    if (instance.page && !instance.page.isClosed()) {
      await instance.page.close().catch(() => {})
    }
    if (instance.browserContext && !instance.browserContext._closed) {
      await instance.browserContext.close().catch(() => {})
    }
  } catch (_) {}
}

/** 根据平台获取默认登录 URL */
function getDefaultUrl(platform) {
  const urls = {
    douyin: 'https://creator.douyin.com/creator-micro/content/upload',
    xiaohongshu: 'https://creator.xiaohongshu.com/publish/publish',
    kuaishou: 'https://cp.kuaishou.com/article/publish/video',
    shipinhao: 'https://channels.weixin.qq.com/platform/post/create',
    bilibili: 'https://member.bilibili.com/platform/upload-video/frame',
    toutiao: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    weibo: 'https://weibo.com',
  }
  return urls[platform] || urls.douyin
}


// ── 启动更新日志弹窗 ──
async function showChangelogOnStartup() {
  try {
    const changelogPath = path.join(__dirname, 'changelog.json')
    if (!fs.existsSync(changelogPath)) return
    const list = JSON.parse(fs.readFileSync(changelogPath, 'utf-8'))
    if (!Array.isArray(list) || list.length === 0) return
    const latest = list[0]
    const storePath = path.join(app.getPath('userData'), 'lastChangelogVersion.json')
    let lastSeen = null
    try { lastSeen = JSON.parse(fs.readFileSync(storePath, 'utf-8')).version } catch (_) {}
    if (lastSeen === latest.version) return
    const detail = (latest.changes || []).map((c, i) => `${i + 1}. ${c}`).join('\n')
    await dialog.showMessageBox({
      type: 'info',
      title: `更新日志 v${latest.version}`,
      message: latest.title || `版本 ${latest.version} 更新内容`,
      detail: `发布日期：${latest.date || '—'}\n\n${detail}`,
      buttons: ['知道了'],
      noLink: true,
    })
    fs.writeFileSync(storePath, JSON.stringify({ version: latest.version, seenAt: new Date().toISOString() }))
  } catch (e) {
    console.error('[Changelog] 弹窗失败:', e.message)
  }
}

app.whenReady().then(() => {
  createWindow()
  showChangelogOnStartup()
})

// 2026-08-10：渲染进程崩溃监控（诊断客户端闪退）
app.on('render-process-gone', (event, webContents, details) => {
  const msg = `[CRASH] 渲染进程崩溃 reason=${details.reason} exitCode=${details.exitCode}`
  console.error(msg)
  try { require('fs').appendFileSync(require('path').join(require('os').tmpdir(), 'aimarketing-crash.log'), new Date().toISOString() + ' ' + msg + '\n') } catch {}
})
app.on('child-process-gone', (event, details) => {
  const msg = `[CRASH] 子进程退出 type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`
  console.error(msg)
  try { require('fs').appendFileSync(require('path').join(require('os').tmpdir(), 'aimarketing-crash.log'), new Date().toISOString() + ' ' + msg + '\n') } catch {}
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// 退出时清理所有浏览器（2026-08-05 修复：Electron 不会 await async listener，
// 直接退出会残留 Playwright/Chromium 子进程占用打包产物文件。改为 preventDefault +
// 等待清理完成（5s 超时兜底）后 app.exit，保证退出无残留）
let isQuitting = false
app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  isQuitting = true
  ;(async () => {
    const browsers = [...activeBrowsers.values()]
    await Promise.race([
      Promise.all(browsers.map(inst => cleanupBrowser(inst).catch(() => {}))),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ])
    activeBrowsers.clear()
    if (localServerProc) {
      try { localServerProc.kill() } catch (e) { /* 忽略 */ }
      localServerProc = null
    }
    app.exit(0)
  })()
})


// ════════════════════════════════════════
//  本地语音识别（sherpa-onnx——A 方案，2026-08-19）
//  前端录 PCM(16k) → IPC → 本地离线识别 → 文本（不依赖服务器/代理）
// ════════════════════════════════════════
let localRecognizer = null
let localAsrSession = null // { stream, lastText }——流式会话（2026-08-19 实时识别）
function getSherpaModelDir() {
  // 打包：resources/models/sherpa；开发：electron/models/sherpa
  const candidates = [
    path.join(process.resourcesPath || '', 'models', 'sherpa'),
    path.join(__dirname, 'models', 'sherpa'),
  ]
  for (const c of candidates) { if (fs.existsSync(path.join(c, 'tokens.txt'))) return c }
  return candidates[1]
}
function ensureLocalRecognizer() {
  const sherpa = require('sherpa-onnx-node')
  const modelDir = getSherpaModelDir()
  if (!fs.existsSync(path.join(modelDir, 'tokens.txt'))) throw new Error('本地语音模型未安装（sherpa models 缺失）')
  if (!localRecognizer) {
    localRecognizer = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: path.join(modelDir, 'encoder-epoch-99-avg-1.int8.onnx'),
          decoder: path.join(modelDir, 'decoder-epoch-99-avg-1.int8.onnx'),
          joiner: path.join(modelDir, 'joiner-epoch-99-avg-1.int8.onnx'),
        },
        tokens: path.join(modelDir, 'tokens.txt'),
      },
    })
  }
  return { sherpa, modelDir }
}
// 流式识别会话（实时——边说边出字，学白龙马）
ipcMain.handle('asr:session-start', async () => {
  try {
    const { sherpa } = ensureLocalRecognizer()
    localAsrSession = { stream: localRecognizer.createStream(), lastText: '' }
    return { success: true }
  } catch (e) { return { success: false, error: e && e.message ? e.message : String(e) } }
})
ipcMain.handle('asr:audio', async (_e, payload) => {
  try {
    if (!localAsrSession) return { success: false, error: '识别会话未开始' }
    const samples = payload && payload.samples ? Array.from(payload.samples) : []
    const sr = payload && payload.sampleRate ? payload.sampleRate : 16000
    if (!samples.length) return { success: true, text: localAsrSession.lastText }
    localAsrSession.stream.acceptWaveform({ samples: new Float32Array(samples), sampleRate: sr })
    localRecognizer.decode(localAsrSession.stream)
    const r = localRecognizer.getResult(localAsrSession.stream)
    const text = String((r && r.text) || '').trim()
    localAsrSession.lastText = text
    return { success: true, text, isFinal: false }
  } catch (e) { return { success: false, error: e && e.message ? e.message : String(e) } }
})
ipcMain.handle('asr:session-end', async () => {
  try {
    if (!localAsrSession) return { success: false, error: '识别会话未开始' }
    const text = localAsrSession.lastText
    localAsrSession = null
    return { success: true, text, isFinal: true }
  } catch (e) { return { success: false, error: e && e.message ? e.message : String(e) } }
})
ipcMain.handle('asr:session-abort', async () => { localAsrSession = null; return { success: true } })



// ════════════════════════════════════════
//  OpenCLI 发布通道（2026-08-21）——驱动用户已登录 Chrome 真发布（独立于指纹浏览器）
//  依赖：用户装 OpenCLI（opencli.info/download 的 OpenCLIApp 自带命令）+ Chrome Browser Bridge 扩展
// ════════════════════════════════════════
const { exec: execCb } = require('child_process')
const { promisify } = require('util')
const execP = promisify(execCb)
ipcMain.handle('opencli:check', async () => {
  try {
    await execP('opencli doctor', { timeout: 15000, windowsHide: true })
    return { success: true }
  } catch (e) {
    return { success: false, error: e && e.message ? (e.message||'').slice(0,120) : '未安装' }
  }
})
ipcMain.handle('opencli:publish', async (_e, payload) => {
  // payload: { site: 'douyin'|'xiaohongshu'|'weibo', args: ['标题', '视频路径', ...] }
  try {
    const site = payload && payload.site ? String(payload.site).trim() : ''
    if (!site) return { success: false, error: '缺少平台（site）' }
    const args = (payload.args || []).map(String)
    const cmd = ['opencli', site, 'publish', ...args].join(' ')
    const { stdout, stderr } = await execP(cmd, { timeout: 240000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 })
    return { success: true, output: String(stdout || '').slice(-2000), err: String(stderr || '').slice(-1000) }
  } catch (e) {
    return {
      success: false,
      error: e && e.message ? (e.message||'').slice(0,120) : String(e),
      hint: '需安装 OpenCLI（opencli.info/download OpenCLIApp）并在 Chrome 安装 Browser Bridge 扩展；抖音/小红书/微博支持 publish，B站/快手/视频号暂无适配器',
    }
  }
})
