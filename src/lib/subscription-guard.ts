import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** 用户是否有有效（active 且未过期）订阅 */
export async function hasActiveSubscription(userId: number): Promise<boolean> {
  const sub = await prisma.userSubscription.findFirst({
    where: { userId, status: 'active', endDate: { gte: new Date() } },
  })
  return !!sub
}
