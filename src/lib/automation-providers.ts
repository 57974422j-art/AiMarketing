/** 
 * 自动化引擎提供商 — 统一接口
 * Phase 1 扩展：完整 JustOneAPI 数据采集能力
 */
export type AutomationEngine = 'justoneapi' | 'q1-coordinates' | 'tiktokdownloader'
export interface AutomationResult { success: boolean; message: string; provider: AutomationEngine; data?: Record<string, unknown> }

export function getActiveEngines(): AutomationEngine[] {
  const raw = process.env.AUTOMATION_ENGINE || 'justoneapi'
  return raw.split(',').map((s: string) => s.trim().toLowerCase()) as AutomationEngine[]
}
export function getJustoneToken(): string | null { return process.env.JUSTONEAPI_TOKEN || null }
export function isEngineConfigured(engine: AutomationEngine): boolean {
  switch (engine) {
    case 'justoneapi': return !!getJustoneToken()
    case 'q1-coordinates': case 'tiktokdownloader': return true; default: return false
  }
}

// ==================== JustOneAPI 基础设施 ====================

const JUSTONE_BASE = 'https://api.justoneapi.com'

/** JustOneAPI 通用请求方法 */
async function justonePost(path: string, body: Record<string, unknown>): Promise<any> {
  const token = getJustoneToken()
  if (!token) throw new Error('JUSTONEAPI_TOKEN 未配置')
  const res = await fetch(JUSTONE_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const data = await res.json()
  if (data.code !== 0 && data.code !== 200) {
    console.error(`[JustOneAPI] ${path} 返回错误:`, JSON.stringify(data).substring(0, 300))
  }
  return data
}

/** JustOneAPI GET 请求（部分接口用 GET） */
async function justoneGet(path: string): Promise<any> {
  const token = getJustoneToken()
  if (!token) throw new Error('JUSTONEAPI_TOKEN 未配置')
  const res = await fetch(JUSTONE_BASE + path, {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token },
    signal: AbortSignal.timeout(30000),
  })
  return await res.json()
}

// ==================== 抖音视频搜索（已有）====================

export async function justoneSearchVideo(keyword: string, count = 10): Promise<AutomationResult> {
  try {
    const data = await justonePost('/douyin/video/search/v4', { keyword, count })
    return { success: true, message: 'ok', provider: 'justoneapi', data: data.data || data }
  } catch (e: any) {
    return { success: false, message: e.message || '搜索失败', provider: 'justoneapi' }
  }
}

// ==================== 抖音评论爬取（Phase 1 新增）====================

/**
 * 获取抖音视频评论列表
 * @param videoUrl 抖音视频分享链接或视频ID
 * @param count 评论数量，默认 20，最大 100
 * @param cursor 分页游标，用于翻页
 */
export async function justoneFetchComments(
  videoUrl: string,
  count = 20,
  cursor = 0
): Promise<AutomationResult> {
  try {
    const data = await justonePost('/douyin/comment/list', {
      video_url: videoUrl,
      count: Math.min(count, 100),
      cursor,
    })
    return {
      success: true,
      message: `获取到 ${data.data?.comments?.length || 0} 条评论`,
      provider: 'justoneapi',
      data: data.data || data,
    }
  } catch (e: any) {
    return { success: false, message: e.message || '评论爬取失败', provider: 'justoneapi' }
  }
}

// ==================== 抖音用户画像（Phase 1 新增）====================

/**
 * 获取抖音用户详细信息（头像、昵称、粉丝数、作品数等）
 * @param secUserId 抖音用户 sec_uid 或分享链接
 */
export async function justoneFetchUserProfile(secUserId: string): Promise<AutomationResult> {
  try {
    const data = await justonePost('/douyin/user/profile', {
      sec_user_id: secUserId,
    })
    return {
      success: true,
      message: '用户信息获取成功',
      provider: 'justoneapi',
      data: data.data || data,
    }
  } catch (e: any) {
    return { success: false, message: e.message || '用户信息获取失败', provider: 'justoneapi' }
  }
}

