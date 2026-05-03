import { NextRequest, NextResponse } from 'next/server'
import { dashscopeGenerateVideo, dashscopeQueryVideoTask } from '@/lib/ai-providers'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

// 文生视频 API
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, aspectRatio } = body

    if (!prompt) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数: prompt' },
        { status: 400 }
      )
    }

    // 确保输出目录存在
    const outputDir = join(process.cwd(), 'public', 'outputs')
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true })
    }

    // 调用通义万相 API
    const result = await dashscopeGenerateVideo(prompt, aspectRatio || '16:9')
    
    // API 未配置
    if (!result) {
      return NextResponse.json(
        { success: false, message: '视频生成服务未配置' },
        { status: 500 }
      )
    }
    
    // 如果返回了视频 URL（同步模式），直接返回
    if (result.videoUrl) {
      return NextResponse.json({
        success: true,
        taskId: result.taskId,
        videoUrl: result.videoUrl
      })
    }

    // 异步模式，返回任务 ID，稍后可以查询
    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      message: '视频生成任务已提交，请稍后查询结果'
    })
  } catch (error) {
    console.error('文生视频错误:', error)
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '视频生成失败' },
      { status: 500 }
    )
  }
}

// 查询视频生成任务状态
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const taskId = searchParams.get('taskId')

    if (!taskId) {
      return NextResponse.json(
        { success: false, message: '缺少参数: taskId' },
        { status: 400 }
      )
    }

    const result = await dashscopeQueryVideoTask(taskId)
    
    return NextResponse.json({
      success: true,
      ...result
    })
  } catch (error) {
    console.error('查询视频任务错误:', error)
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '查询失败' },
      { status: 500 }
    )
  }
}
