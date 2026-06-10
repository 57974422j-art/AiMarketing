const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execSync, spawn } = require('child_process')

// ── 自动更新 ──
const { autoUpdater } = require('electron-updater')

// ── 指纹浏览器模板 ──
const { executeDouyinPublish } = require('./fp-templates/douyin-publish')

let mainWindow

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
    },
    icon: path.join(__dirname, '../public/icon.png'),
  })

  const isDev = process.env.NODE_ENV !== 'production'
  const serverUrl = process.env.SERVER_URL || 'http://120.55.43.195:3000'
  mainWindow.loadURL(serverUrl)
  if (isDev) mainWindow.webContents.openDevTools()

  // ── 自动更新检测（生产环境）──
  if (!isDev) {
    setupAutoUpdater(mainWindow)
  }
}

// ════════════════════════════════════════
//  自动更新（electron-updater）
// ════════════════════════════════════════

function setupAutoUpdater(win) {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // 检测到有新版本
  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] 发现新版本:', info.version)
    win?.webContents.send('app:update-status', { status: 'available', version: info.version, releaseNotes: info.releaseNotes })
  })

  // 新版本下载进度
  autoUpdater.on('download-progress', (progressObj) => {
    const pct = Math.floor(progressObj.percent || 0)
    win?.webContents.send('app:update-status', { status: 'downloading', percent: pct })
  })

  // 下载完成，提示重启
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] 下载完成:', info.version)
    win?.webContents.send('app:update-status', { status: 'ready', version: info.version, releaseNotes: info.releaseNotes })
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

  // 启动后延迟 5 秒检查更新
  setTimeout(() => {
    console.log('[Updater] 正在检查更新...')
    autoUpdater.checkForUpdates()
  }, 5000)
}

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
let _browserChecked = false

