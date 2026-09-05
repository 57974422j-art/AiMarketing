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
// 2026-09-04: 统一 userData 到安装盘（exe 同级 data/）——登录态/日志/指纹 profile 全跟安装盘，不再走 C 盘 AppData（根治 AI-Marketing/ai-marketing/AI营销助手 残留）
try { app.setPath('userData', path.join(path.dirname(process.execPath), '..', 'aimarketing-data')) } catch (e) { console.log('[main] setPath userData 失败:', e.message) }
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
    // 2026-08-23: 主窗口引用给服务器回调读 cookie 用
    // (global.__mainWin 在下方赋值)
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
    global.__mainWin = mainWindow
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
  // 2026-08-26: 启动检查未完成任务提示（确认才继续执行）
  startupTaskCheck().catch(() => { global.__allowResume = true })
  // 2026-08-25: 登录保活——启动时一次 + 每天 11:30 定时（对齐 OpenCLI 中午保活）
  setTimeout(() => { try { keepaliveBrowser() } catch {} }, 8000)
  setInterval(() => {
    const now = new Date()
    if (now.getHours() === 11 && now.getMinutes() >= 28 && now.getMinutes() <= 35) { try { keepaliveBrowser() } catch {} }
  }, 60000)
}

/**
 * 客户端常驻自动发布：Electron 后台定时拉取 pending 发布任务，
 * 有任务时自动打开（隐藏窗口）指纹浏览器页 → 页面 3s 轮询自动导入并执行（自动启动浏览器+发布）。
 * 用户无需手动打开页面；主窗口保持当前页面不动。
 */

// 2026-08-23: 服务器回调带登录 cookie（主进程从 Electron session 读——middleware 无 token 会 401）
async function getServerCookie() {
  try {
    const win = global.__mainWin
    if (!win || !win.webContents) return ''
    const serverUrl = process.env.SERVER_URL || 'https://ai-niuma.cc'
    // 2026-08-30: 多域读——url 精确可能读不到（域/路径不匹配）——先精确后全量 fallback
    let cookies = await win.webContents.session.cookies.get({ url: serverUrl }).catch(() => [])
    if (!cookies.length) {
      const all = await win.webContents.session.cookies.get({}).catch(() => [])
      const tok = all.filter((c) => ['token', 'auth', 'sid'].includes(c.name))
      cookies = tok.length ? tok : all.filter((c) => c.domain.includes('ai-niuma.cc'))
    }
    if (!cookies.length) { console.log('[getServerCookie] 空（读不到 token cookie——session/域问题）'); return '' }
    return cookies.map((c) => c.name + '=' + c.value).join('; ')
  } catch (e) { console.error('[getServerCookie] 异常:', e?.message || e); return '' }
}

// 2026-08-26: 启动检查——有未完成任务（发布/视频）先弹窗提示，用户确认"继续执行"才开轮询（防止启动自动执行/任务没完成被忽略）
async function startupTaskCheck() {
  try {
    const cookies = await session.defaultSession.cookies.get({ url: 'https://ai-niuma.cc', name: 'token' })
    if (!cookies.length) { global.__allowResume = true; return }
    const ck = 'token=' + encodeURIComponent(cookies[0].value)
    const [pub, vid] = await Promise.all([
      fetch('https://ai-niuma.cc/api/agent/publish-tasks?status=pending', { headers: { cookie: ck } }).then((r) => r.json()).catch(() => null),
      fetch('https://ai-niuma.cc/api/video/tasks?status=processing', { headers: { cookie: ck } }).then((r) => r.json()).catch(() => null),
    ])
    const pubN = 0 // opencli 发布已迁移 browser_use——不再弹 AgentPublishTask（视频任务仍提示）
    const vidN = vid && Array.isArray(vid.data) ? vid.data.length : 0
    if (!pubN && !vidN) { global.__allowResume = true; return }
    const { dialog } = require('electron')
    const r = await dialog.showMessageBox(mainWindow, {
      type: 'warning', buttons: ['继续执行', '暂不执行'], defaultId: 0, cancelId: 0, // 2026-08-27: 默认继续执行（建了任务就要发；点 X/关闭=继续，点“暂不执行”才跳过）
      title: '有未完成的任务',
      message: '检测到未完成的任务',
      detail: '发布任务 ' + pubN + ' 个、视频生成任务 ' + vidN + ' 个未完成。是否继续执行？（不执行则保持待办，可稍后手动触发）',
    })
    global.__allowResume = r.response === 0
  } catch { global.__allowResume = true }
}

