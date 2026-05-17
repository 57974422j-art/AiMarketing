/**
 * 自动化引擎提供商 — 统一接口
 * 支持多引擎切换：justoneapi / q1-coordinates
 * 引擎选择通过环境变量 AUTOMATION_ENGINE 控制（admin 后台设置页面可配）
 */

/* ------------------------------------------------------------------ */
/*  类型定义                                                            */
/* ------------------------------------------------------------------ */

export type AutomationEngine = 'justoneapi' | 'q1-coordinates' | 'tiktokdownloader'

export interface AutomationResult {
  success: boolean
  message: string
  provider: AutomationEngine
  data?: Record<string, unknown>
}

export interface AutomationOptions {
  deviceId?: string
  targetUrl?: string
  comment?: string
  keyword?: string
  videoUrl?: string
  caption?: string
  platform?: string
  count?: number
}

/* ------------------------------------------------------------------ */
/*  引擎配置读取                                                        */
/* ------------------------------------------------------------------ */

/** 获取当前启用的自动化引擎列表（逗号分隔，优先级从高到低） */
export function getActiveEngines(): AutomationEngine[] {
  const raw = process.env.AUTOMATION_ENGINE || 'justoneapi'
  return raw.split(',').map(s => s.trim().toLowerCase()) as AutomationEngine[]
}

/** 获取 justoneapi Token */
export function getJustoneToken(): string | null {
  return process.env.JUSTONEAPI_TOKEN || null
}

/** 检查引擎是否已配置 */
export function isEngineConfigured(engine: AutomationEngine): boolean {
  switch (engine) {
    case 'justoneapi':
      return !!getJustoneToken()
    case 'q1-coordinates':
    case 'tiktokdownloader':
      return true // 本地部署，无需特殊配置
    default:
      return false
  }
}

/* ------------------------------------------------------------------ */
/*  justoneapi 官方 API 调用                                           */
/* ------------------------------------------------------------------ */

const JUSTONE_BASE = 'https://api.justoneapi.com'

async function justonePost(path: string, body: Record<string, unknown>): Promise<any> {
  const token = getJustoneToken()
  if (!token) throw new Error('JUSTONEAPI_TOKEN 未配置')
  const res = await fetch(`${JUSTONE_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const data = await res.json()
  if (!res.ok || data.code !== 0) throw new Error(data.message || `HTTP ${res.status}`)
  return data
}

/** justoneapi：获取用户资料 */
export async function justoneGetUserProfile(keyword: string): Promise<AutomationResult> {
  try {
    const data = await justonePost('/douyin/user/search/v2', { keyword })
    return { success: true, message: 'ok', provider: 'justoneapi', data: data.data }
  } catch (e: any) {
    return { success: false, message: e.message || 'justoneapi 搜索用户失败', provider: 'justoneapi' }
  }
}

/** justoneapi：搜索视频 */
export async function justoneSearchVideo(keyword: string, count = 10): Promise<AutomationResult> {
  try {
    const data = await justonePost('/douyin/video/search/v4', { keyword, count })
    return { success: true, message: 'ok', provider: 'justoneapi', data: data.data }
  } catch (e: any) {
    return { success: false, message: e.message || 'justoneapi 搜索视频失败', provider: 'justoneapi' }
  }
}

/** justoneapi：获取视频评论 */
export async function justoneGetComments(videoId: string, count = 20): Promise<AutomationResult> {
  try {
    const data = await justonePost('/douyin/video/comments/v1', { video_id: videoId, count })
    return { success: true, message: 'ok', provider: 'justoneapi', data: data.data }
  } catch (e: any) {
    return { success: false, message: e.message || 'justoneapi 获取评论失败', provider: 'justoneapi' }
  }
}

/* ------------------------------------------------------------------ */
/*  多引擎统一执行（按配置优先级依次尝试，串联降级）                    */
/* ------------------------------------------------------------------ */

/**
 * 对指定操作按引擎顺序依次执行，成功则返回，全部失败则返回最后一个错误。
 * engines 不传时自动读取环境变量 AUTOMATION_ENGINE。
 */
export async function executeWithFallback(
  label: string,
  handlers: Record<AutomationEngine, () => Promise<AutomationResult>>,
  engines?: AutomationEngine[],
): Promise<AutomationResult> {
  const active = engines || getActiveEngines()
  let lastErr: AutomationResult = { success: false, message: '无可用引擎', provider: 'q1-coordinates' }

  for (const engine of active) {
    if (!isEngineConfigured(engine)) {
      console.log(`[${label}] ${engine} 未配置，跳过`)
      continue
    }
    const handler = handlers[engine]
    if (!handler) continue
    try {
      const result = await handler()
      if (result.success) {
        console.log(`[${label}] ${engine} 成功`)
        return result
      }
      lastErr = result
      console.log(`[${label}] ${engine} 失败: ${result.message}，降级`)
    } catch (e: any) {
      lastErr = { success: false, message: e.message, provider: engine }
      console.log(`[${label}] ${engine} 异常: ${e.message}，降级`)
    }
  }

  return lastErr
}
