import { NextRequest, NextResponse } from 'next/server'
import { generateVideo, generateLongVideo, queryVideoTask } from '@/lib/ai-providers'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { checkFeatureAccess, FeatureCodes } from '@/lib/quota'

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

    // 检查文生视频功能是否已开通
    const featureCheck = await checkFeatureAccess(auth.userId, FeatureCodes.TEXT_TO_VIDEO)
    if (!featureCheck.allowed) {
      return NextResponse.json({
        success: false,
        message: featureCheck.message,
        needContactService: featureCheck.needContactService
      }, { status: 403 })
    }

    const body = await request.json()
    const { prompt, aspectRatio, duration, resolution, model, refImage, longVideo, segmentPrompts } = body
    const rawDuration = Math.max(2, parseInt(duration) || 5)
    const videoDuration = longVideo ? Math.min(60, rawDuration) : Math.min(15, rawDuration)
    const requestStart = Date.now()

    if (!prompt && !longVideo) {
      return NextResponse.json({ success: false, message: '缺少必要参数: prompt' }, { status: 400 })
    }

    console.log(`[文生视频API] 开始, params=${JSON.stringify({ prompt: (prompt||'').substring(0, 50), ratio: aspectRatio, duration: videoDuration, resolution, model, longVideo, hasRef: !!refImage })}`)

    // 长视频模式
    if (videoDuration > 15 && longVideo) {
      const segPrompts = segmentPrompts || (prompt ? [prompt] : [])
      const segDuration = body.segmentDuration || 15
      const segModel = model === 'happyhorse' ? 'happyhorse-1.0-t2v' : model || 'happyhorse-1.0-t2v'
      console.log(`[文生视频API] 进入长视频模式, target=${videoDuration}s, 段数=${segPrompts.length}, 每段=${segDuration}s, 模型=${segModel}`)
      const result = await generateLongVideo(segPrompts, videoDuration, resolution || '720P', aspectRatio || '16:9', undefined, segDuration, segModel)
      const cost = Math.round((Date.now() - requestStart) / 1000)
      if (!result?.videoUrl) {
        console.log(`[文生视频API] 长视频失败, 耗时=${cost}s`)
        return NextResponse.json({ success: false, message: '长视频生成失败' }, { status: 500 })
      }
      console.log(`[文生视频API] 长视频成功, 耗时=${cost}s`)
      return NextResponse.json({ success: true, taskId: 'long_video', videoUrl: result.videoUrl })
    }

    // 短视频模式（≤15s）
    console.log(`[文生视频API] 进入短视频模式, duration=${videoDuration}s` + (model ? `, model=${model}` : ''))
    const result = await generateVideo(prompt, videoDuration, resolution || '720P', aspectRatio || '16:9', model)
    const cost = Math.round((Date.now() - requestStart) / 1000)

    if (!result) {
      console.log(`[文生视频API] 服务不可用, 耗时=${cost}s`)
      return NextResponse.json({ success: false, message: '视频生成服务未配置' }, { status: 500 })
    }

    if (result.videoUrl) {
      console.log(`[文生视频API] 同步返回, 耗时=${cost}s, taskId=${result.taskId?.substring(0, 8)}..., videoUrl_len=${result.videoUrl.length}`)
      return NextResponse.json({ success: true, taskId: result.taskId, videoUrl: result.videoUrl })
    }

    // 异步模式（只有 taskId，前端轮询）
    console.log(`[文生视频API] 异步提交, 耗时=${cost}s, taskId=${result.taskId?.substring(0, 8)}...`)
    return NextResponse.json({ success: true, taskId: result.taskId, message: '视频生成任务已提交，请稍后查询结果' })
  } catch (error) {
    console.error('[文生视频API] 异常:', error instanceof Error ? `${error.name}: ${error.message}\n${error.stack?.substring(0, 200)}` : error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '视频生成失败' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const taskId = searchParams.get('taskId')

    if (!taskId) {
      return NextResponse.json({ success: false, message: '缺少参数: taskId' }, { status: 400 })
    }

    console.log(`[文生视频API][查询] 前端查询 taskId=${taskId.substring(0, 8)}...`)
    const result = await queryVideoTask(taskId)
    console.log(`[文生视频API][查询] 返回 taskId=${taskId.substring(0, 8)}..., status=${result?.status}, hasUrl=!!${!!result?.videoUrl}`)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[文生视频API][查询异常]:', error instanceof Error ? `${error.name}: ${error.message}` : error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '查询失败' }, { status: 500 })
  }
}
