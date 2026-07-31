import { NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { checkHealth } from './lib/crawler-client'

/**
 * GET /api/mediacrawler - MediaCrawler 服务健康检查
 * 仅 Admin 可用
 */
export async function GET(req: Request) {
  try {
    const auth = getAuthFromHeaders(req as any)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可用' }, { status: 403 })

    const health = await checkHealth()

    return NextResponse.json({
      success: true,
      data: health,
      message: health.available
        ? 'MediaCrawler 服务可用'
        : 'MediaCrawler 不可用，请检查部署配置',
    })
  } catch (e: unknown) {
    console.error('[API /mediacrawler health]', e)
    return NextResponse.json({ success: false, message: '健康检查失败' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
