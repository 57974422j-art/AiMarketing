import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getUserMonthlyStats } from '@/lib/quota-checker'
import { getTokenWallet } from '@/lib/token-wallet'

const prisma = new PrismaClient()

/** GET /api/subscription/my-usage?userId=1 — 用户配额+订阅信息 */
export async function GET(req: NextRequest) {
  try {
    const userId = parseInt(new URL(req.url).searchParams.get('userId') || '0')
    if (!userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

    let [usage, sub] = await Promise.all([
      getUserMonthlyStats(userId),
      prisma.userSubscription.findFirst({
        where: { userId, status: 'active', endDate: { gte: new Date() } },
        include: { plan: true },
        orderBy: { endDate: 'desc' },
      }),
    ])

    // 兜底恢复：已支付但漏开订阅的订单（支付宝回调异常时），访问本接口即自动补建
    if (!sub) {
      const paidOrders = await prisma.paymentOrder.findMany({
        where: { userId, status: 'paid' },
        orderBy: { paidAt: 'asc' }, // 升序，保证最新一笔最终生效
      })
      for (const paidOrder of paidOrders) {
        const already = await prisma.userSubscription.findFirst({ where: { orderNo: paidOrder.orderNo } })
        if (already) continue
        const plan = await prisma.subscriptionPlan.findUnique({ where: { id: paidOrder.planId } })
        if (!plan) continue
        const startDate = new Date()
        const endDate = new Date()
        endDate.setMonth(endDate.getMonth() + (plan.durationMonths || 1))
        await prisma.userSubscription.updateMany({ where: { userId, status: 'active' }, data: { status: 'expired' } })
        await prisma.userSubscription.create({
          data: { userId, planId: plan.id, startDate, endDate, status: 'active', orderNo: paidOrder.orderNo, paymentMethod: paidOrder.channel },
        })
        const features: string[] = []
        if (plan.text2imgQuota > 0 || plan.text2imgQuota === -1) features.push('image-generator')
        if (plan.text2videoQuota > 0 || plan.text2videoQuota === -1) features.push('text-to-video')
        if (plan.deepseekTokens !== 0 || plan.llmTokens > 0 || plan.llmTokens === -1) features.push('video-edit-tts')
        await prisma.user.update({ where: { id: userId }, data: { plan: plan.name, paidFeatures: JSON.stringify(features) } })
      }
      sub = await prisma.userSubscription.findFirst({
        where: { userId, status: 'active', endDate: { gte: new Date() } },
        include: { plan: true },
        orderBy: { endDate: 'desc' },
      })
    }

    const wallet = await getTokenWallet(userId)
    return NextResponse.json({ success: true, data: { usage, subscription: sub, wallet } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
