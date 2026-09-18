// 2026-08-14: MiniMax H3 视频生成（异步提交 + 轮询）
// ★2026-09-18 H3_RELAY_V1：接入【中转站优先 + 官方降级】+ 模型可选 + use_context_ir
//   · 中转站（朋友机房自建，如 https://h3.submodel.ai）与官方 API 同构：v2 路径、鉴权、错误体一致
//     （实测：POST /v2/video_generation 返回 {"task_id":"task_..."}；
//            GET /v2/query/video_generation/{id} 缺 Authorization 头返回 401 AUTHENTICATION_FAILED）
//   · 后台可配（AI 密钥 → H3）：H3_BASE_URL / H3_API_KEY / H3_MODEL / H3_USE_CONTEXT_IR
//   · 没配中转 → 直接走官方 api.minimaxi.com（老行为完全不变）
// 价格: 768P=0.50元/秒(50点)  2K=0.80元/秒(80点)  duration 4-15s
// 官方: https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create

const OFFICIAL_BASE = 'https://api.minimaxi.com'
const DEFAULT_MODEL = 'MiniMax-H3'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface H3VideoResult {
  ok: boolean
  videoUrl?: string
  taskId?: string
  error?: string
  /** ★H3_RELAY_V1：实际使用的通道（中转 / 官方），便于日志与前台提示 */
  via?: string
  /** ★H3_RELAY_V1：任务真实产出秒数（usage.output_seconds）——可用于精确计费/对账 */
  seconds?: number
}

type H3Target = { base: string; key: string; model: string; label: string }

/** 组装候选通道：中转（若已配）优先 → 官方兜底 */
function h3Targets(): H3Target[] {
  const out: H3Target[] = []
  const relayBase = (process.env.H3_BASE_URL || '').trim().replace(/\/+$/, '')
  const relayKey = (process.env.H3_API_KEY || '').trim()
  const officialKey = (process.env.MINIMAX_API_KEY || '').trim()
  const model = (process.env.H3_MODEL || DEFAULT_MODEL).trim()
  if (relayBase && relayKey) out.push({ base: relayBase, key: relayKey, model, label: '中转' })
  // 官方兜底：没配中转时它就是唯一通道；配了中转则作为降级
  if (officialKey && relayBase !== OFFICIAL_BASE) {
    out.push({ base: OFFICIAL_BASE, key: officialKey, model: DEFAULT_MODEL, label: '官方' })
  }
  return out
}

/** use_context_ir：默认开（自动增强提示词，出片效果更好）；H3_USE_CONTEXT_IR=0/false 关闭 */
function useContextIr(): boolean {
  const v = (process.env.H3_USE_CONTEXT_IR || '').trim().toLowerCase()
  return !(v === '0' || v === 'false' || v === 'off')
}

/** 单通道：提交 + 轮询（最长约 180s） */
async function submitAndPoll(
  t: H3Target,
  prompt: string,
  duration: number,
  resolution: '768P' | '2K',
  ratio: string,
  refImageUrl?: string,
): Promise<H3VideoResult> {
  const content: any[] = [{ type: 'text', text: prompt.substring(0, 7000) }]
  if (refImageUrl) content.push({ type: 'image_url', image_url: { url: refImageUrl }, role: 'first_frame' })
  const body: Record<string, any> = {
    model: t.model,
    content,
    resolution,
    duration: Math.min(Math.max(duration, 4), 15),
    ratio: refImageUrl ? 'adaptive' : ratio,
  }
  if (useContextIr()) body.use_context_ir = true // ★IR：自动增强提示词（中转站要求带上）
  const r = await fetch(`${t.base}/v2/video_generation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const d = await r.json().catch(() => ({} as any))
  if (d?.type === 'error' || d?.error) {
    return { ok: false, error: `${t.label}提交失败: ${d?.error?.message || `HTTP ${r.status}`}`, via: t.label }
  }
  const taskId = d?.task_id
  if (!taskId) return { ok: false, error: `${t.label}未返回 task_id`, via: t.label }

  // ★实测（2026-09-18，中转站 Turbo）：6 秒片 created_at→updated_at = 101s
  //   → 原 36×5s=180s 上限余量太小（排队/长片必超时），改为 120×5s=600s
  for (let i = 0; i < 120; i++) {
    await sleep(5000)
    try {
      const q = await fetch(`${t.base}/v2/query/video_generation/${taskId}`, {
        headers: { Authorization: `Bearer ${t.key}` },
        signal: AbortSignal.timeout(20000),
      })
      const qd = await q.json().catch(() => ({} as any))
      const task = qd?.task
      if (!task) continue
      if (task.status === 'succeeded') {
        return {
          ok: true, videoUrl: task.content?.url || '', taskId, via: t.label,
          seconds: Number(task.usage?.output_seconds) || undefined,
        }
      }
      if (task.status === 'failed') {
        // 任务失败=内容/prompt 问题（如敏感）→ 换通道也一样失败，不降级
        return { ok: false, error: task.error?.message || 'H3 生成失败（可能敏感内容）', taskId, via: `${t.label}(不降级)` }
      }
      if (task.status === 'cancelled') return { ok: false, error: 'H3 任务已取消', taskId, via: t.label }
    } catch { /* 单次查询失败继续轮询 */ }
  }
  return { ok: false, error: `${t.label}生成超时（600s）`, taskId, via: t.label }
}

export async function generateH3Video(
  prompt: string,
  duration = 5,
  resolution: '768P' | '2K' = '768P',
  ratio = '16:9',
  refImageUrl?: string, // 可选：图生视频首帧
): Promise<H3VideoResult> {
  const targets = h3Targets()
  if (!targets.length) {
    return { ok: false, error: '未配置 H3 通道：请在后台「AI 密钥 → H3 中转」填【中转地址 + 中转 Key】，或填官方 MINIMAX_API_KEY' }
  }
  let last: H3VideoResult = { ok: false, error: '未执行' }
  for (const t of targets) {
    try {
      const res = await submitAndPoll(t, prompt, duration, resolution, ratio, refImageUrl)
      if (res.ok && res.videoUrl) return res
      last = res
      console.log(`[H3] ${t.label} 通道失败: ${res.error}`)
      if (String(res.via || '').includes('不降级')) return res // 内容问题，降级无意义
    } catch (e: any) {
      last = { ok: false, error: `${t.label}通道异常: ${e?.message || e}`, via: t.label }
      console.log(`[H3] ${t.label} 通道异常: ${last.error}`)
    }
  }
  return last
}
