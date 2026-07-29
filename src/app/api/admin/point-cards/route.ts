import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** GET /api/admin/point-cards — 获取所有点卡（按 sortOrder 升序） */
export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
  }
  try {
    const cards = await prisma.pointCard.findMany({ orderBy: { sortOrder: 'asc' } })
    return NextResponse.json({ success: true, data: cards })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

/** POST /api/admin/point-cards — 新建点卡 */
export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
  }
  try {
    const body = await req.json()
    if (!body.name) {
      return NextResponse.json({ success: false, message: '请填写点卡名称' }, { status: 400 })
    }
    const card = await prisma.pointCard.create({
      data: {
        name: body.name,
        description: body.description || null,
        points: Number(body.points) || 0,
        price: Number(body.price) || 0,
        status: body.status || 'active',
        sortOrder: Number(body.sortOrder) || 0,
      },
    })
    return NextResponse.json({ success: true, data: card })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 400 })
  }
}
