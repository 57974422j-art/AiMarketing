import { NextRequest, NextResponse } from 'next/server'
import { splitPromptForSegments } from '@/lib/ai-providers'
import { getAuthFromHeaders } from '@/lib/api-auth'

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    const { prompt, segments } = await request.json()
    if (!prompt || !segments) {
      return NextResponse.json({ success: false, message: '缺少参数: prompt, segments' }, { status: 400 })
    }
    const count = Math.max(2, Math.min(8, parseInt(segments) || 2))
    const result = await splitPromptForSegments(prompt, count)
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('[SplitPrompt] 错误:', error)
    return NextResponse.json({ success: false, message: '拆分失败' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
