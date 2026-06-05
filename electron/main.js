const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execSync, spawn } = require('child_process')

// ── 自动更新 ──
const { autoUpdater } = require('electron-updater')

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
async function getChromium() {
  if (!_chromium) _chromium = (await import('playwright')).chromium
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

    let result
    switch (templateType) {
      case 'douyin-publish':
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

/**
 * 抖音发视频模板 v4（客户端版）
 *
 * 流程：/content/upload → 上传 → 等转码 → /content/publish编辑 → 填写→封面→发布
 * v4修复：
 *   - 标题/正文改用 contenteditable div 选择器
 *   - keyboard.type() 替代 fill()（fill对contenteditable无效）
 *   - 上传检测：URL变化 + 编辑元素可见 + 二次确认
 *   - 话题输入后下拉选项确认
 *   - 封面选择（竖3:4 + 横4:3）
 *   - 弹窗处理函数复用
 */
async function executeDouyinPublish(page, params, log) {

  // ═══ 工具函数 ═══

  /** 关闭常见弹窗 */
  async function dismissPopups(prefix = '') {
    for (const text of ['我知道了', '知道了', '确定']) {
      try {
        const btn = await page.$(`text="${text}"`)
        if (btn && await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 2000 })
          log(`${prefix}关闭弹窗「${text}」`)
          await page.waitForTimeout(800)
        }
      } catch (_) {}
    }
  }

  /** 填写标题（contenteditable div） */
  async function fillTitle(titleText) {
    const text = titleText.substring(0, 30)
    const selectors = [
      'div[contenteditable="true"][data-placeholder*="标题"]',
      'div[contenteditable="true"][placeholder*="标题"]',
      '[class*="title-wrap"] div[contenteditable="true"]',
      '[class*="TitleInput"] div[contenteditable="true"]',
    ]
    for (const sel of selectors) {
      try {
        const el = await page.$(sel)
        if (!el || !(await el.isVisible().catch(() => false))) continue
        log(`  找到标题框: ${sel}`)
        await el.click({ timeout: 3000 })
        await page.waitForTimeout(800)
        await el.evaluate((n) => { n.innerText = '' })
        await page.waitForTimeout(200)
        await page.keyboard.type(text, { delay: 60 })
        await page.waitForTimeout(500)
        const value = await el.evaluate((n) => n.innerText).catch(() => '')
        if (value.trim().length > 0) { log(`  ✅ 标题:"${value}"`); return true }
        else log(`  ⚠️ 验证为空`)
      } catch (e) { log(`  ⚠️ ${sel}: ${e.message}`) }
    }
    return false
  }

  /** 填写正文/描述 */
  async function fillDescription(caption) {
    const selectors = [
      'div[contenteditable="true"][data-placeholder*="添加作品简介"]',
      'div[contenteditable="true"][placeholder*="简介"]',
      'div[contenteditable="true"][placeholder*="描述"]',
      '.editor-wrapper div[contenteditable="true"]',
      'textarea[placeholder*="作品简介"]',
      'textarea[placeholder*="简介"]',
    ]
    for (const sel of selectors) {
      try {
        const el = await page.$(sel)
        if (!el || !(await el.isVisible().catch(() => false))) continue
        log(`  找到正文框: ${sel}`)
        await el.click({ timeout: 3000 })
        await page.waitForTimeout(800)
        if (sel.includes('contenteditable')) {
          await el.evaluate((n) => { n.innerText = '' })
          await page.keyboard.type(caption, { delay: 40 })
        } else {
          await el.fill(caption)
        }
        await page.waitForTimeout(500)
        const value = await el.evaluate((n) => n.value || n.innerText).catch(() => '')
        if (value.length > 0) { log(`  ✅ 正文(${value.length}字)`); return true }
      } catch (e) { log(`  ⚠️ ${sel}: ${e.message}`) }
    }
    return false
  }

  // ═══ 主流程 ═══

  try {
    if (!params.videoPath) throw new Error('请提供视频文件路径')
    if (!fs.existsSync(params.videoPath)) throw new Error(`视频文件不存在: ${params.videoPath}`)

    // ── Step 1: 导航到上传页 ──
    const targetUrl = 'https://creator.douyin.com/creator-micro/content/upload'
    const currentUrl = page.url()
    log(`当前页面: ${currentUrl}`)

    if (!currentUrl.includes('/content/upload')) {
      log(`导航到: ${targetUrl}`)
      await page.goto(targetUrl, { timeout: 30000, waitUntil: 'networkidle' })
      await page.waitForTimeout(5000)
      log(`已到达: ${page.url()}`)
    } else {
      log('当前已在视频上传页')
      await page.waitForTimeout(2000)
    }

    await dismissPopups()

    // ── Step 2: 上传视频 ──
    log(`准备上传视频: ${params.videoPath}`)
    let uploaded = false

    // 探测所有file input（含隐藏的）
    let allFileInputs = []
    try {
      allFileInputs = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[type="file"]')
        return Array.from(inputs).map((el, i) => ({
          index: i, accept: el.getAttribute('accept'), id: el.id,
          className: el.className.substring(0, 60),
        }))
      })
    } catch (e) { log(`探测出错: ${e.message}`) }

    log(`探测到 ${allFileInputs.length} 个 file input`)
    if (allFileInputs.length > 0) log(JSON.stringify(allFileInputs))

    for (let i = 0; i < allFileInputs.length; i++) {
      try {
        const els = await page.$$('input[type="file"]')
        if (els[i]) {
          await els[i].setInputFiles(params.videoPath)
          uploaded = true
          log('✅ 视频已设置到 file input[' + i + ']')
          break
        }
      } catch (e) { log(`  input[${i}] 失败: ${e.message}`) }
    }

    // 兜底：点击触发 file chooser
    if (!uploaded) {
      log('尝试点击触发文件选择器...')
      const triggers = [
        'text=上传视频', 'text=上传', 'text=选择文件', 'text=拖拽',
        '[class*="upload-btn"]', '[class*="UploadBtn"]',
        '[class*="upload-area"]', '[class*="picker"]',
        '[data-e2e="upload"]',
      ]
      for (const trigger of triggers) {
        try {
          const [fc] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null),
            page.click(trigger, { timeout: 2000 }).catch(() => {}),
          ])
          if (fc) {
            await fc.setFiles(params.videoPath)
            uploaded = true
            log('✅ 文件选择器上传成功 (' + trigger + ')')
            break
          }
        } catch (_) {}
      }
    }

    // page.setInputFiles 兜底
    if (!uploaded) {
      try {
        await page.setInputFiles('input[type="file"]', params.videoPath)
        uploaded = true
        log('✅ page.setInputFiles 成功')
      } catch (_) {}
    }

    if (!uploaded) {
      const info = await page.evaluate(() => ({ url: location.href, title: document.title })).catch(() => ({}))
      return { success: false, message: '未找到上传入口 URL=' + info.url }
    }

    // ── Step 3: 等待上传完成进入编辑页 ──
    log('═══ Step 3: 等待视频上传+转码 ═══')
    const UPLOAD_WAIT_MS = 3000
    const MIN_UPLOAD_SEC = 30
    const MAX_UPLOAD_SEC = 270
    const MAX_LOOPS = Math.floor(MAX_UPLOAD_SEC * 1000 / UPLOAD_WAIT_MS)
    const MIN_LOOPS = Math.floor(MIN_UPLOAD_SEC * 1000 / UPLOAD_WAIT_MS)

    let editPageDetected = false
    const uploadStartTime = Date.now()

    for (let i = 0; i < MAX_LOOPS; i++) {
      await page.waitForTimeout(UPLOAD_WAIT_MS)
      const elapsedSec = Math.round((Date.now() - uploadStartTime) / 1000)
      const curUrl = page.url()

      // 详细日志（每15秒或前3次）
      if (i % 5 === 4 || i < 3) {
        const info = await page.evaluate(() => {
          const body = document.body.innerText
          const matches = []
          for (const kw of ['上传中', '上传完成', '转码中', '转码完成', '处理中', '%']) {
            if (body.includes(kw)) matches.push(kw)
          }
          return { url: location.href, matches }
        }).catch(() => ({ url: curUrl, matches: [] }))
        log(`  [${elapsedSec}s] URL=${curUrl.replace('https://creator.douyin.com','...')} | 关键词:${info.matches.join(',')||'无'}`)
      }

      // 弹窗处理
      await dismissPopups(`  [${elapsedSec}s] `)

      // 双重检测
      const urlChanged = curUrl.includes('/content/publish') || curUrl.includes('/publish')
      let editElementsFound = false

      if (i >= MIN_LOOPS) {
        const strictSels = [
          'div[contenteditable="true"][data-placeholder*="标题"]',
          'div[contenteditable="true"][data-placeholder*="简介"]',
        ]
        for (const sel of strictSels) {
          try {
            const e = await page.$(sel)
            if (e && await e.isVisible().catch(() => false)) { editElementsFound = true; break }
          } catch (_) {}
        }
      }

      // 二次确认
      if (urlChanged && editElementsFound) {
        log(`  [${elapsedSec}s] 首次检测到编辑页，二次确认中...`)
        await page.waitForTimeout(5000)
        const titleBox = await page.$('div[contenteditable="true"][data-placeholder*="标题"]')
        if (titleBox && await titleBox.isVisible().catch(() => false)) {
          editPageDetected = true
          log(`✅ 视频上传+转码完成 (${elapsedSec}s)，已进入编辑页`)
          break
        } else {
          log(`  [${elapsedSec}s] 二次确认失败，继续等待...`)
        }
      }

      if (urlChanged && !editElementsFound && i < MIN_LOOPS) {
        log(`  [${elapsedSec}s] URL已变但未到最短等待时间(${MIN_UPLOAD_SEC}s)...`)
      }
      if (i % 10 === 9 && i >= MIN_LOOPS) {
        log(`  ...仍在等待 (${elapsedSec}s/${MAX_UPLOAD_SEC}s)`)
      }
    }

    if (!editPageDetected) {
      log(`⚠️ 等待超时 (${Math.round((Date.now()-uploadStartTime)/1000)}s)，尝试继续...`)
    }

    log('额外缓冲5秒...')
    await page.waitForTimeout(5000)
    await dismissPopups('[上传后] ')

    // ── Step 4: 填写作品描述（标题+正文）──
    if (params.caption) {
      log('[步骤4] 填写作品描述')
      await page.waitForTimeout(2000)
      const titleOk = await fillTitle(params.caption)
      if (!titleOk) log('  ❌ 标题未填入')
      await page.waitForTimeout(2000)
      const descOk = await fillDescription(params.caption)
      if (!descOk) log('  ❌ 正文未填入')
      log(`步骤4完成 → 标题:${titleOk?'OK':'失败'} 正文:${descOk?'OK':'失败'}`)
      await page.waitForTimeout(2000)
    } else { log('[步骤4] 跳过') }

    // ── Step 5: 话题 ──
    if (params.topics) {
      log('[步骤5] 添加话题: ' + params.topics)
      await page.waitForTimeout(1500)
      const topicList = params.topics.split(/[\s,，]+/).filter(t => t.trim())
      let ok = 0

      for (let idx = 0; idx < topicList.length; idx++) {
        const ct = topicList[idx].startsWith('#') ? topicList[idx] : '#' + topicList[idx]
        log(`  [5.${idx+1}] ${ct}`)
        try {
          // 点 #添加话题 入口
          for (const tr of ['#添加话题', '添加话题']) {
            try {
              const tb = await page.$('text="' + tr + '"')
              if (tb && await tb.isVisible().catch(() => false)) {
                await tb.click(); log('    已点话题入口'); await page.waitForTimeout(1000); break
              }
            } catch (_) {}
          }
          // 找输入框并输入
          let did = false
          const topicInputs = [
            'input[placeholder*="#"]', 'input[placeholder*="话题"]',
            '[class*="topic-input"] input', '[class*="TopicInput"] input',
            'div[contenteditable="true"][data-placeholder*="话题"]',
          ]
          for (const ti of topicInputs) {
            try {
              const te = await page.$(ti)
              if (te && await te.isVisible().catch(() => false)) {
                await te.click({ timeout: 2000 })
                if (ti.includes('contenteditable')) {
                  await te.evaluate((n) => { n.innerText = '' })
                  await page.keyboard.type(ct, { delay: 60 })
                } else {
                  await te.fill(ct.replace('#', ''))
                }
                await page.waitForTimeout(1200)
                // 下拉选项确认
                let selected = false
                const optionSels = [
                  '[class*="option"]:not([style*="display:none"]) span',
                  '[class*="suggest"] span:not([style*="display:none"])',
                  '[class*="dropdown"] li span',
                  '[class*="topic-item"] span',
                  'text="' + ct + '" >> nth=0',
                ]
                for (const os of optionSels) {
                  try {
                    const opt = await page.$(os)
                    if (opt && await opt.isVisible().catch(() => false)) {
                      await opt.click({ timeout: 2000 }); selected = true; break
                    }
                  } catch (_) {}
                }
                if (!selected) { await page.keyboard.press('Enter'); log('    Enter兜底') }
                did = true; log(`    ✅ 输入:${ct}${selected?'(下拉选中)':''}`); break
              }
            } catch (_) {}
          }
          // 键盘兜底
          if (!did) {
            for (const c of ct) await page.keyboard.type(c, { delay: 80 })
            await page.waitForTimeout(800)
            await page.keyboard.press('Enter')
            log(`    ✅ 键盘:${ct}`); did = true
          }
          ok++; await page.waitForTimeout(1500)
        } catch (e) { log(`    ❌ ${ct}: ${e.message}`) }
      }
      log(`✅ 步骤5完成 (${ok}/${topicList.length})`)
      await page.waitForTimeout(1500)
    } else { log('[步骤5] 跳过') }

    // ── Step 6: 封面（竖3:4 + 横4:3）──
    log('[步骤6] 检查封面...')
    await page.waitForTimeout(1500)
    try {
      const covers = []
      for (const btn of await page.$$('button, div[role="button"]').catch(() => [])) {
        try { if ((await btn.innerText()).trim() === '选择封面') covers.push(btn) } catch (_) {}
      }
      log(`  找到 ${covers.length} 个选择封面按钮`)
      for (let i = 0; i < Math.min(covers.length, 2); i++) {
        const lab = i === 0 ? '竖封面(3:4)' : '横封面(4:3)'
        log(`  [6.${i+1}] 点击${lab}`)
        try {
          await covers[i].click({ timeout: 3000 })
          await page.waitForTimeout(2000)
          // 检查默认选中
          const selectedImg = await page.$('[class*="selected"] img, [class*="active"] img').catch(() => null)
          if (selectedImg) { log(`    有默认选中封面`) }
          else {
            const imgs = await page.$$('[class*="recommend"] img, [class*="cover-list"] img, [class*="img-item"] img').catch(() => [])
            if (imgs.length) { await imgs[0].click({timeout:1500}).catch(()=>{}); log(`    手动选择第1张`); await page.waitForTimeout(500) }
          }
          // 点确认
          for (const cs of ['text=使用', 'text=确定', 'text=确认', 'text=保存']) {
            try {
              const cb = await page.$(cs)
              if (cb && await cb.isVisible().catch(() => false)) {
                await cb.click(); log(`    ✅ 确认${lab}`); await page.waitForTimeout(1000); break
              }
            } catch (_) {}
          }
        } catch (e) { log(`    ⚠️ ${lab}: ${e.message}`) }
      }
      if (!covers.length) log('  ⚠️ 未找到封面按钮')
      log('✅ 步骤6完成')
    } catch (e) { log(`❌ 步骤6: ${e.message}`) }
    await page.waitForTimeout(2000)

    // ── Step 7: 发布 ──
    if (params.publishNow !== 'false') {
      log('[步骤7] 寻找发布按钮...')
      await page.waitForTimeout(2000)
      let pub = false
      try {
        const btns = await page.$$('button')
        const vis = []
        for (let i = 0; i < btns.length; i++) {
          try { const t = (await btns[i].innerText()).trim(); if (await btns[i].isVisible().catch(()=>false) && t) vis.push({t,n:i}) } catch(_) {}
        }
        log(`  可见按钮(${vis.length}):`); vis.forEach(b => log(`    [${b.n}] "${b.t}"`))

        for (const b of vis) {
          if ((b.t === '发布' || b.t === '立即发布') && !b.t.includes('离开')) {
            await btns[b.n].click({ timeout: 5000 }); pub = true; log(`  ✅ 点击:"${b.t}"`); break
          }
        }
      } catch (e) { log(`  遍历异常: ${e.message}`) }

      if (!pub) { try { await page.click('button:has-text("发布")',{timeout:3000}); pub=true; log('  兜底成功') } catch(_){} }

      if (!pub) {
        log('❌ 未找到发布按钮！请手动点击')
        return { success: true, message: '内容已填完，请手动点「发布」', needConfirm: true }
      }

      log('等待发布响应(8s)...')
      await page.waitForTimeout(8000)
      const fu = page.url(), bt = await page.evaluate(()=>document.body.innerText).catch(()=>'')
      if (bt.includes('发布成功') || fu.includes('/manage')) { log('🎉 发布成功！'); return { success: true, message: '视频已发布到抖音' } }
      log('⚠️ 结果不确定，请确认')
      return { success: true, message: '已执行发布，请手动确认', needConfirm: true }
    } else {
      log('[步骤7] 草稿模式')
      return { success: true, message: '内容已填完，保存草稿', needConfirm: true }
    }

  } catch (e) {
    log(`❌ 出错: ${e.message}`)
    return { success: false, message: e.message }
  }
}

/**
 * 抖音点赞模板
 * params: { targetUrls?: string[], count?: number }
 */
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