function setupAutoPublish() {
  if (global.__autoPublishStarted) return
  global.__autoPublishStarted = true
  let fpWindow = null
  const checkPending = async () => {
    try {
      if (!global.__allowResume) return // 2026-08-26: 启动未确认不自动执行（提示后用户选“继续执行”才开）
      // 2026-08-26: 必须带 url 读取（带域 cookie 不指定 url 查不到→轮询每次提前退出→任务永远 pending→“假发”）；与 getServerCookie 一致
      const cookies = await session.defaultSession.cookies.get({ url: 'https://ai-niuma.cc', name: 'token' })
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
      // 2026-08-23: 发布兜底——看到发布任务就立刻检查账号+浏览器：未登录 → 直开平台登录页（新tab一次）+留pending；已登录 → 3平台CDP发布，其余提示手动
      const cdpPublish = ['douyin', 'xiaohongshu', 'weibo', 'shipinhao', 'twitter', 'jike', 'xianyu']
      const LOGIN_URLS = {
        douyin: 'https://creator.douyin.com', xiaohongshu: 'https://creator.xiaohongshu.com/publish/publish',
        weibo: 'https://weibo.com', bilibili: 'https://www.bilibili.com', kuaishou: 'https://cp.kuaishou.com',
        shipinhao: 'https://channels.weixin.qq.com/platform/post/create', twitter: 'https://x.com',
        jike: 'https://web.okjike.com', xianyu: 'https://www.goofish.com', instagram: 'https://www.instagram.com',
      }
      const tasks = d.data.slice(0, 5)
      for (const t of tasks) {
        const plat = String(t.platform || '').toLowerCase()
        try {
          const accts = await getBrowserAccounts()
          const loggedIn = accts.some((a) => a.id === plat && a.loggedIn)
          if (!loggedIn) {
            // 未登录 → 打开平台登录页（仅一次）+ 任务留 pending，登录后自动重试；浏览器未开先自动启动内置
            if (!global.__loginPrompted) global.__loginPrompted = {}
            if (!global.__loginPrompted[t.id]) {
              global.__loginPrompted[t.id] = true
              const { chromium } = require('playwright')
              let b2 = null
              try { b2 = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT) } catch {
                // 浏览器没开 → 自动启动内置 Chromium（独立 profile 必通）
                try {
                  const builtinExe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p)) || chromium.executablePath()
                  if (builtinExe && fs.existsSync(builtinExe)) {
                    const profileDir = path.join(app.getPath('userData'), 'browser-profile')
                    fs.mkdirSync(profileDir, { recursive: true })
                    try { for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) { const sp = path.join(profileDir, f); if (fs.existsSync(sp)) fs.rmSync(sp, { force: true }) } } catch {}
                    const { spawn } = require('child_process')
                    const proc = spawn(builtinExe, ['--remote-debugging-port=' + CDP_PORT, '--remote-allow-origins=*', '--user-data-dir=' + profileDir, '--no-first-run', '--disable-first-run-ui', 'about:blank'], { detached: true, stdio: 'ignore' })
                    proc.unref(); boundProc = proc
                    for (let i = 0; i < 30; i++) { try { const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', { signal: AbortSignal.timeout(2000) }); if (r.ok) break } catch {} await new Promise((r2) => setTimeout(r2, 500)) }
                    b2 = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT)
                  }
                } catch {}
              }
              const ctx2 = b2 ? b2.contexts()[0] : null
              if (ctx2) {
                const pg = await ctx2.newPage()
                await pg.goto(LOGIN_URLS[plat] || 'https://www.google.com', { waitUntil: 'domcontentloaded' }).catch(() => {})
                console.log('[AutoPublish] 平台未登录，已直开登录页:', plat, '任务#', t.id)
              }
              b2.close().catch(() => {})
            }
            continue  // 留 pending，等用户登录后自动重试
          }
          // 已登录：CDP 3 平台真发布（publishXxx），其余提示手动
          if (!cdpPublish.includes(plat)) {
            fetch(`${serverUrl}/api/agent/publish-tasks/${t.id}/done`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': await getServerCookie() },
              body: JSON.stringify({ status: 'failed', error: '浏览器已登录' + (t.platform || '') + '，但该平台自动发布通道未开通——请到浏览器手动发布' }),
            }).catch(() => {})
            continue
          }
          // 3 平台已登录 → 执行 CDP 发布
          const { chromium } = require('playwright')
          const b3 = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT)
          const ctx3 = b3.contexts()[0]
          if (ctx3) {
            const page = ctx3.pages().find((p2) => p2.url().includes(plat)) || await ctx3.newPage()
            // 2026-08-26: 测试模式（[TEST] 前缀任务）——走页面 DOM 到"发布按钮前"停止，不传视频不真发
            const isTest = (t.description || '').startsWith('[TEST]')
            if (isTest && plat === 'douyin') {
              try {
                // 2026-08-26: 测试必须到上传页——即使已在 creator 域（之前条件判断已有域→跳过goto→停在home→找不到按钮）
                if (!page.url().includes('content/upload')) {
                  await page.goto('https://creator.douyin.com/creator-micro/content/upload', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {})
                  await page.waitForTimeout(3500)
                }
                const btnFound = await page.evaluate(() => {
                  const vis = (el) => el.offsetParent !== null
                  const all = Array.from(document.querySelectorAll('button, [class*="publish" i], [class*="release" i]'))
                  return all.some((el) => vis(el) && /发布/.test(el.textContent || ''))
                }, { timeout: 8000 }).catch(() => false)
                const loggedOut = page.url().includes('login') || page.url().includes('passport')
                // 通过条件：到达上传页（url 含 content/upload 或 creator-micro/content）且未跳登录；发布按钮在未选视频时可能不出现——页面可达即算通道通
                const atUpload = page.url().includes('content/upload') || page.url().includes('creator-micro/content')
                r = (!loggedOut && atUpload) ? { success: true, test: true, message: btnFound ? '✅ 发布通道测试通过：已到达发布页，发布按钮就位（未真发）' : '✅ 发布通道测试通过：已到达上传发布页（选视频后发布按钮将出现，未真发）' }
                  : (loggedOut ? { success: false, error: '未登录抖音创作者平台' } : { success: false, error: '未能到达上传发布页' })
              } catch (e4) { r = { success: false, error: '测试异常: ' + (e4.message || e4) } }
              // 测试完成：标 done 并跳过真发流程
              try { await fetch(serverUrl + '/api/agent/publish-tasks/' + t.id + '/done', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': await getServerCookie() }, body: JSON.stringify(r) }).catch(() => {}) } catch {}
              b3.close().catch(() => {})
              continue
            }
            let r = { success: false, error: '未知平台' }
            try {
              // 2026-08-25: 7 平台自动发布——需视频的平台（抖音/小红书视频/视频号/闲鱼）先取本地路径（任务带或仓库下载）
              let vp = t.videoPath || t.localVideoPath || ''
              if (!vp && t.id && ['douyin', 'xiaohongshu', 'shipinhao', 'xianyu'].includes(plat)) {
                try {
                  const dl = await fetch(serverUrl + '/api/agent/publish-tasks/' + t.id + '/download-url', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': await getServerCookie() }, body: '{}', signal: AbortSignal.timeout(20000) }).then((r2) => r2.json())
                  if (dl && dl.success && dl.url) {
                    const tmpDir = require('os').tmpdir()
                    const dest = require('path').join(tmpDir, 'aim-v-' + t.id + '-' + Date.now() + '.mp4')
                    const buf = Buffer.from(await (await fetch(dl.url, { signal: AbortSignal.timeout(120000) })).arrayBuffer())
                    require('fs').writeFileSync(dest, buf)
                    vp = dest
                    console.log('[AutoPublish] 仓库视频已下载到本地:', dest, buf.length, '字节')
                  }
                } catch (e) { console.log('[AutoPublish] 视频下载失败:', e.message) }
              }
              // 2026-08-28: 小红书排除——图文任务无视频也可发（被拦则图文永不发了）；有视频名时分支内自动走视频线
              // 2026-08-30: OPENCLI 发布链已清除——AgentPublishTask 不再执行（发布统一 browser_use）
              r = { success: true, done: true, result: '发布已迁移至 AI 浏览器（browser_use）——请对 AGENT 说“用AI浏览器发布”重新创建任务', error: '' }
              if (r) return r
              const needVp = ['douyin', 'shipinhao', 'xianyu'].includes(plat)
              if (needVp && !vp) { r = { success: false, error: '视频获取失败（本地路径/仓库下载均不可用）' } }
              else if (plat === 'weibo') r = await publishWeibo(page, { text: t.title || t.description || '' })
              else if (plat === 'xiaohongshu') {
                // 图文：从任务 description 提取图片 URL（AI 传 http(s) 图片）→ 下载本地 → 发布
                // 2026-08-28: 完整 URL（含 ?OSSAccessKeyId 签吏参数——不在扩展名处截断，否则下载 403）
                const imgUrls = (t.description || '').match(/https?:\/\/[^\s"']+/gi)?.filter((u2) => /\.(?:jpg|jpeg|png|webp)/i.test(u2)) || []
                const imgs = []
                for (const u of imgUrls.slice(0, 9)) {
                  try { const buf = Buffer.from(await (await fetch(u, { signal: AbortSignal.timeout(60000) })).arrayBuffer()); const p2 = require('path').join(require('os').tmpdir(), 'xhs-i-' + Date.now() + '-' + imgs.length + '.jpg'); require('fs').writeFileSync(p2, buf); imgs.push(p2) } catch {}
                }
                // 2026-08-28: description 无图 → coverUrl 兜底（封面当图——之前已转 OSS 持久代理）；再无可下视频当图
                let xhsImgs = imgs
                if (!xhsImgs.length && t.coverUrl) {
                  try {
                    // 2026-08-28: coverUrl 文件名（非 http）→ 走 /api/storage/file?name= 代理下载（带 cookie 不过期）
                    const cov = t.coverUrl.startsWith('http') ? t.coverUrl : serverUrl.replace(/\/$/, '') + '/api/storage/file?name=' + encodeURIComponent(t.coverUrl)
                    const buf = Buffer.from(await (await fetch(cov, { signal: AbortSignal.timeout(60000) })).arrayBuffer()); const p3 = require('path').join(require('os').tmpdir(), 'xhs-c-' + Date.now() + '.jpg'); require('fs').writeFileSync(p3, buf); xhsImgs = [p3] } catch (eCov) { console.log('[xhs] 封面下载失败:', eCov.message) }
                }
                if (!xhsImgs.length && vp && require('fs').existsSync(vp)) {
                  // 有视频无图：小红书视频发布（CDP 版——参考 fp-templates/xiaohongshu-publish.js：上传视频→填标题→发布）
                  try {
                    await page.goto('https://creator.xiaohongshu.com/publish/publish?source=official', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {})
                    await page.waitForTimeout(2500)
                    await page.setInputFiles('input[type="file"]', vp).catch(async () => { const vis2 = await page.evaluate(() => { const vis = (el) => !!el && el.offsetParent !== null; const inp = [...document.querySelectorAll('input[type="file"]')].find(i => vis(i)); if (inp) { inp.setAttribute('data-xhs-v', '1'); return 'input[data-xhs-v="1"]' } return '' }); if (vis2) await page.setInputFiles(vis2, vp) })
                    await page.waitForTimeout(12000)
                    const titleSel = await page.evaluate(() => { const vis = (el) => !!el && el.offsetParent !== null; const cand = [...document.querySelectorAll('input[placeholder*="标题"], input[placeholder*="填写标题"], div[contenteditable="true"][data-placeholder*="标题"]')]; const el = cand.find(i => vis(i)); if (el) { el.setAttribute('data-xhs-t', '1'); return 'input[data-xhs-t="1"], div[data-xhs-t="1"]' } return '' })
                    if (titleSel) { await page.fill(titleSel, (t.title || '').slice(0, 20)); await page.waitForTimeout(1500) }
                    const bodySel = await page.evaluate(() => { const vis = (el) => !!el && el.offsetParent !== null; const cand = [...document.querySelectorAll('div[contenteditable="true"][data-placeholder*="正文"], div[contenteditable="true"][data-placeholder*="描述"], div[contenteditable="true"][data-placeholder*="分享"], textarea[placeholder*="正文"]')]; const el = cand.find(i => vis(i)) || [...document.querySelectorAll('div[contenteditable="true"]')].find(i => vis(i)); if (el) { el.setAttribute('data-xhs-b', '1'); return '[data-xhs-b="1"]' } return '' })
                    if (bodySel) { await page.click(bodySel); await page.keyboard.type((t.description || '').slice(0, 500), { delay: 10 }); await page.waitForTimeout(1500) }
                    const pubSel = await page.evaluate(() => { const vis = (el) => !!el && el.offsetParent !== null; const btns = [...document.querySelectorAll('button, [class*="publish"], [class*="release"]')].filter(b => vis(b) && /发布/.test(b.textContent || '')); const t = btns.find(b => (b.textContent || '').includes('发布')) || btns[btns.length - 1]; if (t) { t.setAttribute('data-xhs-p', '1'); return '[data-xhs-p="1"]' } return '' })
                    if (pubSel) { await page.click(pubSel); await page.waitForTimeout(3000); r = { success: true, test: false, message: '小红书视频发布已点击' } }
                    else r = { success: false, error: '未找到小红书发布按钮' }
                  } catch (eXhs) { r = { success: false, error: '小红书视频发布异常: ' + (eXhs.message || eXhs) } }
                } else {
                  r = xhsImgs.length ? await publishXhsImages(page, { images: xhsImgs, title: t.title || '', desc: t.description || '' }) : { success: false, error: '小红书缺材料：无图无视频无封面' }
                }
              }
              else if (plat === 'douyin') r = await publishDouyinViaCDP({ videoPath: vp, title: t.title || '', caption: t.description || '' })
              else if (plat === 'shipinhao') r = await publishShipinhao(page, { videoPath: vp, title: t.title || '', desc: t.description || '' })
              else if (plat === 'twitter') r = await publishTwitter(page, { text: t.title || t.description || '' })
              else if (plat === 'jike') r = await publishJike(page, { text: t.title || t.description || '' })
              else if (plat === 'xianyu') r = await publishXianyu(page, { title: t.title || '', desc: t.description || '', price: '1', images: [] })
              else r = { success: false, error: '未知平台' }
            } catch (e) { r = { success: false, error: e.message } }
            const status = r && r.success ? 'succeeded' : 'failed'
            const error = r && !r.success ? (r.error || '发布失败') : undefined
            const body = { status }
            if (error) body.error = error
            fetch(`${serverUrl}/api/agent/publish-tasks/${t.id}/done`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': await getServerCookie() }, body: JSON.stringify(body),
            }).catch(() => {})
            console.log('[AutoPublish]', plat, '任务#', t.id, status, error || '')
          }
          b3.close().catch(() => {})
        } catch (e) { console.log('[AutoPublish] 任务处理异常:', e.message) }
      }
      return
    } catch (e) { /* 静默：网络/未登录等 */ }
  }
  setInterval(checkPending, 6000)
  setTimeout(checkPending, 5000)
  // 2026-08-29: 工具箱 browser_use_execute——轮询 AgentBrowserTask pending → Python(browser-use) 执行 → 回结果
  setInterval(checkBrowserTasks, 8000)
  console.log('[browser_use] 执行器已启动（checkBrowserTasks 轮询 8s）——v1.0.82+ 有此日志=main.js 为新版')
}

// browser-use 任务执行（Electron 调 Python——复用 D:u_profile 登录态）
// 2026-08-31: BU_PYTHON fallback（硬编码打包机路径——发布机无则 ENOENT）——python/py 兜底
const BU_PYTHON = process.env.BU_PYTHON || (require('child_process').spawnSync('python', ['--version']).status === 0 ? 'python' : (require('child_process').spawnSync('py', ['--version']).status === 0 ? 'py' : "C:/Users/wo'shen/AppData/Local/Programs/Python/Python314/python.exe"))
// 2026-08-29: bu_exec.py 在 extraResources（resources/scripts/browser-use——不是 asar.unpacked）——之前路径错→spawn找不到→任务pending
const BU_SCRIPT = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts', 'browser-use', 'bu_exec.py')
  : path.join(String(app.getAppPath()), 'scripts', 'browser-use', 'bu_exec.py')
const BU_PROFILE = process.env.BU_PROFILE || path.join(app.getPath('userData'), 'browser-profile')
// 2026-09-03: 本地仓库（个人仓库 OSS 的本地镜像——exe 同级 storage，跟安装盘走，不占 C 盘；单向：只 OSS→本地）
const LOCAL_STORAGE = process.env.LOCAL_STORAGE || path.join(path.dirname(process.execPath), 'storage') // 2026-08-30: 用 browser-profile（登记页登录态所在——AI 发布复用）
const BU_CHECK_SCRIPT = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts', 'browser-use', 'bu_check.py')
  : path.join(String(app.getAppPath()), 'scripts', 'browser-use', 'bu_check.py')

function buLog(msg) {
  try {
    const { app } = require('electron')
    const p = path.join(app.getPath('userData'), 'bu_debug.log')
    fs.appendFileSync(p, '[' + new Date().toLocaleString() + '] ' + msg + String.fromCharCode(10))
  } catch {}
}

