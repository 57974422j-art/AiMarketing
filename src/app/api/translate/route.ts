import { NextRequest, NextResponse } from 'next/server'
import { translate } from '@/lib/ai-providers'
import { getAuthFromHeaders } from '@/lib/api-auth'

// 翻译 API
export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) {
      return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    }

    const body = await request.json()
    const { text, from, to } = body

    if (!text || !to) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }

    const result = await translate(text, to, from || 'auto')
    
    return NextResponse.json({ success: true, data: { translatedText: result } })
  } catch (error) {
    console.error('翻译错误:', error)
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '翻译失败' },
      { status: 500 }
    )
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
