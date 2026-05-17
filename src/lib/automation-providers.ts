/** 
 * 自动化引擎提供商 — 统一接口
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
const JUSTONE_BASE = 'https://api.justoneapi.com'
async function justonePost(path: string, body: Record<string, unknown>): Promise<any> {
  const token = getJustoneToken()
  const res = await fetch(JUSTONE_BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  })
  const data = await res.json()
  return data
}
export async function justoneSearchVideo(keyword: string, count = 10): Promise<AutomationResult> {
  try { const data = await justonePost('/douyin/video/search/v4', { keyword, count }); return { success: true, message: 'ok', provider: 'justoneapi', data: data.data } }
  catch (e: any) { return { success: false, message: e.message || '搜索失败', provider: 'justoneapi' } }
}
