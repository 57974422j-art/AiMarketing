import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    // 从数据库获取仪表盘数据
    const dashboardStats = await prisma.dashboardStat.findMany()

    // 如果表为空，自动插入模拟的基础数据
    if (dashboardStats.length === 0) {
      const mockStats = [
        { platform: '抖音', followers: 12500, publishCount: 156, engagementRate: 4.8, userId: 1 },
        { platform: '快手', followers: 8900, publishCount: 98, engagementRate: 3.2, userId: 1 },
        { platform: '小红书', followers: 5600, publishCount: 72, engagementRate: 6.5, userId: 1 }
      ]

      for (const stat of mockStats) {
        await prisma.dashboardStat.create({ data: stat })
      }

      // 重新获取数据
      const updatedStats = await prisma.dashboardStat.findMany()
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

    // 计算统计数据
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
      {
        success: false,
        message: error instanceof Error ? error.message : '获取仪表盘数据时发生错误'
      },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}