async function checkBrowserTasks() {
  try {
    const serverUrl = process.env.SERVER_URL || 'https://ai-niuma.cc' // 2026-08-29: 必须显式定义（同 getServerCookie 坑——未定义→ReferenceError→执行器永远失败→任务不执行）
    const cookie = await getServerCookie()
    if (!cookie) { buLog('轮询跳过：getServerCookie 空（未登录/读不到 token）'); console.log('[browser_use] 轮询跳过：getServerCookie 空（未登录/读不到 token）'); return }
    let dashKey = ''
    try { const bc = await fetch(serverUrl.replace(/\/$/, '') + '/api/agent/browser-config', { headers: { cookie } }).then(r => r.json()).catch(() => null); dashKey = bc?.data?.dashscopeKey || '' } catch {}
    const tasksRes = await fetch(serverUrl.replace(/\/$/, '') + '/api/agent/browser-tasks?status=pending', { headers: { cookie } }).catch(() => null)
    const tasks = tasksRes ? await tasksRes.json().catch(() => null) : null
    buLog('轮询：HTTP=' + (tasksRes?.status || '?') + ' 任务数=' + (tasks?.data?.length ?? 0))
    console.log('[browser_use] 轮询：cookie=' + (cookie ? cookie.slice(0, 20) + '...' : '空') + ' HTTP=' + (tasksRes?.status || '?') + ' success=' + (tasks?.success ?? '?') + ' tasks=' + (tasks?.data?.length ?? 0))
    if (!tasks?.success || !tasks.data?.length) return
    for (const t of tasks.data) {
      let files = []
      try { files = JSON.parse(t.files || '[]') } catch {}
      // 2026-09-04: 先把 files 下载到本地仓库（Electron fetch 带 cookie——比 bu_exec Python urllib 可靠；OSS 签名 URL 无需 cookie 直接可下）
      const localFiles = []
      for (const fu of files) {
        try {
          const uu = new URL(fu)
          const fn = uu.searchParams.get('name') || decodeURIComponent(uu.pathname.split('/').pop() || '')
          if (!fn) continue
          const dest2 = path.join(LOCAL_STORAGE, fn)
          if (!fs.existsSync(dest2)) {
            const rsp = await fetch(fu, { headers: cookie ? { cookie } : {} })
            if (rsp.ok) {
              fs.mkdirSync(LOCAL_STORAGE, { recursive: true })
              fs.writeFileSync(dest2, Buffer.from(await rsp.arrayBuffer()))
            }
          }
          if (fs.existsSync(dest2)) localFiles.push(dest2)
        } catch (eDl) { console.log('[browser_use] 下载 files 失败:', String(fu).slice(0, 60), eDl?.message || eDl) }
      }
      buLog('任务#' + t.id + ' files 下载：' + localFiles.length + '/' + files.length + ' 个落地本地仓库')
      // 标记 executing
      await fetch(serverUrl.replace(/\/$/, '') + '/api/agent/browser-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ id: t.id, status: 'executing' }) }).catch(() => {})
      console.log('[browser_use] 执行任务 #' + t.id + ':', String(t.task).slice(0, 60))
      // 2026-08-30: 登录态预检——未登录目标平台不白跑（直接失败提示扫码/登记）
      try {
        const platKey = String(t.task || '').match(/(抖音|小红书|微博|视频号|快手|B站|bilibili)/)?.[0] || ''
        if (platKey) {
          const buChk = await new Promise((resolve) => {
            const pyc = spawn(BU_PYTHON, ['-u', BU_CHECK_SCRIPT, String(BU_PROFILE_DIR)], { windowsHide: true })
            let so2 = ''
            pyc.stdout.on('data', (d) => so2 += d)
            pyc.on('close', () => resolve(so2.trim()))
            pyc.on('error', () => resolve(''))
            setTimeout(() => { pyc.kill(); resolve('') }, 10000)
          })
          const m2 = buChk.match(/PLATS:([^\r\n]+)/)
          if (m2) {
            const platId = { '抖音': 'douyin', '小红书': 'xiaohongshu', '微博': 'weibo', '视频号': 'shipinhao', '快手': 'kuaishou' }[platKey] || ''
            const st = m2[1].split(',').map((s2) => s2.split(':')).find((kv) => kv[0] === platId)
            if (st && st[1] === '0') {
              buLog('任务#' + t.id + ' 登录态预检=' + buChk.trim() + ' → 未登录' + platKey + '，不执行（浏览器没开的原因）')
              console.log('[browser_use] 任务 #' + t.id + ' 未登录' + platKey + '——不执行')
              await fetch(serverUrl.replace(/\/$/, '') + '/api/agent/browser-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ id: t.id, status: 'failed', error: platKey + ' 未登录——请先通过「浏览器通道」打开登记页扫码登录（点左侧登记平台的「打开浏览器」登录后回来）' }) }).catch(() => {})
              continue
            }
          }
        }
      } catch (eLg) { console.log('[browser_use] 登录态预检异常（继续执行）:', eLg?.message || eLg) }
      try {
        const args = ['-u', BU_SCRIPT, '--task', String(t.task), '--files', (localFiles.length ? localFiles : files).join(','), '--profile', BU_PROFILE, '--storage-dir', LOCAL_STORAGE, '--max-steps', '40']
        const { spawn } = require('child_process')
        // 2026-08-30: 失败重试（browser-use AgentOutput/LLM 偶发失败——重试 2 次不白跑）
        let out = { code: -2, so: '', se: 'not run' }
        for (let retry = 0; retry < 3; retry++) {
          out = await new Promise((resolve, reject) => {
            const py = spawn(BU_PYTHON, args, { windowsHide: true, env: { ...process.env, BU_COOKIE: cookie, DASHSCOPE_API_KEY: dashKey || process.env.DASHSCOPE_API_KEY || '' } })
            let so = '', se = ''
            py.stdout.on('data', d => so += d)
            py.stderr.on('data', d => se += d)
            py.on('close', code => resolve({ code, so, se }))
            py.on('error', e => reject(e))
            setTimeout(() => { py.kill(); resolve({ code: -1, so, se: 'timeout' }) }, 420000)
          })
          if (out.code === 0 && /"success": ?true|RESULT:/.test(out.so)) break
          console.log('[browser_use] 任务 #' + t.id + ' 第' + (retry + 1) + '次失败（code=' + out.code + '），重试中...')
        }
        const parsed = (() => { try { const i = out.so.lastIndexOf('{'); return JSON.parse(out.so.slice(i)) } catch { return null } })()
        await fetch(serverUrl.replace(/\/$/, '') + '/api/agent/browser-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ id: t.id, status: parsed?.success ? 'succeeded' : 'failed', result: parsed?.result || '', error: parsed?.error || out.se.slice(0, 500) || ('执行失败 code=' + out.code) }) }).catch(() => {})
      } catch (e) {
        await fetch(serverUrl.replace(/\/$/, '') + '/api/agent/browser-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ id: t.id, status: 'failed', error: String(e && e.message || e).slice(0, 500) }) }).catch(() => {})
      }
    }
  } catch (e) { console.log('[browser_use] 轮询异常:', e?.message || e) }
}

// ════════════════════════════════════════
//  自动更新（electron-updater）
// ════════════════════════════════════════

function setupAutoUpdater(win) {
  if (process.env.DISABLE_AUTO_UPDATE === '1') { console.log('[Updater] 已禁用（DISABLE_AUTO_UPDATE=1）'); return }
  autoUpdater.autoDownload = true
  // 2026-08-30: 差分更新（blockmap）在 85→86 卡 0——强制全量下载（575MB 慢但能下——根治卡 0）
  autoUpdater.disableDifferentialDownload = true
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

  // 2026-08-21: 自动更新后重建快捷方式（桌面+开始菜单）——electron-updater 不走 NSIS，快捷方式会失效
  const rebuildShortcuts = () => {
    try {
      const { execSync } = require('child_process')
      const exe = process.execPath
      const ps = `$ws=New-Object -ComObject WScript.Shell;` +
        `$d=$ws.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\AI营销助手.lnk');$d.TargetPath='${exe}';$d.Save();` +
        `$s=$ws.CreateShortcut([Environment]::GetFolderPath('Programs')+'\AI营销助手.lnk');$s.TargetPath='${exe}';$s.Save()`
      execSync('powershell -NoProfile -Command "' + ps + '"', { windowsHide: true, stdio: 'ignore' })
      console.log('[Updater] 快捷方式已重建（桌面+开始菜单）')
    } catch (e) { console.log('[Updater] 快捷方式重建失败:', e.message) }
  }

  // 下载完成，弹窗提示重启并自动安装
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] 下载完成:', info.version)
    rebuildShortcuts()
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
// 2026-08-28: 换账号清客户端 session cookie（防旧 token 残留串号）
ipcMain.handle('app:clear-session', async () => {
  try { await session.defaultSession.clearStorageData({ storages: ['cookies'] }); await session.defaultSession.clearCookies() } catch {}
  return { success: true }
})
ipcMain.handle('storage:mirror', async (_event, url) => {
  // 2026-09-03: 本地仓库镜像（单向 OSS→本地）——上传/生成成功后下载素材到本地仓库
  try {
    if (!url || typeof url !== 'string') return { success: false, error: '无 URL' }
    const u = new URL(url)
    const name = u.searchParams.get('name') || decodeURIComponent(u.pathname.split('/').pop() || '')
    if (!name) return { success: false, error: '无文件名' }
    const dest = path.join(LOCAL_STORAGE, name)
    if (fs.existsSync(dest)) return { success: true, path: dest, cached: true }
    fs.mkdirSync(LOCAL_STORAGE, { recursive: true })
    const cookie = await getServerCookie().catch(() => '')
    const resp = await fetch(url, { headers: cookie ? { cookie } : {} })
    if (!resp.ok) return { success: false, error: 'HTTP ' + resp.status + '（未登录/鉴权失败）' }
    const buf = Buffer.from(await resp.arrayBuffer())
    fs.writeFileSync(dest, buf)
    console.log('[storage:mirror] 已镜像到本地仓库:', name)
    return { success: true, path: dest }
  } catch (e) { return { success: false, error: e.message } }
})

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

// 2026-08-29: Browser Use 登记（bu_profile 扫码登录——Browser Use 专用登录态）
const BU_PROFILE_DIR = process.env.BU_PROFILE || path.join(app.getPath('userData'), 'browser-profile')
// 2026-08-31 security: IPC 校验 sender（只允许客户端本地页面/受控域调用——防远程 XSS 命令本机开浏览器）
const isTrustedSender = (event) => {
  try {
    const u = event?.senderFrame?.url || event?.sender?.getURL?.() || ''
    return !u || u.startsWith('file://') || u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost') || u.includes('ai-niuma.cc')
  } catch { return false }
}
ipcMain.handle('bu:open', async (event) => {
  if (!isTrustedSender(event)) return { success: false, error: 'untrusted sender' }
  try {
    const { spawn } = require('child_process')
    // 2026-08-29: spawn 系统 Chrome --user-data-dir（同浏览器同 profile——登录态一致）——弃 python -m playwright（无包）
    const chromeCands = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe']
    const chrome = chromeCands.find(p => require('fs').existsSync(p))
    if (!chrome) return { success: false, error: '未找到系统 Chrome' }
    const prof = String(BU_PROFILE_DIR)
    const ch = spawn(chrome, ['--user-data-dir=' + prof, '--no-first-run', 'https://creator.xiaohongshu.com/publish/publish'], { windowsHide: false, detached: true, stdio: 'ignore' })
    ch.unref()
    return { success: true, message: '已打开 Browser Use 浏览器（bu_profile）——请扫码登录目标平台，登录后点「刷新检测」' }
  } catch (e) { return { success: false, error: String(e && e.message || e) } }
})
  ipcMain.handle('bu:check', async (event) => {
    if (!isTrustedSender(event)) return { success: false, error: 'untrusted sender' }
    try {
      const { spawn } = require('child_process')
      const out = await new Promise((resolve) => {
        let so = ''
        const py = spawn(BU_PYTHON, ['-u', BU_CHECK_SCRIPT, String(BU_PROFILE_DIR)], { windowsHide: true })
        py.stdout.on('data', (d) => { so += d })
        py.stderr.on('data', () => {})
        py.on('close', () => resolve(so.trim()))
        py.on('error', () => resolve(''))
        setTimeout(() => { try { py.kill() } catch {} ; resolve(so.trim()) }, 8000)
      })
      const m = out.match(/PLATS:([A-Za-z0-9_:,]+)/)
      const labels = { douyin: '抖音', xiaohongshu: '小红书', weibo: '微博', bilibili: 'B站', kuaishou: '快手', shipinhao: '视频号' }
      const accounts = []
      if (m) {
        for (const kv of m[1].split(',')) {
          const seg = kv.split(':')
          accounts.push({ id: seg[0], platform: seg[0], name: labels[seg[0]] || seg[0], loggedIn: seg[1] === '1' })
        }
      }
      return { success: true, accounts, buDir: BU_PROFILE_DIR }
    } catch (e) { return { success: false, error: String(e && e.message || e) } }
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
//  清理残留（2026-08-21）——删除缓存/临时文件（不含登录态 APPDATA，只清可重建数据）
// ════════════════════════════════════════
ipcMain.handle('app:cleanup-residue', async () => {
  try {
    const removed = []
    const targets = [
      path.join(os.tmpdir(), 'aimarketing-videos'),
      path.join(os.homedir(), 'AppData', 'Local', 'ai-marketing-updater'),
    ]
    for (const t of targets) {
      try { if (fs.existsSync(t)) { fs.rmSync(t, { recursive: true, force: true }); removed.push(t) } } catch {}
    }
    return { success: true, removed }
  } catch (e) { return { success: false, error: e.message } }
})

// ════════════════════════════════════════
//  OpenCLI 安装引导（2026-08-21，方案1）——扩展随包分发，用户只需开发者模式加载
// ════════════════════════════════════════

// ════════════════════════════════════════
//  方案A CDP：绑定浏览器 + 登录态检测（2026-08-21，P0）
//  客户端拉起用户日常 Chrome/Edge（--remote-debugging-port，127.0.0.1）
//  → 通过 CDP 读各平台登录 cookie → 个人号发布走这里（无扩展/无 OpenCLIApp 依赖）
// ════════════════════════════════════════
const CDP_PORT = 9333
let boundProc = null
const BROWSER_CANDIDATES = [
  process.env.LOCALAPPDATA + '\Google\Chrome\Application\chrome.exe',
  process.env.PROGRAMFILES + '\Google\Chrome\Application\chrome.exe',
  process.env['PROGRAMFILES(X86)'] + '\Google\Chrome\Application\chrome.exe',
  process.env.LOCALAPPDATA + '\Microsoft\Edge\Application\msedge.exe',
  process.env.PROGRAMFILES + '\Microsoft\Edge\Application\msedge.exe',
  process.env['PROGRAMFILES(X86)'] + '\Microsoft\Edge\Application\msedge.exe',
]
function findBrowserExe() {
  // 2026-08-24: ①标准路径 ②写死 Program Files（Electron env 不可靠+系统级装不在PATH）③注册表 App Paths
  for (const p2 of BROWSER_CANDIDATES) { if (p2 && fs.existsSync(p2)) return p2 }
  const hardPaths = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
  for (const p2 of hardPaths) { if (fs.existsSync(p2)) return p2 }
  try {
    const { execFileSync } = require('child_process')
    for (const name of ['chrome', 'msedge']) {
      try {
        const key = 'HKLM' + '\\SOFTWARE' + '\\Microsoft' + '\\Windows' + '\\CurrentVersion' + '\\App Paths' + '\\' + name + '.exe'
        const reg = execFileSync('reg', ['query', key, '/ve'], { timeout: 5000, windowsHide: true, encoding: 'utf8' })
        const m = reg.match(/REG_SZ\s+([^\r\n]+)/)
        const p2 = m ? m[1].trim() : ''
        if (p2 && fs.existsSync(p2)) return p2
      } catch {}
    }
  } catch {}
  try {
    // B方案：内置 Chromium 兜底（打包含 ms-playwright）——任何机器都可用，不依赖系统浏览器
    const { chromium } = require('playwright')
    const exe = chromium.executablePath()
    if (exe && fs.existsSync(exe)) return exe
  } catch {}
  return null
}
ipcMain.handle('browser:bind', async () => {
  try {
    const exe = findBrowserExe()
    if (!exe) return { success: false, error: '未找到 Chrome/Edge 浏览器' }
    // 用用户默认 profile（已登录）启动，带 CDP 调试端口（仅本机）
    const { spawn } = require('child_process')
    const proc = spawn(exe, ['--remote-debugging-port=' + CDP_PORT, '--remote-allow-origins=*', '--no-first-run', 'https://www.douyin.com'], { detached: true, stdio: 'ignore' })
    proc.unref()
    boundProc = proc
    // 等 CDP 就绪
    for (let i = 0; i < 20; i++) {
      try {
        const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', { signal: AbortSignal.timeout(2000) })
        if (r.ok) return { success: true, port: CDP_PORT, exe }
      } catch {}
      await new Promise((r2) => setTimeout(r2, 500))
    }
    return { success: true, port: CDP_PORT, exe, warn: 'CDP 端口未确认（浏览器可能已用该端口启动过）' }
  } catch (e) { return { success: false, error: e.message } }
})

// 2026-08-23: 浏览器登录态检测 helper（browser:accounts 与 AutoPublish 共用）

// 2026-08-25: 登录保活——每天定时 + 启动时访问已登记平台（刷新 cookie 有效期，对齐 OpenCLI 中午保活）
// 2026-08-26: 每次打开浏览器前清会话文件（Last Session/Tabs）——配合 --no-restore-session-state 双保险，彻底不恢复旧tab
function clearBrowserSessionFiles() {
  try {
    const profileDir = path.join(app.getPath('userData'), 'browser-profile')
    for (const f of ['Last Session', 'Last Tabs', 'Current Session', 'Current Tabs', 'Last Browser', 'Last Version']) {
      const sp = path.join(profileDir, f)
      if (fs.existsSync(sp)) { try { fs.rmSync(sp, { force: true }) } catch {} }
    }
    console.log('[浏览器] 已清理会话文件（下次打开全新）')
  } catch {}
}

async function keepaliveBrowser() {
  // 2026-08-26: 不再遍历打开各平台页面（每次启动全开N个tab是此函数造成）——只静默读 cookie 刷新登录态（不新开 tab、不跳转）
  try {
    const { chromium } = require('playwright')
    const browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT).catch(() => null)
    if (!browser) return // 浏览器没开不自动拉起
    const ctx = browser.contexts()[0]
    if (ctx) { const cookies = await ctx.cookies().catch(() => []); console.log('[保活] 静默刷新登录态（读取', cookies.length, '个cookie，未打开任何页面）') }
    browser.close().catch(() => {})
  } catch {}
}


// 2026-08-25: 统一 tab 获取——①同平台tab复用 ②about:blank空tab复用（不新建）③清理多余空tab（保留1个）
async function getTargetPage(ctx, host) {
  const pages = ctx.pages()
  // 清理多余 about:blank（保留 1 个复用）
  const blanks = pages.filter(p => p.url().startsWith('about:'))
  for (const b of blanks.slice(1)) { try { await b.close().catch(() => {}) } catch {} }
  // ① 同平台 tab：保留第一个，关闭其余重复（防历史重复堆积）
  const same = pages.filter(p => p.url().includes(host) && !p.url().startsWith('about:'))
  for (const s of same.slice(1)) { try { await s.close().catch(() => {}) } catch {} }
  if (same.length) return same[0]
  // ② about:blank 复用（用第一个跳转）
  const blank = pages.find(p => p.url().startsWith('about:'))
  if (blank) return blank
  // ③ 新建
  return ctx.newPage()
}

async function getBrowserAccounts() {
  const PLATFORMS = [
    { id: 'douyin', name: '抖音', domain: 'douyin.com', cookies: ['sessionid', 'uid_tt', 'passport_csrf_token'] },
    { id: 'xiaohongshu', name: '小红书', domain: 'xiaohongshu.com', cookies: ['web_session', 'web_session_SSO', 'x-user-id-creator.xiaohongshu.com', 'galaxy_creator_session_id'] },
    { id: 'weibo', name: '微博', domain: 'weibo.com', cookies: ['SUB', 'SUBP'] },
    { id: 'bilibili', name: 'B站', domain: 'bilibili.com', cookies: ['SESSDATA', 'DedeUserID'] },
    { id: 'kuaishou', name: '快手', domain: 'kuaishou.com', cookies: ['kuaishou.session.web', 'userId'] },
    { id: 'shipinhao', name: '视频号', domain: 'channels.weixin.qq.com', cookies: ['sessionid'] },
    { id: 'twitter', name: 'X(Twitter)', domain: 'twitter.com', cookies: ['auth_token', 'ct0'] },
    { id: 'instagram', name: 'Instagram', domain: 'instagram.com', cookies: ['sessionid'] },
    { id: 'youtube', name: 'YouTube', domain: 'youtube.com', cookies: ['SID', 'LOGIN_INFO'] },
    { id: 'facebook', name: 'Facebook', domain: 'facebook.com', cookies: ['c_user'] },
    { id: 'tiktok', name: 'TikTok', domain: 'tiktok.com', cookies: ['sessionid'] },
  ]
  const { chromium } = require('playwright')
  let browser
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT) } catch { return [] }
  if (!browser) return []
  try {
    const accounts = []
    for (const ctx of browser.contexts()) {
      const cookies = await ctx.cookies()
      for (const pf of PLATFORMS) {
        const has = cookies.some((ck) => ck.domain.includes(pf.domain) && pf.cookies.includes(ck.name))
        accounts.push({ id: pf.id, name: pf.name, loggedIn: has })
      }
    }
    return accounts
  } catch { return [] } finally { browser.close().catch(() => {}) }
}


// 2026-08-25: 打开内置浏览器跳转指定地址（登记平台登录页）
ipcMain.handle('browser:open-url', async (_e, url) => {
  try {
    clearBrowserSessionFiles() // 2026-08-26: 打开前清会话——不恢复旧tab
    const { chromium } = require('playwright')
    let browser = null
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT) } catch {
      // 2026-08-25: 浏览器没开 → 自动启动内置（一次，防抖由 __bindInProgress 保证）
      if (global.__bindInProgress) return { success: false, error: '浏览器正在启动，请稍候…' }
      global.__bindInProgress = true
      try {
        const builtinExe = chromium.executablePath()
        if (builtinExe && fs.existsSync(builtinExe)) {
          const profileDir = path.join(app.getPath('userData'), 'browser-profile')
          fs.mkdirSync(profileDir, { recursive: true })
          try { for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) { const sp = path.join(profileDir, f); if (fs.existsSync(sp)) fs.rmSync(sp, { force: true }) } } catch {}
          const { spawn } = require('child_process')
          const proc = spawn(builtinExe, ['--remote-debugging-port=' + CDP_PORT, '--remote-allow-origins=*', '--user-data-dir=' + profileDir, '--no-first-run', '--disable-first-run-ui', '--no-default-browser-check', '--disable-infobars', '--disable-component-update', '--no-restore-session-state', '--disable-session-crashed-bubble', '--no-restore-session-state', '--disable-session-crashed-bubble', 'about:blank'], { detached: true, stdio: 'ignore' })
          proc.unref(); boundProc = proc
          for (let i = 0; i < 30; i++) { try { const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', { signal: AbortSignal.timeout(2000) }); if (r.ok) break } catch {} await new Promise((r2) => setTimeout(r2, 500)) }
          browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT)
        }
      } catch {} finally { global.__bindInProgress = false }
    }
    const ctx = browser ? browser.contexts()[0] : null
    if (!ctx) return { success: false, error: '内置浏览器启动失败' }
    // 复用同平台/空tab（避免多窗口堆积）
    const host = String(url || '').replace(/^https?:\/\//, '').split('/')[0]
    const page = await getTargetPage(ctx, host)
    await page.goto(String(url || 'https://www.google.com'), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    page.bringToFront().catch(() => {})
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('browser:accounts', async () => {
  // 通过 CDP 读已登录平台（访问各平台域，检查登录 cookie）——未绑定时自动拉起（自动扫描）
  try {
    const { chromium } = require('playwright')
    let browser
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT)
    } catch (e0) {
      // 2026-08-26: 不自动拉起浏览器（避免每次自动开一堆页面）——引导用户手动「＋打开浏览器登记」一次性验证；平时检测不打扰
      return { success: false, error: '浏览器未打开（登录态检测需浏览器在线，点「打开浏览器登记」一次性验证后自动记忆）', accounts: [], bound: false, needBind: true }
    }
    if (!browser) return { success: false, error: '未找到浏览器', accounts: [], bound: false, needBind: true }
    const ctxs = browser.contexts()
    const accounts = []
    // 2026-08-23: 国内外 11 平台 + cookie 多候选（任一命中即已登录）——检测用户日常 Chrome 登录态
    const PLATFORMS = [
      { id: 'douyin', name: '抖音', domain: 'douyin.com', cookies: ['sessionid', 'uid_tt', 'passport_csrf_token'] },
      { id: 'xiaohongshu', name: '小红书', domain: 'xiaohongshu.com', cookies: ['web_session', 'web_session_SSO', 'x-user-id-creator.xiaohongshu.com', 'galaxy_creator_session_id'] },
      { id: 'weibo', name: '微博', domain: 'weibo.com', cookies: ['SUB', 'SUBP'] },
      { id: 'bilibili', name: 'B站', domain: 'bilibili.com', cookies: ['SESSDATA', 'DedeUserID'] },
      { id: 'kuaishou', name: '快手', domain: 'kuaishou.com', cookies: ['kuaishou.session.web', 'userId'] },
      { id: 'shipinhao', name: '视频号', domain: 'channels.weixin.qq.com', cookies: ['sessionid'] },
      { id: 'twitter', name: 'X(Twitter)', domain: 'twitter.com', cookies: ['auth_token', 'ct0'] },
      { id: 'instagram', name: 'Instagram', domain: 'instagram.com', cookies: ['sessionid'] },
      { id: 'youtube', name: 'YouTube', domain: 'youtube.com', cookies: ['SID', 'LOGIN_INFO'] },
      { id: 'google', name: 'Google', domain: 'google.com', cookies: ['SID', '__Secure-1PSID', 'HSID'] },
      { id: 'facebook', name: 'Facebook', domain: 'facebook.com', cookies: ['c_user'] },
      { id: 'tiktok', name: 'TikTok', domain: 'tiktok.com', cookies: ['sessionid'] },
    ]
    for (const ctx of ctxs) {
      const cookies = await ctx.cookies()
      for (const pf of PLATFORMS) {
        const has = cookies.some((ck) => ck.domain.includes(pf.domain) && pf.cookies.includes(ck.name))
        if (has) accounts.push({ id: pf.id, name: pf.name, loggedIn: true })
      }
    }
    await browser.close().catch(() => {})
    return { success: true, accounts, bound: true, needBind: false }
  } catch (e) {
    return { success: false, error: '浏览器未绑定或 CDP 未连接：' + e.message, accounts: [], bound: !!boundProc, needBind: true }
  }
})

// 2026-08-23: 一键启动用户自己的 Chrome（默认 profile，带 CDP 端口）——检测日常登录态
ipcMain.handle('browser:bind-mine', async () => {
  try {
    clearBrowserSessionFiles() // 2026-08-26: 打开前清会话——不恢复旧tab
    // 已有调试实例 → 直接复用
    try {
      const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', { signal: AbortSignal.timeout(1500) })
      if (r.ok) return { success: true, already: true, message: '浏览器已在调试模式' }
    } catch {}
    // 2026-08-25: 优先内置 Chromium（独立 profile——必通 CDP，不受系统 Chrome 是否在跑影响）
    let builtinExe = null
    try { const { chromium } = require('playwright'); builtinExe = chromium.executablePath() } catch {}
    if (builtinExe && fs.existsSync(builtinExe)) {
      const profileDir = path.join(app.getPath('userData'), 'browser-profile')
      fs.mkdirSync(profileDir, { recursive: true })
      // 登录态持久保证：清理 profile 锁（非正常关闭残留 → 下次启动失败会重建 profile → 丢登录态）
      try { for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) { const sp = path.join(profileDir, f); if (fs.existsSync(sp)) fs.rmSync(sp, { force: true }) } } catch {}
      const { spawn } = require('child_process')
      const proc = spawn(builtinExe, ['--remote-debugging-port=' + CDP_PORT, '--remote-allow-origins=*', '--user-data-dir=' + profileDir, '--no-first-run', '--disable-first-run-ui', '--no-default-browser-check', '--disable-sync', '--disable-infobars', 'about:blank'], { detached: true, stdio: 'ignore' })
      proc.unref(); boundProc = proc
      for (let i = 0; i < 30; i++) {
        try {
          const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', { signal: AbortSignal.timeout(2000) })
          if (r.ok) return { success: true, builtin: true, message: '内置浏览器已启动——请在浏览器登录需要的平台' }
        } catch {}
        await new Promise((r2) => setTimeout(r2, 500))
      }
      return { success: false, error: '内置浏览器启动超时' }
    }
    // 备用：系统浏览器（写死路径/注册表）
    const exe = findBrowserExe()
    if (!exe) return { success: false, error: '未找到浏览器' }
    const { spawn } = require('child_process')
    const proc = spawn(exe, ['--remote-debugging-port=' + CDP_PORT, '--remote-allow-origins=*', '--no-first-run', '--disable-first-run-ui', '--no-default-browser-check', '--disable-infobars', '--disable-component-update', '--no-restore-session-state', '--disable-session-crashed-bubble', '--no-restore-session-state', '--disable-session-crashed-bubble', 'about:blank'], { detached: true, stdio: 'ignore' })
    proc.unref(); boundProc = proc
    for (let i = 0; i < 24; i++) {
      try {
        const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', { signal: AbortSignal.timeout(2000) })
        if (r.ok) return { success: true }
      } catch {}
      await new Promise((r2) => setTimeout(r2, 500))
    }
    return { success: false, error: '启动超时（若 Chrome 已在运行请先完全关闭再试）' }
  } catch (e) { global.__bindInProgress = false; return { success: false, error: e.message } }
  finally { global.__bindInProgress = false }
})

// 2026-08-21: CDP 发布通道（P0-2）——复用 OpenCLI 官方 API 流程（page.evaluate 浏览器内 fetch，a_bogus 自动）
// 关键发现：OpenCLI douyin publish 是官方 API（vod-upload/tos-upload/create_v2），不是 DOM 点按钮；
// browserFetch(page,...) 用浏览器上下文 fetch——我们的 CDP page 完全兼容（无扩展依赖）
// 微博发布（P0-2，DOM UI 自动化——移植 OpenCLI weibo publish）

// 2026-08-23: 小红书图文发布（参考 opencli publish.js：setInputFiles 上传图 → 标题/正文 → 发布 → 轮询确认）
async function publishXhsImages(page, payload) {
  const images = (payload && payload.images) || []
  const title = (payload && payload.title) || ''
  const desc = (payload && payload.desc) || (payload && payload.caption) || ''
  if (!images.length || !images.every((p2) => fs.existsSync(p2))) return { success: false, error: '图片文件不存在' }
  await page.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2000)
  if (!page.url().includes('xiaohongshu.com')) return { success: false, error: '请先登录小红书（浏览器中）', needLogin: true, platform: 'xiaohongshu' }
  // 上传图片（accept image 的 file input）
  const imgSel = await page.evaluate(() => {
    const vis = (el) => !!el && el.offsetParent !== null
    const inputs = [...document.querySelectorAll('input[type="file"]')].filter(inp => vis(inp))
    const target = inputs.find(inp => (inp.getAttribute('accept') || '').toLowerCase().includes('image')) || inputs[0]
    if (!target) return ''
    target.setAttribute('data-xhs-img', '1')
    return 'input[data-xhs-img="1"]'
  })
  if (!imgSel) return { success: false, error: '未找到小红书图片上传入口（页面结构可能变化）' }
  await page.setInputFiles(imgSel, images)
  // 等上传完成（轮询"上传中/进度"消失，最多 40s）
  let uploadDone = false
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000)
    const st = await page.evaluate(() => {
      const t = (document.body.innerText || '').slice(0, 800)
      const uploading = /上传中|上传进度|%/.test(t) && /上传失败/.test(t) === false
      return { uploading, err: /上传失败|图片格式不支持|图片过大/.test(t) }
    })
    if (st.err) return { success: false, error: '小红书图片上传失败（浏览器可见错误）' }
    if (!st.uploading && i > 3) { uploadDone = true; break }
  }
  if (!uploadDone) return { success: false, error: '小红书图片上传超时' }
  // 填标题
  if (title) {
    const ok = await page.evaluate((t) => {
      for (const sel of ['input[placeholder*="标题"]', 'input[placeholder*="填写标题"]', 'div[contenteditable="true"][data-placeholder*="标题"]', '.note-title input', '.title-input input']) {
        const el = document.querySelector(sel)
        if (el && el.offsetParent !== null) {
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          if (set) set.call(el, t)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        }
      }
      return false
    }, title)
    if (!ok) return { success: false, error: '未找到小红书标题输入框' }
  }
  // 填正文
  if (desc) {
    await page.evaluate((d) => {
      const el = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => e.offsetParent !== null && !String(e.getAttribute('placeholder') || '').includes('标题'))[0]
      if (el) { el.focus(); document.execCommand('insertText', false, d) }
    }, desc)
  }
  // 点发布（xhs-publish-btn 或文字"发布"）
  await page.waitForTimeout(1500)
  const sent = await page.evaluate(() => {
    const vis = (el) => !!el && el.offsetParent !== null && !el.disabled
    // 2026-08-29: shadowRoot 穿透（fp 实测发布红键在 closed shadow 内——宿主 click 无效）
    const deepFind = (root, label) => {
      const all = root.querySelectorAll ? root.querySelectorAll('button, [role="button"], xhs-publish-btn') : []
      for (const el of all) { const t = (el.innerText || el.textContent || '').trim(); if ((t === label || t.includes(label)) && vis(el)) return el }
      for (const el of (root.querySelectorAll ? root.querySelectorAll('*') : [])) { if (el.shadowRoot) { const hit = deepFind(el.shadowRoot, label); if (hit) return hit } }
      return null
    }
    for (const label of ['发布', '发布笔记', '发 布']) {
      const hit = deepFind(document, label)
      if (hit) { hit.click(); return label }
    }
    return ''
  })
  if (!sent) return { success: false, error: '未找到「发布」按钮（可能上传未完成）' }
  // 轮询确认（发布成功/上传成功/跳转）
  let confirmed = false
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500)
    const st = await page.evaluate(() => {
      const t = (document.body.innerText || '').slice(0, 800)
      return {
        ok: /发布成功|上传成功|已发布|审核中/.test(t),
        err: /发布失败|上传失败|违规|操作频繁|请重新登录|登录已过期/.test(t),
        gone: !location.href.includes('/publish/publish'),
      }
    })
    if (st.ok || st.gone) { confirmed = true; break }
    if (st.err) break
  }
  if (!confirmed) return { success: false, error: '小红书发布结果未确认（请到浏览器查看——请勿告知用户已发布）' }
  return { success: true, message: '小红书图文已发布（已确认）' }
}


