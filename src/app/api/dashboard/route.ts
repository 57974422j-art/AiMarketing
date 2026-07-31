import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  const teamId = request.headers.get('X-User-Team-Id')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role, teamId: teamId ? parseInt(teamId) : null }
}

function checkPermission(role: string, action: 'read' | 'write' | 'delete'): boolean {
  switch (action) {
    case 'read': return ['end-user', 'viewer', 'editor', 'admin'].includes(role)
    case 'write': return ['editor', 'admin'].includes(role)
    case 'delete': return role === 'admin'
    default: return false
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }
    
    if (!checkPermission(user.role, 'read')) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }

    let whereClause: any = {}
    if (user.role === 'admin') {
      whereClause = {}
    } else if (user.teamId) {
      whereClause = { user: { teamId: user.teamId } }
    } else {
      whereClause = { user: { id: user.userId as any } }
    }

    const dashboardStats = await prisma.dashboardStat.findMany({
      where: whereClause,
      orderBy: { date: 'desc' },
    })

    // 没有数据时返回空结构（不再自动播种 mock 数据）
    if (dashboardStats.length === 0) {
      return NextResponse.json({
        totalFollowers: 0,
        totalPublishCount: 0,
        averageEngagementRate: 0,
        platformStats: [],
      })
    }

    const totalFollowers = dashboardStats.reduce((sum: number, stat: any) => sum + stat.followers, 0)
    const totalPublishCount = dashboardStats.reduce((sum: number, stat: any) => sum + stat.publishCount, 0)
    const averageEngagementRate = dashboardStats.reduce((sum: number, stat: any) => sum + stat.engagementRate, 0) / dashboardStats.length || 0

    const platformStats = dashboardStats.map((stat: any) => ({
      platform: stat.platform,
      followers: stat.followers,
      publishCount: stat.publishCount,
      engagementRate: stat.engagementRate,
      // growthRate 需要两次采集对比计算，单次查询暂返回 null（前端显示"开发中"）
      growthRate: null as number | null,
    }))

    return NextResponse.json({
      totalFollowers,
      totalPublishCount,
      averageEngagementRate,
      platformStats,
    })
  } catch (error) {
    console.error('获取仪表盘数据错误:', error)
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}
// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
