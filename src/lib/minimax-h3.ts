// 2026-08-14: MiniMax H3 视频生成（国内站 api.minimaxi.com v2，异步提交+轮询）
// 价格: 768P=0.50元/秒(50点)  2K=0.80元/秒(80点)  duration 4-15s
// 官方: https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create
const H3_CREATE = 'https://api.minimaxi.com/v2/video_generation'
const H3_QUERY = 'https://api.minimaxi.com/v2/query/video_generation'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface H3VideoResult {
  ok: boolean
  videoUrl?: string
  taskId?: string
  error?: string
}

export async function generateH3Video(
  prompt: string,
  duration = 5,
  resolution: '768P' | '2K' = '768P',
  ratio = '16:9',
  refImageUrl?: string, // 可选：图生视频首帧
): Promise<H3VideoResult> {
  const key = process.env.MINIMAX_API_KEY
  if (!key) return { ok: false, error: '未配置 MINIMAX_API_KEY（后台 AI 密钥 → Minimax）' }
  try {
    const content: any[] = [{ type: 'text', text: prompt.substring(0, 7000) }]
    if (refImageUrl) content.push({ type: 'image_url', image_url: { url: refImageUrl }, role: 'first_frame' })
    const r = await fetch(H3_CREATE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'MiniMax-H3',
        content,
        resolution,
        duration: Math.min(Math.max(duration, 4), 15),
        ratio: refImageUrl ? 'adaptive' : ratio,
      }),
      signal: AbortSignal.timeout(30000),
    })
    const d = await r.json().catch(() => ({}))
    if (d?.type === 'error' || d?.error) return { ok: false, error: d?.error?.message || `H3 提交失败 HTTP ${r.status}` }
    const taskId = d?.task_id
    if (!taskId) return { ok: false, error: 'H3 未返回 task_id' }
    // 轮询（最长 180 秒）
    for (let i = 0; i < 36; i++) {
      await sleep(5000)
      try {
        const q = await fetch(`${H3_QUERY}/${taskId}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) })
        const qd = await q.json().catch(() => ({}))
        const task = qd?.task
        if (!task) continue
        if (task.status === 'succeeded') return { ok: true, videoUrl: task.content?.url || '', taskId }
        if (task.status === 'failed') return { ok: false, error: task.error?.message || 'H3 生成失败（可能敏感内容）', taskId }
        if (task.status === 'cancelled') return { ok: false, error: 'H3 任务已取消', taskId }
      } catch { /* 单次查询失败继续轮询 */ }
    }
    return { ok: false, error: 'H3 生成超时（180s）', taskId }
  } catch (e: any) {
    return { ok: false, error: `H3 调用失败: ${e?.message || e}` }
  }
}
