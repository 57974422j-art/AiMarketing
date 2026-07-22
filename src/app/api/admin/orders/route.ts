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
    const [orders, total, grouped] = await Promise.all([
      prisma.paymentOrder.findMany({
        where,
        include: {
          user: { select: { username: true, email: true } },
          plan: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.paymentOrder.count({ where }),
      prisma.paymentOrder.groupBy({ by: ['status'], _count: { _all: true } }),
    ])

    const summary: Record<string, number> = { all: total }
    grouped.forEach((g: any) => { summary[g.status] = g._count._all })

    return NextResponse.json({
      success: true,
      data: { orders, total, page, pageSize, summary },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
