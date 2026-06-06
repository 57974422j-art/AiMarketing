/** 
 * 自动化引擎提供商 — 统一接口
 * 
 * 架构设计：
 * ┌─────────────────────────────────────────────────┐
 * │  Engine Type: douyin-official | mediacrawler    │
 * ├─────────────────────────────────────────────────┤
 * │  douyin-official: 抖音开放平台官方API（待接入）    │
 * │  mediacrawler: MediaCrawler 爬虫服务（待部署）   │
 * └─────────────────────────────────────────────────┘
 * 
 * 当前状态：数据采集功能依赖 MediaCrawler 服务。
 * 在 MediaCrawler 部署完成前，以下接口返回 "未配置" 提示，
 * 不再返回任何假数据（旧 Mock 已全部移除）。
 * 
 * 环境变量：
 *   DOUYIN_APP_ID          - 抖音开放平台 App ID（可选，企业资质申请后使用）
 *   DOUYIN_APP_SECRET      - 抖音开放平台 App Secret
 *   MEDIACRAWLER_URL       - MediaCrawler 服务地址（如 http://127.0.0.1:8000）
 */

// ==================== 类型定义 ====================

export type AutomationEngine = 'douyin-official' 'mediacrawler' | 'q1-coordinates' | 'fingerprint'

export interface AutomationResult {
  success: boolean
  message: string
  provider: AutomationEngine
  data?: Record<string, unknown>
}

/** 抖音开放平台配置 */
export interface DouyinConfig {
  appId: string
  appSecret: string
  accessToken?: string
}

// ==================== 引擎管理 ====================

/**
 * 获取当前活跃的数据采集引擎列表
 */
export function getActiveEngines(): AutomationEngine[] {
  const raw = process.env.AUTOMATION_ENGINE || ''
  if (!raw) return []
  return raw.split(',').map((s: string) => s.trim().toLowerCase()) as AutomationEngine[]
}

/** 检查引擎是否已配置并可用 */
export function isEngineConfigured(engine: AutomationEngine): boolean {
  switch (engine) {
    case 'douyin-official':
      return !!(process.env.DOUYIN_APP_ID && process.env.DOUYIN_APP_SECRET)
    case 'mediacrawler':
      return !!process.env.MEDIACRAWLER_URL
    case 'q1-coordinates': case 'fingerprint':
      return true
    default:
      return false
  }
}

/** 获取抖音官方 API 配置 */
export function getDouyinConfig(): DouyinConfig | null {
  const appId = process.env.DOUYIN_APP_ID
  const appSecret = process.env.DOUYIN_APP_SECRET
  if (!appId || !appSecret) return null
  return {
    appId,
    appSecret,
    accessToken: process.env.DOUYIN_ACCESS_TOKEN || undefined,
  }
}


// ==================== 抖音官方 API 适配器 ====================
// TODO: 申请抖音开放平台资质后激活此模块

const DOUYIN_OPEN_BASE = 'https://open.douyin.com'

async function douyinOfficialRequest(
  path: string,
  params?: Record<string, string>
): Promise<any> {
  const config = getDouyinConfig()
  if (!config) throw new Error('抖音官方 API 未配置，请设置 DOUYIN_APP_ID 和 DOUYIN_APP_SECRET')

  const token = config.accessToken || ''

  const searchParams = new URLSearchParams(params || {})
  if (token) searchParams.set('access_token', token)

  const url = `${DOUYIN_OPEN_BASE}${path}?${searchParams.toString()}`
  console.log(`[Douyin Official] GET ${url}`)

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  })

  return await res.json()
}


// ==================== 数据采集接口 ====================
// 所有接口统一：优先走 MediaCrawler → 再尝试 Douyin Official → 返回提示信息


/**
 * 视频搜索
 * 搜索关键词获取视频列表
 */
