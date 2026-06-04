/**
 * 指纹浏览器管理模块
 *
 * 负责：Playwright + Stealth 浏览器的启停、状态管理
 * 仅用于 bindType='manual' (指纹浏览器) 类型的账号
 *
 * 与 Q1群控(device) / USB真手机(usb) 完全独立，互不干扰
 *
 * 端口规则：
 *   - 一账号一端口，固定绑定
 *   - 由 Admin 在审核时手动分配
 *   - Cookie/登录态持久化在该端口环境中
 *
 * 注意：playwright-extra / stealth 使用动态 import，避免 Next.js 构建时 ESM/CJS 冲突
 */

// ── 类型定义 ──

export interface BrowserInstance {
  /** CDP 调试端口号 */
  port: number
  /** 绑定的账号ID */
  accountId: string | null
  /** Playwright Browser 对象 */
  browser: any
  /** 启动时间 */
  startedAt: Date
  /** 是否正在运行 */
  running: boolean
}

// ── 全局状态 ──

/** 已启动的浏览器实例 Map<port, instance> */
const activeBrowsers = new Map<number, BrowserInstance>()

// ── 核心函数 ──

/** 动态加载的 chromium 引用缓存（避免重复 import） */
let _chromium: any = null

async function getChromium() {
  if (!_chromium) {
    const pw = await import('playwright-extra')
    const st = await import('puppeteer-extra-plugin-stealth')
    const stealth = st.default || st
    _chromium = pw.chromium
    _chromium.use(stealth())
  }
  return _chromium
}

/**
 * 启动指定端口的指纹浏览器实例
 *
 * @param port - CDP 调试端口号（由 Admin 分配）
 * @param accountId - 关联的账号ID（可选）
 * @returns 浏览器实例信息
 */
export async function startBrowser(port: number, accountId?: string): Promise<BrowserInstance> {
  // 检查端口是否已被占用
  if (activeBrowsers.has(port)) {
    const existing = activeBrowsers.get(port)!
    if (existing.running) {
      throw new Error(`端口 ${port} 已被占用（账号: ${existing.accountId || '未知'}）`)
    }
    // 之前停了但没清理，先清理
    activeBrowsers.delete(port)
  }

  // 启动浏览器
  const chromium = await getChromium()
  const browser = await chromium.launch({
    headless: true,
    args: [
      `--remote-debugging-port=${port}`,
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
      '--lang=zh-CN',
      '--disable-features=IsolateOrigins,site-per-process',
      // 反指纹参数
      `--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,
    ],
  })

  const instance: BrowserInstance = {
    port,
    accountId: accountId || null,
    browser,
    startedAt: new Date(),
    running: true,
  }

  activeBrowsers.set(port, instance)

  console.log(`[BrowserManager] ✅ 浏览器已启动 - 端口:${port} 账号:${accountId || '未绑定'}`)

  return instance
}

/**
 * 停止指定端口的浏览器实例
 * 
 * @param port - 要停止的 CDP 端口号
 */
export async function stopBrowser(port: number): Promise<void> {
  const instance = activeBrowsers.get(port)
  
  if (!instance) {
    throw new Error(`端口 ${port} 没有运行的浏览器实例`)
  }

  try {
    await instance.browser.close()
    instance.running = false
    activeBrowsers.delete(port)
    console.log(`[BrowserManager] ⏹️ 浏览器已停止 - 端口:${port}`)
  } catch (error) {
    // 即使关闭失败也清理引用
    activeBrowsers.delete(port)
    instance.running = false
    console.error(`[BrowserManager] ❌ 停止浏览器时出错 - 端口:${port}`, error)
    throw error
  }
}

/**
 * 获取指定端口的浏览器状态
 * 
 * @param port - CDP 端口号
 */
export function getBrowserStatus(port: number): { running: boolean; info?: BrowserInstance } {
  const instance = activeBrowsers.get(port)
  
  if (!instance) {
    return { running: false }
  }
  
  return {
    running: instance.running,
    info: {
      ...instance,
      browser: '[Browser Object]', // 不序列化 browser 对象
    },
  }
}

/**
 * 获取所有活跃的浏览器列表（用于 Admin 查看）
 */
export function getAllBrowsers(): Array<{ port: number; accountId: string | null; startedAt: Date; running: boolean }> {
  const result: Array<{ port: number; accountId: string | null; startedAt: Date; running: boolean }> = []
  
  for (const [port, instance] of activeBrowsers) {
    result.push({
      port,
      accountId: instance.accountId,
      startedAt: instance.startedAt,
      running: instance.running,
    })
  }
  
  return result
}

/**
 * 通过 CDP 连接到已运行的浏览器并打开页面
 * 
 * @param port - 目标浏览器的 CDP 端口
 * @param url - 要打开的 URL
 * @returns 页面对象
 */
export async function openPage(port: number, url: string): Promise<any> {
  const instance = activeBrowsers.get(port)
  
  if (!instance || !instance.running) {
    throw new Error(`端口 ${port} 的浏览器未运行`)
  }
  
  // 在现有浏览器中新建页面
  const page = await instance.browser.newPage()
  
  // 设置视口和语言
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  })

  // 导航到目标页面
  await page.goto(url, {
    timeout: 45000,
    waitUntil: 'networkidle',
  })

  // 额外等待渲染
  await page.waitForTimeout(3000)

  return page
}
