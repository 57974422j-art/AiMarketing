import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import * as BrowserManager from '@/lib/browser-manager'

const prisma = new PrismaClient()

/**
 * POST /api/dashboard/sync
 *
 * 触发指纹浏览器数据采集：
 * 1. 查找当前用户绑定的指纹浏览器账号（bindType=manual）
 * 2. 对每个已运行的浏览器实例执行个人主页数据采集
 * 3. 将结果写入 DashboardStat 表
 *
 * 用途：
 *   - 指纹浏览器启动后自动调用
 *   - 手动刷新仪表盘数据
 *   - 定时任务调用
 */
export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }

    const userId = auth.userId

    // 查找用户的指纹浏览器账号
    const accounts = await prisma.account.findMany({
      where: {
        userId,
        bindType: 'manual',
        isBound: true,
        cdpPort: { not: null },
      },
      select: {
        id: true,
        platform: true,
        accountName: true,
        cdpPort: true,
      },
    })

    if (accounts.length === 0) {
      return NextResponse.json({
        success: true,
        message: '没有已绑定的指纹浏览器账号',
        data: [],
      })
    }

    const results: Array<{
      platform: string
      accountName: string
      cdpPort: number
      collected: boolean
      followers?: number
      videoCount?: number
      message: string
    }> = []

    // 逐个账号采集
    for (const acct of accounts) {
      const port = acct.cdpPort!

      // 先检查浏览器是否运行中
      const browserStatus = BrowserManager.getBrowserStatus(port)
      if (!browserStatus.running) {
        results.push({
          platform: acct.platform,
          accountName: acct.accountName,
          cdpPort: port,
          collected: false,
          message: `端口 ${port} 的浏览器未运行，请先启动指纹浏览器`,
        })
        continue
      }

      try {
        // 调用采集函数
        const collectResult = await BrowserManager.collectProfileData(
          port,
          acct.platform,
          userId,
        )

        results.push({
          platform: acct.platform,
          accountName: acct.accountName,
          cdpPort: port,
          collected: collectResult.success,
          followers: collectResult.followers,
          videoCount: collectResult.videoCount,
          message: collectResult.message,
        })

        console.log(`[DashboardSync] ${acct.platform}/${acct.accountName}: ${collectResult.message}`)
      } catch (e: any) {
        results.push({
          platform: acct.platform,
          accountName: acct.accountName,
          cdpPort: port,
          collected: false,
          message: `采集异常: ${e.message}`,
        })
      }
    }

    const successCount = results.filter(r => r.collected).length

    return NextResponse.json({
      success: true,
      message: `采集完成：${successCount}/${results.length} 个账号成功`,
      data: results,
    })
  } catch (error) {
    console.error('[DashboardSync] 错误:', error)
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '采集失败',
    }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
