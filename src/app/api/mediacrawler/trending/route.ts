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

    // 2026-08-16: 入库 CrawledTrending（upsert 去重）——data-center/trending 页可查
    if (result.success && Array.isArray((result as any).data)) {
      const { PrismaClient } = await import('@prisma/client')
      const prisma = new PrismaClient()
      const items = (result as any).data as any[]
      for (let i = 0; i < items.length; i++) {
        const title = String(items[i]?.title || '').trim()
        if (!title) continue
        try {
          await prisma.crawledTrending.upsert({
            where: { platform_category_title: { platform: '抖音', category, title } },
            update: { heatValue: Number(items[i]?.heat) || 0, rank: i + 1, crawledAt: new Date() },
            create: { platform: '抖音', category, title, heatValue: Number(items[i]?.heat) || 0, rank: i + 1 },
          })
        } catch (_) {}
      }
      await prisma.$disconnect()
      return NextResponse.json({ success: true, data: items, stored: true })
    }

    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error('[API /mediacrawler/trending]', e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