export async function douyinSearchVideo(keyword: string, count = 10): Promise<AutomationResult> {
  try {
    // 优先尝试抖音官方 API
    if (isEngineConfigured('douyin-official')) {
      const data = await douyinOfficialRequest('/video/search/v4/', { keyword: String(keyword), count: String(count) })
      return {
        success: data?.error_code === 0 || data?.code === 0,
        message: data?.description || '搜索完成',
        provider: 'douyin-official',
        data: data?.data || data,
      }
    }

    // 未配置任何数据源
    return {
      success: false,
      message: `视频搜索暂不可用：请配置 MediaCrawler 服务或抖音官方 API。关键词: "${keyword}"`,
      provider: 'douyin-official',
      data: { keyword, note: '需部署 MediaCrawler 或配置 DOUYIN_APP_ID/DOUYIN_APP_SECRET' },
    }
  } catch (e: any) {
    return { success: false, message: e.message || '搜索失败', provider: 'douyin-official' as any }
  }
}


/**
 * 视频评论
 * 获取指定视频的评论列表
 */
export async function douyinFetchComments(
  videoUrl: string,
  count = 20,
  cursor = 0
): Promise<AutomationResult> {
  try {
    if (isEngineConfigured('douyin-official')) {
      const data = await douyinOfficialRequest('/comment/list/v1/', {
        video_url: videoUrl,
        count: String(Math.min(count, 100)),
        cursor: String(cursor),
      })
      return {
        success: data?.error_code === 0 || data?.code === 0,
        message: `获取 ${data?.data?.comments?.length || 0} 条评论`,
        provider: 'douyin-official',
        data: data?.data || data,
      }
    }

    return {
      success: false,
      message: `评论爬取暂不可用：请部署 MediaCrawler 服务。`,
      provider: 'douyin-official',
      data: { video_url: videoUrl, note: '需部署 MediaCrawler' },
    }
  } catch (e: any) {
    return { success: false, message: e.message || '评论爬取失败', provider: 'douyin-official' as any }
  }
}


/**
 * 用户资料
 * 获取抖音用户详细信息
 */
export async function douyinFetchUserProfile(secUserId: string): Promise<AutomationResult> {
  try {
    if (isEngineConfigured('douyin-official')) {
      const data = await douyinOfficialRequest('/user/profile/v3/', { sec_user_id: secUserId })
      return {
        success: data?.error_code === 0,
        message: '用户信息获取成功',
        provider: 'douyin-official',
        data: data?.data || data,
      }
    }

    return {
      success: false,
      message: `用户资料查询暂不可用：请部署 MediaCrawler 服务。`,
      provider: 'douyin-official',
      data: { sec_uid: secUserId, note: '需部署 MediaCrawler' },
    }
  } catch (e: any) {
    return { success: false, message: e.message || '用户信息获取失败', provider: 'douyin-official' as any }
  }
}


/**
 * 视频详情
 * 获取视频的详细信息和互动数据
 */
export async function douyinVideoDetail(videoUrl: string): Promise<AutomationResult> {
  try {
    if (isEngineConfigured('douyin-official')) {
      const data = await douyinOfficialRequest('/video/detail/v2/', { video_url: videoUrl })
      return {
        success: data?.error_code === 0,
        message: '视频详情获取成功',
        provider: 'douyin-official',
        data: data?.data || data,
      }
    }

    return {
      success: false,
      message: `视频详情查询暂不可用：请部署 MediaCrawler 服务。`,
      provider: 'douyin-official',
      data: { video_url: videoUrl, note: '需部署 MediaCrawler' },
    }
  } catch (e: any) {
    return { success: false, message: e.message || '视频详情获取失败', provider: 'douyin-official' as any }
  }
}


/**
 * 热门话题/热搜
 * 注：此功能建议通过 AI 分析生成，或接入第三方热搜 API
 */
export async function douyinTrendingTopics(
  category: 'all' | 'hot' | 'realtime' | 'video' | 'live' = 'all',
  count = 20
): Promise<AutomationResult> {
  // 热门话题目前无稳定的外部数据源
  // 建议：后续通过 MediaCrawler 的 trending 接口或 AI 生成替代
  return {
    success: false,
    message: `热门话题功能待接入：请部署 MediaCrawler 或使用 AI 生成的行业简报。`,
    provider: 'douyin-official',
    data: { category, count, note: '需部署 MediaCrawler 或查看 /admin/briefings' },
  }
}


