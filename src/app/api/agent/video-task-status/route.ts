import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { queryVideoTask } from '@/lib/ai-providers'
import { finalizeSuccessByTaskId, finalizeFailureByTaskId } from '@/lib/generation-record'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { getOSSClient, signedUrl } from '@/lib/oss'

const prisma = new PrismaClient()

/* ★VF_VIDEOSTATUS_UNKNOWN_V1b：**已判定不存在的任务，别再问百炼第二次**。
   为什么需要：客户端是 Electron 打包版（不随部署更新），它可能只看 `done`、无视 `failed`
   ⇒ 即使我们返回 failed，它仍会每分钟问一次。这层缓存保证：
     · 同一个 taskId 查过一次 UNKNOWN ⇒ 之后**直接返回 failed，不调百炼、不打日志**
     · 代价：内存里存几个 taskId（可忽略），进程重启后自动清空。 */
const _deadTaskIds = new Set<string>()

// 2026-08-24: 视频任务进度查询（前端自动轮询用）——VIDEO_TASK 消息出现后每 10s 查一次
// 2026-09-06: 成片成功 → 落个人仓库（下载→put storage/{userId}/→mediaAsset）+ 扣点（原子认领防重复）
//             失败标记不扣点；返回 errMsg 供前端显示失败原因
export async function POST(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req)
    const body = await req.json()
    const taskId = String(body?.taskId || '').trim()
    if (!taskId) return NextResponse.json({ success: false, message: '缺少 taskId' }, { status: 400 })
    // ★VF_VIDEOSTATUS_UNKNOWN_V1b：已判定不存在的任务 ⇒ 直接回 failed，不再打百炼
    if (_deadTaskIds.has(String(taskId))) {
      return NextResponse.json({
        success: true, status: 'FAILED', videoUrl: '',
        errMsg: '任务不存在或已过期（服务端已标记，请重新生成）', done: false, failed: true,
      })
    }
    const r = await queryVideoTask(taskId)
    if (!r) return NextResponse.json({ success: false, message: '查询失败' })
    /* ★VF_VIDEOSTATUS_UNKNOWN_V1（2026-10-20 线上实测「[百炼查询] task=vf179247… UNKNOWN 每分钟一条，关不掉」）：
       病灶：`UNKNOWN`（百炼里任务不存在/已过期）**既不匹配 done、也不匹配 failed**
             ⇒ 接口返回 `{done:false, failed:false}` ⇒ **客户端认为"还在生成"** ⇒ 每 60 秒问一次、永远不停。
             证据：nginx 日志 20:02:41→20:09:41 每分钟一条 `POST /api/agent/video-task-status`（Electron 客户端）。
       现口径：**`UNKNOWN` / 空状态 一律视为 failed**（任务不存在就没有"以后会完成"这回事）
             ⇒ 客户端收到 failed 就会停止轮询，日志立刻安静。
       ⚠️ 安全前提：百炼任务**刚提交时返回 PENDING/RUNNING**，不会返回 UNKNOWN
          ⇒ 所以"UNKNOWN=failed"不会误杀正在跑的任务。 */
    const _st = String(r.status || '').toUpperCase()
    const isUnknown = !_st || _st === 'UNKNOWN'
    if (isUnknown) {
      _deadTaskIds.add(String(taskId))   // ★V1b：记下来，后续请求直接返回，不再打百炼
      try { console.log('[video-status] 任务不存在（UNKNOWN）⇒ 判失败 + 已缓存，后续请求不再查百炼 task=' + String(taskId).substring(0, 12)) } catch { /* ignore */ }
    }
    const done = !isUnknown && (r.status === 'completed' || r.status === 'SUCCEEDED' || r.status === 'done')
    const failed = isUnknown || r.status === 'failed' || r.status === 'FAILED' || r.status === 'CANCELED'
    const errMsg = isUnknown ? '任务不存在或已过期（服务端没有这个任务，请重新生成）' : ((r as any).errMsg || '')
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
