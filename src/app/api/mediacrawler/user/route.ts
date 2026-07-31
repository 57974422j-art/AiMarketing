import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { crawl } from '../lib/crawler-client'

/**
 * GET /api/mediacrawler/user?sec_user_id=xxx
 *
 * 用户画像查询 - 仅 Admin 可用
 */
export async function GET(req: NextRequest) {
  try {
    const auth = getAuthFromHeaders(req)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可用' }, { status: 403 })

    const secUserId = req.nextUrl.searchParams.get('sec_user_id') || req.nextUrl.searchParams.get('user_id')

    if (!secUserId) {
      return NextResponse.json({ success: false, message: '缺少 sec_user_id 或 user_id 参数' }, { status: 400 })
    }

    const result = await crawl('user', { sec_user_id: secUserId })

    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error('[API /mediacrawler/user]', e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
