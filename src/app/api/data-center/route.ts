import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 数据中心仪表盘 API
 *
 * GET /api/data-center
 * 返回所有关键指标的聚合统计数据
 */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    // 并行查询所有统计指标
    const [
      totalVideos,
      totalComments,
      totalLeads,
      totalUsers,
      totalTrending,
      recentTasks,
      platformVideoStats,
      leadStatusBreakdown,
      dailyLeadTrend,
      topVideosByLikes,
    ] = await Promise.all([
      // 1. 总视频数
      prisma.crawledVideo.count(),

      // 2. 总评论数
      prisma.crawledComment.count(),

      // 3. 总线索数
      prisma.lead.count({
        where: {
          OR: [{ ownerId: auth.userId }, { assignedTo: auth.userId }],
        },
      }),

      // 4. 用户画像数
      prisma.crawledUserProfile.count(),

      // 5. 热门话题数
      prisma.crawledTrending.count(),

      // 6. 最近采集任务（最近10条）
      prisma.collectionTask.findMany({
        where: { ownerId: auth.userId },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          name: true,
          status: true,
          platform: true,
          createdAt: true,
          _count: { select: { leads: true, crawledVideos: true } },
        },
      }),

      // 7. 按平台统计视频数量
      prisma.crawledVideo.groupBy({
        by: ['platform'],
        _count: { id: true },
      }),

      // 8. 线索状态分布
      prisma.lead.groupBy({
        by: ['status'],
        _count: { id: true },
        where: {
          OR: [{ ownerId: auth.userId }, { assignedTo: auth.userId }],
        },
      }),

      // 9. 近7天每日新增线索趋势
      prisma.$queryRaw<Array<{ day: string; cnt: number }>>`
        SELECT DATE(createdAt) as day, COUNT(*) as cnt 
        FROM Lead 
        WHERE createdAt >= datetime('now', '-7 days')
        GROUP BY DATE(createdAt) ORDER BY day ASC
      `,

      // 10. 点赞最高的视频 Top 5
      prisma.crawledVideo.findMany({
        orderBy: { likeCount: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          authorName: true,
          likeCount: true,
          commentCount: true,
          platform: true,
          coverUrl: true,
          crawledAt: true,
        },
      }),
    ])

    // 计算任务状态分布
    const taskStats = {
      total: recentTasks.length,
      pending: recentTasks.filter(t => t.status === 'pending').length,
      running: recentTasks.filter(t => t.status === 'running').length,
      completed: recentTasks.filter(t => t.status === 'completed').length,
    }

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          totalVideos,
          totalComments,
          totalLeads,
          totalUsers,
          totalTrending,
          totalTasks: taskStats.total,
        },
        tasks: {
          list: recentTasks,
          stats: taskStats,
        },
        platformDistribution: platformVideoStats.map(p => ({
          platform: p.platform,
          count: p._count.id,
        })),
        leadStatus: leadStatusBreakdown.map(s => ({
          status: s.status,
          count: s._count.id,
        })),
        dailyTrend: dailyLeadTrend.map(d => ({
          date: d.day,
          count: d.cnt || 0,
        })),
        topVideos: topVideosByLikes,
      },
    })
  } catch (error: any) {
    console.error('[数据中心API] 错误:', error)
    return NextResponse.json(
      { success: false, message: error.message || '获取数据失败' },
      { status: 500 }
    )
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
