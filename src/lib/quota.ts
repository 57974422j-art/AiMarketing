import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export const UsageActions = {
  COPY: '文案生成',
  VIDEO: '视频剪辑',
  AI_CHAT: 'AI对话',
  LEAD: '意向采集',
} as const
export type UsageAction = typeof UsageActions[keyof typeof UsageActions]

// 付费功能编码（对应 User.paidFeatures JSON 数组中的值）
export const FeatureCodes = {
  TEXT_TO_VIDEO: 'text-to-video',    // 文生视频
  IMAGE_GENERATOR: 'image-generator', // AI 生图
  VIDEO_EDIT_TTS: 'video-edit-tts',   // 一键成片TTS（预留，目前免费）
  AI_AGENT: 'ai-agent',               // AI 智能体（预留）
} as const
export type FeatureCode = typeof FeatureCodes[keyof typeof FeatureCodes]

const DAILY_COPY_LIMIT = 5  // AI 文案每日免费次数

const PLAN_QUOTAS: Record<string, number> = {
  free: 100,
  basic: 500,
  pro: 2000,
  vip: 10000
}

const SYSTEM_DEFAULT_DAILY_QUOTA = 100

// ========== AI 文案：按天 5 次免费配额 ==========

interface CopyQuotaResult {
  allowed: boolean
  message?: string
  remaining?: number
}

/** 检查 AI 文案每日配额（免费用户每天 5 次） */
export async function checkCopyDailyQuota(userId: number | null): Promise<CopyQuotaResult> {
  try {
    if (userId === null) {
      return { allowed: true, message: '未登录', remaining: DAILY_COPY_LIMIT }
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return { allowed: false, message: '用户不存在' }

    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

    // 跨天自动重置
    if (user.copyLastResetDate !== today) {
      await prisma.user.update({
        where: { id: userId },
        data: { copyUsedToday: 0, copyLastResetDate: today }
      })
      return { allowed: true, remaining: DAILY_COPY_LIMIT }
    }

    const remaining = DAILY_COPY_LIMIT - user.copyUsedToday
    if (remaining <= 0) {
      return {
        allowed: false,
        message: `今日免费次数已用完(${DAILY_COPY_LIMIT}次)，请联系客服充值`,
        remaining: 0
      }
    }

    return { allowed: true, remaining }
  } catch (error) {
    console.error('Check copy daily quota error:', error)
    return { allowed: false, message: '检查配额失败' }
  }
}

/** 扣减 AI 文案每日配额 + 记录 usageLog */
export async function useCopyQuota(userId: number): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { copyUsedToday: { increment: 1 } }
      })
      await tx.usageLog.create({
        data: { userId, action: UsageActions.COPY, count: 1 }
      })
    })
  } catch (error) {
    console.error('Use copy quota error:', error)
    throw error
  }
}

// ========== 付费功能开关检查 ==========

interface FeatureAccessResult {
  allowed: boolean
  message?: string
  /** 是否需要联系客服（前端据此显示不同提示） */
  needContactService?: boolean
}

/**
 * 检查用户是否已开通某付费功能
 * admin 角色默认开通所有功能
 */
export async function checkFeatureAccess(
  userId: number | null,
  featureCode: FeatureCode
): Promise<FeatureAccessResult> {
  try {
    if (userId === null) {
      return { allowed: false, needContactService: true, message: '请先登录' }
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return { allowed: false, message: '用户不存在' }

    // admin 全部开放
    if (user.role === 'admin') return { allowed: true }

    // 解析 paidFeatures JSON 数组
    const paidFeatures: string[] = user.paidFeatures
      ? JSON.parse(user.paidFeatures)
      : []

    if (!paidFeatures.includes(featureCode)) {
      return {
        allowed: false,
        needContactService: true,
        message: '该功能需要充值开通，请联系客服'
      }
    }

    return { allowed: true }
  } catch (error) {
    console.error('Check feature access error:', error)
    return { allowed: false, message: '功能权限检查失败' }
  }
}

// ========== 一键成片用量记录（仅统计，不拦截）==========

/** 记录视频后期处理/一键成片使用量（不拦截，纯计数） */
export async function recordVideoEditUsage(userId: number): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { videoEditCount: { increment: 1 } }
      })
      await tx.usageLog.create({
        data: { userId, action: UsageActions.VIDEO, count: 1 }
      })
    })
  } catch (error) {
    console.error('Record video edit usage error:', error)
    throw error
  }
}

