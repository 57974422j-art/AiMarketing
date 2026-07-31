import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** GET /api/point-cards — 公开：返回上架中的点卡（供「我的套餐」购买区展示） */
export async function GET(req: NextRequest) {
  try {
    const cards = await prisma.pointCard.findMany({ where: { status: 'active' }, orderBy: { sortOrder: 'asc' } })
    return NextResponse.json({ success: true, data: cards })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
