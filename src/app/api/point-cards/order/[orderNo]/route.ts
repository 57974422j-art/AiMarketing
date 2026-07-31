import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromCookie } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** GET /api/point-cards/order/[orderNo] — 查询点卡订单状态（前端支付后轮询） */
export async function GET(_req: NextRequest, { params }: { params: { orderNo: string } }) {
  try {
    const auth = getAuthFromCookie(_req)
    const userId = auth?.userId ?? 0
    const order = await prisma.pointCardOrder.findUnique({ where: { orderNo: params.orderNo } })
    if (!order) return NextResponse.json({ success: false, message: '订单不存在' }, { status: 404 })
    if (order.userId !== userId) return NextResponse.json({ success: false, message: '无权限' }, { status: 403 })
    return NextResponse.json({ success: true, data: { status: order.status, points: order.points, paidAt: order.paidAt } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
