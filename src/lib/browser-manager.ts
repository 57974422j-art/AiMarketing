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

// ════════════════════════════════════
// 个人主页数据采集（指纹浏览器启动后自动调用）
// ════════════════════════════════════

export interface ProfileCollectResult {
  success: boolean
  platform: string
  accountId: string | null
  /** 采集到的数据 */
  followers?: number
  following?: number
  totalLikes?: number
  videoCount?: number
  nickname?: string
  message: string
}

/**
 * 通过已运行的浏览器实例采集个人主页数据
 * 在指纹浏览器启动后自动调用，将数据写入 DashboardStat
 *
 * @param port CDP 端口号（必须已运行）
 * @param platform 平台标识 (douyin/kuaishou/xiaohongshu)
 * @param userId 用户ID（用于写入数据库）
 */
export async function collectProfileData(
  port: number,
  platform: string,
  userId: number,
): Promise<ProfileCollectResult> {
  const instance = activeBrowsers.get(port)
  if (!instance || !instance.running || !instance.page) {
    return { success: false, platform, accountId: instance?.accountId || null, message: `端口 ${port} 浏览器未运行` }
  }

  const page = instance.page
  let result: ProfileCollectResult = {
    success: false, platform, accountId: instance.accountId, message: '',
  }

  try {
    // 根据平台选择采集策略
    if (platform === 'douyin') {
      result = await collectDouyinProfile(page)
    } else if (platform === 'kuaishou') {
      result = await collectKuaishouProfile(page)
    } else if (platform === 'xiaohongshu') {
      result = await collectXhsProfile(page)
    } else {
      return { ...result, message: `暂不支持 ${platform} 平台数据采集` }
    }

    // 采集成功 → 写入 DashboardStat
    if (result.success && result.followers !== undefined) {
      const { PrismaClient } = require('@prisma/client')
      const prisma = new PrismaClient()
      try {
        const today = new Date()
        today.setHours(0, 0, 0, 1)

        // 查找今天是否已有该用户+平台的记录
        const existing = await prisma.dashboardStat.findFirst({
          where: { userId, platform, date: { gte: today } },
        })

        if (existing) {
          await prisma.dashboardStat.update({
            where: { id: existing.id },
            data: {
              followers: result.followers || 0,
              following: result.following || 0,
              likes: result.totalLikes || 0,
              publishCount: result.videoCount || 0,
              engagementRate: result.videoCount && result.videoCount > 0
                ? Math.round(((result.totalLikes || 0) / result.videoCount) * 100) / 100
                : 0,
              date: new Date(),
            },
          })
        } else {
          await prisma.dashboardStat.create({
            data: {
              userId,
              platform,
              followers: result.followers || 0,
              following: result.following || 0,
              likes: result.totalLikes || 0,
              publishCount: result.videoCount || 0,
              engagementRate: result.videoCount && result.videoCount > 0
                ? Math.round(((result.totalLikes || 0) / result.videoCount) * 100) / 100
                : 0,
            },
          })
        }
        console.log(`[BrowserManager] ✅ 数据已入库 → 用户${userId} ${platform}: 粉丝${result.followers} 作品${result.videoCount}`)
      } finally {
        await prisma.$disconnect()
      }
    }

    return result
  } catch (e: any) {
    console.error(`[BrowserManager] ❌ 采集失败 (${platform}, port=${port}):`, e.message)
    return { ...result, message: `采集异常: ${e.message}` }
  }
}

/**
 * 解析数字（支持中文万/w单位）
 */
function parseNum(raw: string): number {
  if (!raw) return 0
  const c = raw.replace(/,/g, '').trim()
  const wan = c.match(/^([\d.]+)\s*[wW万]$/)
  if (wan) return Math.round(parseFloat(wan[1]) * 10000)
  const n = parseFloat(c)
  return isNaN(n) ? 0 : Math.round(n)
}