/**
 * 用户发布视频列表
 * 获取指定用户的作品列表
 */
export async function douyinFetchUserVideos(
  secUserId: string,
  count = 20,
  cursor = 0
): Promise<AutomationResult> {
  try {
    if (isEngineConfigured('douyin-official')) {
      const data = await douyinOfficialRequest('/user/videos/v3/', {
        sec_user_id: secUserId,
        count: String(Math.min(count, 50)),
        cursor: String(cursor),
      })
      return {
        success: data?.error_code === 0,
        message: `获取 ${data?.data?.videos?.length || 0} 个作品`,
        provider: 'douyin-official',
        data: data?.data || data,
      }
    }

    return {
      success: false,
      message: `用户作品查询暂不可用：请部署 MediaCrawler 服务。`,
      provider: 'douyin-official',
      data: { sec_uid: secUserId, note: '需部署 MediaCrawler' },
    }
  } catch (e: any) {
    return { success: false, message: e.message || '用户作品获取失败', provider: 'douyin-official' as any }
  }
}


/**
 * 搜索用户
 * 通过关键词搜索抖音用户
 */
export async function douyinSearchUser(keyword: string, count = 10): Promise<AutomationResult> {
  try {
    if (isEngineConfigured('douyin-official')) {
      const data = await douyinOfficialRequest('/user/search/v2/', {
        keyword,
        count: String(count),
      })
      return {
        success: data?.error_code === 0,
        message: `找到 ${data?.data?.users?.length || 0} 个用户`,
        provider: 'douyin-official',
        data: data?.data || data,
      }
    }

    return {
      success: false,
      message: `用户搜索暂不可用：请部署 MediaCrawler 服务。`,
      provider: 'douyin-official',
      data: { keyword, note: '需部署 MediaCrawler' },
    }
  } catch (e: any) {
    return { success: false, message: e.message || '用户搜索失败', provider: 'douyin-official' as any }
  }
}


// ==================== 批量采集引擎（Phase 1 核心）====================

export interface CollectionContext {
  keywords: string[]
  platform: string
  maxResults: number
  ownerId: number
  taskId?: number
}

/**
 * 执行一次自动采集任务的完整流程：
 * 1. 用每个关键词搜索视频
 * 2. 对每个视频获取详情
 * 3. 获取视频评论
 * 4. 从评论中分析提取高意向线索
 * 5. 返回结构化结果（由调用方写入数据库）
 *
 * 注意：在 MediaCrawler 部署前，此函数会因无数据源而返回空结果 + 错误提示
 */
