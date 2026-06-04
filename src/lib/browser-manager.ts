/**
 * 指纹浏览器管理模块（可交互版本）
 *
 * 负责：Playwright 浏览器的启停、页面交互
 * 仅用于 bindType='manual' (指纹浏览器) 类型的账号
 *
 * 与 Q1群控(device) / USB真手机(usb) 完全独立，互不干扰
 *
 * 端口规则：
 *   - 一账号一端口，固定绑定
 *   - 由 Admin 在审核时手动分配
 *   - Cookie/登录态持久化在该端口环境中
 *
 * 交互模式：
 *   - headless 运行在服务器端
 *   - 前端通过截图查看 + 点击/输入操作
 *   - 用户可在截图上点击元素位置，后端执行对应交互
 *
 * 反检测策略（纯 Playwright）：
 *   - --disable-blink-features=AutomationControlled
 *   - 自定义 UA 模拟真实 Chrome
 */

import { chromium, Page } from 'playwright'

// ── 类型定义 ──

export interface BrowserInstance {
  /** CDP 调试端口号 */
  port: number
  /** 绑定的账号ID */
  accountId: string | null
  /** Playwright Browser 对象 */
  browser: any
  /** 当前活跃页面（启动后不关闭） */
  page: any
  /** 当前 URL */
  currentUrl: string
  /** 启动时间 */
  startedAt: Date
  /** 是否正在运行 */
  running: boolean
}

// ── 全局状态 ──

/** 已启动的浏览器实例 Map<port, instance> */
const activeBrowsers = new Map<number, BrowserInstance>()

// ── 反检测参数 ──

const LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,800',
  '--lang=zh-CN',
  '--disable-features=IsolateOrigins,site-per-process',
]

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// ── 核心函数 ──

/**
 * 启动指定端口的指纹浏览器实例并打开初始页面
 */
export async function startBrowser(port: number, accountId?: string): Promise<BrowserInstance> {
  if (activeBrowsers.has(port)) {
    const existing = activeBrowsers.get(port)!
    if (existing.running) {
      throw new Error(`端口 ${port} 已被占用（账号: ${existing.accountId || '未知'}）`)
    }
    await cleanup(existing)
    activeBrowsers.delete(port)
  }

  const userDataDir = `/root/browser-data/${port}`

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [
      ...LAUNCH_ARGS,
      `--remote-debugging-port=${port}`,
      `--user-agent=${USER_AGENT}`,
    ],
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
  })

  // 创建页面并保持存活（不关闭）
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' })

  const instance: BrowserInstance = {
    port,
    accountId: accountId || null,
    browser,
    page,
    currentUrl: '',
    startedAt: new Date(),
    running: true,
  }
  activeBrowsers.set(port, instance)

  console.log(`[BrowserManager] ✅ 启动成功 - 端口:${port} 账号:${accountId || '未绑定'}`)
  return instance
}

/**
 * 清理浏览器资源
 */
async function cleanup(instance: BrowserInstance): Promise<void> {
  try {
    if (instance.page && !instance.page.isClosed()) {
      await instance.page.close().catch(() => {})
    }
    if (instance.browser && instance.browser.isConnected()) {
      await instance.browser.close().catch(() => {})
    }
  } catch (_) {}
}

/**
 * 停止指定端口的浏览器实例
 */
export async function stopBrowser(port: number): Promise<void> {
  const instance = activeBrowsers.get(port)
  if (!instance) throw new Error(`端口 ${port} 没有运行的浏览器`)

  try {
    await cleanup(instance)
    instance.running = false
    instance.page = null
    activeBrowsers.delete(port)
    console.log(`[BrowserManager] ⏹ 已停止 - 端口:${port}`)
  } catch (error) {
    activeBrowsers.delete(port)
    instance.running = false
    console.error(`[BrowserManager] ❌ 停止出错 - 端口:${port}`, error)
    throw error
  }
}

/** 获取指定端口的状态 */
export function getBrowserStatus(port: number): { running: boolean; info?: Omit<BrowserInstance, 'browser' | 'page'> } {
  const instance = activeBrowsers.get(port)
  if (!instance) return { running: false }
  return {
    running: instance.running,
    info: { port: instance.port, accountId: instance.accountId, currentUrl: instance.currentUrl, startedAt: instance.startedAt, running: instance.running },
  }
}

