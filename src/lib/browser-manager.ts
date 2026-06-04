/**
 * 指纹浏览器管理模块
 *
 * 负责：Playwright 浏览器的启停、状态管理
 * 仅用于 bindType='manual' (指纹浏览器) 类型的账号
 *
 * 与 Q1群控(device) / USB真手机(usb) 完全独立，互不干扰
 *
 * 端口规则：
 *   - 一账号一端口，固定绑定
 *   - 由 Admin 在审核时手动分配
 *   - Cookie/登录态持久化在该端口环境中
 *
 * 反检测策略（纯 Playwright，无需额外插件）：
 *   - --disable-blink-features=AutomationControlled  隐藏 webdriver 标记
 *   - 自定义 UA 模拟真实 Chrome
 *   - 禁用自动化提示条/首次运行向导
 */

import { chromium } from 'playwright'

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

// ── 反检测参数（所有浏览器实例共享） ──

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
 * 启动指定端口的指纹浏览器实例
 */
export async function startBrowser(port: number, accountId?: string): Promise<BrowserInstance> {
  if (activeBrowsers.has(port)) {
    const existing = activeBrowsers.get(port)!
    if (existing.running) {
      throw new Error(`端口 ${port} 已被占用（账号: ${existing.accountId || '未知'}）`)
    }
    activeBrowsers.delete(port)
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      ...LAUNCH_ARGS,
      `--remote-debugging-port=${port}`,
      `--user-agent=${USER_AGENT}`,
    ],
  })

  const instance: BrowserInstance = { port, accountId: accountId || null, browser, startedAt: new Date(), running: true }
  activeBrowsers.set(port, instance)

  console.log(`[BrowserManager] ✅ 启动成功 - 端口:${port} 账号:${accountId || '未绑定'}`)
  return instance
}

/**
 * 停止指定端口的浏览器实例
 */
export async function stopBrowser(port: number): Promise<void> {
  const instance = activeBrowsers.get(port)
  if (!instance) throw new Error(`端口 ${port} 没有运行的浏览器`)

  try {
    await instance.browser.close()
    instance.running = false
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
export function getBrowserStatus(port: number): { running: boolean; info?: BrowserInstance } {
  const instance = activeBrowsers.get(port)
  if (!instance) return { running: false }
  return { running: instance.running, info: { ...instance, browser: '[Browser Object]' } }
}

/** 获取所有活跃浏览器列表 */
export function getAllBrowsers(): Array<{ port: number; accountId: string | null; startedAt: Date; running: boolean }> {
  const result: Array<{ port: number; accountId: string | null; startedAt: Date; running: boolean }> = []
  for (const [port, inst] of activeBrowsers) result.push({ port, accountId: inst.accountId, startedAt: inst.startedAt, running: inst.running })
  return result
}

/**
 * 在已运行浏览器中打开页面并返回截图 base64
 */
export async function openPage(port: number, url: string): Promise<{ success: boolean; screenshot?: string }> {
  const instance = activeBrowsers.get(port)
  if (!instance || !instance.running) throw new Error(`端口 ${port} 的浏览器未运行`)

  const page = await instance.browser.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' })

  await page.goto(url, { timeout: 45000, waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)

  const screenshot = await page.screenshot({ type: 'png', fullPage: false })
  await page.close()

  return { success: true, screenshot: `data:image/png;base64,${screenshot.toString('base64')}` }
}
