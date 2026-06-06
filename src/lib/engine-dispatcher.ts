/**
 * 统一引擎调度器 - Engine Dispatcher
 *
 * 职责划分：
 * ┌─────────────────────────────────────────────────────┐
 * │  读操作 (Read Operations)                           │
 * │  → 视频搜索、评论爬取、用户画像、数据查询             │
 * │  → 引擎：MediaCrawler 爬虫 / 抖音官方API             │
 ├─────────────────────────────────────────────────────┤
 * │  写操作 (Write Operations)                          │
 * │  → 点赞、评论、关注、分享、发布视频、私信            │
 * │  → 引擎：Q1 ADB / 指纹浏览器 / 真机接入             │
 * └─────────────────────────────────────────────────────┘
 *
 * 使用方式：
 * import { dispatchEngine } from '@/lib/engine-dispatcher'
 * const result = await dispatchEngine({ action: 'search', platform: '抖音', params: { keyword: '美业' }, userId: 1 })
 */

import {
  AutomationResult,
  getActiveEngines,
  douyinSearchVideo,
  douyinFetchComments,
  douyinFetchUserProfile,
  douyinVideoDetail,
  douyinTrendingTopics,
  douyinFetchUserVideos,
  douyinSearchUser,
} from './automation-providers'

// ====== 类型定义 ======

export type EngineAction =
  | 'search'              // 视频搜索
  | 'fetch_comments'      // 评论爬取
  | 'fetch_user_profile'  // 用户画像查询
  | 'extract'             // 数据提取（通用）
  | 'like'                // 点赞
  | 'comment'             // 发表评论
  | 'follow'              // 关注
  | 'share'               // 转发/分享
  | 'publish'             // 发布视频
  | 'dm'                  // 私信
  | 'trending_topics'     // 热门话题
  | 'video_detail'        // 视频详情

export interface EngineContext {
  action: EngineAction           // 操作类型
  platform: string               // 平台：抖音/快手/小红书
  params: Record<string, unknown> // 操作参数
  userId: number                 // 执行用户 ID
  deviceId?: number              // 写操作需要设备 ID（可选）
}

// 读操作列表（这些操作会路由到数据查询引擎）
const READ_ACTIONS: Set<EngineAction> = new Set([
  'search',
  'fetch_comments',
  'fetch_user_profile',
  'extract',
  'trending_topics',
  'video_detail'
])

// 写操作列表（这些操作会路由到动作执行引擎）
const WRITE_ACTIONS: Set<EngineAction> = new Set([
  'like',
  'comment',
  'follow',
  'share',
  'publish',
  'dm'
])

/**
 * 判断操作类型是否为读操作
 */
export function isReadAction(action: EngineAction): boolean {
  return READ_ACTIONS.has(action)
}

/**
 * 判断操作类型是否为写操作
 */
export function isWriteAction(action: EngineAction): boolean {
  return WRITE_ACTIONS.has(action)
}

// ====== 主调度函数 ======

/**
 * 统一引擎调度入口
 *
 * 根据操作类型自动选择合适的引擎：
 * - 读操作 → MediaCrawler / 抖音官方 API（需配置 AUTOMATION_ENGINE）
 * - 写操作 → Q1 ADB / 指纹浏览器 / 真机接入
 *
 * @param ctx 引擎上下文（包含操作类型、平台、参数等）
 * @returns 操作结果
 */
export async function dispatchEngine(ctx: EngineContext): Promise<AutomationResult> {
  const { action } = ctx

  // 验证操作类型
  if (!READ_ACTIONS.has(action) && !WRITE_ACTIONS.has(action)) {
    return {
      success: false,
      message: `未知的操作类型: ${action}`,
      provider: 'unknown' as any,
      data: { error: 'INVALID_ACTION' }
    }
  }

  // 路由到对应的处理函数
  if (isReadAction(action)) {
    return await dispatchReadEngine(ctx)
  } else {
    return await dispatchWriteEngine(ctx)
  }
}

// ====== 读操作引擎（数据查询）======

