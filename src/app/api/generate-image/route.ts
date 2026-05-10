import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { generateImage } from '@/lib/ai-providers'

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    const body = await request.json()
    const { prompt } = body
    if (!prompt?.trim()) {
      return NextResponse.json({ success: false, message: '请提供提示词' }, { status: 400 })
    }
    const imageUrl = await generateImage(prompt)
    if (!imageUrl || imageUrl.startsWith('[Mock')) {
      return NextResponse.json({ success: false, message: 'AI 服务不可用，请配置硅基流动 API Key' }, { status: 503 })
    }
    return NextResponse.json({ success: true, data: { url: imageUrl } })
  } catch (e) {
    console.error('[生成图片] 失败:', e)
    return NextResponse.json({ success: false, message: '生成失败' }, { status: 500 })
  }
}
