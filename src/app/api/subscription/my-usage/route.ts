import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getUserMonthlyStats } from '@/lib/quota-checker'

const prisma = new PrismaClient()

/** GET /api/subscription/my-usage?userId=1 — 用户配额+订阅信息 */
export async function GET(req: NextRequest) {
  try {
    const userId = parseInt(new URL(req.url).searchParams.get('userId') || '0')
    if (!userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

    const [usage, sub] = await Promise.all([
      getUserMonthlyStats(userId),
      prisma.userSubscription.findFirst({
        where: { userId, status: 'active', endDate: { gte: new Date() } },
        include: { plan: true },
        orderBy: { endDate: 'desc' },
      }),
    ])

    return NextResponse.json({ success: true, data: { usage, subscription: sub } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
