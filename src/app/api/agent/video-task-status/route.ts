import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { queryVideoTask } from '@/lib/ai-providers'
import { finalizeSuccessByTaskId, finalizeFailureByTaskId } from '@/lib/generation-record'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { getOSSClient, signedUrl } from '@/lib/oss'

const prisma = new PrismaClient()

// 2026-08-24: 视频任务进度查询（前端自动轮询用）——VIDEO_TASK 消息出现后每 10s 查一次
// 2026-09-06: 成片成功 → 落个人仓库（下载→put storage/{userId}/→mediaAsset）+ 扣点（原子认领防重复）
//             失败标记不扣点；返回 errMsg 供前端显示失败原因
export async function POST(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req)
    const body = await req.json()
    const taskId = String(body?.taskId || '').trim()
    if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })
    const r = await queryVideoTask(taskId)
    if (!r) return NextResponse.json({ success: false, message: '查询失败' })
    const done = r.status === 'completed' || r.status === 'SUCCEEDED' || r.status === 'done'
    const failed = r.status === 'failed' || r.status === 'FAILED' || r.status === 'CANCELED'
    const errMsg = (r as any).errMsg || ''
    let finalVideoUrl = r.videoUrl || ''
    // 成片成功：落个人仓库（下载→上传 storage/{userId}/→mediaAsset）+ 扣点（原子认领防重复）
    if (done && r.videoUrl) {
      try {
        if (auth?.userId) {
          const key = 'storage/' + auth.userId + '/ai_' + Date.now() + '.mp4'
          const buf = Buffer.from(await (await fetch(r.videoUrl, { signal: AbortSignal.timeout(120000) })).arrayBuffer())
          const oss = await getOSSClient()
          await oss.put(key, buf)
          finalVideoUrl = await signedUrl(key, 86400)
          await finalizeSuccessByTaskId(String(taskId), finalVideoUrl)
          await prisma.mediaAsset.create({
            data: { title: 'AI生成视频', ossUrl: finalVideoUrl, type: 'video', prompt: 'AI生成视频', category: 'AI生成', source: 'private', ownerId: auth.userId },
          }).catch(() => {})
        } else {
          await finalizeSuccessByTaskId(String(taskId), r.videoUrl)
        }
      } catch (e) { console.error('[video-status] 落库失败:', e) }
    }
    // 失败：标记不扣点（防重复）
    if (failed) {
      try { await finalizeFailureByTaskId(String(taskId), errMsg || '视频生成失败') } catch (e) { console.error('[video-status] 失败标记:', e) }
    }
    return NextResponse.json({
      success: true,
      status: r.status,
      videoUrl: finalVideoUrl,
      errMsg,
      done,
      failed,
    })
  } catch { return NextResponse.json({ success: false, message: '查询失败' }) }
}
