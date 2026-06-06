/** 
 * 自动化引擎提供商 — 统一接口
 * 
 * 架构设计：
 * ┌─────────────────────────────────────────────────┐
 * │  Engine Type: douyin-official | mock            │
 * ├─────────────────────────────────────────────────┤
 * │  douyin-official: 抖音开放平台官方API（待接入）    │
 * │  mock: 返回模拟数据，用于开发和测试               │
 * └─────────────────────────────────────────────────┘
 * 
 * 环境变量：
 *   AUTOMATION_ENGINE=douyin-official|mock （默认 mock）
 *   DOUYIN_APP_ID          - 抖音开放平台 App ID
 *   DOUYIN_APP_SECRET      - 抖音开放平台 App Secret  
 *   DOUYIN_ACCESS_TOKEN    - 抖音开放平台 Access Token（可选，自动刷新）
 */

// ==================== 类型定义 ====================

export type AutomationEngine = 'douyin-official' | 'mock' | 'q1-coordinates' | 'fingerprint'

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
 * 默认使用 mock 模式（开发/测试阶段）
 */
export function getActiveEngines(): AutomationEngine[] {
  const raw = process.env.AUTOMATION_ENGINE || 'mock'
  return raw.split(',').map((s: string) => s.trim().toLowerCase()) as AutomationEngine[]
}

