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

    // screencap + download
    const shellRes = await fetch(`http://127.0.0.1:${device.apiPort}/modifydev?cmd=6&cmdline=screencap%20-p%20/sdcard/screen.png`, { signal: AbortSignal.timeout(15000) })
    const shellData = await shellRes.json()
    if (shellData.code !== 200) {
      return NextResponse.json({ success: false, message: '截图命令失败' }, { status: 502 })
    }
    await new Promise(r => setTimeout(r, 500))

    const dlRes = await fetch(`http://127.0.0.1:${device.apiPort}/download?path=/sdcard/screen.png`, { signal: AbortSignal.timeout(10000) })
    if (!dlRes.ok) {
      return NextResponse.json({ success: false, message: '下载截图失败' }, { status: 502 })
    }

    const buf = await dlRes.arrayBuffer()
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache, max-age=0',
      },
    })
  } catch (e) {
    return NextResponse.json({ success: false, message: '截图失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
