import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * ═══════════════════════════════════════════════════════════
 * 点数钱包（平台统一虚拟货币账本）
 * ═══════════════════════════════════════════════════════════
 * 平台内部单位统一叫「点」。1 点 = ¥0.01（1分）。
 * 各外部 AI 平台（阿里/硅基/千问/Agnes/可灵…）的真实 token 消耗，
 * 一律由后台按其单价换算成「点」后再记账，页面只显示「点」。
 *
 * 套餐月额度 = round(原价(分) / 订阅月数)，每自然月重置：
 *   - 基础月卡 原价¥29  → 2900 点
 *   - 专业月卡 原价¥89  → 8900 点
 *   - 旗舰月卡 原价¥299 → 29900 点
 * 免费套餐（价格为 0，如免费周卡）= 固定试用额度 FREE_TRIAL_POINTS（500 点）
 *
 * 动作成本（非 token 计费类，按均价估成点）：
 * - 文生图 ≈ ¥0.12/张 → 12 点/张
 * - 文生视频 ≈ ¥1/秒  → 100 点/秒
 * - AI 对话 ≈ ¥0.01/条 → 1 点/条
 * - 多模态理解（AI 看片等，按真实 token 计）→ 见 usageToPoints() 换算
 *
 * 账本落在 usageLog 表（action='point_spend', tokens=消耗点数, model=用途），
 * 不改 schema、不跑 prisma generate。
 */

/** 各平台模型「真实 token → 点」换算系数（点 = 真实token数 × 系数）。
 *  系数 = 该模型单价(元/token) × 100（因 1 点 = ¥0.01）。
 *  单价未知（如 Agnes 灰度）先用估算值，拿到真实定价再回填。 */
export const PLATFORM_TOKEN_TO_POINT: Record<string, number> = {
  'agnes-2.5-flash': 0.002, // 估算：¥0.00002/token
  'agnes-2.0-flash': 0.002,
  'deepseek-chat': 0.002,
  'qwen-plus': 0.002,
  'qwen-vl-max': 0.002,
  'qwen2-vl-7b': 0.002,
  default: 0.002,
}

/** 把某平台真实 token 消耗换算成「点」 */
export function usageToPoints(platform: string, realTokens: number): number {
  const rate = PLATFORM_TOKEN_TO_POINT[platform] ?? PLATFORM_TOKEN_TO_POINT.default
  return Math.max(1, Math.round((realTokens || 0) * rate))
}

export const TOKEN_COSTS = {
  IMAGE_PER_PIC: 12,        // 文生图：12 点/张
  VIDEO_PER_SECOND: 100,    // 文生视频：100 点/秒
  CHAT_PER_MSG: 1,          // AI 对话：1 点/条
  DH_VIDEO: 200,            // 数字人口播视频：200 点/条（千寻 liveportrait，估 ¥2/条）
  VOICE_ENROLL: 100,        // 声音克隆注册：100 点/次
  VOICE_TTS: 10,            // 克隆声音合成音频：10 点/次
} as const

/** 免费套餐（0元周卡等）的固定试用额度（点） */
export const FREE_TRIAL_POINTS = 500
export const FREE_TRIAL_TOKENS = FREE_TRIAL_POINTS // 向后兼容别名

const TOKEN_ACTION = 'point_spend'
/** 点卡余额消耗记账（与套餐额度 point_spend 分开，避免影响月额度统计） */
const POINT_CARD_ACTION = 'pointcard_spend'

export interface TokenWallet {
  hasSubscription: boolean
  planName: string | null
  allowance: number     // 本期套餐总额度
  spent: number         // 本期套餐内已消耗
  subRemaining: number  // 套餐剩余额度（= allowance - spent，不超过 0）
  pointBalance: number  // 点卡永久余额（User.pointBalance，不过期）
  remaining: number     // 总可用 = 套餐剩余 + 点卡余额
}

export interface TokenCheck {
  allowed: boolean
  message: string
  wallet: TokenWallet
}

/** 计算某套餐的月度点数额度：手动设定的 monthlyTokens 优先；否则按原价/月数自动算（折后价仅作展示/支付用） */
export function planMonthlyTokens(plan: { price: number; discountPrice: number | null; durationMonths: number; monthlyTokens?: number | null }): number {
  if (plan.monthlyTokens !== null && plan.monthlyTokens !== undefined) return plan.monthlyTokens
  const effective = plan.price // 分，使用原价
  if (effective <= 0) return FREE_TRIAL_POINTS
  return Math.round(effective / Math.max(1, plan.durationMonths || 1))
}