/** 抖音个人主页采集 */
async function collectDouyinProfile(page: any): Promise<ProfileCollectResult> {
  const log = (m: string) => console.log(`[DouyinProfile] ${m}`)

  try {
    // 策略A：创作者中心
    log('导航到创作者中心...')
    await page.goto('https://creator.douyin.com/creator-micro/home', {
      timeout: 30000, waitUntil: 'domcontentloaded',
    })
    await page.waitForTimeout(8000)

    // 关闭弹窗
    for (const text of ['我知道了', '知道了', '确定', '关闭']) {
      try {
        const btn = await page.$(`text="${text}"`)
        if (btn && await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 2000 })
          await page.waitForTimeout(800)
        }
      } catch (_) {}
    }

    // DOM 解析
    const raw = await page.evaluate(() => {
      const bodyText = document.body.innerText
      const data: Record<string, string> = {}

      // 多模式匹配
      const patterns: [RegExp, string][] = [
        [/粉丝[：:\s]*(\d+[,\d]*\d*(?:\.\d+)?[wW万]?)/, 'followers'],
        [/关注[：:\s]*(\d+[,\d]*\d*)/, 'following'],
        [/获赞[：:\s]*(\d+[,\d]*\d*(?:\.\d+)?[wW万]?)/, 'totalLikes'],
        [/总获赞[：:\s]*(\d+[,\d]*\d*(?:\.\d+)?[wW万]?)/, 'totalLikes'],
        [/作品[：:\s]*(\d+)/, 'videoCount'],
        [/作品数[：:\s]*(\d+)/, 'videoCount'],
      ]
      for (const [p, key] of patterns) {
        const m = bodyText.match(p)
        if (m) data[key] = m[1]
      }
      data._raw = bodyText.substring(0, 2000)
      return data
    })

    log(`原始匹配: ${JSON.stringify(raw)}`)

    const followers = parseNum(raw['followers'])
    const following = parseNum(raw['following'])
    const totalLikes = parseNum(raw['totalLikes'])
    const videoCount = parseNum(raw['videoCount'])

    const hasData = followers > 0 || videoCount > 0
    log(`结果: 粉丝=${followers} 关注=${following} 获赞=${totalLikes} 作品=${videoCount} 有效=${hasData}`)

    if (hasData) {
      return {
        success: true, platform: 'douyin', accountId: null,
        followers, following, totalLikes, videoCount,
        message: `抖音数据采集成功: 粉丝${followers} 作品${videoCount}`,
      }
    }

    // 策略B：网页版个人主页兜底
    log('创作者中心无数据，尝试网页版...')
    await page.goto('https://www.douyin.com/user/self', {
      timeout: 20000, waitUntil: 'domcontentloaded',
    })
    await page.waitForTimeout(6000)

    const webRaw = await page.evaluate(() => {
      const bt = document.body.innerText
      const d: Record<string, string> = {}
      const patterns: [RegExp, string][] = [
        [/关注\s+(\d+)/, 'following'], [/粉丝\s+(\d+)/, 'followers'],
        [/获赞\s+(\d[\d,]*)/, 'totalLikes'], [/喜欢\s+(\d[\d,]*)/, 'totalLikes'],
        [/作品\s*(\d+)/, 'videoCount'], [/(\d+)\s*作品/, 'videoCount'],
      ]
      for (const [p, k] of patterns) { const m = bt.match(p); if (m) d[k] = m[1] }
      return d
    })

    const wFollowers = parseNum(webRaw['followers'])
    const wVideoCount = parseNum(webRaw['videoCount'])
    const wTotalLikes = parseNum(webRaw['totalLikes'])
    const wFollowing = parseNum(webRaw['following'])
    const wHasData = wFollowers > 0 || wVideoCount > 0

    if (wHasData) {
      return {
        success: true, platform: 'douyin', accountId: null,
        followers: wFollowers, following: wFollowing, totalLikes: wTotalLikes, videoCount: wVideoCount,
        message: `抖音(网页版): 粉丝${wFollowers} 作品${wVideoCount}`,
      }
    }

    return {
      success: false, platform: 'douyin', accountId: null,
      message: '未能提取到有效数据，可能未登录或页面结构变化',
    }
  } catch (e: any) {
    return { success: false, platform: 'douyin', accountId: null, message: e.message }
  }
}

/** 快手个人主页采集（预留） */
async function collectKuaishouProfile(_page: any): Promise<ProfileCollectResult> {
  return {
    success: false, platform: 'kuaishou', accountId: null,
    message: '快手数据采集开发中，后续通过 MediaCrawler 实现',
  }
}

/** 小红书个人主页采集（预留） */
async function collectXhsProfile(_page: any): Promise<ProfileCollectResult> {
  return {
    success: false, platform: 'xiaohongshu', accountId: null,
    message: '小红书数据采集开发中，后续通过 MediaCrawler 实现',
  }
}
