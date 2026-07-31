import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

    const body = await request.json()
    const { platform, action, keywords, deviceSerial } = body
    if (!platform || !action || !deviceSerial) {
      return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })
    }

    // 检查本地设备是否已绑定
    const device = await prisma.account.findFirst({
      where: { userId: auth.userId, platform: 'local-device', accountId: deviceSerial, isBound: true },
    })
    if (!device) {
      return NextResponse.json({ success: false, message: '设备未绑定或不属于你' }, { status: 403 })
    }

    const task = await prisma.automationTask.create({
      data: {
        type: action,
        status: '等待中',
        params: JSON.stringify({ platform, keywords: keywords || [], deviceSerial }),
        createdBy: auth.userId,
      },
    })

    return NextResponse.json({ success: true, data: { id: task.id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