/**
 * 读操作引擎调度
 *
 * 当前支持的数据源：
 * - mediacrawler：MediaCrawler 爬虫服务（推荐）
 * - douyin-official：抖音开放平台官方 API
 *
 * 未配置时返回明确的错误提示，引导用户配置引擎。
 */
async function dispatchReadEngine(ctx: EngineContext): Promise<AutomationResult> {
  const { action, params } = ctx
  const activeEngines = getActiveEngines()

  // 检查是否有可用的数据查询引擎
  if (activeEngines.length === 0) {
    return {
      success: false,
      message: '未配置数据采集引擎。请在 Settings 中设置 AUTOMATION_ENGINE 为 mediacrawler 或 douyin-official，并完成对应服务的部署配置。',
      provider: 'none' as any,
      data: { error: 'NO_READ_ENGINE_CONFIGURED', hint: '设置环境变量 AUTOMATION_ENGINE=mediacrawler 并部署 MediaCrawler 服务' }
    }
  }

  // 根据具体操作类型分发
  switch (action) {
    case 'search':
      return await handleSearch(params)

    case 'fetch_comments':
      return await handleFetchComments(params)

    case 'fetch_user_profile':
      return await handleFetchUserProfile(params)

    case 'trending_topics':
      return await handleTrendingTopics(params)

    case 'video_detail':
      return await handleVideoDetail(params)

    case 'extract':
      return await handleExtract(params)

    default:
      return {
        success: false,
        message: `读操作 ${action} 尚未实现`,
        provider: activeEngines[0] || ('none' as any),
        data: { error: 'NOT_IMPLEMENTED' }
      }
  }
}

// ====== 写操作引擎（动作执行）======

/**
 * 写操作引擎调度
 *
 * 注意：此函数只负责路由，实际执行逻辑在：
 * - src/app/api/devices/[id]/execute/route.ts（Q1 设备）
 * - electron/fp-templates/*.js（指纹浏览器）
 *
 * 写操作必须指定设备 ID，不再有 mock 模式。
 */
async function dispatchWriteEngine(ctx: EngineContext): Promise<AutomationResult> {
  const { action, deviceId, platform, params } = ctx

  // 写操作必须指定设备 ID
  if (!deviceId) {
    return {
      success: false,
      message: '写操作需要指定设备 ID（deviceId）。请先在设备管理中添加 Q1/指纹浏览器/真机设备。',
      provider: 'none' as any,
      data: { error: 'DEVICE_ID_REQUIRED' }
    }
  }

  // 返回引擎配置信息，由调用方决定如何执行
  const { getAutomationConfig } = await import('./automation/config')
  const config = getAutomationConfig()

  return {
    success: true,
    message: `写操作 ${action} 已路由到执行引擎: ${config.engine}`,
    provider: config.engine as any,  // 'fingerprint' | 'real-device' | 'q1-adb'
    data: {
      action,
      platform,
      deviceId,
      engine: config.engine,
      fingerprintBrowser: config.fingerprintBrowser,
      executeEndpoint: `/api/devices/${deviceId}/execute`
    }
  }
}

// ====== 具体的读操作处理器 ======

/**
 * 处理视频搜索
 */
async function handleSearch(params: Record<string, unknown>): Promise<AutomationResult> {
  const keyword = String(params.keyword || '')
  const count = Number(params.count || 10)

  if (!keyword) {
    return {
      success: false,
      message: '缺少搜索关键词（keyword 参数）',
      provider: 'none' as any,
      data: { error: 'MISSING_KEYWORD' }
    }
  }

  return await douyinSearchVideo(keyword, count)
}

/**
 * 处理评论爬取
 */
async function handleFetchComments(params: Record<string, unknown>): Promise<AutomationResult> {
  const videoUrl = String(params.videoUrl || '')
  const count = Number(params.count || 20)

  if (!videoUrl) {
    return {
      success: false,
      message: '缺少视频 URL（videoUrl 参数）',
      provider: 'none' as any,
      data: { error: 'MISSING_VIDEO_URL' }
    }
  }

  return await douyinFetchComments(videoUrl, count)
}

