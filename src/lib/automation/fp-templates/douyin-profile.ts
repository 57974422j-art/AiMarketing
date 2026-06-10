/**
 * 抖音个人主页数据采集模板 v1.0
 *
 * 功能：打开抖音创作者中心/个人主页，解析 DOM 提取账号数据
 *
 * 采集字段：
 *   - followers      粉丝数
 *   - following       关注数
 *   - totalLikes     获赞总数
 *   - videoCount     作品数
 *   - nickname       昵称
 *
 * 用途：
 *   指纹浏览器启动后自动调用，将数据写入 DashboardStat 表
 *   供终端用户仪表盘展示真实数据
 */

import { TemplateResult, LogFn, FingerprintTemplate, TemplateParamDef } from './types'

const meta = {
  key: 'douyin-profile',
  label: '📊 抖音采集主页',
  description: '打开个人主页采集粉丝/作品/获赞等数据',
  platforms: ['douyin'],
  version: '1.0.0',
}

const params: TemplateParamDef[] = []

/** 解析结果接口 */
export interface ProfileData {
  success: boolean
  /** 昵称 */
  nickname?: string
  /** 粉丝数 */
  followers?: number
  /** 关注数 */
  following?: number
  /** 获赞总数 */
  totalLikes?: number
  /** 作品数 */
  videoCount?: number
  /** 原始页面快照（用于调试） */
  rawText?: string
}

// ════════════════════════════════════
// DOM 解析策略（多选择器容错）
// ════════════════════════════════════

/**
 * 从创作者中心侧边栏解析数据
 * URL: https://creator.douyin.com/creator-micro/home
 * 页面左侧有用户信息卡片，包含粉丝/关注等数据
 */
async function parseCreatorCenter(page: any, log: LogFn): Promise<ProfileData | null> {
  try {
    const data = await page.evaluate(() => {
      const result: Record<string, any> = { source: 'creator-center' }

      // 策略1：从侧边栏用户卡片中提取数字
      // 创作者中心左侧栏通常有：粉丝数、关注数、获赞数
      const allText = document.body.innerText

      // 提取昵称 — 通常在头像旁边或顶部
      const nameEl = document.querySelector('[class*="nickname"], [class*="nickname"], [class*="userName"], [class*="user-name"]')
        || document.querySelector('.avatar-card .name, .user-info .name')
      if (nameEl) result.nickname = nameEl.textContent?.trim()

      // 用正则从页面文本中提取数字模式
      // 抖音创作者中心常见的格式：粉丝 12,500 / 关注 128 / 获赞 89.2w
      const patterns = [
        // "粉丝" 后面跟数字
        /粉丝[：:\s]*(\d+[,\d]*\d*(?:\.\d+)?[wW万]?)/,
        /粉丝数[：:\s]*(\d+[,\d]*\d*(?:\.\d+)?[wW万]?)/,
        /关注[：:\s]*(\d+[,\d]*\d*)/,
        /关注数[：:\s]*(\d+[,\d]*\d*)/,
        /获赞[：:\s]*(\d+[,\d]*\d*(?:\.\d+)?[wW万]?)/,
        /总获赞[：:\s]*(\d+[,\d]*\d*(?:\.\d+)?[wW万]?)/,
        /作品[：:\s]*(\d+[,\d]*\d*)/,
        /作品数[：:\s]*(\d+[,\d]*\d*)/,
        /视频[：:\s]*(\d+[,\d]*\d*)/,
      ]

      for (const p of patterns) {
        const m = allText.match(p)
        if (m) {
          const label = p.source.replace(/[\\/:*\s]/g, '').replace(/\(\?[^)]*\)/g, '')
          result[label + '_raw'] = m[1]
        }
      }

      // 策略2：尝试从特定 DOM 结构提取
      // 创作者中心的数据经常在 class 含有 statistic/count/number 的元素中
      const statEls = document.querySelectorAll('[class*="statistic"], [class*="count"], [class*="number"], [class*="data-count"]')
      statEls.forEach((el: any) => {
        const text = el.textContent?.trim() || ''
        if (/^\d/.test(text) && !result._statTexts) result._statTexts = []
        if (/^\d/.test(text)) result._statTexts?.push(text)
      })

      // 获取完整原始文本（截取前2000字符用于调试）
      result.rawSnippet = allText.substring(0, 2000)

      return result
    })

    log(`创作者中心解析结果: ${JSON.stringify(data).substring(0, 300)}`)

    // 将原始匹配结果转换为结构化数字
    const profile = normalizeProfileData(data, log)
    return profile
  } catch (e: any) {
    log(`创作者中心解析异常: ${e.message}`)
    return null
  }
}

/**
 * 从抖音网页版个人主页解析数据
 * URL: https://www.douyin.com/user/self 或 /user/{id}
 */
