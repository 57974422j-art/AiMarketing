import { NextRequest, NextResponse } from 'next/server'

// 2026-09-06: 生图任务进度查询（前端自动轮询用）——IMAGE_PENDING 消息出现后每 5s 查一次
// pendingImages 抽在 globalThis.__pendingImages（chat route 后台轮询转存后写 url），此处跨模块读
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const taskId = String(body?.taskId || '').trim()
    if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })
    const map = (globalThis as any).__pendingImages as Map<number, { taskId: string; ts: number; url?: string; fileName?: string; done: boolean }> | undefined
    if (!map) return NextResponse.json({ success: false, message: '无生图任务' })
    // 按 taskId 找（Map key 是 userId，value 有 taskId）
    let hit: { url?: string; fileName?: string; done: boolean } | null = null
    for (const v of map.values()) {
      if (v.taskId === taskId) { hit = v; break }
    }
    if (!hit) return NextResponse.json({ success: true, done: false })
    // 超时兜底：超过 4 分钟仍未 done 视为失败（后台轮询上限 240s）
    const done = hit.done && !!hit.url
    return NextResponse.json({ success: true, done, url: hit.url || '', fileName: hit.fileName || '' })
  } catch { return NextResponse.json({ success: false, message: '查询失败' }) }
}
