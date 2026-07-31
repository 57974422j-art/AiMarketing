import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** PUT /api/admin/point-cards/[id] — 更新点卡 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = getAuthFromHeaders(req)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
  }
  try {
    const body = await req.json()
    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.description !== undefined) data.description = body.description
    if (body.points !== undefined) data.points = Number(body.points)
    if (body.price !== undefined) data.price = Number(body.price)
    if (body.status !== undefined) data.status = body.status
    if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder)
    const card = await prisma.pointCard.update({ where: { id: parseInt(params.id) }, data })
    return NextResponse.json({ success: true, data: card })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 400 })
  }
}

/** DELETE /api/admin/point-cards/[id] — 删除点卡 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = getAuthFromHeaders(_req)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
  }
  try {
    await prisma.pointCard.delete({ where: { id: parseInt(params.id) } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 400 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
