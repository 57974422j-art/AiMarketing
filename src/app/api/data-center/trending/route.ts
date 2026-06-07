import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 热榜追踪 API
 *
 * GET /api/data-center/trending?category=hot&platform=douyin
 */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const platform = searchParams.get('platform')

    const where: any = {}
    if (platform) where.platform = platform
    if (category) where.category = category

    // 获取热榜数据，按排名+热度排序
    const trending = await prisma.crawledTrending.findMany({
      where,
      orderBy: [{ rank: 'asc' }, { heatValue: 'desc' }],
      take: 100,
    })

    // 分类统计
    const categoryStats = await prisma.crawledTrending.groupBy({
      by: ['category'],
      _count: true,
      where: platform ? { platform } : undefined,
    })

    // 平台统计
    const platformStats = await prisma.crawledTrending.groupBy({
      by: ['platform'],
      _count: true,
    })

    return NextResponse.json({
      success: true,
      data: {
        list: trending,
        filters: {
          categories: categoryStats.map(c => ({ category: c.category, count: c._count })),
          platforms: platformStats.map(p => ({ platform: p.platform, count: p._count })),
        },
      },
    })
  } catch (error: any) {
    console.error('[热榜API] 错误:', error)
    return NextResponse.json(
      { success: false, message: error.message || '获取热榜数据失败' },
      { status: 500 }
    )
  }
}