/**
 * 处理用户画像查询
 */
async function handleFetchUserProfile(params: Record<string, unknown>): Promise<AutomationResult> {
  const userId = String(params.userId || params.user_id || params.secUserId || params.sec_user_id || '')

  if (!userId) {
    return {
      success: false,
      message: '缺少用户 ID（userId / secUserId 参数）',
      provider: 'none' as any,
      data: { error: 'MISSING_USER_ID' }
    }
  }

  return await douyinFetchUserProfile(userId)
}

/**
 * 处理热门话题查询
 */
async function handleTrendingTopics(params: Record<string, unknown>): Promise<AutomationResult> {
  const category = (params.category || 'all') as 'all' | 'hot' | 'realtime' | 'video' | 'live'
  const count = Number(params.count || 20)

  return await douyinTrendingTopics(category, count)
}

/**
 * 处理视频详情查询
 */
async function handleVideoDetail(params: Record<string, unknown>): Promise<AutomationResult> {
  const videoUrl = String(params.videoUrl || '')

  if (!videoUrl) {
    return {
      success: false,
      message: '缺少视频 URL（videoUrl 参数）',
      provider: 'none' as any,
      data: { error: 'MISSING_VIDEO_URL' }
    }
  }

  return await douyinVideoDetail(videoUrl)
}

/**
 * 处理通用数据提取
 * 支持模式：
 * - 'collection': 执行完整采集任务（搜索+详情+评论+线索提取）
 * - 'user_videos': 获取指定用户的作品列表
 * - 'search_user': 搜索用户
 */
async function handleExtract(params: Record<string, unknown>): Promise<AutomationResult> {
  const extractType = String(params.extractType || 'general')

  switch (extractType) {
    case 'collection': {
      const { runCollection } = await import('./automation-providers')
      const result = await runCollection({
        keywords: (params.keywords as string[]) || [String(params.keyword || '')].filter(Boolean),
        platform: String(params.platform || 'douyin'),
        maxResults: Number(params.maxResults || 20),
        ownerId: Number(params.ownerId || 0),
        taskId: params.taskId ? Number(params.taskId) : undefined,
      })
      return {
        success: true,
        message: `采集完成: ${result.videos.length}视频, ${result.comments.length}评论, ${result.extractedLeads.length}线索`,
        provider: getActiveEngines()[0] || ('none' as any),
        data: result,
      }
    }

    case 'user_videos': {
      const secUserId = String(params.secUserId || params.userId || '')
      if (!secUserId) {
        return { success: false, message: '缺少用户 ID', provider: 'none' as any, data: { error: 'MISSING_USER_ID' } }
      }
      return await douyinFetchUserVideos(secUserId, Number(params.count || 20))
    }

    case 'search_user': {
      const keyword = String(params.keyword || '')
      if (!keyword) {
        return { success: false, message: '缺少搜索关键词', provider: 'none' as any, data: { error: 'MISSING_KEYWORD' } }
      }
      return await douyinSearchUser(keyword, Number(params.count || 10))
    }

    default:
      return {
        success: false,
        message: `不支持的提取类型: ${extractType}，支持: collection / user_videos / search_user`,
        provider: 'none' as any,
        data: { error: 'UNSUPPORTED_EXTRACT_TYPE', extractType },
      }
  }
}

// ====== 导出工具函数 ======

export type { AutomationResult }

/**
 * 获取所有可用的读操作类型
 */
export function getAvailableReadActions(): EngineAction[] {
  return Array.from(READ_ACTIONS)
}

/**
 * 获取所有可用的写操作类型
 */
export function getAvailableWriteActions(): EngineAction[] {
  return Array.from(WRITE_ACTIONS)
}

/**
 * 获取所有操作类型（读写合并）
 */
export function getAllActions(): EngineAction[] {
  return [...getAvailableReadActions(), ...getAvailableWriteActions()]
}