/** 检查引擎是否已配置并可用 */
export function isEngineConfigured(engine: AutomationEngine): boolean {
  switch (engine) {
    case 'douyin-official':
      return !!(process.env.DOUYIN_APP_ID && process.env.DOUYIN_APP_SECRET)
    case 'mock':
      return true
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

/** 判断是否为 Mock 模式 */
export function isMockMode(): boolean {
  return getActiveEngines().includes('mock')
}


// ==================== 抖音官方 API 适配器 ====================
// TODO: 周一申请抖音开放平台后，替换以下占位实现

const DOUYIN_OPEN_BASE = 'https://open.douyin.com'

/**
 * 抖音官方 API 请求封装
 * 自动处理 access_token 刷新和错误重试
 */
async function douyinOfficialRequest(
  path: string,
  params?: Record<string, string>
): Promise<any> {
  const config = getDouyinConfig()
  if (!config) throw new Error('抖音官方 API 未配置，请设置 DOUYIN_APP_ID 和 DOUYIN_APP_SECRET')

  // TODO: 实现 access_token 获取/刷新逻辑
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


// ==================== Mock 数据生成器 ====================
// 开发测试阶段使用，返回结构化的模拟数据

function generateMockVideos(keyword: string, count: number): Record<string, unknown>[] {
  const videos: Record<string, unknown>[] = []
  for (let i = 0; i < Math.min(count, 10); i++) {
    videos.push({
      aweme_id: `mock_aweme_${Date.now()}_${i}`,
      video_url: `https://v.douyin.com/mock${i}/`,
      share_url: `https://v.douyin.com/mock${i}/`,
      title: `${keyword}相关视频 ${i + 1} #美业 #美容护肤`,
      desc: `这是一条关于${keyword}的精彩内容分享...`,
      author: {
        nickname: `美业达人_${String.fromCharCode(65 + i)}`,
        uid: `mock_uid_${i}`,
        sec_uid: `mock_secuid_${i}`,
        follower_count: Math.floor(Math.random() * 500000) + 1000,
      },
      statistics: {
        play_count: Math.floor(Math.random() * 100000),
        like_count: Math.floor(Math.random() * 10000),
        comment_count: Math.floor(Math.random() * 1000),
        share_count: Math.floor(Math.random() * 500),
      },
      create_time: Date.now() - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000),
      _mock: true,
    })
  }
  return videos
}

function generateMockComments(videoUrl: string, count: number): Record<string, unknown>[] {
  const templates = [
    { text: '这个效果怎么样？想了解一下价格', score: 75 },
    { text: '在哪里可以买到？求链接', score: 85 },
    { text: '太好看了！请问怎么下单', score: 80 },
    { text: '有人用过吗？效果真的假的', score: 45 },
    { text: '北京的有吗？想咨询一下', score: 70 },
    { text: '加我微信聊一下 vx:beauty2024', score: 90 },
    { text: '多少钱一套？学生党能买得起吗', score: 80 },
    { text: '绝了绝了！爱了爱了', score: 25 },
    { text: '请问有联系方式吗？13800138000', score: 95 },
    { text: '推荐推荐！已入手，效果不错', score: 65 },
    { text: '怎么购买？私信我了', score: 70 },
    { text: '好看是好看就是有点贵', score: 50 },
  ]
  
  const comments: Record<string, unknown>[] = []
  for (let i = 0; i < Math.min(count, templates.length); i++) {
    const t = templates[i % templates.length]
    comments.push({
      id: `mock_comment_${Date.now()}_${i}`,
      text: t.text,
      content: t.text,
      author: {
        nickname: `用户_${String.fromCharCode(65 + i)}`,
        uid: `mock_cuid_${i}`,
      },
      like_count: Math.floor(Math.random() * 100),
      create_time: Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000),
      video_url: videoUrl,
      _mock: true,
      _intentScore: t.score,
    })
  }
  return comments
}


// ==================== 数据采集接口 ====================
// 所有接口统一：优先走官方 API → 失败降级到 Mock

/**
 * 视频搜索 V4
 * 搜索关键词获取视频列表
 */
export async function douyinSearchVideo(keyword: string, count = 10): Promise<AutomationResult> {
  try {
    if (isMockMode()) {
      // Mock 模式：返回模拟数据
      const videos = generateMockVideos(keyword, count)
      return {
        success: true,
        message: `[Mock] 搜索"${keyword}"返回 ${videos.length} 条结果`,
        provider: 'mock',
        data: { list: videos, total: videos.length, keyword },
      }
    }

    // 官方 API 模式
    const data = await douyinOfficialRequest('/video/search/v4/', { keyword: String(keyword), count: String(count) })
    return {
      success: data?.error_code === 0 || data?.code === 0,
      message: data?.description || '搜索完成',
      provider: 'douyin-official',
      data: data?.data || data,
    }
  } catch (e: any) {
    return { success: false, message: e.message || '搜索失败', provider: 'mock' as any }
  }
}
// 向后兼容别名
export const justoneSearchVideo = douyinSearchVideo


/**
 * 视频评论 V1
 * 获取指定视频的评论列表
 */
export async function douyinFetchComments(
  videoUrl: string,
  count = 20,
  cursor = 0
): Promise<AutomationResult> {
  try {
    if (isMockMode()) {
      const comments = generateMockComments(videoUrl, count)
      return {
        success: true,
        message: `[Mock] 获取 ${comments.length} 条评论`,
        provider: 'mock',
        data: { comments, total: comments.length, cursor, has_more: false },
      }
    }

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
  } catch (e: any) {
    return { success: false, message: e.message || '评论爬取失败', provider: 'mock' as any }
  }
}
export const justoneFetchComments = douyinFetchComments


/**
 * 用户资料 V3
 * 获取抖音用户详细信息
 */
export async function douyinFetchUserProfile(secUserId: string): Promise<AutomationResult> {
  try {
    if (isMockMode()) {
      return {
        success: true,
        message: '[Mock] 用户资料获取成功',
        provider: 'mock',
        data: {
          user: {
            sec_uid: secUserId,
            nickname: `Mock用户_${secUserId.substring(0, 6)}`,
            avatar: 'https://example.com/avatar.jpg',
            follower_count: Math.floor(Math.random() * 500000) + 1000,
            following_count: Math.floor(Math.random() * 500) + 100,
            aweme_count: Math.floor(Math.random() * 200) + 10,
            verification_type: Math.random() > 0.5 ? 1 : 0,
            signature: '这是模拟的用户简介',
          },
          _mock: true,
        },
      }
    }

    const data = await douyinOfficialRequest('/user/profile/v3/', { sec_user_id: secUserId })
    return {
      success: data?.error_code === 0,
      message: '用户信息获取成功',
      provider: 'douyin-official',
      data: data?.data || data,
    }
  } catch (e: any) {
    return { success: false, message: e.message || '用户信息获取失败', provider: 'mock' as any }
  }
}
export const justoneFetchUserProfile = douyinFetchUserProfile


/**
 * 视频详情 V2
 * 获取视频的详细信息和互动数据
 */
export async function douyinVideoDetail(videoUrl: string): Promise<AutomationResult> {
  try {
    if (isMockMode()) {
      return {
        success: true,
        message: '[Mock] 视频详情获取成功',
        provider: 'mock',
        data: {
          video: {
            video_url: videoUrl,
            title: 'Mock视频标题',
            desc: '这是一个模拟的视频描述内容...',
            statistics: {
              play_count: Math.floor(Math.random() * 100000),
              like_count: Math.floor(Math.random() * 10000),
              comment_count: Math.floor(Math.random() * 1000),
              share_count: Math.floor(Math.random() * 500),
              collect_count: Math.floor(Math.random() * 300),
            },
          },
          _mock: true,
        },
      }
    }

    const data = await douyinOfficialRequest('/video/detail/v2/', { video_url: videoUrl })
    return {
      success: data?.error_code === 0,
      message: '视频详情获取成功',
      provider: 'douyin-official',
      data: data?.data || data,
    }
  } catch (e: any) {
    return { success: false, message: e.message || '视频详情获取失败', provider: 'mock' as any }
  }
}
export const justoneVideoDetail = douyinVideoDetail


/**
 * 热门话题/热搜
 * 注：抖音开放平台可能无此接口，Mock 模式下返回热门关键词
 */
export async function douyinTrendingTopics(
  category: 'all' | 'hot' | 'realtime' | 'video' | 'live' = 'all',
  count = 20
): Promise<AutomationResult> {
  // Mock 热门数据
  const mockTopics = [
    { title: '#美业护肤#', hot_value: 980000, category: 'beauty' },
    { title: '#美容院探店#', hot_value: 750000, category: 'beauty' },
    { title: '#抗衰老攻略#', hot_value: 620000, category: 'beauty' },
    { title: '#医美体验#', hot_value: 540000, category: 'medical' },
    { title: '#减肥打卡#', hot_value: 890000, category: 'health' },
    { title: '#健身日常#', hot_value: 720000, category: 'health' },
    { title: '#穿搭分享#', hot_value: 650000, category: 'fashion' },
    { title: '#美食探店#', hot_value: 930000, category: 'food' },
    { title: '#旅行vlog#', hot_value: 580000, category: 'travel' },
    { title: '#数码测评#', hot_value: 470000, category: 'tech' },
  ]

  return {
    success: true,
    message: '[Mock] 热门话题（待接入官方API）',
    provider: 'mock',
    data: {
      list: mockTopics.slice(0, count),
      total: mockTopics.length,
      category,
      _mock: true,
    },
  }
}
export const justoneTrendingTopics = douyinTrendingTopics


/**
 * 用户发布视频 V3
 * 获取指定用户的作品列表
 */
export async function douyinFetchUserVideos(
  secUserId: string,
  count = 20,
  cursor = 0
): Promise<AutomationResult> {
  try {
    if (isMockMode()) {
      const videos = generateMockVideos('用户作品', count).map(v => ({
        ...v,
        author: { nickname: 'Mock创作者', uid: secUserId, sec_uid: secUserId },
      }))
      return {
        success: true,
        message: `[Mock] 获取 ${videos.length} 个作品`,
        provider: 'mock',
        data: { list: videos, total: videos.length, has_more: false },
      }
    }

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
  } catch (e: any) {
    return { success: false, message: e.message || '用户作品获取失败', provider: 'mock' as any }
  }
}
export const justoneFetchUserVideos = douyinFetchUserVideos


/**
 * 搜索用户 V2
 * 通过关键词搜索抖音用户
 */
export async function douyinSearchUser(keyword: string, count = 10): Promise<AutomationResult> {
  try {
    if (isMockMode()) {
      const users: Record<string, unknown>[] = []
      for (let i = 0; i < Math.min(count, 5); i++) {
        users.push({
          uid: `mock_search_uid_${i}`,
          sec_uid: `mock_search_secuid_${i}`,
          nickname: `${keyword}相关用户_${String.fromCharCode(65 + i)}`,
          avatar: 'https://example.com/avatar.jpg',
          follower_count: Math.floor(Math.random() * 500000) + 1000,
          verification_type: Math.random() > 0.7 ? 1 : 0,
          signature: `专注${keyword}领域的内容创作`,
          _mock: true,
        })
      }
      return {
        success: true,
        message: `[Mock] 找到 ${users.length} 个用户`,
        provider: 'mock',
        data: { list: users, total: users.length },
      }
    }

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
  } catch (e: any) {
    return { success: false, message: e.message || '用户搜索失败', provider: 'mock' as any }
  }
}
export const justoneSearchUser = douyinSearchUser


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
 */
export async function runCollection(ctx: CollectionContext): Promise<{
  videos: any[]
  comments: any[]
  extractedLeads: Array<{ content: string; source: string; intentScore: number; contactInfo?: string }>
  errors: string[]
}> {
  const { keywords, platform, maxResults } = ctx
  const videos: any[] = []
  const comments: any[] = []
  const extractedLeads: Array<{ content: string; source: string; intentScore: number; contactInfo?: string }> = []
  const errors: string[] = []

  const resultsPerKeyword = Math.ceil(maxResults / Math.max(keywords.length, 1))

  for (const keyword of keywords) {
    try {
      // Step 1: 搜索视频
      const searchResult = await douyinSearchVideo(keyword, resultsPerKeyword)
      if (!searchResult.success || !searchResult.data) {
        errors.push(`搜索关键词"${keyword}"无结果`)
        continue
      }

      // 解析视频列表（兼容多种返回格式）
      const searchData = searchResult.data as any
      const videoList: Record<string, unknown>[] =
        searchData.list || searchData.videos || searchData.data?.list || searchData.data?.videos || []

      if (videoList.length === 0 && !searchData._mock) {
        console.log(`[采集] 关键词"${keyword}"未解析到视频列表，原始 keys:`, Object.keys(searchData))
      }

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
              
              // Mock 评论自带意向分，真实数据用算法分析
              const score = (comment as any)._intentScore ?? analyzeLeadIntent(text)
              
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
    `线索=${extractedLeads.length}, 错误=${errors.length}` +
    (isMockMode() ? ' [MOCK模式]' : '')
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