// 2026-08-23: 视频号发布（参考 opencli：wujie shadow DOM，deepQuery 处理）
async function publishShipinhao(page, payload) {
  const videoPath = payload && payload.videoPath
  const title = (payload && payload.title) || ''
  const desc = (payload && payload.desc) || ''
  if (!videoPath || !fs.existsSync(videoPath)) return { success: false, error: '视频文件不存在: ' + videoPath }
  await page.goto('https://channels.weixin.qq.com/platform/post/create', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {})
  await page.waitForTimeout(3000)
  if (!page.url().includes('channels.weixin.qq.com')) return { success: false, error: '请先登录视频号助手（浏览器中）', needLogin: true, platform: 'shipinhao' }
  // 上传视频（shadow DOM 穿透查找 file input）
  const upSel = await page.evaluate(() => {
    const deepQ = (sel) => {
      const el = document.querySelector(sel); if (el) return el
      for (const sr of document.querySelectorAll('*')) { if (sr.shadowRoot) { const f = sr.shadowRoot.querySelector(sel); if (f) return f } }
      return null
    }
    const vis = (el) => !!el && el.offsetParent !== null
    const inp = deepQ('input[type="file"]')
    if (!inp) return ''
    inp.setAttribute('data-wxsp', '1')
    return 'input[data-wxsp="1"]'
  })
  if (!upSel) return { success: false, error: '未找到视频号上传入口（页面结构可能变化）' }
  await page.setInputFiles(upSel, videoPath)
  // 等上传+转码（轮询"上传/转码"文字消失，最多 60s）
  let upOk = false
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000)
    const st = await page.evaluate(() => {
      const t = (document.body.innerText || '').slice(0, 600)
      return { busy: /上传中|转码中|处理中|%/.test(t) && !/上传失败/.test(t), err: /上传失败|格式不支持|文件过大/.test(t) }
    })
    if (st.err) return { success: false, error: '视频号上传失败（浏览器可见错误）' }
    if (!st.busy && i > 5) { upOk = true; break }
  }
  if (!upOk) return { success: false, error: '视频号上传超时' }
  // 填标题（主要内容）+ 描述（shadow DOM）
  if (title || desc) {
    await page.evaluate(({ t, d }) => {
      const deepAll = (sel) => {
        const out = [...document.querySelectorAll(sel)]
        for (const sr of document.querySelectorAll('*')) { if (sr.shadowRoot) out.push(...sr.shadowRoot.querySelectorAll(sel)) }
        return out
      }
      const setVal = (el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; if (set) set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
      if (t) { const inp = deepAll('input').find(e => e.offsetParent !== null); if (inp) setVal(inp, t) }
      if (d) { const ed = deepAll('[contenteditable="true"]').find(e => e.offsetParent !== null); if (ed) { ed.focus(); document.execCommand('insertText', false, d) } }
    }, { t: title, d: desc })
  }
  // 点发布
  await page.waitForTimeout(1500)
  const sent = await page.evaluate(() => {
    const vis = (el) => !!el && el.offsetParent !== null && !el.disabled
    for (const el of document.querySelectorAll('*')) { if (el.shadowRoot) { const b = [...el.shadowRoot.querySelectorAll('button')].find(x => vis(x) && /发表|发布/.test(x.innerText || '')); if (b) { b.click(); return true } } }
    for (const btn of document.querySelectorAll('button')) { if (vis(btn) && (/^(发表|发布)$/.test((btn.innerText || '').trim()))) { btn.click(); return true } }
    return false
  })
  if (!sent) return { success: false, error: '未找到「发表/发布」按钮（可能上传未完成）' }
  // 轮询确认
  let confirmed = false
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500)
    const st = await page.evaluate(() => {
      const t = (document.body.innerText || '').slice(0, 800)
      return { ok: /已发表|发布成功|发表成功|审核中/.test(t), err: /发布失败|发表失败|违规|请登录|操作频繁/.test(t) }
    })
    if (st.ok) { confirmed = true; break }
    if (st.err) break
  }
  if (!confirmed) return { success: false, error: '视频号发布结果未确认（请到浏览器查看——请勿告知用户已发布）' }
  return { success: true, message: '视频号已发布（已确认）' }
}

