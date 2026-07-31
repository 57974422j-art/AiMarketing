import { NextRequest, NextResponse } from 'next/server'
import { generateVideo } from '@/lib/ai-providers'
import { getAuthFromHeaders } from '@/lib/api-auth'

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    
    const body = await request.json()
    const { prompt, duration, resolution, aspectRatio, model } = body

    if (!prompt) {
      return NextResponse.json({ success: false, message: '缺少参数: prompt' }, { status: 400 })
    }

    const segDuration = Math.max(2, Math.min(15, parseInt(duration) || 5))
    const rs = resolution || '720P'
    const md = model || 'happyhorse-1.0-t2v'

    console.log(`[生成分段] prompt="${prompt.substring(0, 40)}...", duration=${segDuration}s, model=${md}, resolution=${rs}`)

    const result = await generateVideo(prompt, segDuration, rs, aspectRatio || '16:9', md)

    if (!result) {
      return NextResponse.json({ success: false, message: '分段生成失败：无返回' }, { status: 500 })
    }

    if (result.videoUrl) {
      console.log(`[生成分段] 同步返回 videoUrl_len=${result.videoUrl.length}`)
      return NextResponse.json({ success: true, videoUrl: result.videoUrl })
    }

    // 异步任务，需要前端轮询
    console.log(`[生成分段] 异步 taskId=${result.taskId?.substring(0, 8)}...`)
    return NextResponse.json({ success: true, taskId: result.taskId })
  } catch (error) {
    console.error('[生成分段] 异常:', error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '分段生成失败' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