/** 获取所有活跃浏览器列表 */
export function getAllBrowsers(): Array<{ port: number; accountId: string | null; startedAt: Date; currentUrl: string; running: boolean }> {
  const result: Array<{ port: number; accountId: string | null; startedAt: Date; currentUrl: string; running: boolean }> = []
  for (const [, inst] of activeBrowsers) {
    result.push({ port: inst.port, accountId: inst.accountId, startedAt: inst.startedAt, currentUrl: inst.currentUrl, running: inst.running })
  }
  return result
}

/**
 * 打开 URL 并导航到该页面（page 保持存活）
 */
export async function openPage(port: number, url: string): Promise<{ success: boolean; screenshot?: string }> {
  const instance = activeBrowsers.get(port)
  if (!instance || !instance.running) throw new Error(`端口 ${port} 的浏览器未运行`)

  // 如果当前没有可用页面，创建一个
  let page = instance.page
  if (!page || page.isClosed?.()) {
    page = await instance.browser.newPage()
    await page.setViewportSize({ width: 1280, height: 800 })
    instance.page = page
  }

  await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' })
  instance.currentUrl = url
  await page.waitForTimeout(2000)

  const screenshot = await takeScreenshotInternal(page)
  return { success: true, screenshot }
}

/**
 * 在页面上点击指定坐标位置
 */
export async function clickAt(port: number, x: number, y: number): Promise<{ success: boolean; screenshot?: string }> {
  const instance = activeBrowsers.get(port)
  if (!instance || !instance.running) throw new Error(`端口 ${port} 的浏览器未运行`)
  const page = instance.page
  if (!page || page.isClosed?.()) throw new Error('页面未打开')

  try {
    await page.mouse.click(x, y)
    await page.waitForTimeout(1000)
    const screenshot = await takeScreenshotInternal(page)
    return { success: true, screenshot }
  } catch (e) {
    console.warn('[BrowserManager] clickAt error:', e instanceof Error ? e.message : e)
    throw e
  }
}

/**
 * 在页面上输入文字
 * 先点击输入位置，再输入内容
 */
export async function typeAt(port: number, x: number, y: number, text: string): Promise<{ success: boolean; screenshot?: string }> {
  const instance = activeBrowsers.get(port)
  if (!instance || !instance.running) throw new Error(`端口 ${port} 的浏览器未运行`)
  const page = instance.page
  if (!page || page.isClosed?.()) throw new Error('页面未打开')

  try {
    await page.mouse.click(x, y)
    await page.waitForTimeout(300)
    // 先清空现有内容（全选+删除）
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(100)
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(100)
    // 逐字输入模拟真人打字
    for (const char of text) {
      await page.keyboard.type(char, { delay: 50 + Math.random() * 80 })
    }
    await page.waitForTimeout(500)
    const screenshot = await takeScreenshotInternal(page)
    return { success: true, screenshot }
  } catch (e) {
    console.warn('[BrowserManager] typeAt error:', e instanceof Error ? e.message : e)
    throw e
  }
}

/**
 * 按 Enter 键（用于提交表单等）
 */
export async function pressEnter(port: number): Promise<{ success: boolean; screenshot?: string }> {
  const instance = activeBrowsers.get(port)
  if (!instance || !instance.running) throw new Error(`端口 ${port} 的浏览器未运行`)
  const page = instance.page
  if (!page || page.isClosed?.()) throw new Error('页面未打开')

  await page.keyboard.press('Enter')
  await page.waitForTimeout(2000)
  const screenshot = await takeScreenshotInternal(page)
  return { success: true, screenshot }
}

/**
 * 截取当前页面截图（base64 data URI）
 */
export async function takeScreenshot(port: number): Promise<string> {
  const instance = activeBrowsers.get(port)
  if (!instance || !instance.running) throw new Error(`端口 ${port} 的浏览器未运行`)
  const page = instance.page
  if (!page || page.isClosed?.()) throw new Error('页面未打开')
  return takeScreenshotInternal(page)
}

/** 内部截图函数 */
async function takeScreenshotInternal(page: any): Promise<string> {
  const buf = await page.screenshot({ type: 'png', fullPage: false })
  return `data:image/png;base64,${buf.toString('base64')}`
}