// 2026-08-23: X(Twitter) 发推（参考 opencli post.js：compose 页 + 内容 + 可选图 + 提交）
async function publishTwitter(page, payload) {
  const text = String(payload && payload.text || payload && payload.title || '').trim()
  if (!text) return { success: false, error: '推文内容为空' }
  await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)
  if (!/x\.com|twitter\.com/.test(page.url())) return { success: false, error: '请先登录 X（浏览器中）', needLogin: true, platform: 'twitter' }
  // 输入内容（contenteditable）
  const typed = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('[contenteditable="true"]')].find(e => e.offsetParent !== null)
    if (!el) return false
    el.focus()
    document.execCommand('insertText', false, t)
    return true
  }, text)
  if (!typed) return { success: false, error: '未找到推文输入框' }
  // 可选图片
  const images = (payload && payload.images) || []
  if (images.length) {
    const ok = await page.evaluate(() => { const inp = document.querySelector('input[data-testid="fileInput"]'); if (inp) { inp.setAttribute('data-x-f', '1'); return true } return false })
    if (!ok) return { success: false, error: '未找到 X 图片上传入口' }
    await page.setInputFiles('input[data-x-f="1"]', images)
    await page.waitForTimeout(3000)
  }
  // 提交（发帖按钮）
  await page.waitForTimeout(800)
  const sent = await page.evaluate(() => {
    const vis = (el) => !!el && el.offsetParent !== null && !el.disabled
    for (const btn of document.querySelectorAll('button[data-testid="tweetButton"], button[data-testid="tweetButtonInline"]')) { if (vis(btn)) { btn.click(); return true } }
    for (const btn of document.querySelectorAll('button')) { if (vis(btn) && /^Post$|发布/.test((btn.innerText || '').trim())) { btn.click(); return true } }
    return false
  })
  if (!sent) return { success: false, error: '未找到「发帖」按钮' }
  // 轮询确认（compose 页关闭）
  let confirmed = false
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(500)
    if (!page.url().includes('/compose/post')) { confirmed = true; break }
  }
  if (!confirmed) return { success: false, error: 'X 发布结果未确认（请到浏览器查看——请勿告知用户已发布）' }
  return { success: true, message: 'X 已发布（已确认）' }
}


