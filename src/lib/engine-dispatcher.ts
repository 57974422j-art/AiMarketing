/**
 * 统一引擎调度器 - Engine Dispatcher
 * 
 * 职责划分：
 * ┌─────────────────────────────────────────────────────┐
 * │  读操作 (Read Operations)                           │
 * │  → 视频搜索、评论爬取、用户画像、数据查询             │
 * │  → 引擎：JustOneAPI / 第三方数据平台                 │
 * ├─────────────────────────────────────────────────────┤
 * │  写操作 (Write Operations)                          │
 * │  → 点赞、评论、关注、分享、发布视频、私信            │
 * │  → 引擎：Q1 ADB / 指纹浏览器 / Mock（保持原有逻辑）  │
 * └─────────────────────────────────────────────────────┘
 * 
 * 使用方式：
 * import { dispatchEngine } from '@/lib/engine-dispatcher'
 * const result = await dispatchEngine({ action: 'search', platform: '抖音', params: { keyword: '美业' }, userId: 1 })
 */

import { AutomationResult, getActiveEngines } from './automation-providers'

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
  | 'trending_topics'     // 热门话题（新增）
  | 'video_detail'        // 视频详情（新增）

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
 * - 读操作 → JustOneAPI 或其他数据平台
 * - 写操作 → Q1 ADB / 指纹浏览器 / Mock
 * 
 * @param ctx 引擎上下文（包含操作类型、平台、参数等）
 * @returns 操作结果
 */
