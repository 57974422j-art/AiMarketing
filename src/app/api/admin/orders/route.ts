import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** GET /api/admin/orders — 管理员订单列表（支持状态/渠道筛选、关键词搜索、分页、状态汇总） */
export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'all'
  const channel = searchParams.get('channel') || 'all'
  const q = (searchParams.get('q') || '').trim()
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)))

  const where: any = {}
  if (status !== 'all') where.status = status
  if (channel !== 'all') where.channel = channel
  if (q) {
    where.OR = [
      { orderNo: { contains: q } },
      { user: { username: { contains: q } } },
      { user: { email: { contains: q } } },
    ]
  }

  try {
    // 同时查「套餐订单」与「点卡订单」，合并为统一列表（点卡订单计入同一状态汇总）
    const [subOrders, pcOrders, subTotal, pcTotal, subGrouped, pcGrouped] = await Promise.all([
      prisma.paymentOrder.findMany({
        where,
        include: { user: { select: { username: true, email: true } }, plan: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.pointCardOrder.findMany({
        where,
        include: { user: { select: { username: true, email: true } }, card: { select: { name: true, points: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.paymentOrder.count({ where }),
      prisma.pointCardOrder.count({ where }),
      prisma.paymentOrder.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.pointCardOrder.groupBy({ by: ['status'], _count: { _all: true } }),
    ])

    const normSub = subOrders.map((o: any) => ({ ...o, type: 'subscription', productName: o.plan?.name || '—' }))
    const normPc = pcOrders.map((o: any) => ({ ...o, type: 'pointcard', productName: o.card?.name || o.subject || '—', points: o.points }))
    const merged = [...normSub, ...normPc].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )

    const total = subTotal + pcTotal
    const pageOrders = merged.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)

    const summary: Record<string, number> = { all: total }
    ;[...subGrouped, ...pcGrouped].forEach((g: any) => { summary[g.status] = (summary[g.status] || 0) + g._count._all })

    return NextResponse.json({
      success: true,
      data: { orders: pageOrders, total, page, pageSize, summary },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
