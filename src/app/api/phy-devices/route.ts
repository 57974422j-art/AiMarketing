/**
 * Q1 物理机管理 API
 * GET    /api/phy-devices         - 获取所有 Q1 物理机
 * POST   /api/phy-devices         - 新增 Q1 物理机
 * PUT    /api/phy-devices/[id]    - 分配 Q1 给 editor
 * DELETE /api/phy-devices/[id]    - 删除 Q1
 */

import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })
    const where = auth.role === 'admin' ? {} : { ownerId: auth.userId }
    const data = await prisma.phyDevice.findMany({
      where,
      include: {
        devices: { select: { id: true, name: true, status: true, apiPort: true, ownerId: true, owner: { select: { username: true } } } },
        owner: { select: { id: true, username: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ success: true, data })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
    const body = await request.json()
    if (!body.name || !body.ip) return NextResponse.json({ success: false, message: '名称和 IP 必填' }, { status: 400 })
    const device = await prisma.phyDevice.create({
      data: { name: body.name, ip: body.ip, port: parseInt(body.port) || 8000, note: body.note || null, ownerId: auth.userId },
    })
    return NextResponse.json({ success: true, data: device }, { status: 201 })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '创建失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

// PUT — 分配 Q1 给 editor（同时同步容器设备归属）
export async function PUT(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
    const body = await request.json()
    const { id, ownerId } = body
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    const newOwnerId = ownerId ? parseInt(ownerId) : auth.userId
    await prisma.phyDevice.update({ where: { id: parseInt(id) }, data: { ownerId: newOwnerId } })
    await prisma.device.updateMany({ where: { phyDeviceId: parseInt(id) }, data: { ownerId: newOwnerId } })
    return NextResponse.json({ success: true, message: '已更新' })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '更新失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
