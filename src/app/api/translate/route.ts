import { NextRequest, NextResponse } from 'next/server'
import { dashscopeTranslate, dashscopeGenerateVideo, dashscopeQueryVideoTask } from '@/lib/ai-providers'

// 翻译 API
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { text, from, to } = body

    if (!text || !to) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数: text, to' },
        { status: 400 }
      )
    }

    const result = await dashscopeTranslate(text, from || 'zh', to)
    
    return NextResponse.json({
      success: true,
      result
    })
  } catch (error) {
    console.error('翻译错误:', error)
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '翻译失败' },
      { status: 500 }
    )
  }
}
