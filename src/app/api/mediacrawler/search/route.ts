import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { crawl } from '../lib/crawler-client'

/**
 * GET /api/mediacrawler/search?keyword=美业&count=20&sort_type=general
 *
 * 视频搜索 - 仅 Admin 可用
 */
export async function GET(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可用' }, { status: 403 })

    const keyword = req.nextUrl.searchParams.get('keyword')
    const count = req.nextUrl.searchParams.get('count') || '20'
    const sortType = req.nextUrl.searchParams.get('sort_type') || 'general'

    if (!keyword) {
      return NextResponse.json({ success: false, message: '缺少 keyword 参数' }, { status: 400 })
    }

    const result = await crawl('search', { keyword, count, sort_type: sortType })

    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error('[API /mediacrawler/search]', e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
