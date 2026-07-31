import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/**
 * POST /api/devices/heartbeat
 * 设备心跳上报（允许设备层直接调用，无需用户认证）
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { deviceId } = body

    if (!deviceId) {
      return NextResponse.json({ success: false, message: '缺少 deviceId' }, { status: 400 })
    }

    const numericId = parseInt(deviceId, 10)
    const device = await prisma.device.findFirst({
      where: {
        OR: [
          ...(isNaN(numericId) ? [] : [{ id: numericId }]),
          { name: deviceId },
        ],
      },
    })

    if (!device) {
      return NextResponse.json({ success: false, message: '设备不存在' }, { status: 404 })
    }

    await prisma.device.update({
      where: { id: device.id },
      data: {
        status: 'online',
        lastHeartbeat: new Date(),
      },
    })

    return NextResponse.json({ success: true, message: '心跳已更新' })
  } catch (error) {
    console.error('心跳上报失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
