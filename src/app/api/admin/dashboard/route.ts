import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    const isAdmin = auth.role === 'admin'
    const userId = auth.userId

    // 今日时间范围
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date()
    todayEnd.setHours(23, 59, 59, 999)

    // 查询条件
    const userFilter = isAdmin ? {} : { ownerId: userId }
    const taskFilter = isAdmin ? {} : { createdBy: userId }
    const accountFilter = isAdmin ? {} : { userId }

    // 今日发布数（已完成的发布视频任务）
    const todayPublished = await prisma.automationTask.count({
      where: {
        ...taskFilter,
        type: '发布视频',
        status: '已完成',
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    })

    // 总任务数、成功数、失败数
    const [totalTasks, successTasks] = await Promise.all([
      prisma.automationTask.count({ where: taskFilter }),
      prisma.automationTask.count({ where: { ...taskFilter, status: '已完成' } }),
    ])
    const successRate = totalTasks > 0 ? Math.round((successTasks / totalTasks) * 100) : 0

    // 设备在线率
    const [totalDevices, onlineDevices] = await Promise.all([
      prisma.device.count({ where: userFilter }),
      prisma.device.count({ where: { ...userFilter, status: 'online' } }),
    ])
    const onlineRate = totalDevices > 0 ? Math.round((onlineDevices / totalDevices) * 100) : 0

    // 粉丝增长（从 DashboardStat 取近7天差值）
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const recentStats = await prisma.dashboardStat.findMany({
      where: { ...(isAdmin ? {} : { userId }), date: { gte: sevenDaysAgo } },
      orderBy: { date: 'asc' },
    })
    const followerGrowth = recentStats.length >= 2
      ? (recentStats[recentStats.length - 1]?.followers || 0) - (recentStats[0]?.followers || 0)
      : 0

    // 总绑定账号数
    const totalAccounts = await prisma.socialAccount.count({ where: accountFilter })

    return NextResponse.json({
      success: true,
      data: {
        todayPublished,
        followerGrowth,
        successRate,
        onlineRate,
        totalTasks,
        totalAccounts,
        totalDevices,
      },
    })
  } catch (error) {
    console.error('获取看板数据失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
