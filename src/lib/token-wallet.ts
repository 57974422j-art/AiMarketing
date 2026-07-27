import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * ═══════════════════════════════════════════════════════════
 * TOKEN 钱包（统一代币账本）
 * ═══════════════════════════════════════════════════════════
 * 换算基准：1 TOKEN = ¥0.01（1分）
 * 套餐月额度 = round(实付价(分) / 订阅月数)，每自然月重置
 * 免费套餐（价格为 0，如免费周卡）= 固定试用额度 FREE_TRIAL_TOKENS
 *
 * 各动作成本（按阿里国内定价估算）：
 * - 文生图（通义万相级别）≈ ¥0.12/张 → 12 TOKEN/张
 * - 文生视频（阿里）≈ ¥1/秒 → 100 TOKEN/秒
 * - AI 对话（DeepSeek/千问）极便宜 → 1 TOKEN/次
 *
 * 账本落在 usageLog 表（action='token_spend', tokens=消耗额, model=用途），
 * 不改 schema、不跑 prisma generate。
 */

export const TOKEN_COSTS = {
  IMAGE_PER_PIC: 12,      // 文生图：12 TOKEN/张
  VIDEO_PER_SECOND: 100,  // 文生视频：100 TOKEN/秒
  CHAT_PER_MSG: 1,        // AI 对话：1 TOKEN/条
} as const

/** 免费套餐（0元周卡等）的固定试用额度 */
export const FREE_TRIAL_TOKENS = 500

const TOKEN_ACTION = 'token_spend'

export interface TokenWallet {
  hasSubscription: boolean
  planName: string | null
  allowance: number   // 本期总额度
  spent: number       // 本期已消耗
  remaining: number   // 剩余
}

export interface TokenCheck {
  allowed: boolean
  message: string
  wallet: TokenWallet
}

/** 计算某套餐的月度 TOKEN 额度 */
export function planMonthlyTokens(plan: { price: number; discountPrice: number | null; durationMonths: number }): number {
  const effective = plan.discountPrice ?? plan.price // 分
  if (effective <= 0) return FREE_TRIAL_TOKENS
  return Math.round(effective / Math.max(1, plan.durationMonths || 1))
}

/** 查询用户当前 TOKEN 钱包（额度=当前生效订阅套餐；消耗=当月 token_spend 累计） */
export async function getTokenWallet(userId: number): Promise<TokenWallet> {
  const sub = await prisma.userSubscription.findFirst({
    where: { userId, status: 'active', endDate: { gte: new Date() } },
    include: { plan: true },
    orderBy: { endDate: 'desc' },
  })
  const monthStart = new Date(new Date().toISOString().slice(0, 7) + '-01')
  const agg = await prisma.usageLog.aggregate({
    where: { userId, action: TOKEN_ACTION, createdAt: { gte: monthStart } },
    _sum: { tokens: true },
  })
  const spent = agg._sum.tokens || 0
  if (!sub?.plan) {
    return { hasSubscription: false, planName: null, allowance: 0, spent, remaining: 0 }
  }
  const allowance = planMonthlyTokens(sub.plan)
  return {
    hasSubscription: true,
    planName: sub.plan.name,
    allowance,
    spent,
    remaining: Math.max(0, allowance - spent),
  }
}

/** 消费前检查：余额不足直接拒绝（避免先烧上游成本再拦） */
export async function checkTokens(userId: number, cost: number): Promise<TokenCheck> {
  try {
    const wallet = await getTokenWallet(userId)
    if (!wallet.hasSubscription) {
      return { allowed: false, message: '未订阅任何套餐，请先开通（可在"我的套餐"领取免费周卡）', wallet }
    }
    if (wallet.remaining < cost) {
      return {
        allowed: false,
        message: `TOKEN 余额不足：本次需 ${cost}，剩余 ${wallet.remaining}（本月额度 ${wallet.allowance}），请升级/续费套餐`,
        wallet,
      }
    }
    return { allowed: true, message: 'ok', wallet }
  } catch (e: any) {
    console.error('[TokenWallet] 检查异常:', e?.message)
    // 容灾：查库异常时放行，不影响主流程
    return {
      allowed: true,
      message: 'skip(error)',
      wallet: { hasSubscription: true, planName: null, allowance: -1, spent: 0, remaining: -1 },
    }
  }
}

/** 记账（成功后调用）。reason 示例：'text2img' / 'text2video:5s' / 'agent_chat' */
export async function spendTokens(userId: number, cost: number, reason: string): Promise<void> {
  if (cost <= 0) return
  try {
    await prisma.usageLog.create({
      data: { userId, action: TOKEN_ACTION, tokens: cost, count: 1, model: reason },
    })
  } catch (e: any) {
    console.error('[TokenWallet] 记账失败:', e?.message)
  }
}
