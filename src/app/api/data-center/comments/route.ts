import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 评论池数据 API
 *
 * GET /api/data-center/comments?page=1&size=20&videoId=5&keyword=xxx&hasLead=true&sort=crawledAt
 */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const size = Math.min(100, Math.max(1, parseInt(searchParams.get('size') || '20')))
    const videoId = searchParams.get('videoId')
    const keyword = searchParams.get('keyword')?.trim()
    const hasLead = searchParams.get('hasLead')
    const sort = searchParams.get('sort') || 'crawledAt'
    const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc'

    const where: any = {}
    if (videoId) where.videoId = parseInt(videoId)
    if (keyword) where.content = { contains: keyword }
    if (hasLead === 'true') where.leadId = { not: null }

    const allowedSorts = ['crawledAt', 'likeCount', 'createdAt', 'intentScore']
    const orderByField = allowedSorts.includes(sort) ? sort : 'crawledAt'

    const [comments, total] = await Promise.all([
      prisma.crawledComment.findMany({
        where,
        orderBy: { [orderByField]: order },
        skip: (page - 1) * size,
        take: size,
        include: {
          video: {
            select: { id: true, title: true, platform: true, authorName: true, coverUrl: true },
          },
        },
      }),
      prisma.crawledComment.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: {
        list: comments,
        pagination: {
          page,
          size,
          total,
          totalPages: Math.ceil(total / size),
        },
      },
    })
  } catch (error: any) {
    console.error('[评论池API] 错误:', error)
    return NextResponse.json(
      { success: false, message: error.message || '获取评论数据失败' },
      { status: 500 }
    )
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
