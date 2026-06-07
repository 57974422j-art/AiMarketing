import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 用户画像库 API
 *
 * GET /api/data-center/users?page=1&size=20&platform=douyin&keyword=xxx&verifiedOnly=true&sortBy=followers
 */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const size = Math.min(100, Math.max(1, parseInt(searchParams.get('size') || '24')))
    const platform = searchParams.get('platform')
    const keyword = searchParams.get('keyword')?.trim()
    const verifiedOnly = searchParams.get('verifiedOnly') === 'true'
    const sortBy = searchParams.get('sortBy') || 'followerCount'

    const where: any = {}
    if (platform) where.platform = platform
    if (keyword) where.nickname = { contains: keyword }
    if (verifiedOnly) where.isVerified = true

    const allowedSorts = ['followerCount', 'likeCount', 'videoCount', 'lastCrawledAt', 'firstCrawledAt']
    const orderByField = allowedSorts.includes(sortBy) ? sortBy : 'followerCount'

    const [users, total] = await Promise.all([
      prisma.crawledUserProfile.findMany({
        where,
        orderBy: { [orderByField]: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.crawledUserProfile.count({ where }),
    ])

    // 平台统计
    const platformStats = await prisma.crawledUserProfile.groupBy({
      by: ['platform'],
      _count: true,
    })

    // 认证用户占比
    const [verifiedCount, totalCount] = await Promise.all([
      prisma.crawledUserProfile.count({ where: { isVerified: true } }),
      prisma.crawledUserProfile.count(),
    ])

    return NextResponse.json({
      success: true,
      data: {
        list: users,
        pagination: { page, size, total, totalPages: Math.ceil(total / size) },
        summary: {
          totalUsers: totalCount,
          verifiedUsers: verifiedCount,
          verifiedRate: totalCount > 0 ? ((verifiedCount / totalCount) * 100).toFixed(1) : '0',
        },
        filters: {
          platforms: platformStats.map(p => ({ platform: p.platform, count: p._count })),
        },
      },
    })
  } catch (error: any) {
    console.error('[用户画像API] 错误:', error)
    return NextResponse.json(
      { success: false, message: error.message || '获取用户画像数据失败' },
      { status: 500 }
    )
  }
}
