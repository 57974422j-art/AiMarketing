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
 * 套餐额度的「统计口径」见 ALLOWANCE_PERIOD_MODE（★VF_BILLING_PERIOD_V1, 2026-10-01）：
 *   - 'period'（默认·老板口径）：按【当前订阅周期】累计已扣（从订阅 startDate 起）。
 *     年卡 29999 是一整年的量，绝不到月重置；季卡/周卡同理。
 *   - 'month'：按自然月累计（旧行为，每月 1 号归零）。
 * 额度的「大小」= plan.monthlyTokens ?? round(原价(分) / max(1, 订阅月数))：
 *   - 基础月卡 原价¥29  → 2900 点
 *   - 专业季卡 手填 8900（=一季总量）
 *   - 旗舰年卡 手填 29999（=一年总量）
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

export interface PlanLike {
  name?: string
  price: number
  discountPrice: number | null
  durationMonths: number
  monthlyTokens?: number | null
}

/** 计算某套餐的点数额度：手动设定的 monthlyTokens 优先；否则按原价/月数自动算（折后价仅作展示/支付用）。
 *  ★VF_BILLING_PERIOD_V1 加固：monthlyTokens 非有限数 → 回退自动算；月数用 max(1,·) 防 0 除零（周卡 durationMonths=0 → /1）；
 *  价格 ≤0 或非有限 → FREE_TRIAL_POINTS；结果保证为有限非负数（绝不 NaN/Infinity）。 */
export function planMonthlyTokens(plan: PlanLike): number {
  const mt = plan?.monthlyTokens
  if (mt !== null && mt !== undefined && Number.isFinite(mt) && mt >= 0) return mt
  const effective = Number(plan?.price)
  if (!Number.isFinite(effective) || effective <= 0) return FREE_TRIAL_POINTS
  const months = Math.max(1, Math.floor(Number(plan?.durationMonths) || 1))
  const v = Math.round(effective / months)
  return Number.isFinite(v) ? Math.max(0, v) : FREE_TRIAL_POINTS
}

// ═══════════════════════════════════════════════════════════════════
// ★VF_BILLING_PERIOD_V1（2026-10-01）额度统计口径 + 多订阅取用 + 纯函数钱包
// ═══════════════════════════════════════════════════════════════════

/** 额度统计口径 */
export type AllowancePeriodMode = 'period' | 'month'

/**
 * 当前采用的口径（★要切换只改这一处）：
 *  - 'period'：按【当前订阅周期】累计已扣（从订阅 startDate 起）——老板口径，
 *      「年卡不存在到月更新的问题」「月卡也没有 29999 点」。
 *  - 'month' ：按自然月累计（旧行为）。
 * 若要改回按月：把下一行改成 'month'；同时前端 my-subscription / admin 套餐页的字样需同步。
 */
export const ALLOWANCE_PERIOD_MODE: AllowancePeriodMode = 'period'

/** 自然月的时区偏移（小时）。默认 +8（北京）。
 *  旧实现用 toISOString() 取 UTC 月 → 国内用户每月 1 号 08:00 才重置（不是 00:00），是"跨月跳变"疑点之一。 */
export const BILLING_TZ_OFFSET_HOURS = 8

/** 取"本自然月"起点（按 BILLING_TZ_OFFSET_HOURS 时区，返回真实 UTC 时刻） */
export function monthStartInBillingTz(now: Date = new Date(), offsetHours: number = BILLING_TZ_OFFSET_HOURS): Date {
  const shifted = new Date(now.getTime() + offsetHours * 3600_000)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - offsetHours * 3600_000)
}

/**
 * 额度统计起点：
 *  - mode='month'  → 本自然月 1 号（按 BILLING_TZ_OFFSET_HOURS）
 *  - mode='period' → 当前订阅的 startDate；无订阅/非法日期 → 兜底自然月（保证永不返回 null）
 */
export function allowancePeriodStart(
  sub: { startDate: Date | string } | null,
  mode: AllowancePeriodMode = ALLOWANCE_PERIOD_MODE,
  now: Date = new Date(),
): Date {
  if (mode === 'month' || !sub) return monthStartInBillingTz(now)
  const s = new Date(sub.startDate)
  return Number.isFinite(s.getTime()) ? s : monthStartInBillingTz(now)
}

export interface SubscriptionLike {
  planId: number
  startDate: Date | string
  endDate: Date | string
  status?: string
}

/**
 * 多订阅取用规则（★）：
 *   在候选里选「status=active 且 endDate >= now」中 **endDate 最大者**（最晚到期优先）。
 *   过期的那条靠 endDate 过滤掉（库里同一用户可能残留多条 active，如 uid1 的 #1 已过期 + #4 生效）；
 *   全部过期 / 无 active → 返回 null（不拿过期订阅的额度）。
 */
export function pickActiveSubscription<T extends { status?: string; endDate: Date | string }>(
  subs: T[],
  now: Date = new Date(),
): T | null {
  const active = subs.filter((s) => {
    const st = s.status ?? 'active'
    const end = new Date(s.endDate).getTime()
    return st === 'active' && Number.isFinite(end) && end >= now.getTime()
  })
  if (!active.length) return null
  return active.slice().sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())[0]
}

export interface WalletInput {
  sub: SubscriptionLike | null
  plan: PlanLike | null
  spentInPeriod: number
  pointBalance: number
}