// ==================== 抖音视频详情（Phase 1 新增）====================

/**
 * 获取抖音视频详细信息（播放量、点赞数、评论数、分享数等）
 * @param videoUrl 抖音视频分享链接或视频ID
 */
export async function justoneVideoDetail(videoUrl: string): Promise<AutomationResult> {
  try {
    const data = await justonePost('/douyin/video/detail', {
      video_url: videoUrl,
    })
    return {
      success: true,
      message: '视频详情获取成功',
      provider: 'justoneapi',
      data: data.data || data,
    }
  } catch (e: any) {
    return { success: false, message: e.message || '视频详情获取失败', provider: 'justoneapi' }
  }
}

// ==================== 抖音热门话题/热搜（Phase 1 新增）====================

/**
 * 获取抖音热门话题或热搜榜单
 * @category 类别：all(综合)/hot(热榜)/realtime(实时)/video(视频)/live(直播)
 * @param count 数量，默认 20
 */
export async function justoneTrendingTopics(
  category: 'all' | 'hot' | 'realtime' | 'video' | 'live' = 'all',
  count = 20
): Promise<AutomationResult> {
  try {
    // 尝试热搜接口，如果失败降级为搜索热门关键词
    let data: any
    try {
      data = await justonePost('/douyin/hot/trend', { category, count })
    } catch {
      // 备用：通过搜索接口模拟热门话题
      data = await justonePost('/douyin/hot/search', { count })
    }
    return {
      success: true,
      message: `获取到 ${data.data?.list?.length || data.data?.length || 0} 个热门话题`,
      provider: 'justoneapi',
      data: data.data || data,
    }
  } catch (e: any) {
    return { success: false, message: e.message || '热门话题获取失败', provider: 'justoneapi' }
  }
}

// ==================== 抖音用户作品列表（Phase 1 新增）====================

/**
 * 获取指定用户的发布作品列表
 * @param secUserId 抖音用户 sec_uid
 * @param count 作品数量，默认 20
 * @param cursor 分页游标
 */
export async function justoneFetchUserVideos(
  secUserId: string,
  count = 20,
  cursor = 0
): Promise<AutomationResult> {
  try {
    const data = await justonePost('/douyin/user/videos', {
      sec_user_id: secUserId,
      count: Math.min(count, 50),
      cursor,
    })
    return {
      success: true,
      message: `获取到 ${data.data?.videos?.length || 0} 个作品`,
      provider: 'justoneapi',
      data: data.data || data,
    }
  } catch (e: any) {
    return { success: false, message: e.message || '用户作品获取失败', provider: 'justoneapi' }
  }
}

// ==================== 抖音搜索用户（Phase 1 新增）====================

/**
 * 搜索抖音用户
 * @param keyword 搜索关键词（用户名/昵称）
 * @param count 结果数量，默认 10
 */
export async function justoneSearchUser(keyword: string, count = 10): Promise<AutomationResult> {
  try {
    const data = await justonePost('/douyin/user/search', { keyword, count })
    return {
      success: true,
      message: `找到 ${data.data?.users?.length || 0} 个用户`,
      provider: 'justoneapi',
      data: data.data || data,
    }
  } catch (e: any) {
    return { success: false, message: e.message || '用户搜索失败', provider: 'justoneapi' }
  }
}

// ==================== 高级：批量采集 + 线索提取（Phase 1 核心）====================

export interface CollectionContext {
  keywords: string[]        // 采集关键词
  platform: string          // 平台
  maxResults: number        // 最大结果数
  ownerId: number           // 任务所有者 ID
  taskId?: number           // 关联的 CollectionTask ID
}

/**
 * 执行一次自动采集任务：
 * 1. 用关键词搜索视频
 * 2. 对每个视频获取详情和评论
 * 3. 从评论中提取高意向线索
 * 4. 返回结构化数据（由调用方决定是否写入 DB）
 */
