import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * GET /api/devices/[id]/snap
 * 代理 Q1 容器截图，解决跨域/跨端口问题
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const deviceId = parseInt(id)
    const device = await prisma.device.findUnique({ where: { id: deviceId } })
    if (!device?.apiPort) {
      return NextResponse.json({ success: false, message: '设备不存在或未配置端口' }, { status: 404 })
    }

    const snapRes = await fetch(`http://127.0.0.1:${device.apiPort}/snap`, { signal: AbortSignal.timeout(10000) })
    if (!snapRes.ok) {
      return NextResponse.json({ success: false, message: '截图失败' }, { status: 502 })
    }

    const buf = await snapRes.arrayBuffer()
    return new NextResponse(buf, {
      headers: {
        'Content-Type': snapRes.headers.get('Content-Type') || 'image/png',
        'Cache-Control': 'no-cache, max-age=0',
      },
    })
  } catch (e) {
    return NextResponse.json({ success: false, message: '截图失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