export async function runCollection(ctx: CollectionContext): Promise<{
  videos: any[]
  comments: any[]
  extractedLeads: Array<{ content: string; source: string; intentScore: number; contactInfo?: string }>
  errors: string[]
}> {
  const { keywords, maxResults } = ctx
  const errors: string[] = []

  // 快速检查是否有可用的数据源
  const hasSource = isEngineConfigured('douyin-official') || isEngineConfigured('mediacrawler')
  if (!hasSource) {
    errors.push('无可用的数据采集源。请部署 MediaCrawler 服务（推荐）或配置抖音官方 API。')
    return { videos: [], comments: [], extractedLeads: [], errors }
  }

  const resultsPerKeyword = Math.ceil(maxResults / Math.max(keywords.length, 1))
  const videos: any[] = []
  const comments: any[] = []
  const extractedLeads: Array<{ content: string; source: string; intentScore: number; contactInfo?: string }> = []

  for (const keyword of keywords) {
    try {
      // Step 1: 搜索视频
      const searchResult = await douyinSearchVideo(keyword, resultsPerKeyword)
      if (!searchResult.success || !searchResult.data) {
        errors.push(`搜索关键词"${keyword}"无结果: ${searchResult.message}`)
        continue
      }

      // 解析视频列表（兼容多种返回格式）
      const searchData = searchResult.data as any
      const videoList: Record<string, unknown>[] =
        searchData.list || searchData.videos || searchData.data?.list || searchData.data?.videos || []

      for (const video of videoList.slice(0, resultsPerKeyword)) {
        const videoUrl = String(video.video_url || video.share_url || video.aweme_id || '')
        if (!videoUrl) continue

        videos.push(video)

        // Step 2: 获取视频详情
        try {
          const detailResult = await douyinVideoDetail(videoUrl)
          if (detailResult.success && detailResult.data) {
            Object.assign(video, detailResult.data)
          }
        } catch (e: any) {
          errors.push(`视频${videoUrl}详情失败: ${e.message}`)
        }

        // Step 3: 获取评论
        try {
          const commentResult = await douyinFetchComments(videoUrl, 10)
          if (commentResult.success && commentResult.data) {
            const commentList: Record<string, unknown>[] =
              (commentResult.data as any).comments || []
            comments.push(...commentList)

            // Step 4: 从评论中提取高意向线索
            for (const comment of commentList) {
              const text = String(comment.text || comment.content || '')
              const score = analyzeLeadIntent(text)

              if (score >= 60) {
                extractedLeads.push({
                  content: text,
                  source: `视频:${videoUrl}`,
                  intentScore: score,
                  contactInfo: extractContactInfo(text),
                })
              }
            }
          }
        } catch (e: any) {
          errors.push(`视频${videoUrl}评论失败: ${e.message}`)
        }

        // 控制请求频率
        await new Promise(r => setTimeout(r, 300))
      }
    } catch (e: any) {
      errors.push(`关键词"${keyword}"异常: ${e.message}`)
    }
  }

  console.log(
    `[采集完成] 视频=${videos.length}, 评论=${comments.length}, ` +
    `线索=${extractedLeads.length}, 错误=${errors.length}`
  )

  return { videos, comments, extractedLeads, errors }
}


// ==================== 线索分析工具函数 ====================

/**
 * 分析文本中的购买/咨询意向（0-100 分）
 * 用于从评论中筛选出潜在客户
 */
function analyzeLeadIntent(text: string): number {
  if (!text) return 0
  let score = 0

  // 强意向关键词 (+30)
  const highIntent = ['怎么买', '在哪里买', '多少钱', '价格', '链接', '怎么下单', '想买', '求购', '哪里有卖', '购买', '下单']
  // 中意向关键词 (+15)
  const midIntent = ['好用吗', '效果怎么样', '推荐吗', '有人用过吗', '真的假的', '种草', '想要', '需要', '不错', '喜欢']
  // 弱意向关键词 (+5)
  const lowIntent = ['好看', '漂亮', '厉害', '牛', '绝了', '爱了']

  for (const kw of highIntent) { if (text.includes(kw)) score += 30 }
  for (const kw of midIntent) { if (text.includes(kw)) score += 15 }
  for (const kw of lowIntent) { if (text.includes(kw)) score += 5 }

  // 包含联系方式加分
  if (/[\d]{11}|微信|加我|私|VX|vx|QQ/.test(text)) score += 20
  // 地域词加分（本地客户）
  if (/(北京|上海|广州|深圳|杭州|成都|武汉|南京|重庆|西安)[市县]?/.test(text)) score += 10

  return Math.min(score, 100)
}

/**
 * 从文本中提取可能的联系方式
 * 返回 JSON 字符串或空字符串
 */
function extractContactInfo(text: string): string {
  const phoneMatch = text.match(/1[3-9]\d{9}/)
  if (phoneMatch) return JSON.stringify({ phone: phoneMatch[0] })

  const wechatMatch = text.match(/微信[:\s]*([a-zA-Z0-9_-]+)/i)
  if (wechatMatch) return JSON.stringify({ wechat: wechatMatch[1] })

  return ''
}
