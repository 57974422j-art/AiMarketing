import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { crawl } from '../lib/crawler-client'

/**
 * GET /api/mediacrawler/trending?category=hot&count=20
 *
 * 热门话题 - 仅 Admin 可用
 * category: all | hot | realtime | video | live
 */
export async function GET(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可用' }, { status: 403 })

    const category = req.nextUrl.searchParams.get('category') || 'hot'
    const count = req.nextUrl.searchParams.get('count') || '20'

    const result = await crawl('trending', { category, count })

    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error('[API /mediacrawler/trending]', e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  }
}
