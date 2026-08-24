import { NextRequest, NextResponse } from 'next/server'
import { queryVideoTask } from '@/lib/ai-providers'

// 2026-08-24: 视频任务进度查询（前端自动轮询用）——VIDEO_TASK 消息出现后每 10s 查一次
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const taskId = String(body?.taskId || '').trim()
    if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })
    const r = await queryVideoTask(taskId)
    if (!r) return NextResponse.json({ success: false, message: '查询失败' })
    return NextResponse.json({
      success: true,
      status: r.status,
      videoUrl: r.videoUrl || '',
      done: r.status === 'completed' || r.status === 'SUCCEEDED' || r.status === 'done',
      failed: r.status === 'failed' || r.status === 'FAILED' || r.status === 'CANCELED',
    })
  } catch { return NextResponse.json({ success: false, message: '查询失败' }) }
}
