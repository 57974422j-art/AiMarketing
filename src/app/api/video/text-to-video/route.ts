import { NextRequest, NextResponse } from 'next/server'
import { generateVideo, generateLongVideo, queryVideoTask } from '@/lib/ai-providers'
import { getAuthFromHeaders } from '@/lib/api-auth'

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    const body = await request.json()
    const { prompt, aspectRatio, duration, resolution, model, refImage, longVideo } = body
    const rawDuration = Math.max(2, parseInt(duration) || 5)
    const videoDuration = longVideo ? Math.min(60, rawDuration) : Math.min(15, rawDuration)

    if (!prompt) {
      return NextResponse.json({ success: false, message: '缺少必要参数: prompt' }, { status: 400 })
    }

    console.log('[文生视频] 参数:', { prompt: prompt.substring(0, 50), ratio: aspectRatio, duration: videoDuration, resolution, model, longVideo, hasRef: !!refImage })

    // 长视频模式（>15s 自动拼接）
    if (videoDuration > 15 && longVideo) {
      const result = await generateLongVideo(prompt, videoDuration, resolution || '720P', aspectRatio || '16:9')
      if (!result?.videoUrl) {
        return NextResponse.json({ success: false, message: '长视频生成失败' }, { status: 500 })
      }
      return NextResponse.json({ success: true, taskId: 'long_video', videoUrl: result.videoUrl })
    }

    // 短文本模式（≤15s）
    const result = await generateVideo(prompt, videoDuration, resolution || '720P', aspectRatio || '16:9')

    if (!result) {
      return NextResponse.json({ success: false, message: '视频生成服务未配置' }, { status: 500 })
    }

    if (result.videoUrl) {
      return NextResponse.json({ success: true, taskId: result.taskId, videoUrl: result.videoUrl })
    }

    return NextResponse.json({ success: true, taskId: result.taskId, message: '视频生成任务已提交，请稍后查询结果' })
  } catch (error) {
    console.error('文生视频错误:', error)
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

    const result = await queryVideoTask(taskId)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('查询视频任务错误:', error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '查询失败' }, { status: 500 })
  }
}
