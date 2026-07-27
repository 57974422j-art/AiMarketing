import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getPaymentConfig } from '@/lib/payment-config'
import { verifySign } from '@/lib/alipay'

const prisma = new PrismaClient()

/**
 * POST /api/payment/alipay/notify — 支付宝异步通知回调
 * 支付宝以 application/x-www-form-urlencoded 发送；验签通过并支付成功后开通订阅。
 * 必须返回纯文本 "success"，否则支付宝会重复通知。
 */
export async function POST(req: NextRequest) {
  try {
    // 1. 解析表单参数
    const raw = await req.text()
    const params: Record<string, string> = {}
    new URLSearchParams(raw).forEach((v, k) => { params[k] = v })

    // 2. 验签
    const cfg = await getPaymentConfig()
    if (!cfg.alipayPublicKey) return new NextResponse('failure', { status: 200 })
    const ok = verifySign(params, cfg.alipayPublicKey)
    if (!ok) return new NextResponse('failure', { status: 200 })

    // 3. 校验交易状态
    const tradeStatus = params['trade_status']
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      return new NextResponse('success', { status: 200 }) // 非成功状态也应答，避免重复通知
    }

    const orderNo = params['out_trade_no']
    const tradeNo = params['trade_no']
    const order = await prisma.paymentOrder.findUnique({ where: { orderNo } })
    if (!order) return new NextResponse('success', { status: 200 })

    // 4. 幂等 + 恢复：以「订阅是否已开通」为准，而非只看订单状态
    //    （旧逻辑订单先标 paid 再建订阅，建订阅抛错后重试会因订单已 paid 直接返回，导致订阅永久漏开）
    const existingSub = await prisma.userSubscription.findFirst({ where: { orderNo } })
    if (order.status === 'paid' && existingSub) {
      return new NextResponse('success', { status: 200 })
    }

    // 5. 校验金额（元，两位小数）；已支付订单不被复核误覆盖为 failed
    const notifyAmount = Math.round(parseFloat(params['total_amount'] || '0') * 100)
    if (notifyAmount !== order.amount) {
      if (order.status !== 'paid') {
        await prisma.paymentOrder.update({ where: { orderNo }, data: { status: 'failed', raw } })
      }
      return new NextResponse('success', { status: 200 })
    }

    // 6. 标记订单已支付（已付则保持，不覆盖原 paidAt）
    if (order.status !== 'paid') {
      await prisma.paymentOrder.update({
        where: { orderNo },
        data: { status: 'paid', tradeNo, paidAt: order.paidAt || new Date(), raw },
      })
    }

    // 7. 开通订阅（已开通则跳过，保证幂等、可 recovery）
    if (!existingSub) {
      await activateSubscription(order.userId, order.planId, orderNo, order.channel)
    }

    return new NextResponse('success', { status: 200 })
  } catch (e: any) {
    // 出错也返回 failure，让支付宝重试
    return new NextResponse('failure', { status: 200 })
  }
}

/** 开通/续费用户订阅并同步 user.plan + paidFeatures */
async function activateSubscription(userId: number, planId: number, orderNo: string, channel: string) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } })
  if (!plan) return

  const startDate = new Date()
  const endDate = new Date()
  endDate.setMonth(endDate.getMonth() + (plan.durationMonths || 1))

  // 取消已有 active 订阅
  await prisma.userSubscription.updateMany({
    where: { userId, status: 'active' },
    data: { status: 'expired' },
  })

  await prisma.userSubscription.create({
    data: {
      userId, planId: plan.id, startDate, endDate, status: 'active',
      orderNo, paymentMethod: channel,
    },
  })

  // 同步旧配额系统的 user.plan + paidFeatures
  const features: string[] = []
  if (plan.text2imgQuota > 0 || plan.text2imgQuota === -1) features.push('image-generator')
  if (plan.text2videoQuota > 0 || plan.text2videoQuota === -1) features.push('text-to-video')
  if (plan.deepseekTokens !== 0 || plan.llmTokens > 0 || plan.llmTokens === -1) features.push('video-edit-tts')
  await prisma.user.update({
    where: { id: userId },
    data: { plan: plan.name, paidFeatures: JSON.stringify(features) },
  })
}
