import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET(req: NextRequest) {
  try {
    const userIdHeader = req.headers.get('X-User-Id')
    const role = req.headers.get('X-User-Role')
    if (!userIdHeader || !role) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    const userId = parseInt(userIdHeader)

    /* 查询范围：admin 看全部，其他看自己及下级 */
    let userIds: number[] = [userId]
    if (role === 'admin') {
      const allUsers = await prisma.user.findMany({ select: { id: true } })
      userIds = allUsers.map(u => u.id)
    } else if (role === 'editor') {
      const children = await prisma.user.findMany({ where: { parentId: userId }, select: { id: true } })
      userIds = [userId, ...children.map(u => u.id)]
    }

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekAgo = new Date(now.getTime() - 7 * 86400000)
    const monthAgo = new Date(now.getTime() - 30 * 86400000)

    const [
      totalUsage,
      todayUsage,
      weekUsage,
      monthlyUsage,
      todayDetail,
    ] = await Promise.all([
      prisma.usageLog.count({ where: { userId: { in: userIds } } }),
      prisma.usageLog.aggregate({
        where: { userId: { in: userIds }, createdAt: { gte: todayStart } },
        _sum: { tokens: true, count: true },
      }),
      prisma.usageLog.groupBy({
        by: ['action'],
        where: { userId: { in: userIds }, createdAt: { gte: weekAgo } },
        _count: { id: true },
        _sum: { tokens: true },
        orderBy: { _count: { id: 'desc' } },
        take: 8,
      }),
      prisma.usageLog.groupBy({
        by: ['action'],
        where: { userId: { in: userIds }, createdAt: { gte: monthAgo } },
        _count: { id: true },
        _sum: { tokens: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),

      /* 今日各模块统计 */
      prisma.usageLog.groupBy({
        by: ['action', 'model'],
        where: { userId: { in: userIds }, createdAt: { gte: todayStart } },
        _sum: { tokens: true, count: true },
      }),
    ])

    const actionLabelMap: Record<string, string> = {
      ai_copy: 'AI 文案',
      ai_image: 'AI 生图',
      video_edit: '视频剪辑',
      ai_chat: 'AI 对话',
      text_to_video: '文生视频',
      digital_human: '数字人',
    }

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalUsage,
          todayCount: todayUsage._sum.count || 0,
          todayTokens: todayUsage._sum.tokens || 0,
          weeklyTotal: weekUsage.reduce((s, i) => s + i._count.id, 0),
          weeklyTokens: weekUsage.reduce((s, i) => s + (i._sum.tokens || 0), 0),
          monthlyTotal: monthlyUsage.reduce((s, i) => s + i._count.id, 0),
          monthlyTokens: monthlyUsage.reduce((s, i) => s + (i._sum.tokens || 0), 0),
        },
        topWeekly: weekUsage.map(item => ({
          action: item.action,
          label: actionLabelMap[item.action] || item.action,
          count: item._count.id,
          tokens: item._sum.tokens || 0,
        })),
        topMonthly: monthlyUsage.map(item => ({
          action: item.action,
          label: actionLabelMap[item.action] || item.action,
          count: item._count.id,
          tokens: item._sum.tokens || 0,
        })),
        todayDetail: todayDetail.map(item => ({
          action: item.action,
          label: actionLabelMap[item.action] || item.action,
          model: (item as any).model || '-',
          count: item._sum.count || 0,
          tokens: item._sum.tokens || 0,
        })),
      },
    })
  } catch (e: unknown) {
    console.error('[API /dashboard/usage GET]', e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
