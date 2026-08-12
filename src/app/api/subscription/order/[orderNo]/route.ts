import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()

function getUserIdFromRequest(req: NextRequest): number | null {
  const token = req.cookies.get('token')?.value
  if (!token) return null
  const JWT_SECRET = process.env.JWT_SECRET
  try {
    const [header, payload, signature] = token.split('.')
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
    if (signature !== expected) return null
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof data.userId === 'number' ? data.userId : null
  } catch {
    return null
  }
}

/**
 * GET /api/subscription/order/[orderNo] — 查询订单状态（前端轮询用）
 * 返回 status: pending / paid / closed / failed
 */
export async function GET(req: NextRequest, { params }: { params: { orderNo: string } }) {
  try {
    const userId = getUserIdFromRequest(req)
    if (!userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

    const order = await prisma.paymentOrder.findUnique({ where: { orderNo: params.orderNo } })
    if (!order) return NextResponse.json({ success: false, message: '订单不存在' }, { status: 404 })
    if (order.userId !== userId) return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })

    return NextResponse.json({
      success: true,
      data: {
        orderNo: order.orderNo,
        status: order.status,
        amount: order.amount,
        subject: order.subject,
        paidAt: order.paidAt,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