/** 获取 Playwright Chromium 实例，自动检测并安装浏览器 */
async function getChromium() {
  if (!_chromium) {
    const pw = await import('playwright')
    
    // 首次使用时检查浏览器是否已安装
    if (!_browserChecked) {
      _browserChecked = true
      try {
        const executablePath = pw.chromium.executablePath()
        if (!executablePath || !fs.existsSync(executablePath)) {
          console.log('[FP] ⚠️ Chromium 浏览器未检测到，正在自动安装...')
          const { execSync } = require('child_process')
          // 使用 npx playwright install 安装（兼容打包/开发环境）
          const cmd = process.platform === 'win32' ? 'npx playwright install chromium' : 'npx playwright install chromium'
          execSync(cmd, { stdio: 'inherit', timeout: 120000 })
          console.log('[FP] ✅ Chromium 浏览器安装完成')
          
          // 重新获取路径确认
          const newPath = pw.chromium.executablePath()
          if (!newPath || !fs.existsSync(newPath)) {
            throw new Error(`安装后仍找不到浏览器: ${newPath}`)
          }
        }
      } catch (e) {
        console.error('[FP] ❌ 浏览器安装失败:', e.message)
        throw new Error(
          `Playwright Chromium 未安装且自动安装失败: ${e.message}\n` +
          `请手动执行: npx playwright install chromium`
        )
      }
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
ipcMain.handle('fp:start', async (_event, { port, accountId, platform, proxy }) => {
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
    const userDataDir = getUserDataDir(port)
    fs.mkdirSync(userDataDir, { recursive: true })

    const launchOptions = {
      headless: false,              // ⭐ 有头模式：用户能看到真实浏览器窗口
      args: [
        ...FP_LAUNCH_ARGS,
        `--remote-debugging-port=${port}`,
        `--user-agent=${FP_USER_AGENT}`,
      ],
      viewport: { width: 1280, height: 800 },
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


// ── 停止当前执行的模板脚本（不是停止浏览器）──
ipcMain.handle('fp:scriptStop', () => {
  global.__fpAbort = true
  return { success: true, message: '已发送停止信号' }
})

// ── 执行自动化模板脚本（核心）──
// templateType: 'douyin-publish' | 'douyin-comment' | ...
// params: 模板所需的参数（文案、目标用户等）
ipcMain.handle('fp:execute', async (_event, { port, templateType, params }) => {
  try {
    const instance = activeBrowsers.get(port)
    if (!instance?.page || instance.page.isClosed()) throw new Error('浏览器未运行')

    const logs = []
    const log = (msg) => {
      logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`)
      console.log(`[FP-Script][${templateType}] ${msg}`)
    }

    log(`开始执行模板: ${templateType}`)

    // 重置停止标志
    global.__fpAbort = false
    let result
    switch (templateType) {
      case 'douyin-publish':
        // 如果是从素材仓库选择视频，先下载到本地
        if (params.storageFileName && !params.videoPath) {
          const serverUrl = process.env.SERVER_URL || 'http://120.55.43.195:3000'
          const downloadUrl = `${serverUrl}/api/storage/file?userId=${params.userId || ''}&name=${encodeURIComponent(params.storageFileName)}`
          const tmpDir = path.join(os.tmpdir(), 'aimarketing-videos')
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
          const localPath = path.join(tmpDir, params.storageFileName)
          log(`从素材仓库下载: ${params.storageFileName}`)
          try {
            // 用 stream 方式下载，支持大文件
            await new Promise((resolve, reject) => {
              const urlObj = new URL(downloadUrl)
              const mod = require(urlObj.protocol === 'https:' ? 'https' : 'http')
              const reqHeaders = {}
              if (params.authToken) reqHeaders['Cookie'] = 'token=' + params.authToken
              mod.get(downloadUrl, { timeout: 120000, headers: reqHeaders }, (res) => {
                if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
                const chunks = []
                res.on('data', chunk => chunks.push(chunk))
                res.on('end', () => {
                  const buf = Buffer.concat(chunks)
                  fs.writeFileSync(localPath, buf)
                  resolve()
                })
              }).on('error', reject).on('timeout', () => reject(new Error('下载超时')))
            })
            const stat = fs.statSync(localPath)
            log(`✅ 已下载到本地 (${(stat.size / 1024 / 1024).toFixed(1)}MB)`)
            if (stat.size < 10000) {
              log(`⚠️ 文件过小(${stat.size}B)，可能下载不完整`)
            }
            params.videoPath = localPath
          } catch (e) {
            log(`❌ 视频下载失败: ${e.message}`)
            return { success: false, logs, message: `素材仓库下载失败: ${e.message}` }
          }
        }
        result = await executeDouyinPublish(instance.page, params, log)
        break
      case 'douyin-like':
        result = await executeDouyinLike(instance.page, params, log)
        break
      case 'douyin-comment':
        result = await executeDouyinComment(instance.page, params, log)
        break
      case 'xiaohongshu-publish':
        result = await executeXhsPublish(instance.page, params, log)
        break
      default:
        throw new Error(`未知模板类型: ${templateType}`)
    }

    log(`执行完成: ${result.success ? '成功' : '失败'} ${result.message || ''}`)

    return {
      success: true,
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

/**
 * 小红书发帖模板（结构类似抖音）
 */
async function executeXhsPublish(page, params, log) {
  try {
    if (!page.url().includes('creator.xiaohongshu.com') && !page.url().includes('xhslink')) {
      log('导航到小红书创作服务平台...')
      await page.goto('https://creator.xiaohongshu.com/publish/publish', { timeout: 30000 })
      await page.waitForTimeout(3000)
    }

    if (params.caption) {
      log('填写小红书文案...')
      const inputSel = ['textarea', '[contenteditable="true"]']
      for (const sel of inputSel) {
        try {
          const input = await page.$(sel)
          if (input && await input.isVisible()) {
            await input.click()
            await page.waitForTimeout(300)
            await input.fill(params.caption)
            log('文案已填写')
            break
          }
        } catch (_) {}
      }
    }

    log('小红书发帖模板完成')
    return {
      success: true,
      message: '小红书发帖内容已填写，请手动确认发布',
      needConfirm: true,
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
    bilibili: 'https://member.bilibili.com/platform/upload-video/frame',
    toutiao: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    weibo: 'https://weibo.com',
  }
  return urls[platform] || urls.douyin
}


app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// 退出时清理所有浏览器
app.on('before-quit', async () => {
  for (const [, inst] of activeBrowsers) {
    await cleanupBrowser(inst).catch(() => {})
  }
  activeBrowsers.clear()
})
