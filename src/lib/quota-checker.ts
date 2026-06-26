import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type ApiType = 'llm' | 'text2img' | 'text2video' | 'digital_human' | 'live_stream'

interface QuotaResult { allowed: boolean; remaining: number; message: string }

/**
 * 检查用户是否有配额调用指定 API，并自动扣量
 * @param userId 用户 ID
 * @param apiType API 类型
 * @param consume  本次消耗(token数或次数)
 */
export async function checkQuota(userId: number, apiType: ApiType, consume: number = 1): Promise<QuotaResult> {
  try {
    const month = new Date().toISOString().slice(0, 7) // "2026-06"

    // 查当前订阅
    const sub = await prisma.userSubscription.findFirst({
      where: { userId, status: 'active', endDate: { gte: new Date() } },
      include: { plan: true },
      orderBy: { endDate: 'desc' },
    })
    if (!sub?.plan) {
      // 无订阅 → 检查是否免费放行的 API
      if (apiType === 'llm') return consumeFreeLLM(userId, month, consume)
      return { allowed: false, remaining: 0, message: '未订阅任何套餐，请先购买' }
    }
    const plan = sub.plan

    // 取限额
    const quotas: Record<ApiType, number> = {
      llm: plan.llmTokens,
      text2img: plan.text2imgQuota,
      text2video: plan.text2videoQuota,
      digital_human: plan.digitalHumanMin,
      live_stream: plan.liveStreamMin,
    }
    const limit = quotas[apiType]
    if (limit === 0) return { allowed: false, remaining: 0, message: '当前套餐不含此功能' }
    if (limit === -1) {
      // 无限：记录用量但永远放行
      await recordUsage(userId, month, apiType, consume)
      return { allowed: true, remaining: -1, message: 'ok' }
    }

    // 查当月用量
    const used = await getMonthUsage(userId, month, apiType)
    if (used + consume > limit) {
      return { allowed: false, remaining: Math.max(0, limit - used), message: `配额不足(已用${used}/${limit})，请充值或升级套餐` }
    }

    // 扣量
    await recordUsage(userId, month, apiType, consume)
    return { allowed: true, remaining: limit - used - consume, message: 'ok' }

  } catch (e: any) {
    console.error('[配额检查] 异常:', e.message)
    return { allowed: true, remaining: -1, message: '检查跳过(error)' } // 容灾：断联就放行
  }
}

/** 免费 LLM（DeepSeek）：永远放行 */
async function consumeFreeLLM(userId: number, month: string, tokens: number): Promise<QuotaResult> {
  await recordUsage(userId, month, 'llm', tokens)
  return { allowed: true, remaining: -1, message: 'ok (free)' }
}

/** 获取当月用量 */
async function getMonthUsage(userId: number, month: string, apiType: ApiType): Promise<number> {
  const log = await prisma.usageLog.findFirst({
    where: { userId, action: apiType, createdAt: { gte: new Date(month + '-01') } },
    orderBy: { createdAt: 'desc' },
  })
  // 累加当月所有同类型记录
  const logs = await prisma.usageLog.findMany({
    where: { userId, action: apiType, createdAt: { gte: new Date(month + '-01') } },
  })
  switch (apiType) {
    case 'llm': return logs.reduce((a, l) => a + (l.tokens || 0), 0)
    case 'text2img': return logs.reduce((a, l) => a + (l.count || 1), 0)
    case 'text2video': return logs.reduce((a, l) => a + (l.count || 1), 0)
    case 'digital_human': return logs.reduce((a, l) => a + (l.count || 0), 0)
    case 'live_stream': return logs.reduce((a, l) => a + (l.count || 0), 0)
    default: return 0
  }
}

/** 记录用量 */
async function recordUsage(userId: number, month: string, apiType: string, amount: number) {
  await prisma.usageLog.create({
    data: { userId, action: apiType, tokens: apiType === 'llm' ? amount : 0, count: apiType !== 'llm' ? amount : 1, model: 'quota', createdAt: new Date() },
  })
}

/** 获取用户当月用量统计(给前端看板用) */
export async function getUserMonthlyStats(userId: number): Promise<any> {
  const month = new Date().toISOString().slice(0, 7)
  const logs = await prisma.usageLog.findMany({
    where: { userId, createdAt: { gte: new Date(month + '-01') } },
  })
  return {
    month,
    llmTokens: logs.filter(l => l.action === 'llm').reduce((a, l) => a + (l.tokens || 0), 0),
    text2img: logs.filter(l => l.action === 'text2img').reduce((a, l) => a + (l.count || 1), 0),
    text2video: logs.filter(l => l.action === 'text2video').reduce((a, l) => a + (l.count || 1), 0),
    digitalHuman: logs.filter(l => l.action === 'digital_human').reduce((a, l) => a + (l.count || 0), 0),
    liveStream: logs.filter(l => l.action === 'live_stream').reduce((a, l) => a + (l.count || 0), 0),
  }
}
