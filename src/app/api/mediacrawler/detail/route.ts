import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { crawl } from '../lib/crawler-client'

/**
 * GET /api/mediacrawler/detail?url={video_url}
 *
 * 视频详情 - 仅 Admin 可用
 */
export async function GET(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可用' }, { status: 403 })

    const videoUrl = req.nextUrl.searchParams.get('url')

    if (!videoUrl) {
      return NextResponse.json({ success: false, message: '缺少 url 参数（视频链接）' }, { status: 400 })
    }

    const result = await crawl('detail', { url: videoUrl })

    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error('[API /mediacrawler/detail]', e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  }
}
