import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import {
  startStream,
  stopStream,
  getStreamStatus,
  generateLiveContent,
  aiGenerateLiveContent,
  listClips,
  createPlaylist,
  listPlaylists,
  shufflePlaylist,
} from '@/lib/live-stream-engine'

/* ============================================================
 * GET: 查询推流状态 / 素材列表 / 播放列表
 *
 * ?action=status&sessionId=xxx   → 推流会话状态
 * ?action=clips&taskId=xxx      → 素材片段列表
 * ?action=playlists            → 所有播放列表
 * ?action=playlist&id=xxx       → 单个播放列表
 * ============================================================ */
export async function GET(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action') || 'status'

    switch (action) {
      case 'status': {
        const sessionId = searchParams.get('sessionId')
        const data = await getStreamStatus(sessionId || undefined)
        return NextResponse.json({ success: true, data })
      }

      case 'clips': {
        const taskId = searchParams.get('taskId') || undefined
        const clips = await listClips(taskId)
        return NextResponse.json({ success: true, data: clips })
      }

      case 'playlists': {
        const playlists = await listPlaylists()
        return NextResponse.json({ success: true, data: playlists })
      }

      case 'playlist': {
        const id = searchParams.get('id')
        if (!id) return NextResponse.json({ success: false, message: '缺少 playlist id' }, { status: 400 })
        const pl = await (await import('@/lib/live-stream-engine')).getPlaylist(id)
        return NextResponse.json({ success: true, data: pl })
      }

      default:
        return NextResponse.json({ success: false, message: `未知操作: ${action}` }, { status: 400 })
    }
  } catch (e: unknown) {
    console.error('[API /live/stream GET]', e)
    const msg = e instanceof Error ? e.message : '查询失败'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

/* ============================================================
 * POST: 推流控制 & 内容生成
 *
 * action=start-stream    → 启动推流
 * action=stop-stream     → 停止推流
 * action=generate        → 批量生成数字人素材
 * action=ai-generate     → AI一键生成(话术+视频)
 * action=create-playlist → 创建播放列表
 * action=shuffle         → 打乱播放顺序
 * ============================================================ */
export async function POST(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') {
      return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    }

    const body = await req.json()
    const { action } = body

    switch (action) {
      // ---- 启动推流 ----
      case 'start-stream': {
        const { rtmpUrl, videoBitrate, audioBitrate, fps, resolution, targetDurationHours, playlistId, clips } = body
        if (!rtmpUrl) return NextResponse.json({ success: false, message: '缺少 rtmpUrl 推流地址' })

        const session = await startStream(
          { rtmpUrl, videoBitrate, audioBitrate, fps, resolution, targetDurationHours },
          playlistId,
          clips,
        )
        return NextResponse.json({
          success: true,
          message: `✅ 推流已启动 (session=${session.id})`,
          data: session,
        })
      }

      // ---- 停止推流 ----
      case 'stop-stream': {
        const { sessionId } = body
        if (!sessionId) return NextResponse.json({ success: false, message: '缺少 sessionId' })

        const session = await stopStream(sessionId)
        return NextResponse.json({
          success: true,
          message: '✅ 推流已停止',
          data: session,
        })
      }

      // ---- 批量生成素材（已有文案→数字人视频）----
      case 'generate': {
        const { items } = body as { items: Array<{ text: string; type: string; avatarId: string; background?: string }> }
        if (!items?.length) return NextResponse.json({ success: false, message: '缺少生成项 items' })

        // 异步执行，立即返回任务ID
        const taskPromise = generateLiveContent(items)

        // 对于 API 场景，我们等待结果返回（后续可改为真正异步+轮询）
        const task = await taskPromise
        return NextResponse.json({
          success: true,
          message: `内容生成完成 (${task.progress.done}/${task.progress.total})`,
          data: task,
        })
      }

      // ---- AI 一键生成（商品→话术→视频）----
      case 'ai-generate': {
        const { products, scriptTypes, avatarId, brandTone, background } = body as {
          products?: Array<{ name: string; price: string; features: string[] }>
          scriptTypes?: string[]
          avatarId: string
          brandTone?: string
          background?: string
        }
        if (!avatarId) return NextResponse.json({ success: false, message: '缺少 avatarId' })

        const task = await aiGenerateLiveContent({
          products,
          scriptTypes: scriptTypes as any,
          avatarId,
          brandTone,
          background,
        })
        return NextResponse.json({
          success: true,
          message: `AI 内容生成完成 (${task.progress.done}/${task.progress.total})`,
          data: task,
        })
      }

      // ---- 创建播放列表 ----
      case 'create-playlist': {
        const { name, roomId, clips } = body as { name: string; roomId: number | null; clips: any[] }
        if (!clips?.length) return NextResponse.json({ success: false, message: '缺少 clips' })

        const playlist = await createPlaylist(name || '未命名播放列表', roomId || null, clips)
        return NextResponse.json({ success: true, message: '播放列表已创建', data: playlist })
      }

      // ---- 打乱播放顺序 ----
      case 'shuffle': {
        const { playlistId } = body
        if (!playlistId) return NextResponse.json({ success: false, message: '缺少 playlistId' })

        const playlist = await shufflePlaylist(playlistId)
        return NextResponse.json({ success: true, message: '播放顺序已打乱', data: playlist })
      }

      default:
        return NextResponse.json({ success: false, message: `未知操作: ${action}` }, { status: 400 })
    }
  } catch (e: unknown) {
    console.error('[API /live/stream POST]', e)
    const msg = e instanceof Error ? e.message : '操作失败'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}
