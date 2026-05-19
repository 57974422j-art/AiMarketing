/**
 * ================================================================
 * 管理后台 Dashboard API
 * ================================================================
 * 
 * 三层角色数据范围：
 * ┌──────────┬──────────────────────────────────────────────────┐
 * │ admin    │ 全局数据：所有设备/所有任务/所有客户/所有窗口    │
 * │          │ 可查看每个 editor 的详细运行数据                  │
 * ├──────────┼──────────────────────────────────────────────────┤
 * │ editor   │ 自己的数据：自己名下的设备/任务/窗口池           │
 * │          │ 可查看下属 end-user 的账号使用情况               │
 * ├──────────┼──────────────────────────────────────────────────┤
 * │ end-user │ 无权访问此 API，走 /api/dashboard               │
 * └──────────┴──────────────────────────────────────────────────┘
 * 
 * 【未来 AI 可扩展】
 * - UsageLog.tokens 字段已预留，可统计 AI 工具 Token 消耗
 * - WindowSession 表已建立，可统计窗口使用效率
 * - 直播数据可追加到返回结构中的 liveStreaming 字段
 * ================================================================
 */

import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })

    const isAdmin = auth.role === 'admin'
    const userId = auth.userId

    // === 时间范围 ===
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    // === 查询过滤器 ===
    const ownerFilter = isAdmin ? {} : { ownerId: userId }
    const taskCreatorFilter = isAdmin ? {} : { createdBy: userId }
    // admin 能看到所有 editor 的 children，editor 只看自己创建的 end-user
    const userScope = isAdmin
      ? {}
      : { OR: [{ id: userId }, { parentId: userId }] }

    // ================================================================
    // 并行查询所有数据
    // ================================================================
    const [
      deviceCounts,       // 设备统计
      taskStats,          // 任务统计
      todayTasks,         // 今日任务
      accountCount,       // 账号统计
      windowPoolData,     // 窗口池数据
      editors,            // 下级列表 (admin 看所有 editor, editor 看自己的下属)
      todayUsage,         // 今日 AI 用量
      followerData,       // 粉丝增长
      videoTasks,         // 视频剪辑统计
      todayWindowSessions,// 今日窗口使用
    ] = await Promise.all([
      // --- 设备统计 ---
      prisma.device.groupBy({
        by: ['status'],
        where: ownerFilter,
        _count: true,
      }),

      // --- 任务总览 ---
      prisma.automationTask.groupBy({
        by: ['status', 'type'],
        where: taskCreatorFilter,
        _count: true,
      }),

      // --- 今日发布 ---
      prisma.automationTask.count({
        where: { ...taskCreatorFilter, type: '发布视频', status: '已完成', createdAt: { gte: todayStart, lte: todayEnd } },
      }),

      // --- 账号统计 ---
      prisma.socialAccount.groupBy({
        by: ['platform', 'status'],
        where: isAdmin ? {} : { userId: { in: [userId] } },  // editor 只看自己的账号
        _count: true,
      }),

      // --- 窗口池 ---
      (isAdmin
        ? prisma.devicePool.findMany({ include: { owner: { select: { username: true, name: true, id: true } }, sessions: true } })
        : prisma.devicePool.findMany({ where: { ownerId: userId }, include: { sessions: true } })
      ),

      // --- 下级用户列表 ---
      (isAdmin
        ? prisma.user.findMany({
            where: { role: 'editor' },
            select: { id: true, username: true, name: true, devicePools: { select: { totalWindows: true, usedWindows: true, dailyQuota: true } } },
          })
        : prisma.user.findMany({
            where: { parentId: userId, role: 'end-user' },
            select: { id: true, username: true, name: true, socialAccounts: { select: { platform: true } }, _count: { select: { createdTasks: true } } },
          })
      ),

      // --- AI 工具用量今日统计 ---
      prisma.usageLog.groupBy({
        by: ['action'],
        where: { userId },
        _sum: { count: true, tokens: true },
        _count: true,
      }),

      // --- 粉丝增长 ---
      prisma.dashboardStat.findMany({
        where: { userId, date: { gte: sevenDaysAgo } },
        orderBy: { date: 'asc' },
        select: { date: true, followers: true },
      }),

      // --- 视频剪辑统计 ---
      prisma.videoTask.groupBy({
        by: ['status'],
        where: { userId, createdAt: { gte: thirtyDaysAgo } },
        _count: true,
      }),

      // --- 今日窗口会话 ---
      prisma.windowSession.count({
        where: {
          ...(isAdmin ? {} : { pool: { ownerId: userId } }),
          openedAt: { gte: todayStart, lte: todayEnd },
        },
      }),
    ])

    // ================================================================
    // 数据整理
    // ================================================================

    // 设备统计
    const totalDevices = deviceCounts.reduce((s, d) => s + d._count, 0)
    const onlineDevices = deviceCounts.find(d => d.status === 'online')
    const offlineDevices = deviceCounts.find(d => d.status === 'offline')
    const busyDevices = deviceCounts.find(d => d.status === 'busy')

    // 任务统计
    const totalTasks = taskStats.reduce((s, d) => s + d._count, 0)
    const successTasks = taskStats.filter(d => d.status === '已完成').reduce((s, d) => s + d._count, 0)
    const failedTasks = taskStats.filter(d => d.status === '失败').reduce((s, d) => s + d._count, 0)
    const successRate = totalTasks > 0 ? Math.round((successTasks / totalTasks) * 100) : 0

    // 按类型统计任务
    const taskByType: Record<string, number> = {}
    taskStats.forEach(d => { taskByType[d.type] = (taskByType[d.type] || 0) + d._count })

    // 账号统计
    const totalAccounts = accountCount.reduce((s, d) => s + d._count, 0)
    const boundAccounts = accountCount.filter(d => d.status === '已绑定').reduce((s, d) => s + d._count, 0)

    // 窗口池
    const poolTotal = windowPoolData.reduce((s, p) => s + p.totalWindows, 0)
    const poolUsed = windowPoolData.reduce((s, p) => s + p.usedWindows, 0)
    const poolDaily = windowPoolData.reduce((s, p) => s + p.dailyQuota, 0)

    // 粉丝增长
    const followerGrowth = followerData.length >= 2
      ? (followerData[followerData.length - 1]?.followers || 0) - (followerData[0]?.followers || 0)
      : 0

    // AI 用量
    const aiUsage: Record<string, { count: number; tokens: number }> = {}
    todayUsage.forEach(d => {
      aiUsage[d.action] = { count: d._sum.count || 0, tokens: d._sum.tokens || 0 }
    })

    // 视频剪辑
    const videoTaskCount = videoTasks.reduce((s, d) => s + d._count, 0)
    const videoDone = videoTasks.filter(d => d.status === '已完成').reduce((s, d) => s + d._count, 0)

    // ================================================================
    // 构建返回
    // ================================================================

    const response: any = {
      success: true,
      data: {
        role: auth.role,
        // --- 概览统计（两种角色都展示） ---
        overview: {
          todayPublished: todayTasks,
          totalTasks,
          successTasks,
          failedTasks,
          successRate,
          followerGrowth,
          videoTaskCount,
          videoTaskDone: videoDone,
        },
        // --- 设备统计 ---
        devices: {
          total: totalDevices,
          online: onlineDevices?._count || 0,
          offline: offlineDevices?._count || 0,
          busy: busyDevices?._count || 0,
          onlineRate: totalDevices > 0 ? Math.round(((onlineDevices?._count || 0) / totalDevices) * 100) : 0,
        },
        // --- 账号 ---
        accounts: {
          total: totalAccounts,
          bound: boundAccounts,
          byPlatform: accountCount.reduce((acc: any, d) => {
            if (!acc[d.platform]) acc[d.platform] = {}
            acc[d.platform][d.status] = d._count
            return acc
          }, {}),
        },
        // --- 窗口池 ---
        windows: {
          poolTotal,
          poolUsed,
          poolDaily,
          todaySessions: todayWindowSessions,
          pools: windowPoolData.map(p => ({
            ownerId: p.ownerId,
            ownerName: (p as any).owner?.username || '未知',
            totalWindows: p.totalWindows,
            usedWindows: p.usedWindows,
            dailyQuota: p.dailyQuota,
            activeSessions: p.sessions.filter(s => s.status === 'active').length,
          })),
        },
        // --- 任务按类型分布 ---
        taskByType,
        // --- AI 工具用量 ---
        aiUsage,
        // --- 下级列表 ---
        subordinates: editors.map((e: any) => {
          if (isAdmin) {
            // admin 看到的 editor 列表
            const pool = (e as any).devicePools?.[0] || { totalWindows: 0, usedWindows: 0, dailyQuota: 0 }
            return {
              id: e.id, username: e.username, name: e.name || e.username,
              totalWindows: pool.totalWindows, usedWindows: pool.usedWindows, dailyQuota: pool.dailyQuota,
            }
          } else {
            // editor 看到的 end-user 列表
            return {
              id: e.id, username: e.username, name: e.name || e.username,
              accounts: e.socialAccounts.map((a: any) => a.platform),
              taskCount: (e as any)._count?.createdTasks || 0,
            }
          }
        }),
        // --- 粉丝 7 天趋势 ---
        followerTrend: followerData.map(d => ({ date: d.date.toISOString().split('T')[0], followers: d.followers })),
        // --- 直播统计（预留） ---
        // 【直播数据】Q1 推流开播后，从此处扩展：
        // liveStreaming: {
        //   todayStreams: 0,      // 今日开播场次
        //   totalDuration: 0,     // 总直播时长（分钟）
        //   peakViewers: 0,       // 最高在线人数
        //   totalViewers: 0,      // 总观看人数
        // },
        liveStreaming: {
          todayStreams: 0,
          totalDuration: 0,
          peakViewers: 0,
          totalViewers: 0,
          status: '未配置',
          // 【接入方式】使用 Q1 流管理功能，RTMP 推流到抖音开播
          // 1. Q1 容器内启动直播推流（OBS/FFmpeg）
          // 2. 通过 uiautomator 点击抖音开播按钮
          // 3. 推流地址配置在 DevicePool 中
          // 详细文档查阅 Q1 流管理说明
        },
        // --- AI Token 消耗统计（预留） ---
        // 【AI 成本】UsageLog.tokens 记录每次 AI 调用的 token 消耗
        // 目前数据尚未完整录入，后续对接 AI provider 后自动统计
        // action 类型: ai_copy / ai_image / video_edit / ai_chat / text_to_video / digital_human
        aiTokens: {
          total: Object.values(aiUsage).reduce((s: number, u: any) => s + u.tokens, 0),
          details: aiUsage,
        },
      },
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Dashboard API 错误:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
