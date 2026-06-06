/**
 * 行业洞察 Dashboard API - 数据聚合与统计接口
 * 
 * 路由：
 * GET  /api/insights?view=overview    → 总览（线索数、任务数、采集量等）
 * GET  /api/insights?view=leads      → 线索趋势与分布
 * GET  /api/insights?view=trending   → 热门话题/趋势数据
 * GET  /api/insights?view=keywords   → 关键词效果分析
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'
import { dispatchEngine } from '@/lib/engine-dispatcher'

const prisma = new PrismaClient()

// ====== GET: 数据聚合接口 ======
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'overview'
    const days = parseInt(searchParams.get('days') || '30')

    switch (view) {
      case 'overview':
        return await handleOverview(auth.userId, days)
      
      case 'leads':
        return await handleLeadInsights(auth.userId, days)
      
      case 'trending':
        return await handleTrendingData(auth.userId)
      
      case 'keywords':
        return await handleKeywordAnalysis(auth.userId, days)
      
      case 'collection':
        return await handleCollectionStats(auth.userId)
      
      default:
        return NextResponse.json(
          { success: false, message: `未知视图: ${view}，支持: overview / leads / trending / keywords / collection` },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('[Insights] 查询失败:', error)
    return NextResponse.json(
      { success: false, message: '查询失败' },
      { status: 500 }
    )
  }
}

// ====== 总览面板 ======

/**
 * 返回仪表盘总览数据
 */
async function handleOverview(userId: number, days: number) {
  const since = new Date()
  since.setDate(since.getDate() - days)

  // 并行查询所有统计数据
  const [
    totalLeads,
    newLeadsThisWeek,
    activeTasks,
    totalReferrals,
    leadByStatus,
    recentCollections,
  ] = await Promise.all([
    // 总线索数
    prisma.lead.count({
      where: {
        OR: [{ ownerId: userId }, { assignedTo: userId }]
      }
    }),
    // 本周新增线索
    prisma.lead.count({
      where: {
        OR: [{ ownerId: userId }, { assignedTo: userId }],
        createdAt: { gte: since }
      }
    }),
    // 活跃采集任务
    prisma.collectionTask.count({
      where: {
        OR: [{ ownerId: userId }, { ownerId: 0 }],
        status: { in: ['active', 'running'] }
      }
    }),
    // 导流配置数
    prisma.referralConfig.count({
      where: { ownerId: userId, status: 'active' }
    }),
    // 线索按状态分组
    prisma.lead.groupBy({
      by: ['status'],
      where: {
        OR: [{ ownerId: userId }, { assignedTo: userId }]
      },
      _count: true
    }),
    // 最近7天每日新增线索
    getDailyLeadTrend(userId, 7),
  ])

  // 构建状态分布图数据
  const statusDistribution = leadByStatus.reduce((acc, item) => {
    acc[item.status] = item._count
    return acc
  }, {} as Record<string, number>)

  return NextResponse.json({
    success: true,
    data: {
      summary: {
        totalLeads,
        newLeadsThisWeek,
        activeTasks,
        totalReferrals,
        conversionRate: totalLeads > 0 ? Math.round((newLeadsThisWeek / totalLeads) * 100) : 0,
      },
      statusDistribution,
      dailyTrend: recentCollections,
    }
  })
}

// ====== 线索分析 ======

async function handleLeadInsights(userId: number, days: number) {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const [dailyTrend, platformDist, sourceTypeDist, intentScoreAvg] = await Promise.all([
    // 每日趋势（按天）
    getDailyLeadTrend(userId, days),
    // 平台分布
    prisma.lead.groupBy({
      by: ['platform'],
      where: {
        OR: [{ ownerId: userId }, { assignedTo: userId }],
        createdAt: { gte: since },
      },
      _count: true,
    }),
    // 来源类型分布
    prisma.lead.groupBy({
      by: ['sourceType'],
      where: {
        OR: [{ ownerId: userId }, { assignedTo: userId }],
        createdAt: { gte: since },
      },
      _count: true,
    }),
    // 平均意向分（安全处理空数据）
    prisma.lead.aggregate({
      where: {
        OR: [{ ownerId: userId }, { assignedTo: userId }],
        createdAt: { gte: since },
      },
      _avg: { intentScore: true },
      _max: { intentScore: true },
    }),
  ])

  // 安全取值：聚合结果可能为 null
  const avgScore = intentScoreAvg._avg?.intentScore ?? 0
  const maxScore = intentScoreAvg._max?.intentScore ?? 0

  return NextResponse.json({
    success: true,
    data: {
      dailyTrend,
      platformDistribution: platformDist.reduce((acc, item) => {
        acc[item.platform] = item._count
        return acc
      }, {} as Record<string, number>),
      sourceTypeDistribution: sourceTypeDist.reduce((acc, item) => {
        acc[item.sourceType] = item._count
        return acc
      }, {} as Record<string, number>),
      intentStats: {
        avg: Math.round(avgScore),
        max: maxScore,
      },
    }
  })
}

