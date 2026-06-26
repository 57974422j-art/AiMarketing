import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** POST /api/subscription/buy  — 用户购买/续费套餐 */
export async function POST(req: NextRequest) {
  try {
    const { userId, planId, months } = await req.json()
    if (!userId || !planId) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })

    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } })
    if (!plan || plan.status !== 'active') return NextResponse.json({ success: false, message: '套餐不可用' }, { status: 400 })

    const duration = months || plan.durationMonths
    const startDate = new Date()
    const endDate = new Date()
    endDate.setMonth(endDate.getMonth() + duration)

    // 取消已有订阅
    await prisma.userSubscription.updateMany({
      where: { userId, status: 'active' },
      data: { status: 'expired' },
    })

    // 创建新订阅
    const sub = await prisma.userSubscription.create({
      data: { userId, planId: plan.id, startDate, endDate, status: 'active' },
      include: { plan: true },
    })

    // 更新 user.plan 字段（兼容旧代码）
    await prisma.user.update({ where: { id: userId }, data: { plan: plan.name } })

    return NextResponse.json({ success: true, data: sub })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