/** 查询用户当前点数钱包（额度=当前生效订阅套餐；消耗=当月 point_spend 累计；另含点卡永久余额） */
export async function getTokenWallet(userId: number): Promise<TokenWallet> {
  const sub = await prisma.userSubscription.findFirst({
    where: { userId, status: 'active', endDate: { gte: new Date() } },
    include: { plan: true },
    orderBy: { endDate: 'desc' },
  })
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { pointBalance: true } })
  const pointBalance = user?.pointBalance || 0
  const monthStart = new Date(new Date().toISOString().slice(0, 7) + '-01')
  const agg = await prisma.usageLog.aggregate({
    where: { userId, action: TOKEN_ACTION, createdAt: { gte: monthStart } },
    _sum: { tokens: true },
  })
  const spent = agg._sum.tokens || 0
  const allowance = sub?.plan ? planMonthlyTokens(sub.plan) : 0
  const subRemaining = Math.max(0, allowance - spent)
  return {
    hasSubscription: !!sub?.plan,
    planName: sub?.plan?.name || null,
    allowance,
    spent,
    subRemaining,
    pointBalance,
    remaining: subRemaining + pointBalance,
  }
}

/** 消费前检查：月额度 + 点卡余额均不足才拒绝（月额度优先、余额兜底） */
export async function checkTokens(userId: number, cost: number): Promise<TokenCheck> {
  try {
    const wallet = await getTokenWallet(userId)
    if (!wallet.hasSubscription && wallet.pointBalance <= 0) {
      return {
        allowed: false,
        message: '未订阅套餐且点卡余额为 0，请先开通套餐或在「我的套餐」购买点卡补充点数',
        wallet,
      }
    }
    if (wallet.remaining < cost) {
      return {
        allowed: false,
        message: `点数不足：本次需 ${cost} 点，可用 ${wallet.remaining}（套餐剩余 ${wallet.subRemaining} + 点卡余额 ${wallet.pointBalance}），请购买点卡或续费套餐`,
        wallet,
      }
    }
    return { allowed: true, message: 'ok', wallet }
  } catch (e: any) {
    console.error('[TokenWallet] 检查异常:', e?.message)
    // 2026-08-12 #9: 查库异常改为拒绝（原容灾放行=计费旁路，消费可免费绕过）
    return {
      allowed: false,
      message: '点数系统暂时不可用，请稍后重试',
      wallet: { hasSubscription: false, planName: null, allowance: 0, spent: 0, subRemaining: 0, pointBalance: 0, remaining: 0 },
    }
  }
}

/**
 * 记账（成功后调用）。cost 为「点」数；reason 示例：'text2img' / 'text2video:5s' / 'agent_chat'。
 * 扣费顺序：先扣当月套餐额度，额度不够的部分再扣点卡永久余额（User.pointBalance）。
 * - 套餐内消耗 → usageLog(action='point_spend')，计入月额度统计；
 * - 点卡余额消耗 → 原子 decrement User.pointBalance，并记 usageLog(action='pointcard_spend') 便于对账（不计入月额度）。
 */
export async function spendTokens(userId: number, cost: number, reason: string): Promise<void> {
  if (cost <= 0) return
  try {
    const wallet = await getTokenWallet(userId)
    const fromSub = Math.min(cost, wallet.subRemaining)
    const fromBalance = cost - fromSub
    if (fromSub > 0) {
      await prisma.usageLog.create({
        data: { userId, action: TOKEN_ACTION, tokens: fromSub, count: 1, model: reason },
      })
    }
    if (fromBalance > 0) {
      // 2026-08-10：点卡余额不扣成负数（下限 0）
      await prisma.user.update({
        where: { id: userId },
        data: { pointBalance: Math.max(0, wallet.pointBalance - fromBalance) },
      })
      await prisma.usageLog.create({
        data: { userId, action: POINT_CARD_ACTION, tokens: fromBalance, count: 1, model: reason },
      })
    }
  } catch (e: any) {
    console.error('[TokenWallet] 记账失败:', e?.message)
  }
}

/** 给某用户充值点卡余额（支付回调成功时调用）。amount 为点数，orderNo 仅用于日志 */
export async function addPointBalance(userId: number, amount: number, reason = 'pointcard'): Promise<void> {
  if (amount <= 0) return
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { pointBalance: { increment: amount } },
    })
    await prisma.usageLog.create({
      data: { userId, action: POINT_CARD_ACTION, tokens: -amount, count: 1, model: `recharge:${reason}` },
    })
  } catch (e: any) {
    console.error('[TokenWallet] 充值失败:', e?.message)
  }
}
