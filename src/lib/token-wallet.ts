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

/** 计算某套餐的月度点数额度：手动设定的 monthlyTokens 优先；否则按原价/月数自动算（折后价仅作展示/支付用） */
export function planMonthlyTokens(plan: { price: number; discountPrice: number | null; durationMonths: number; monthlyTokens?: number | null }): number {
  if (plan.monthlyTokens !== null && plan.monthlyTokens !== undefined) return plan.monthlyTokens
  const effective = plan.price // 分，使用原价
  if (effective <= 0) return FREE_TRIAL_POINTS
  return Math.round(effective / Math.max(1, plan.durationMonths || 1))
}

/** 查询用户当前点数钱包（额度=当前生效订阅套餐；消耗=当月 point_spend 累计） */
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
        message: `点数余额不足：本次需 ${cost} 点，剩余 ${wallet.remaining}（本月额度 ${wallet.allowance}），请升级/续费套餐`,
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

/** 记账（成功后调用）。cost 为「点」数；reason 示例：'text2img' / 'text2video:5s' / 'agent_chat' / 'fp_analyze_video' */
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