/** 纯函数：由「订阅 + 套餐 + 周期内已扣 + 点卡余额」算出钱包（不碰库，便于自测）。
 *  保证：spent ≥ 0、subRemaining ≥ 0、remaining 永不为负。 */
export function computeWallet(input: WalletInput): TokenWallet {
  const { sub, plan } = input
  const allowance = plan ? planMonthlyTokens(plan) : 0
  const spent = Math.max(0, Number(input.spentInPeriod) || 0)
  const subRemaining = Math.max(0, allowance - spent)
  const pointBalance = Math.max(0, Number(input.pointBalance) || 0)
  return {
    hasSubscription: !!plan,
    planName: plan?.name || null,
    allowance,
    spent,
    subRemaining,
    pointBalance,
    remaining: subRemaining + pointBalance,
  }
}

/** 查询用户当前点数钱包（额度=当前生效订阅套餐；消耗=统计周期内 point_spend 累计；另含点卡永久余额） */
export async function getTokenWallet(userId: number): Promise<TokenWallet> {
  // 2026-08-12: 两步查询（include plan 在脏数据/plan 缺失时 Prisma 抛 "Field plan is required"，改查后单独取 plan 容错）
  // ★VF_BILLING_PERIOD_V1: 多订阅统一走 pickActiveSubscription；消耗起点走 allowancePeriodStart。
  const now = new Date()
  const subs = await prisma.userSubscription.findMany({
    where: { userId, status: 'active', endDate: { gte: now } },
    orderBy: { endDate: 'desc' },
  })
  const sub = pickActiveSubscription(subs, now)
  const plan = sub ? await prisma.subscriptionPlan.findUnique({ where: { id: sub.planId } }) : null
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { pointBalance: true } })
  const pointBalance = user?.pointBalance || 0
  let spentInPeriod = 0
  if (sub && plan) {
    const periodStart = allowancePeriodStart(sub, ALLOWANCE_PERIOD_MODE, now)
    const agg = await prisma.usageLog.aggregate({
      where: { userId, action: TOKEN_ACTION, createdAt: { gte: periodStart } },
      _sum: { tokens: true },
    })
    spentInPeriod = agg._sum.tokens || 0
  }
  return computeWallet({ sub, plan, spentInPeriod, pointBalance })
}

/** 消费前检查：本期套餐额度 + 点卡余额均不足才拒绝（套餐额度优先、余额兜底） */
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
 * 扣费顺序：先扣本统计周期套餐额度，额度不够的部分再扣点卡永久余额（User.pointBalance）。
 * - 套餐内消耗 → usageLog(action='point_spend')，计入本期额度统计；
 * - 点卡余额消耗 → 原子 decrement User.pointBalance，并记 usageLog(action='pointcard_spend') 便于对账（不计入套餐额度）。
 * ★VF_BILLING_PERIOD_V1: 记账失败**不再静默吞**——记日志后 rethrow，让调用方能感知（旧实现 catch 只 console.error，
 *   调用处再 `.catch(()=>{})` → 双重吞 → 记账失败 = 静默不扣费）。需要容忍的调用方请显式 .catch。
 */
export async function spendTokens(userId: number, cost: number, reason: string): Promise<void> {
  if (!(cost > 0)) return // 同时挡掉 0 / 负数 / NaN
  try {
    // 2026-08-18 隐患②: 扣款+记账事务化（并发防重复扣）
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { pointBalance: true } })
      const now = new Date()
      const subs = await tx.userSubscription.findMany({
        where: { userId, status: 'active', endDate: { gte: now } },
        orderBy: { endDate: 'desc' },
      })
      const sub = pickActiveSubscription(subs, now)
      const plan = sub ? await tx.subscriptionPlan.findUnique({ where: { id: sub.planId } }) : null
      const allowance = plan ? planMonthlyTokens(plan) : 0
      let spent = 0
      if (sub && plan) {
        const agg = await tx.usageLog.aggregate({
          where: { userId, action: TOKEN_ACTION, createdAt: { gte: allowancePeriodStart(sub, ALLOWANCE_PERIOD_MODE, now) } },
          _sum: { tokens: true },
        })
        spent = agg._sum.tokens || 0
      }
      const subRemaining = Math.max(0, allowance - spent)
      const fromSub = Math.min(cost, subRemaining)
      const fromBalance = Math.max(0, cost - fromSub)
      if (fromSub > 0) {
        await tx.usageLog.create({
          data: { userId, action: TOKEN_ACTION, tokens: fromSub, count: 1, model: reason },
        })
      }
      if (fromBalance > 0) {
        // 点卡最多扣到 0，绝不出现负余额；按**实际扣除额**记账，保证账实一致
        const bal = user?.pointBalance || 0
        const deducted = Math.min(fromBalance, bal)
        if (deducted > 0) {
          await tx.user.update({ where: { id: userId }, data: { pointBalance: bal - deducted } })
          await tx.usageLog.create({
            data: { userId, action: POINT_CARD_ACTION, tokens: deducted, count: 1, model: reason },
          })
        }
        if (deducted < fromBalance) {
          console.warn(`[TokenWallet] 点卡余额不足：应扣 ${fromBalance}、实扣 ${deducted}（userId=${userId}）`)
        }
      }
    })
  } catch (e: any) {
    console.error('[TokenWallet] 记账失败:', e?.message)
    throw new Error(`点数记账失败：${e?.message || e}`)
  }
}

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
