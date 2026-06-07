import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 视频库数据 API
 *
 * GET /api/data-center/videos?page=1&size=20&platform=douyin&keyword=xxx&taskId=5&sort=crawledAt
 *
 * 查询参数:
 *  - page: 页码 (默认1)
 *  - size: 每页条数 (默认20, 最大100)
 *  - platform: 平台筛选
 *  - keyword: 标题关键词搜索
 *  - taskId: 关联任务ID
 *  - sort: 排序字段 (crawledAt|likeCount|commentCount)
 *  - order: asc | desc (默认desc)
 */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const size = Math.min(100, Math.max(1, parseInt(searchParams.get('size') || '20')))
    const platform = searchParams.get('platform')
    const keyword = searchParams.get('keyword')?.trim()
    const taskId = searchParams.get('taskId')
    const sort = searchParams.get('sort') || 'crawledAt'
    const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc'

    // 构建查询条件
    const where: any = {}
    if (platform) where.platform = platform
    if (keyword) where.title = { contains: keyword }
    if (taskId) where.taskId = parseInt(taskId)

    // 排序白名单
    const allowedSorts = ['crawledAt', 'likeCount', 'commentCount', 'shareCount', 'playCount', 'publishedAt']
    const orderByField = allowedSorts.includes(sort) ? sort : 'crawledAt'

    // 并行查询数据和总数
    const [videos, total] = await Promise.all([
      prisma.crawledVideo.findMany({
        where,
        orderBy: { [orderByField]: order },
        skip: (page - 1) * size,
        take: size,
        include: {
          task: { select: { id: true, name: true } },
          _count: { select: { comments: true } },
        },
      }),
      prisma.crawledVideo.count({ where }),
    ])

    // 获取平台列表（用于筛选器）
    const platforms = await prisma.crawledVideo.groupBy({
      by: ['platform'],
      _count: true,
      orderBy: { platform: 'asc' },
    })

    return NextResponse.json({
      success: true,
      data: {
        list: videos.map(v => ({
          ...v,
          commentsCount: v._count.comments,
        })),
        pagination: {
          page,
          size,
          total,
          totalPages: Math.ceil(total / size),
        },
        filters: {
          platforms: platforms.map(p => p.platform),
        },
      },
    })
  } catch (error: any) {
    console.error('[视频库API] 错误:', error)
    return NextResponse.json(
      { success: false, message: error.message || '获取视频数据失败' },
      { status: 500 }
    )
  }
}
