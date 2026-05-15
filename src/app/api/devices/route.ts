import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/**
 * GET /api/devices
 * 设备列表（按权限过滤）
 *   admin: 全部
 *   editor: 自己的设备
 *   end-user: 返回空（无权限看设备）
 */
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) {
      return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    }

    let devices

    if (auth.role === 'admin') {
      // 平台方：查看所有设备
      devices = await prisma.device.findMany({
        include: { owner: { select: { id: true, username: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      })
    } else if (auth.role === 'editor') {
      // 二级客户：只看自己的设备
      devices = await prisma.device.findMany({
        where: { ownerId: auth.userId },
        include: { owner: { select: { id: true, username: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      })
    } else {
      // end-user 等：无权查看
      return NextResponse.json({ success: false, message: '无权访问设备列表' }, { status: 403 })
    }

    return NextResponse.json({ success: true, data: devices })
  } catch (error) {
    console.error('获取设备列表失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * POST /api/devices
 * 新增设备
 */
export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) {
      return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    }
    if (auth.role === 'end-user') {
      return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    }

    const body = await request.json()
    const { name, groupId } = body

    if (!name) {
      return NextResponse.json({ success: false, message: '缺少设备名称' }, { status: 400 })
    }

    const device = await prisma.device.create({
      data: {
        name,
        groupId: groupId || null,
        ownerId: auth.userId,
        status: 'offline',
      },
    })

    // 更新设备池
    const pool = await prisma.devicePool.findFirst({ where: { ownerId: auth.userId } })
    if (pool) {
      await prisma.devicePool.update({
        where: { id: pool.id },
        data: { totalWindows: { increment: 1 } },
      })
    }

    const device = await prisma.device.create({
      data: {
        name,
        groupId: groupId || null,
        ownerId: body.ownerId || auth.userId,
        status: 'offline',
        ip: body.ip || null,
        apiPort: body.apiPort ? parseInt(body.apiPort) : null,
        rpaPort: body.rpaPort ? parseInt(body.rpaPort) : null,
        adbPort: body.adbPort ? parseInt(body.adbPort) : null,
        type: body.type || 'mock',
      },
    })

    // 更新设备池
    const pool = await prisma.devicePool.findFirst({ where: { ownerId: auth.userId } })
    if (pool) {
      await prisma.devicePool.update({
        where: { id: pool.id },
        data: { totalWindows: { increment: 1 } },
      })
    }

    return NextResponse.json({ success: true, data: device }, { status: 201 })
  } catch (error) {
    console.error('创建设备失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })

    const body = await request.json()
    const { id, name, groupId, ownerId, ip, apiPort, rpaPort, adbPort, type } = body
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })

    const data: any = {}
    if (name !== undefined) data.name = name
    if (groupId !== undefined) data.groupId = groupId
    if (ownerId !== undefined) data.ownerId = ownerId
    if (ip !== undefined) data.ip = ip
    if (apiPort !== undefined) data.apiPort = parseInt(apiPort)
    if (rpaPort !== undefined) data.rpaPort = parseInt(rpaPort)
    if (adbPort !== undefined) data.adbPort = parseInt(adbPort)
    if (type !== undefined) data.type = type

    await prisma.device.update({ where: { id: parseInt(id) }, data })
    return NextResponse.json({ success: true, message: '已更新' })
  } catch (error) {
    console.error('更新设备失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
