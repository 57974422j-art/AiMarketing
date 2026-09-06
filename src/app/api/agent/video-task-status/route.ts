import { NextRequest, NextResponse } from 'next/server'
import { queryVideoTask } from '@/lib/ai-providers'
import { finalizeSuccessByTaskId, finalizeFailureByTaskId } from '@/lib/generation-record'

// 2026-08-24: 视频任务进度查询（前端自动轮询用）——VIDEO_TASK 消息出现后每 10s 查一次
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const taskId = String(body?.taskId || '').trim()
    if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })
    const r = await queryVideoTask(taskId)
    if (!r) return NextResponse.json({ success: false, message: '查询失败' })
    const done = r.status === 'completed' || r.status === 'SUCCEEDED' || r.status === 'done'
    const failed = r.status === 'failed' || r.status === 'FAILED' || r.status === 'CANCELED'
    const errMsg = (r as any).errMsg || ''
    // 成片成功：扣点 + 转存 OSS（原子认领——重复轮询不重复扣；无记录时跳过）
    if (done && r.videoUrl) {
      try { await finalizeSuccessByTaskId(String(taskId), r.videoUrl) } catch (e) { console.error('[video-status] 结算失败:', e) }
    }
    // 失败：标记不扣点（防重复）
    if (failed) {
      try { await finalizeFailureByTaskId(String(taskId), errMsg || '视频生成失败') } catch (e) { console.error('[video-status] 失败标记:', e) }
    }
    return NextResponse.json({
      success: true,
      status: r.status,
      videoUrl: r.videoUrl || '',
      errMsg,
      done,
      failed,
    })
  } catch { return NextResponse.json({ success: false, message: '查询失败' }) }
}
