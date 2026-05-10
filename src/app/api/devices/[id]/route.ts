import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/**
 * GET /api/devices/[id] 设备详情
 * PUT  /api/devices/[id] 更新设备信息
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })

    const device = await prisma.device.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        owner: { select: { id: true, username: true } },
        socialAccounts: { select: { id: true, platform: true, username: true, status: true } },
        automationTasks: {
          select: { id: true, type: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    })

    if (!device) return NextResponse.json({ success: false, message: '设备不存在' }, { status: 404 })

    return NextResponse.json({ success: true, data: device })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })

    const body = await request.json()
    const { name, groupId } = body
    const deviceId = parseInt(id, 10)
    const device = await prisma.device.findUnique({ where: { id: deviceId } })
    if (!device) return NextResponse.json({ success: false, message: '设备不存在' }, { status: 404 })
    if (auth.role !== 'admin' && device.ownerId !== auth.userId) {
      return NextResponse.json({ success: false, message: '无权修改' }, { status: 403 })
    }

    const updated = await prisma.device.update({
      where: { id: deviceId },
      data: { name: name || undefined, groupId: groupId !== undefined ? groupId : undefined },
    })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
