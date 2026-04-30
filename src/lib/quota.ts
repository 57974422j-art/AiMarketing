import { PrismaClient } from '@prisma/client/edge'

const prisma = new PrismaClient()

export type UsageAction = '文案生成' | '视频剪辑' | 'AI对话' | '意向采集'

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

const PLAN_QUOTAS: Record<string, number> = {
  free: 100,
  basic: 500,
  pro: 2000,
  vip: 10000
}

export async function checkQuota(userId: number, action: UsageAction): Promise<QuotaResult> {
  try {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    
    const [user, usageThisMonth] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.usageLog.aggregate({
        where: {
          userId,
          createdAt: { gte: startOfMonth }
        },
        _sum: { count: true }
      })
    ])
    
    if (!user) {
      return { allowed: false, message: '用户不存在' }
    }
    
    const used = usageThisMonth._sum.count || 0
    const quota = PLAN_QUOTAS[user.plan] || PLAN_QUOTAS.free
    const remaining = quota - used
    
    if (remaining <= 0) {
      return {
        allowed: false,
        message: '本月配额已用尽，请升级套餐',
        remainingQuota: 0
      }
    }
    
    return {
      allowed: true,
      message: `配额充足，剩余 ${remaining} 次`,
      remainingQuota: remaining
    }
  } catch (error) {
    console.error('Check quota error:', error)
    return { allowed: false, message: '检查配额失败' }
  }
}

export async function incrementUsage(userId: number, action: UsageAction, count: number = 1): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.usageLog.create({
        data: {
          userId,
          action,
          count
        }
      })
      
      await tx.user.update({
        where: { id: userId },
        data: {
          usedThisMonth: { increment: count }
        }
      })
    })
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
        where: {
          userId,
          createdAt: { gte: startOfMonth }
        },
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
        where: {
          userId,
          createdAt: { gte: startOfMonth }
        },
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