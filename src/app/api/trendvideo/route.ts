import { NextRequest, NextResponse } from 'next/server'
import { searchTrends, analyzeTrends, extractVideoInsights } from '@/lib/gemini'
import { getAuthFromHeaders } from '@/lib/api-auth'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action') || 'search'
    const body = await request.json()

    // 趋势搜索
    if (action === 'search') {
      const { keyword, platforms, count } = body
      if (!keyword) return NextResponse.json({ success: false, message: '请输入关键词' }, { status: 400 })
      const results = await searchTrends(keyword, platforms || ['YouTube', 'TikTok', 'Twitter', 'Bilibili', 'Douyin'], count || 30)
      return NextResponse.json({ success: true, data: results })
    }

    // AI 深度分析
    if (action === 'analyze') {
      const { items } = body
      if (!items?.length) return NextResponse.json({ success: false, message: '无数据' }, { status: 400 })
      const analyzed = await analyzeTrends(items)
      return NextResponse.json({ success: true, data: analyzed })
    }

    // 单个洞察
    if (action === 'insight') {
      const { item } = body
      if (!item) return NextResponse.json({ success: false, message: '无数据' }, { status: 400 })
      const data = await extractVideoInsights(item)
      return NextResponse.json({ success: true, data })
    }

    return NextResponse.json({ success: false, message: `未知动作: ${action}` }, { status: 400 })
  } catch (error: any) {
    console.error('[TrendVideo]', error)
    return NextResponse.json({ success: false, message: error.message || '处理失败' }, { status: 500 })
  }
}

// 合成视频（复用现有FFmpeg逻辑）
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const action = url.searchParams.get('action')
  if (action === 'synthesize') {
    // 前端调用 /api/trendvideo?action=synthesize 查看进度
    return NextResponse.json({ success: true, message: '合成接口通过 POST 触发' })
  }
  return NextResponse.json({ success: true })
}