export async function runCollection(ctx: CollectionContext): Promise<{
  videos: any[]
  comments: any[]
  extractedLeads: Array<{ content: string; source: string; intentScore: number; contactInfo?: string }>
  errors: string[]
}> {
  const { keywords, platform, maxResults, ownerId, taskId } = ctx
  const videos: any[] = []
  const comments: any[] = []
  const extractedLeads: Array<{ content: string; source: string; intentScore: number; contactInfo?: string }> = []
  const errors: string[] = []

  const resultsPerKeyword = Math.ceil(maxResults / Math.max(keywords.length, 1))

  for (const keyword of keywords) {
    try {
      // Step 1: 搜索视频
      const searchResult = await justoneSearchVideo(keyword, resultsPerKeyword)
      if (!searchResult.success || !searchResult.data) {
        errors.push(`搜索关键词"${keyword}"无结果`)
        continue
      }

      const videoList: Record<string, unknown>[] = (searchResult.data as any).list || (searchResult.data as any).videos || []
      
      for (const video of videoList.slice(0, resultsPerKeyword)) {
        const videoUrl = video.video_url || video.share_url || video.aweme_id || ''
        if (!videoUrl) continue

        videos.push(video)

        // Step 2: 获取视频详情
        try {
          const detailResult = await justoneVideoDetail(videoUrl)
          if (detailResult.success && detailResult.data) {
            Object.assign(video, detailResult.data)
          }
        } catch (e: any) {
          errors.push(`视频${videoUrl}详情获取失败: ${e.message}`)
        }

        // Step 3: 获取评论（限制数量避免过多请求）
        try {
          const commentResult = await justoneFetchComments(videoUrl, 10)
          if (commentResult.success && commentResult.data) {
            const commentList = commentResult.data.comments || commentResult.data || []
            comments.push(...commentList)

            // Step 4: 从评论中提取潜在线索
            for (const comment of commentList) {
              const text = comment.text || comment.content || ''
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
          errors.push(`视频${videoUrl}评论获取失败: ${e.message}`)
        }

        // 避免请求过快
        await new Promise(r => setTimeout(r, 500))
      }
    } catch (e: any) {
      errors.push(`关键词"${keyword}"采集异常: ${e.message}`)
    }
  }

  console.log(`[采集完成] 视频=${videos.length}, 评论=${comments.length}, 线索=${extractedLeads.length}, 错误=${errors.length}`)

  return { videos, comments, extractedLeads, errors }
}

// ==================== 线索分析工具函数 ====================

/** 分析文本中的购买/咨询意向（0-100 分） */
function analyzeLeadIntent(text: string): number {
  if (!text) return 0
  let score = 0
  
  // 强意向关键词（+30分）
  const highIntent = ['怎么买', '在哪里买', '多少钱', '价格', '链接', '怎么下单', '想买', '求购', '哪里有卖', '购买', '下单']
  // 中意向关键词（+15分）
  const midIntent = ['好用吗', '效果怎么样', '推荐吗', '有人用过吗', '真的假的', '种草', '想要', '需要', '不错', '喜欢']
  // 弱意向关键词（+5分）
  const lowIntent = ['好看', '漂亮', '厉害', '牛', '绝了', '爱了']

  for (const kw of highIntent) { if (text.includes(kw)) score += 30 }
  for (const kw of midIntent) { if (text.includes(kw)) score += 15 }
  for (const kw of lowIntent) { if (text.includes(kw)) score += 5 }

  // 包含联系方式加分
  if (/[\d]{11}|微信|加我|私|VX|vx|QQ/.test(text)) score += 20
  // 包含地域词加分（说明是本地客户）
  if (/(北京|上海|广州|深圳|杭州|成都|武汉|南京|重庆|西安)[市县]?/.test(text)) score += 10

  return Math.min(score, 100)
}

/** 从文本中提取可能的联系方式 */
function extractContactInfo(text: string): string {
  const phoneMatch = text.match(/1[3-9]\d{9}/)
  if (phoneMatch) return JSON.stringify({ phone: phoneMatch[0] })
  
  const wechatMatch = text.match(/微信[:\s]*([a-zA-Z0-9_-]+)/i)
  if (wechatMatch) return JSON.stringify({ wechat: wechatMatch[1] })

  return ''
}
