import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { crawl } from '../lib/crawler-client'

/**
 * GET /api/mediacrawler/comments?url={video_url}&count=50
 *
 * 视频评论爬取 - 仅 Admin 可用
 */
export async function GET(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可用' }, { status: 403 })

    const videoUrl = req.nextUrl.searchParams.get('url')
    const count = req.nextUrl.searchParams.get('count') || '50'

    if (!videoUrl) {
      return NextResponse.json({ success: false, message: '缺少 url 参数（视频链接）' }, { status: 400 })
    }

    const result = await crawl('comments', { url: videoUrl, count })

    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error('[API /mediacrawler/comments]', e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  }
}
