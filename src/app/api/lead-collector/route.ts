import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { generateText } from '@/lib/ai-providers'

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
  return NextResponse.json({ success: true, data: { leads: [] } })
}

// 智能分析关键词/采集客户
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { keywords, action } = await request.json()

    if (action === 'analyze') {
      if (!keywords) {
        return NextResponse.json({ success: false, message: '缺少关键词' }, { status: 400 })
      }
      const prompt = `你是一个营销数据分析师。请分析以下关键词的营销价值，返回 JSON（只返回 JSON）：

关键词：${keywords}

返回格式：
{"intent":"用户意图描述（20字内）","targetGroup":"目标人群画像（30字内）","suggestions":["建议1","建议2","建议3"],"difficulty":"竞争难度（简单/中等/困难）","estimatedTraffic":"预估流量（高/中/低）"}
`
      const result = await generateText(prompt)
      const jsonMatch = result?.match(/\{[\s\S]*\}/)
      const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null
      return NextResponse.json({ success: true, data: analysis || { message: '分析失败' } })
    }

    return NextResponse.json({ success: true, message: '暂不支持' })
  } catch (error) {
    console.error('关键词分析失败:', error)
    return NextResponse.json({ success: false, message: '分析失败' }, { status: 500 })
  }
}