// ========== 系统配置读取（客服信息等）==========

export interface SystemConfigData {
  key: string
  value: string
  label?: string
  description?: string
}

/** 获取系统配置项（支持批量获取） */
export async function getSystemConfigs(keys?: string[]): Promise<Record<string, string>> {
  try {
    const where = keys ? { key: { in: keys } } : {}
    const configs = await prisma.systemConfig.findMany({ where })

    const result: Record<string, string> = {}
    configs.forEach(c => { result[c.key] = c.value })
    return result
  } catch (error) {
    console.error('Get system config error:', error)
    return {}
  }
}

/** 设置/更新系统配置项 */
export async function setSystemConfig(key: string, value: string, label?: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value, label, updatedAt: new Date() },
    create: { key, value, label }
  })
}

// ========== 保留的旧接口（兼容） ==========

export interface QuotaResult {
  allowed: boolean
  message?: string
  remainingQuota?: number
}

export interface QuotaInfo {
  plan: string
  monthlyQuota: number
  usedThisMonth: number
  remainingQuota: number
  usageByAction: Record<string, number>
}

/** @deprecated 使用 checkCopyDailyQuota 替代（文案按天计费后不再需要月度配额） */
export async function checkQuota(userId: number | null, action: UsageAction): Promise<QuotaResult> {
  // 文案走新的按天逻辑
  if (action === UsageActions.COPY && userId !== null) {
    const result = await checkCopyDailyQuota(userId)
    return {
      allowed: result.allowed,
      message: result.message,
      remainingQuota: result.remaining
    }
  }

  try {
    if (userId === null) {
      return {
        allowed: true,
        message: `系统默认配额，剩余 ${SYSTEM_DEFAULT_DAILY_QUOTA} 次`,
        remainingQuota: SYSTEM_DEFAULT_DAILY_QUOTA
      }
    }

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [user, usageThisMonth] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.usageLog.aggregate({
        where: { userId, createdAt: { gte: startOfMonth } },
        _sum: { count: true }
      })
    ])

    if (!user) return { allowed: false, message: '用户不存在' }

    const used = usageThisMonth._sum.count || 0
    const quota = PLAN_QUOTAS[user.plan] || PLAN_QUOTAS.free
    const remaining = quota - used

    if (remaining <= 0) {
      return { allowed: false, message: '本月配额已用尽，请升级套餐', remainingQuota: 0 }
    }

    return { allowed: true, message: `配额充足，剩余 ${remaining} 次`, remainingQuota: remaining }
  } catch (error) {
    console.error('Check quota error:', error)
    return { allowed: false, message: '检查配额失败' }
  }
}

/** @deprecated 使用 useCopyQuota 替代 */
export async function incrementUsage(userId: number, action: UsageAction, count: number = 1): Promise<void> {
  if (action === UsageActions.COPY) {
    await useCopyQuota(userId)
    return
  }
  try {
    await prisma.usageLog.create({ data: { userId, action, count } })
  } catch (error) {
    console.error('Increment usage error:', error)
    throw error
  }
}

export async function getRemainingQuota(userId: number): Promise<number> {
  try {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [user, usageThisMonth] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.usageLog.aggregate({
        where: { userId, createdAt: { gte: startOfMonth } },
        _sum: { count: true }
      })
    ])

    if (!user) return 0

    const used = usageThisMonth._sum.count || 0
    const quota = PLAN_QUOTAS[user.plan] || PLAN_QUOTAS.free

    return quota - used
  } catch (error) {
    console.error('Get remaining quota error:', error)
    return 0
  }
}

export async function getQuotaInfo(userId: number): Promise<QuotaInfo | null> {
  try {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [user, usageByAction] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.usageLog.groupBy({
        by: ['action'],
        where: { userId, createdAt: { gte: startOfMonth } },
        _sum: { count: true }
      })
    ])

    if (!user) return null

    const totalUsed = usageByAction.reduce((sum, item) => sum + (item._sum.count || 0), 0)
    const quota = PLAN_QUOTAS[user.plan] || PLAN_QUOTAS.free

    const usageByActionMap: Record<string, number> = {}
    usageByAction.forEach(item => {
      usageByActionMap[item.action] = item._sum.count || 0
    })

    return {
      plan: user.plan,
      monthlyQuota: quota,
      usedThisMonth: totalUsed,
      remainingQuota: quota - totalUsed,
      usageByAction: usageByActionMap
    }
  } catch (error) {
    console.error('Get quota info error:', error)
    return null
  }
}