export async function dispatchEngine(ctx: EngineContext): Promise<AutomationResult> {
  const { action, platform, params, userId, deviceId } = ctx
  
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
 * - justoneapi：JustOneAPI 第三方数据平台（推荐）
 * - 后续可扩展：自建爬虫、官方 API 等
 */
async function dispatchReadEngine(ctx: EngineContext): Promise<AutomationResult> {
  const { action, params } = ctx
  const activeEngines = getActiveEngines()
  
  // 检查是否有可用的数据查询引擎
  if (!activeEngines.includes('justoneapi')) {
    return {
      success: false,
      message: '未配置数据查询引擎，请在系统设置中配置 JustOneAPI Token',
      provider: 'none' as any,
      data: { error: 'NO_READ_ENGINE_CONFIGURED' }
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
        provider: 'justoneapi',
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
 * 这里只是返回配置信息，告诉调用者应该使用哪个引擎。
 */
async function dispatchWriteEngine(ctx: EngineContext): Promise<AutomationResult> {
  const { action, deviceId, platform, params } = ctx
  
  // 写操作必须指定设备（除非是 Mock 模式）
  if (!deviceId) {
    // 检查是否为 Mock 模式
    const { getAutomationConfig } = await import('./automation/config')
    const config = getAutomationConfig()
    
    if (config.engine === 'mock') {
      // Mock 模式：返回模拟成功结果
      return {
        success: true,
        message: `[Mock] ${action} 操作已模拟执行`,
        provider: 'mock' as any,
        data: { action, platform, params, mock: true }
      }
    }
    
    return {
      success: false,
      message: '写操作需要指定设备 ID（deviceId）',
      provider: 'unknown' as any,
      data: { error: 'DEVICE_ID_REQUIRED' }
    }
  }
  
  // 返回引擎配置信息，由调用方决定如何执行
  // 实际的设备执行逻辑在 /api/devices/{id}/execute 中处理
  const { getAutomationConfig } = await import('./automation/config')
  const config = getAutomationConfig()
  
  return {
    success: true,
    message: `写操作 ${action} 已路由到执行引擎: ${config.engine}`,
    provider: config.engine as any,  // 'fingerprint' | 'real-device' | 'mock'
    data: {
      action,
      platform,
      deviceId,
      engine: config.engine,
      fingerprintBrowser: config.fingerprintBrowser,
      // 提示调用方应该使用 /api/devices/{id}/execute 来执行
      executeEndpoint: `/api/devices/${deviceId}/execute`
    }
  }
}

// ====== 具体的读操作处理器 ======
// （这些函数将在 Phase 1 中实现具体的 JustOneAPI 调用）

import { justoneSearchVideo } from './automation-providers'

/**
 * 处理视频搜索
 * 已实现：调用 justoneSearchVideo
 */
async function handleSearch(params: Record<string, unknown>): Promise<AutomationResult> {
  const keyword = String(params.keyword || '')
  const count = Number(params.count || 10)
  
  if (!keyword) {
    return {
      success: false,
      message: '缺少搜索关键词（keyword 参数）',
      provider: 'justoneapi',
      data: { error: 'MISSING_KEYWORD' }
    }
  }
  
  return await justoneSearchVideo(keyword, count)
}

/**
 * 处理评论爬取
 * 待实现：Phase 1 需要在 automation-providers.ts 中添加 justoneFetchComments
 */
async function handleFetchComments(params: Record<string, unknown>): Promise<AutomationResult> {
  const videoUrl = String(params.videoUrl || '')
  const count = Number(params.count || 20)
  
  if (!videoUrl) {
    return {
      success: false,
      message: '缺少视频 URL（videoUrl 参数）',
      provider: 'justoneapi',
      data: { error: 'MISSING_VIDEO_URL' }
    }
  }
  
  // TODO: Phase 1 实现 - 调用 justoneFetchComments(videoUrl, count)
  // 目前返回占位符
  return {
    success: false,
    message: '评论爬取功能将在 Phase 1 中实现',
    provider: 'justoneapi',
    data: { error: 'NOT_IMPLEMENTED_YET', videoUrl, count }
  }
}

/**
 * 处理用户画像查询
 * 待实现：Phase 1 需要添加 justoneFetchUserProfile
 */
async function handleFetchUserProfile(params: Record<string, unknown>): Promise<AutomationResult> {
  const userId = String(params.userId || params.user_id || '')
  
  if (!userId) {
    return {
      success: false,
      message: '缺少用户 ID（userId 参数）',
      provider: 'justoneapi',
      data: { error: 'MISSING_USER_ID' }
    }
  }
  
  // TODO: Phase 1 实现 - 调用 justoneFetchUserProfile(userId)
  return {
    success: false,
    message: '用户画像功能将在 Phase 1 中实现',
    provider: 'justoneapi',
    data: { error: 'NOT_IMPLEMENTED_YET', targetUserId: userId }
  }
}

/**
 * 处理热门话题查询
 * 待实现：Phase 1 需要添加 justoneTrendingTopics
 */
async function handleTrendingTopics(params: Record<string, unknown>): Promise<AutomationResult> {
  const category = String(params.category || 'all')
  
  // TODO: Phase 1 实现 - 调用 justoneTrendingTopics(category)
  return {
    success: false,
    message: '热门话题功能将在 Phase 1 中实现',
    provider: 'justoneapi',
    data: { error: 'NOT_IMPLEMENTED_YET', category }
  }
}

/**
 * 处理视频详情查询
 * 待实现：Phase 1 需要添加 justoneVideoDetail
 */
async function handleVideoDetail(params: Record<string, unknown>): Promise<AutomationResult> {
  const videoUrl = String(params.videoUrl || '')
  
  if (!videoUrl) {
    return {
      success: false,
      message: '缺少视频 URL（videoUrl 参数）',
      provider: 'justoneapi',
      data: { error: 'MISSING_VIDEO_URL' }
    }
  }
  
  // TODO: Phase 1 实现 - 调用 justoneVideoDetail(videoUrl)
  return {
    success: false,
    message: '视频详情功能将在 Phase 1 中实现',
    provider: 'justoneapi',
    data: { error: 'NOT_IMPLEMENTED_YET', videoUrl }
  }
}

/**
 * 处理通用数据提取
 * 待实现：Phase 1 根据 extractType 分发
 */
async function handleExtract(params: Record<string, unknown>): Promise<AutomationResult> {
  const extractType = String(params.extractType || 'general')
  
  // TODO: Phase 1 实现通用提取逻辑
  return {
    success: false,
    message: `数据提取功能 (${extractType}) 将在 Phase 1 中实现`,
    provider: 'justoneapi',
    data: { error: 'NOT_IMPLEMENTED_YET', extractType }
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
