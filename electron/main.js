const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execSync, spawn } = require('child_process')

let mainWindow

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
}

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
 * 抖音发帖模板
 * params: { caption?, videoPath?[], images?[] }
 */
async function executeDouyinPublish(page, params, log) {
  try {
    // 确保在创作者中心
    const currentUrl = page.url()
    if (!currentUrl.includes('creator.douyin.com')) {
      log('导航到抖音创作者中心...')
      await page.goto('https://creator.douyin.com/creator-micro/content/publish', { timeout: 30000 })
      await page.waitForTimeout(3000)
    }

    // 点击"发布图文/视频"入口
    log('寻找发布按钮...')
    // 尝试多种选择器
    const publishSelectors = [
      'text=发布',
      '[class*="publish"]',
      'button:has-text("发布")',
      'div[class*="publishBtn"]',
      '[data-testid="publish-btn"]',
    ]

    let clicked = false
    for (const sel of publishSelectors) {
      try {
        const el = await page.$(sel)
        if (el && await el.isVisible()) {
          await el.click({ timeout: 3000 })
          clicked = true
          log(`点击发布按钮: ${sel}`)
          break
        }
      } catch (_) {}
    }

    if (!clicked) {
      // 兜底：直接访问上传页
      log('尝试直接进入上传页面...')
      await page.goto('https://creator.douyin.com/publish/content/', { timeout: 20000 })
      await page.waitForTimeout(3000)
    }

    await page.waitForTimeout(2000)

    // 如果有文案，填入标题/描述
    if (params.caption) {
      log(`填写文案 (${params.caption.length}字)...`)
      const inputSel = ['textarea[placeholder*="添加作品描述"]', 'textarea', '[contenteditable="true"]']
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

    // 如果有图片/视频，上传文件
    const mediaFiles = [...(params.images || []), ...(params.videoPath ? [params.videoPath] : [])]
    if (mediaFiles.length > 0) {
      log(`准备上传 ${mediaFiles.length} 个文件...`)
      // 寻找文件上传元素
      const uploadInputSel = ['input[type="file"]', '[class*="upload"] input']
      for (const sel of uploadInputSel) {
        try {
          const uploadEl = await page.$(sel)
          if (uploadEl) {
            // Playwright 文件上传需要通过 setInputFiles
            const fileInputs = await page.$$('input[type="file"]')
            if (fileInputs.length > 0) {
              // 过滤存在的文件
              const existingFiles = mediaFiles.filter(f => fs.existsSync(f))
              if (existingFiles.length > 0) {
                await fileInputs[0].setInputFiles(existingFiles)
                log(`已选择 ${existingFiles.length} 个文件`)
                await page.waitForTimeout(5000) // 等待上传
              } else {
                log('警告：指定的媒体文件不存在于本地')
              }
            }
            break
          }
        } catch (_) {}
      }
    }

    log('模板步骤完成，等待用户确认发布或继续操作...')

    return {
      success: true,
      message: '抖音发帖模板执行完毕（已填写内容，请手动确认发布）',
      needConfirm: true,
    }
  } catch (e) {
    log(`执行出错: ${e.message}`)
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
    douyin: 'https://creator.douyin.com/creator-micro/content/publish',
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