// ====== 热门话题/趋势 ======

async function handleTrendingData(_userId: number) {
  try {
    // 从数据采集引擎获取热门话题
    const result = await dispatchEngine({
      action: 'trending_topics',
      platform: '抖音',
      params: { category: 'all', count: 20 },
      userId: _userId,
    })

    if (result.success && result.data) {
      return NextResponse.json({ success: true, data: { source: (result as any).provider || 'engine', topics: result.data } })
    }

    // API 失败时返回本地缓存的热门关键词
    const topKeywords = await prisma.lead.findMany({
      where: { intentScore: { gte: 60 } },
      orderBy: { intentScore: 'desc' },
      take: 10,
      select: { rawContent: true, platform: true, intentScore: true },
    })

    return NextResponse.json({
      success: true,
      data: {
        source: 'local_cache',
        topics: topKeywords.map(k => ({
          title: k.rawContent.substring(0, 50),
          source: k.platform,
          score: k.intentScore,
        })),
        fallback: true,
      }
    })
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      message: e.message || '获取趋势数据失败',
    })
  }
}

// ====== 关键词效果分析 ======

async function handleKeywordAnalysis(userId: number, days: number) {
  const since = new Date()
  since.setDate(since.getDate() - days)

  // 获取用户的所有采集任务
  const tasks = await prisma.collectionTask.findMany({
    where: {
      OR: [{ ownerId: userId }, { ownerId: 0 }],
    },
    include: {
      _count: { select: { leads: true } },
      leads: {
        where: { createdAt: { gte: since } },
        select: { id: true, intentScore: true, status: true, createdAt: true },
      },
    },
  })

  // 分析每个任务的关键词效果
  const keywordStats = tasks.map(task => {
    const keywords = JSON.parse(task.keywords || '[]') as string[]
    const taskLeads = task.leads
    const highIntentCount = taskLeads.filter(l => l.intentScore >= 60).length
    const convertedCount = taskLeads.filter(l => l.status === 'converted').length

    return {
      taskId: task.id,
      taskName: task.name,
      keywords,
      totalLeads: task._count.leads,
      periodLeads: taskLeads.length,
      highIntentLeads: highIntentCount,
      convertedLeads: convertedCount,
      conversionRate: taskLeads.length > 0 ? Math.round((convertedCount / taskLeads.length) * 100) : 0,
      avgIntentScore: taskLeads.length > 0
        ? Math.round(taskLeads.reduce((s, l) => s + l.intentScore, 0) / taskLeads.length)
        : 0,
      status: task.status,
    }
  }).sort((a, b) => b.periodLeads - a.periodLeads)

  return NextResponse.json({
    success: true,
    data: { keywordStats, totalTasks: tasks.length }
  })
}

// ====== 采集执行统计 ======

async function handleCollectionStats(userId: number) {
  const [taskStats, recentRuns] = await Promise.all([
    // 各任务统计
    prisma.collectionTask.findMany({
      where: { OR: [{ ownerId: userId }, { ownerId: 0 }] },
      include: { _count: { select: { leads: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    // 最近创建的线索（最近10条）
    prisma.lead.findMany({
      where: { OR: [{ ownerId: userId }, { assignedTo: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        rawContent: true,
        platform: true,
        sourceType: true,
        intentScore: true,
        status: true,
        createdAt: true,
      },
    }),
  ])

  return NextResponse.json({
    success: true,
    data: {
      tasks: taskStats,
      recentLeads: recentRuns,
    }
  })
}

// ====== 工具函数 ======

/** 获取指定天数内的每日新增线索趋势 */
async function getDailyLeadTrend(userId: number, days: number): Promise<Array<{ date: string; count: number }>> {
  try {
    const since = new Date()
    since.setDate(since.getDate() - days)

    // 使用 Prisma 原生查询（兼容 SQLite）
    const raw = await prisma.$queryRaw<Array<{ date: string; count: number }>>`
      SELECT DATE(createdAt) as date, COUNT(*) as count 
      FROM Lead 
      WHERE (ownerId = ${userId} OR assignedTo = ${userId})
        AND createdAt >= ${since}
      GROUP BY DATE(createdAt)
      ORDER BY date DESC
    `
    
    // 补全缺失的日期（显示为 0）
    const resultMap = new Map((raw || []).map(r => [String(r.date).split('T')[0], r.count]))
    const trend: Array<{ date: string; count: number }> = []

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      trend.push({
        date: dateStr,
        count: resultMap.get(dateStr) || 0,
      })
    }

    return trend
  } catch (e) {
    console.error('[getDailyLeadTrend] 查询失败:', e)
    // 返回空趋势数据
    const trend: Array<{ date: string; count: number }> = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      trend.push({ date: d.toISOString().split('T')[0], count: 0 })
    }
    return trend
  }
}
