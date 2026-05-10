import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { generateText } from '@/lib/ai-providers'

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
  return NextResponse.json({ success: true, data: { referrals: [] } })
}

// 智能生成导流文案
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { platform, keywords, action } = await request.json()

    // 生成导流文案
    if (action === 'generate') {
      if (!platform || !keywords) {
        return NextResponse.json({ success: false, message: '缺少平台或关键词' }, { status: 400 })
      }
      const prompt = `你是一个短视频营销专家。请为以下平台生成一条导流文案（吸引用户私信/加微信）：

平台：${platform}
关键词：${keywords}

要求：
1. 文案长度 80-120 字
2. 包含引导行动（如"私信我获取详情""加微信领资料"）
3. 语气亲切自然
4. 只返回文案内容，不要任何解释`
      
      const copy = await generateText(prompt)
      return NextResponse.json({ success: true, data: { copy: copy || '生成失败' } })
    }

    return NextResponse.json({ success: true, message: '暂不支持' })
  } catch (error) {
    console.error('导流文案生成失败:', error)
    return NextResponse.json({ success: false, message: '生成失败' }, { status: 500 })
  }
}
