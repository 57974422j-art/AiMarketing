import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

    const userId = auth.userId

    const [user, systemConfigs] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.systemConfig.findMany({ where: { key: { in: ['service_qrcode'] } } })
    ])

    if (!user) return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 })

    // 解析已开通的付费功能
    const paidFeatures: string[] = user.paidFeatures ? JSON.parse(user.paidFeatures) : []

    // 文案配额（跨天重置）
    const today = new Date().toISOString().slice(0, 10)
    const copyRemaining = user.copyLastResetDate === today
      ? Math.max(0, 5 - user.copyUsedToday)
      : 5

    // 系统配置转为 key-value
    const configs: Record<string, string> = {}
    systemConfigs.forEach(c => { configs[c.key] = c.value })

    return NextResponse.json({
      success: true,
      data: {
        name: user.name || user.username,
        role: user.role,
        isAdmin: user.role === 'admin',
        // 功能权限
        features: {
          aiCopy: {
            available: true,
            type: 'free',
            limit: 5,
            used: user.copyLastResetDate === today ? user.copyUsedToday : 0,
            remaining: copyRemaining,
          },
          textToVideo: {
            available: user.role === 'admin' || paidFeatures.includes('text-to-video'),
            type: 'paid',
          },
          imageGenerator: {
            available: user.role === 'admin' || paidFeatures.includes('image-generator'),
            type: 'paid',
          },
          videoEdit: {
            available: true,
            type: 'free',
            usedCount: user.videoEditCount || 0,
          },
        },
        // 客服信息
        serviceQrcode: configs['service_qrcode'] || '',
      }
    })
  } catch (error) {
    console.error('[Workspace status] error:', error)
    return NextResponse.json({ success: false, message: '获取状态失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