async function parseWebProfile(page: any, log: LogFn): Promise<ProfileData | null> {
  try {
    const data = await page.evaluate(() => {
      const result: Record<string, any> = { source: 'web-profile' }
      const allText = document.body.innerText

      // 抖音网页版个人主页格式：
      // 头像下方显示：关注  粉丝  获赞  以及作品数量

      // 尝试多种正则
      const patterns = [
        [/关注\s+(\d+)/, 'following'],
        [/粉丝\s+(\d+)/, 'followers'],
        [/获赞\s+(\d[\d,]*)/, 'totalLikes'],
        [/喜欢\s+(\d[\d,]*)/, 'totalLikes'], // 新版可能用"喜欢"
        [/作品\s*(\d+)/, 'videoCount'],
        [/(\d+)\s*作品/, 'videoCount'],
        [/作品.*?(\d+)/, 'videoCount'],
      ]

      for (const [p, label] of patterns) {
        const m = allText.match(p as RegExp)
        if (m) result[label] = m[1]
      }

      // 尝试从 meta 标签或 JSON-LD 获取
      const scripts = document.querySelectorAll('script[type="application/ld+json"]')
      scripts.forEach((s: any) => {
        try {
          const j = JSON.parse(s.textContent)
          if (j.name) result.nickname = j.name
        } catch (_) {}
      })

      result.rawSnippet = allText.substring(0, 2000)
      return result
    })

    log(`网页版解析结果: ${JSON.stringify(data).substring(0, 300)}`)
    return normalizeProfileData(data, log)
  } catch (e: any) {
    log(`网页版解析异常: ${e.message}`)
    return null
  }
}

/**
 * 将原始字符串转换为数字
 * 支持：12500 / 12,500 / 89.2w / 10.5万 等中文计数格式
 */
function parseChineseNumber(raw: string | undefined): number {
  if (!raw) return 0
  const cleaned = raw.replace(/,/g, '').trim()

  // 中文万/ w 单位
  const wanMatch = cleaned.match(/^([\d.]+)\s*[wW万]$/)
  if (wanMatch) return Math.round(parseFloat(wanMatch[1]) * 10000)

  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : Math.round(num)
}

/**
 * 统一标准化各来源的解析结果
 */
function normalizeProfileData(raw: Record<string, any>, log: LogFn): ProfileData {
  const profile: ProfileData = { success: false }

  const get = (key: string): string => raw[key] || raw[key + '_raw'] || ''

  profile.followers = parseChineseNumber(get('粉丝') || get('followers'))
  profile.following = parseChineseNumber(get('关注') || get('following'))
  profile.totalLikes = parseChineseNumber(get('获赞') || get('总获赞') || get('totalLikes') || get('喜欢'))
  profile.videoCount = parseChineseNumber(get('作品') || get('作品数') || get('视频') || get('videoCount'))
  profile.nickname = raw.nickname || ''

  // 至少有一个有效数据就算成功
  const hasData = profile.followers > 0 || profile.videoCount > 0 || profile.totalLikes > 0
  profile.success = hasData

  if (hasData) {
    log(`✅ 数据提取成功 → 粉丝:${profile.followers} 关注:${profile.following} 获赞:${profile.totalLikes} 作品:${profile.videoCount}`)
  } else {
    log(`⚠️ 未提取到有效数值，原始片段: ${raw.rawSnippet?.substring(0, 100)}`)
  }

  profile.rawText = raw.rawSnippet || ''
  return profile
}

// ════════════════════════════════════
// 主执行函数
// ════════════════════════════════════

async function execute(page: any, _params: Record<string, any>, log: LogFn): Promise<TemplateResult> {
  log('开始采集抖音个人主页数据...')

  let currentUrl = ''
  try { currentUrl = page.url() } catch (_) {}

  // ── Step 1: 导航到创作者中心 ──
  const targetUrl = 'https://creator.douyin.com/creator-micro/home'
  log(`当前页面: ${currentUrl}`)

  if (!currentUrl.includes('creator.douyin.com')) {
    log(`导航到创作者中心: ${targetUrl}`)
    await page.goto(targetUrl, { timeout: 30000, waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(8000) // 创作者中心加载较慢
    log(`已到达: ${page.url()}`)
  } else {
    log('已在抖音创作者平台')
    await page.waitForTimeout(3000)
  }

  // ── Step 2: 关闭弹窗 ──
  for (const text of ['我知道了', '知道了', '确定', '暂不升级', '以后再说', '关闭']) {
    try {
      const btn = await page.$(`text="${text}"`)
      if (btn && await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 2000 })
        log(`关闭弹窗「${text}」`)
        await page.waitForTimeout(800)
      }
    } catch (_) {}
  }

  // ── Step 3: 解析数据（多策略尝试）──

  // 策略A: 创作者中心首页
  let profile = await parseCreatorCenter(page, log)

  // 策略B: 如果创作者中心没拿到数据，尝试网页版个人主页
  if (!profile?.success) {
    log('创作者中心未获取到数据，尝试网页版个人主页...')
    try {
      await page.goto('https://www.douyin.com/user/self', { timeout: 20000, waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(6000)
      profile = await parseWebProfile(page, log)
    } catch (e: any) {
      log(`网页版跳转失败: ${e.message}`)
    }
  }

  // ── Step 4: 返回结果 ──
  if (!profile || !profile.success) {
    log('❌ 所有策略均未提取到有效数据，可能未登录或页面结构变化')
    return {
      success: false,
      message: '未能提取账号数据，请确认已登录抖音创作者平台。原始数据已记录供调试。',
      needConfirm: false,
    }
  }

  // 将结构化数据附加到 message 中（调用方可从 message 解析）
  const summary = `粉丝${profile.followers} · 关注${profile.following} · 获赞${profile.totalLikes} · 作品${profile.videoCount}`
  log(`🎉 采集完成: ${summary}`)

  return {
    success: true,
    message: `数据采集成功: ${summary}`,
    // 通过返回值传递数据（TemplateResult 扩展）
    ...(profile as any),
  }
}

const template: FingerprintTemplate = { meta, params, execute }
export default template
