import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role }
}

function checkPermission(role: string, action: 'read' | 'write' | 'delete'): boolean {
  switch (action) {
    case 'read': return ['viewer', 'editor', 'admin'].includes(role)
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
    
    const dashboardStats = await prisma.dashboardStat.findMany({
      where: user.role === 'admin' ? {} : { userId: user.userId }
    })

    if (dashboardStats.length === 0) {
      const mockStats = [
        { platform: '抖音', followers: 12500, publishCount: 156, engagementRate: 4.8, userId: user.userId },
        { platform: '快手', followers: 8900, publishCount: 98, engagementRate: 3.2, userId: user.userId },
        { platform: '小红书', followers: 5600, publishCount: 72, engagementRate: 6.5, userId: user.userId }
      ]

      for (const stat of mockStats) {
        await prisma.dashboardStat.create({ data: stat })
      }

      const updatedStats = await prisma.dashboardStat.findMany({
        where: user.role === 'admin' ? {} : { userId: user.userId }
      })
      
      return NextResponse.json({
        totalFollowers: updatedStats.reduce((sum: number, stat: any) => sum + stat.followers, 0),
        totalPublishCount: updatedStats.reduce((sum: number, stat: any) => sum + stat.publishCount, 0),
        averageEngagementRate: updatedStats.reduce((sum: number, stat: any) => sum + stat.engagementRate, 0) / updatedStats.length || 0,
        platformStats: updatedStats.map((stat: any) => ({
          platform: stat.platform,
          followers: stat.followers,
          publishCount: stat.publishCount,
          engagementRate: stat.engagementRate,
          growthRate: Math.random() * 20
        }))
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
      growthRate: Math.random() * 20
    }))

    return NextResponse.json({
      totalFollowers,
      totalPublishCount,
      averageEngagementRate,
      platformStats
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