// 2026-08-23: 即刻发布（web.okjike.com 首页内联发帖框 → 输入 → 发送）
async function publishJike(page, payload) {
  const text = String(payload && payload.text || payload && payload.title || '').trim()
  if (!text) return { success: false, error: '动态内容为空' }
  await page.goto('https://web.okjike.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)
  if (!page.url().includes('okjike.com')) return { success: false, error: '请先登录即刻（浏览器中）', needLogin: true, platform: 'jike' }
  // 发帖框（_postForm_ 容器 contenteditable）
  const typed = await page.evaluate((t) => {
    const form = document.querySelector('[class*="_postForm_"]')
    const el = (form ? form.querySelector('[contenteditable="true"]') : null) || document.querySelector('[contenteditable="true"]')
    if (!el) return false
    el.focus()
    document.execCommand('insertText', false, t)
    return true
  }, text)
  if (!typed) return { success: false, error: '未找到即刻发帖输入框' }
  // 点"发送"
  await page.waitForTimeout(800)
  const sent = await page.evaluate(() => {
    const vis = (el) => !!el && el.offsetParent !== null && !el.disabled
    for (const btn of document.querySelectorAll('button, [role="button"]')) {
      if (((btn.innerText || btn.textContent || '').trim() === '发送') && vis(btn)) { btn.click(); return true }
    }
    return false
  })
  if (!sent) return { success: false, error: '未找到「发送」按钮' }
  // 轮询确认（发帖框清空/成功）
  let confirmed = false
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500)
    const st = await page.evaluate(() => {
      const t = (document.body.innerText || '').slice(0, 500)
      const form = document.querySelector('[class*="_postForm_"]')
      const el = form ? form.querySelector('[contenteditable="true"]') : null
      return { ok: /发布成功|发送成功/.test(t) || (el && (el.innerText || '').trim() === '' && i > 2) }
    })
    if (st.ok) { confirmed = true; break }
  }
  if (!confirmed) return { success: false, error: '即刻发布结果未确认（请到浏览器查看——请勿告知用户已发布）' }
  return { success: true, message: '即刻动态已发布（已确认）' }
}


