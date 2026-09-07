import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromCookie } from '@/lib/api-auth'

const prisma = new PrismaClient()

export const dynamic = 'force-dynamic'

const FREE_WEEKLY_NAME = '免费周卡'

/** 确保周卡套餐记录存在（不存在则自动种下），返回该套餐 */
async function ensureWeeklyPlan() {
  let plan = await prisma.subscriptionPlan.findFirst({ where: { name: FREE_WEEKLY_NAME } })
  if (!plan) {
    plan = await prisma.subscriptionPlan.create({
      data: {
        name: FREE_WEEKLY_NAME,
        description: '每账号限领一次 · 7天试用（含 500 TOKEN 体验额度）',
        price: 0,
        discountPrice: null,
        durationMonths: 0, // 周卡固定 7 天（0=非月计费，activateSubscription/my-usage 按 7 天处理）
        llmTokens: 10000,
        text2imgQuota: 20,
        text2videoQuota: 1,
        storageMb: 100,
        status: 'active',
        sortOrder: -1, // 排最前
      },
    })
  }
  return plan
}

/** GET /api/subscription/claim-weekly — 自动种下周卡套餐并返回状态（页面加载时调用） */
export async function GET(request: NextRequest) {
  try {
    const plan = await ensureWeeklyPlan()
    const auth = getAuthFromCookie(request)
    let claimed = false
    if (auth?.userId) {
      claimed = !!(await prisma.userSubscription.findFirst({ where: { userId: auth.userId, planId: plan.id } }))
    }
    return NextResponse.json({ success: true, data: { planId: plan.id, status: plan.status, claimed } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message }, { status: 500 })
  }
}

/**
 * POST /api/subscription/claim-weekly — 领取免费周卡
 * 规则：
 * - 每个账号只能领一次（userSubscription 里有该套餐记录即算领过，不论是否过期）
 * - 后台可随时下架（status=disabled 即拒绝领取）
 * - 已有生效套餐时不可领（避免覆盖付费套餐）
 * - 套餐记录不存在时自动创建（免部署种子脚本）
 */
export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromCookie(request)
    if (!auth?.userId) {
      return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    }
    const userId = auth.userId

    // 1. 找周卡套餐，不存在则自动种下
    const plan = await ensureWeeklyPlan()

    // 2. 后台下架即拒绝
    if (plan.status !== 'active') {
      return NextResponse.json({ success: false, message: '免费周卡已下架' }, { status: 403 })
    }

    // 3. 每账号只能领一次（历史领过即拒绝，含已过期）
    const claimed = await prisma.userSubscription.findFirst({ where: { userId, planId: plan.id } })
    if (claimed) {
      return NextResponse.json({ success: false, message: '免费周卡每个账号只能领取一次，您已领取过' }, { status: 403 })
    }

    // 4. 已有生效套餐时不可领（避免覆盖付费套餐）
    const activeSub = await prisma.userSubscription.findFirst({
      where: { userId, status: 'active', endDate: { gte: new Date() } },
    })
    if (activeSub) {
      return NextResponse.json({ success: false, message: '当前已有生效套餐，无需领取周卡' }, { status: 403 })
    }

    // 5. 开通 7 天订阅
    const startDate = new Date()
    const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const orderNo = `FREEWEEK${userId}${Date.now()}`
    await prisma.userSubscription.create({
      data: { userId, planId: plan.id, startDate, endDate, status: 'active', orderNo, paymentMethod: 'free' },
    })

    // 6. 同步 user.plan + paidFeatures（与付费开通逻辑一致）
    const features: string[] = []
    if (plan.text2imgQuota > 0 || plan.text2imgQuota === -1) features.push('image-generator')
    if (plan.text2videoQuota > 0 || plan.text2videoQuota === -1) features.push('text-to-video')
    if (plan.deepseekTokens !== 0 || plan.llmTokens > 0 || plan.llmTokens === -1) features.push('video-edit-tts')
    await prisma.user.update({
      where: { id: userId },
      data: { plan: plan.name, paidFeatures: JSON.stringify(features) },
    })

    return NextResponse.json({
      success: true,
      message: `免费周卡领取成功，有效期至 ${endDate.toLocaleDateString('zh-CN')}`,
      data: { planName: plan.name, endDate },
    })
  } catch (e: any) {
    console.error('[claim-weekly] 领取失败:', e?.message)
    return NextResponse.json({ success: false, message: '领取失败: ' + (e?.message || '未知错误') }, { status: 500 })
  }
}