// 2026-08-23: 闲鱼发布（goofish.com/publish 商品发布：标题/描述/价格/传图 → 发布 → 确认）
async function publishXianyu(page, payload) {
  const title = String(payload && payload.title || '').trim()
  const desc = String(payload && payload.desc || payload && payload.caption || '').trim()
  const price = String(payload && payload.price || '1').trim()
  const images = (payload && payload.images) || []
  if (!title) return { success: false, error: '商品标题为空' }
  await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {})
  await page.waitForTimeout(3000)
  if (!page.url().includes('goofish.com')) return { success: false, error: '请先登录闲鱼（浏览器中）', needLogin: true, platform: 'xianyu' }
  // 填标题/描述/价格
  await page.evaluate(({ t, d, pr }) => {
    const setV = (el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (set) { el.focus(); set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }
    }
    const vis = (el) => !!el && el.offsetParent !== null
    const ti = document.querySelector('input[id*="title"], input[placeholder*="标题"], [class*="titleInput"]')
    if (ti && vis(ti)) setV(ti, t)
    if (d) { const di = document.querySelector('textarea[id*="desc"], textarea[id*="description"], [class*="descInput"]'); if (di && vis(di)) setV(di, d) }
    const pi = document.querySelector('input[id*="price"], input[placeholder*="价"], input[class*="price"]')
    if (pi && vis(pi)) setV(pi, pr)
  }, { t: title, d: desc, pr: price })
  // 传图
  if (images.length) {
    const ok = await page.evaluate(() => { const inp = document.querySelector('input[type="file"]'); if (inp) { inp.setAttribute('data-goofish', '1'); return true } return false })
    if (!ok) return { success: false, error: '未找到闲鱼图片上传入口' }
    await page.setInputFiles('input[data-goofish="1"]', images)
    await page.waitForTimeout(5000)
  }
  // 点发布
  await page.waitForTimeout(1500)
  const sent = await page.evaluate(() => {
    const vis = (el) => !!el && el.offsetParent !== null && !el.disabled
    const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim()
    const btn = [...document.querySelectorAll('button')].find(b => vis(b) && /发布|提交|上架|确认/.test(clean(b.textContent || '')) && !/取消/.test(clean(b.textContent || '')))
    if (btn) { btn.click(); return true }
    return false
  })
  if (!sent) return { success: false, error: '未找到「发布/上架」按钮' }
  // 轮询确认（URL 变商品详情 /item?id= 或 发布成功）
  let confirmed = false
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500)
    const st = await page.evaluate(() => {
      const t = (document.body.innerText || '').slice(0, 800)
      const u = location.href || ''
      return { ok: /item\?id=\d+/.test(u) || /发布成功|上架成功|发布完成/.test(t), err: /发布失败|上架失败|请重新登录|操作频繁/.test(t) }
    })
    if (st.ok) { confirmed = true; break }
    if (st.err) break
  }
  if (!confirmed) return { success: false, error: '闲鱼发布结果未确认（请到浏览器查看——请勿告知用户已发布）' }
  return { success: true, message: '闲鱼已发布（已确认）' }
}

async function publishWeibo(page, payload) {
  try {
    const text = String(payload && payload.text || payload && payload.title || '').trim()
    if (!text) return { success: false, error: '微博内容为空' }
    if (text.length > 2000) return { success: false, error: '微博内容超过 2000 字' }
    await page.goto('https://weibo.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(2500)
    // 登录检测：URL 是否还停留在 weibo.com（未登录可能跳 login）
    if (!page.url().includes('weibo.com')) return { success: false, error: '请先登录微博（浏览器中）', needLogin: true, platform: 'weibo' }
    // 点"发微博"打开编辑器
    const opened = await page.evaluate(() => {
      const vis = (el) => !!el && el.offsetParent !== null && !el.disabled
      for (const btn of document.querySelectorAll('button[title="发微博"], button[title="写微博"]')) {
        if (vis(btn)) { btn.click(); return true }
      }
      return false
    })
    if (!opened) return { success: false, error: '未找到「发微博」按钮（可能未登录）', needLogin: true, platform: 'weibo' }
    // 等 textarea 出现
    let taOk = false
    for (let i = 0; i < 10; i++) {
      taOk = await page.evaluate(() => {
        for (const sel of ['textarea[placeholder*="新鲜事"], div[contenteditable="true"][data-placeholder*="新鲜事"], div[contenteditable="true"][data-placeholder*="分享"], div[contenteditable="true"][data-placeholder*="说点什么"]']) {
          for (const t of document.querySelectorAll(sel)) if (t.offsetParent !== null) return true
        }
        return false
      })
      if (taOk) break
      await page.waitForTimeout(800)
    }
    if (!taOk) return { success: false, error: '微博编辑器未出现' }
    // 填内容（native setter 保留 React 状态）
    await page.evaluate((content) => {
      const ta = [...document.querySelectorAll('textarea[placeholder*="新鲜事"]')].filter(t => t.offsetParent !== null).pop()
      if (!ta) return
      ta.focus()
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (nativeSetter) nativeSetter.call(ta, content)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }, text)
    // 点"发送/发布"
    await page.waitForTimeout(600)
    const sent = await page.evaluate(() => {
      const vis = (el) => !!el && el.offsetParent !== null && !el.disabled
      for (const label of ['发送', '发布']) {
        for (const btn of document.querySelectorAll('button, [role="button"]')) {
          const t = (btn.innerText || btn.textContent || '').trim()
          if (t === label && vis(btn)) { btn.click(); return label }
        }
      }
      return ''
    })
    if (!sent) return { success: false, error: '未找到「发送」按钮' }
    // 2026-08-23: 发布结果轮询确认——不假报成功（等发送成功提示或编辑器关闭）
    let confirmed = false
    let failHint = ''
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500)
      const st = await page.evaluate(() => {
        const vis = (el) => !!el && el.offsetParent !== null
        const bodyTxt = (document.body.innerText || '').slice(0, 600)
        const editorGone = ![...document.querySelectorAll('textarea[placeholder*="新鲜事"], textarea._input_13iqr_8')].some(el => vis(el))
        const okHint = /发送成功|发布成功|已发送|微博发送|分享成功/.test(bodyTxt)
        const errHint = /发送失败|发布失败|内容包含|操作频繁|登录过期|请登录/.test(bodyTxt)
        return { okHint, errHint, editorGone, bodyTxt }
      })
      if (st.okHint || st.editorGone) { confirmed = true; break }
      if (st.errHint) { failHint = st.bodyTxt.match(/发送失败|发布失败|内容包含|操作频繁|登录过期|请登录/)?.[0] || ''; break }
    }
    if (!confirmed) return { success: false, error: '微博发布结果未确认（' + (failHint || '未收到成功反馈，请到浏览器查看') + '）——请勿告知用户已发布' }
    return { success: true, message: '微博已发布（已确认）' }
  } catch (e) { return { success: false, error: (e && e.message) || String(e) } }
}

async function publishDouyinViaCDP(payload) {
  // 抖音发布（P0-2，复用 OpenCLI 官方 API 流程：vod-upload/tos-upload/create_v2，CDP page 内 fetch）
  try {
    const { chromium } = require('playwright')
    const videoPath = payload && payload.videoPath
    const title = (payload && payload.title) || ''
    const caption = (payload && payload.caption) || ''
    if (!videoPath || !fs.existsSync(videoPath)) return { success: false, error: '视频文件不存在: ' + videoPath }
    const fileSize = fs.statSync(videoPath).size
    if (title.length > 30) return { success: false, error: '标题不能超过 30 字' }
    if (caption.length > 1000) return { success: false, error: '正文不能超过 1000 字' }

    const browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT)
    const ctx = browser.contexts()[0]
    if (!ctx) return { success: false, error: '浏览器未绑定/无页面，请先「绑定浏览器」' }
    // 2026-08-27: 发布执行也复用 getTargetPage（同平台tab复用+清blank）——不再每次执行 newPage 堆积抖音tab
    let page = await getTargetPage(ctx, 'creator.douyin.com')
    if (!page.url().includes('creator.douyin.com')) { await page.goto('https://creator.douyin.com/creator-micro/content/upload', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {}) }
    // 确保已在 creator.douyin.com（未登录会跳登录）
    if (!page.url().includes('creator.douyin.com')) return { success: false, error: '请先登录抖音创作者平台（浏览器中）', needLogin: true, platform: 'douyin' }

    // browserFetch：在浏览器上下文 fetch（cookie+a_bogus 自动）
    const browserFetch = (method, url, options) => page.evaluate(({ m, u, o }) => {
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ status_code: -1, status_msg: 'timeout' }), 40000)
        fetch(u, { method: m, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, ...(o.body ? { body: JSON.stringify(o.body) } : {}) })
          .then(r => r.text()).then(t => { clearTimeout(timer); try { resolve(JSON.parse(t)) } catch { resolve({ status_code: -2, status_msg: t.slice(0, 300) }) } })
          .catch(e => { clearTimeout(timer); resolve({ status_code: -1, status_msg: String(e && e.message || e) }) })
      })
    }, { m: method, u: url, o: options })

    // 复用 OpenCLI 官方上传流程（动态 import，绝对路径绕过 exports；打包需 asarUnpack @jackwener）
    const { pathToFileURL } = require('url')
    const base = pathToFileURL(path.join(String(app.getAppPath()).replace('.asar', '.asar.unpacked'), 'node_modules', '@jackwener', 'opencli', 'clis', 'douyin', '_shared')).href + '/'
    const vod = await import(base + 'vod-upload.js')
    const tosMod = await import(base + 'tos-upload.js')

    // Phase 1-3: 上传鉴权 → 申请上传 → TOS 分片上传 → 提交
    const credentials = await vod.getUploadAuthV5Credentials({ evaluate: (js) => page.evaluate(js) })
    const tosUploadInfo = await vod.applyVideoUploadInner(fileSize, credentials)
    await tosMod.tosUpload({ filePath: videoPath, uploadInfo: tosUploadInfo, credentials, onProgress: () => {} })
    const committed = await vod.commitVideoUploadInner(tosUploadInfo, credentials)
    const videoId = committed.video_id
    if (!videoId) return { success: false, error: '上传提交失败: ' + JSON.stringify(committed).slice(0, 300) }
    const coverUri = committed.poster_uri || ''
    const coverWidth = committed.width || 720
    const coverHeight = committed.height || 1280

    // Phase 8: create_v2 发布（立即——timing=now；抖音 web 若仅支持定时会返回错误，届时提示）
    const DEVICE = 'aid=1128&cookie_enabled=true&screen_width=1512&screen_height=982&browser_language=zh-CN&browser_platform=MacIntel&browser_name=Mozilla&browser_online=true&timezone_name=Asia%2FTokyo&support_h265=1'
    const publishUrl = 'https://creator.douyin.com/web/api/media/aweme/create_v2/?read_aid=2906&' + DEVICE
    const publishText = caption ? title + ' ' + caption : title
    const body = {
      item: {
        common: {
          text: publishText, caption: caption || '', item_title: title,
          activity: '[]', text_extra: '[]', challenges: '[]', mentions: '[]', hashtag_source: '', hot_sentence: '',
          interaction_stickers: '[]', visibility_type: 0, download: 0,
          timing: Math.floor(Date.now() / 1000) + 10800, // 2026-08-29: 定时 3 小时后（之前 2h 边界仍 -2，保险加到 3h）
          creation_id: String(Date.now()) + Math.random().toString(36).slice(2, 10),
          media_type: 4, video_id: videoId, music_source: 0, music_id: null,
        },
        cover: { poster: coverUri, custom_cover_image_height: coverHeight, custom_cover_image_width: coverWidth, poster_delay: 0,
          cover_tools_info: '{"video_cover_source":2,"cover_timestamp":0,"recommend_timestamp":0,"is_cover_edit":0,"is_cover_template":0,"cover_template_id":"","is_text_template":0,"text_template_id":"","text_template_content":"","is_text":0,"text_num":0,"text_content":"","is_use_sticker":0,"sticker_id":"","is_use_filter":0,"filter_id":"","is_cover_modify":0,"to_status":0,"cover_type":0,"initial_cover_uri":"","cut_coordinate":""}',
          cover_tools_extend_info: '{}' },
        mix: {}, chapter: { chapter: JSON.stringify({ chapter_abstract: '', chapter_details: [], chapter_type: 0 }) },
        anchor: {}, sync: { should_sync: false, sync_to_toutiao: 0 }, open_platform: {},
        assistant: { is_preview: 0, is_post_assistant: 1 }, declare: { user_declare_info: '{}' },
      },
    }
    // 2026-08-27: 抖音内容安全预检（opencli Phase 7）——跳过预检直接 create_v2 会 200 空响应（发布被拒根因）
    try {
      const safetyUrl = 'https://creator.douyin.com/aweme/v1/post_assistant/fast_detect/pre_check'
      const safetyBody = { video_id: videoId, title: title || '', desc: caption || '' }
      await browserFetch('POST', safetyUrl, { body: safetyBody }).catch(() => {})
      const pollUrl = 'https://creator.douyin.com/aweme/v1/post_assistant/fast_detect/poll'
      const sDeadline = Date.now() + 30000
      while (Date.now() < sDeadline) {
        const sp = await browserFetch('POST', pollUrl, { body: safetyBody })
        if (sp && sp.ok) break
        await new Promise((r2) => setTimeout(r2, 3000))
      }
      console.log('[douyin] 内容安全预检完成')
    } catch (ePre) { console.error('[douyin] 预检异常（继续发布）:', ePre?.message || ePre) }
    const publishRes = await browserFetch('POST', publishUrl, { body })
    const awemeId = publishRes.aweme_id || publishRes.item_id
    if (!awemeId) return { success: false, error: '发布未返回 aweme_id（可能需定时发布）：' + JSON.stringify(publishRes).slice(0, 300) }
    return { success: true, awemeId, url: 'https://www.douyin.com/video/' + awemeId }
  } catch (e) { return { success: false, error: (e && e.message) || String(e) } }
}

ipcMain.handle('browser:publish', async (_e, payload) => {
  const platform = payload && payload.platform
  if (platform === 'weibo') {
    const { chromium } = require('playwright')
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT)
      const ctx = browser.contexts()[0]
      if (!ctx) return { success: false, error: '浏览器未绑定/无页面，请先「绑定浏览器」' }
      const page = ctx.pages().find((p2) => p2.url().includes('weibo.com')) || await ctx.newPage()
      return await publishWeibo(page, payload)
    } catch (e) { return { success: false, error: (e && e.message) || String(e) } }
  }
  if (platform === 'xianyu') {
    const { chromium } = require('playwright')
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT)
      const ctx = browser.contexts()[0]
      if (!ctx) return { success: false, error: '浏览器未绑定/无页面，请先「绑定浏览器」' }
      const page = ctx.pages().find((p2) => p2.url().includes('goofish.com')) || await ctx.newPage()
      return await publishXianyu(page, payload)
    } catch (e) { return { success: false, error: (e && e.message) || String(e) } }
  }
  if (platform === 'jike') {
    const { chromium } = require('playwright')
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT)
      const ctx = browser.contexts()[0]
      if (!ctx) return { success: false, error: '浏览器未绑定/无页面，请先「绑定浏览器」' }
      const page = ctx.pages().find((p2) => p2.url().includes('okjike.com')) || await ctx.newPage()
      return await publishJike(page, payload)
    } catch (e) { return { success: false, error: (e && e.message) || String(e) } }
  }
  if (platform === 'shipinhao') {
    const { chromium } = require('playwright')
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT)
      const ctx = browser.contexts()[0]
      if (!ctx) return { success: false, error: '浏览器未绑定/无页面，请先「绑定浏览器」' }
      const page = ctx.pages().find((p2) => p2.url().includes('channels.weixin.qq.com')) || await ctx.newPage()
      return await publishShipinhao(page, payload)
    } catch (e) { return { success: false, error: (e && e.message) || String(e) } }
  }
  if (platform === 'twitter') {
    const { chromium } = require('playwright')
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT)
      const ctx = browser.contexts()[0]
      if (!ctx) return { success: false, error: '浏览器未绑定/无页面，请先「绑定浏览器」' }
      const page = ctx.pages().find((p2) => /x\.com|twitter\.com/.test(p2.url())) || await ctx.newPage()
      return await publishTwitter(page, payload)
    } catch (e) { return { success: false, error: (e && e.message) || String(e) } }
  }
  if (platform === 'xiaohongshu') {
    // 小红书发布：图文（images 数组）或 视频（videoPath）——DOM，参考 opencli 选择器
    const { chromium } = require('playwright')
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT)
      const ctx = browser.contexts()[0]
      if (!ctx) return { success: false, error: '浏览器未绑定/无页面，请先「绑定浏览器」' }
      const page = ctx.pages().find((p2) => p2.url().includes('xiaohongshu.com')) || await ctx.newPage()
      if (payload && payload.images && payload.images.length) {
        return await publishXhsImages(page, payload)
      }
      const videoPath = payload && payload.videoPath
      const title = (payload && payload.title) || ''
      const desc = (payload && payload.caption) || ''
      if (!videoPath || !fs.existsSync(videoPath)) return { success: false, error: '视频文件不存在: ' + videoPath }
      await page.goto('https://creator.xiaohongshu.com/publish/publish?target=video', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(2000)
      if (!page.url().includes('xiaohongshu.com')) return { success: false, error: '请先登录小红书（浏览器中）', needLogin: true, platform: 'xiaohongshu' }
      // 上传视频（通用 file input，accept 视频）
      const uploaded = await page.evaluate(() => {
        const vis = (el) => !!el && el.offsetParent !== null
        for (const inp of document.querySelectorAll('input[type="file"]')) {
          const acc = (inp.getAttribute('accept') || '').toLowerCase()
          if (vis(inp) && (acc.includes('video') || acc.includes('mp4') || acc === '')) return true
        }
        return false
      })
      if (!uploaded) return { success: false, error: '未找到小红书视频上传入口（页面结构可能变化）' }
      const inputSel = await page.evaluate(() => {
        const vis = (el) => !!el && el.offsetParent !== null
        const inputs = [...document.querySelectorAll('input[type="file"]')].filter(inp => vis(inp))
        const target = inputs.find(inp => (inp.getAttribute('accept') || '').toLowerCase().includes('video')) || inputs[inputs.length - 1]
        if (!target) return ''
        target.setAttribute('data-xhs-video', '1')
        return 'input[data-xhs-video="1"]'
      })
      if (!inputSel) return { success: false, error: '未找到上传输入框' }
      await page.setInputFiles(inputSel, videoPath)
      // 等上传完成（简单等待 + 填标题/正文）
      await page.waitForTimeout(6000)
      const fillTitle = title ? await page.evaluate((t) => {
        for (const sel of ['input[placeholder*="title" i]', 'input[class*="title"]', '.note-title input', '.title-input input']) {
          const el = document.querySelector(sel)
          if (el && el.offsetParent !== null) {
            const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
            if (set) set.call(el, t)
            el.dispatchEvent(new Event('input', { bubbles: true }))
            return true
          }
        }
        return false
      }, title) : false
      if (title && !fillTitle) return { success: false, error: '未找到小红书标题输入框' }
      if (desc) {
        await page.evaluate((d) => {
          const el = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => e.offsetParent !== null && !String(e.getAttribute('placeholder') || '').includes('标题'))[0]
          if (el) { el.focus(); document.execCommand('insertText', false, d) }
        }, desc)
      }
      // 点发布
      await page.waitForTimeout(1000)
      const sent = await page.evaluate(() => {
        const vis = (el) => !!el && el.offsetParent !== null && !el.disabled
        for (const label of ['发布', '发布笔记']) {
          for (const btn of document.querySelectorAll('button, [role="button"]')) {
            if (((btn.innerText || btn.textContent || '').trim() === label) && vis(btn)) { btn.click(); return label }
          }
        }
        return ''
      })
      if (!sent) return { success: false, error: '未找到「发布」按钮（可能上传未完成）' }
      // 2026-08-23: 发布结果轮询确认——不假报（等"发布成功/审核中"提示或跳转；失败如实报）
      let xhsConfirmed = false
      let xhsFail = ''
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(500)
        const st = await page.evaluate(() => {
          const t = (document.body.innerText || '').slice(0, 800)
          return {
            ok: /发布成功|发布笔记成功|笔记发布成功|已发布|审核中|审核通过|发布中/.test(t),
            err: /发布失败|发布不成功|上传失败|违规|操作频繁|请重新登录|登录已过期/.test(t),
            gone: !location.href.includes('publish/publish'),
          }
        })
        if (st.ok || st.gone) { xhsConfirmed = true; break }
        if (st.err) { xhsFail = '小红书发布失败提示（浏览器可见）'; break }
      }
      if (!xhsConfirmed) return { success: false, error: '小红书发布结果未确认（' + (xhsFail || '未收到成功反馈，请到浏览器查看——请勿告知用户已发布') + '）' }
      return { success: true, message: '小红书发布已确认（发布中/审核中）' }
    } catch (e) { return { success: false, error: (e && e.message) || String(e) } }
  }
  return await publishDouyinViaCDP(payload)
})

