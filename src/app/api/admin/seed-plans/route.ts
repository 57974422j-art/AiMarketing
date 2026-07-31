import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DEFAULT_PLANS = [
  {
    name: '基础月卡', description: '入门体验，海量AI文案+基础生成',
    price: 2900, discountPrice: 1900, durationMonths: 1, sortOrder: 1,
    deepseekTokens: -1, llmTokens: 100000,
    text2imgQuota: 200, text2videoQuota: 10,
    digitalHumanMin: 30, liveStreamMin: 60, storageMb: 500,
  },
  {
    name: '专业季卡', description: '专业级创作，文生图/视频大量配额',
    price: 8900, discountPrice: 6900, durationMonths: 3, sortOrder: 2,
    deepseekTokens: -1, llmTokens: 500000,
    text2imgQuota: 800, text2videoQuota: 50,
    digitalHumanMin: 120, liveStreamMin: 200, storageMb: 2048,
  },
  {
    name: '旗舰年卡', description: '全部无限，专属数字人+直播',
    price: 29900, discountPrice: 19900, durationMonths: 12, sortOrder: 3,
    deepseekTokens: -1, llmTokens: -1,
    text2imgQuota: -1, text2videoQuota: 200,
    digitalHumanMin: 600, liveStreamMin: 1000, storageMb: 10240,
  },
]

export async function POST() {
  try {
    const exists = await prisma.subscriptionPlan.findFirst()
    if (exists) return NextResponse.json({ success: false, message: '已有套餐数据，请先清空' }, { status: 400 })

    for (const p of DEFAULT_PLANS) {
      await prisma.subscriptionPlan.create({ data: { name: p.name, description: p.description, price: p.price, discountPrice: p.discountPrice, durationMonths: p.durationMonths, sortOrder: p.sortOrder, deepseekTokens: p.deepseekTokens, llmTokens: p.llmTokens, text2imgQuota: p.text2imgQuota, text2videoQuota: p.text2videoQuota, digitalHumanMin: p.digitalHumanMin, liveStreamMin: p.liveStreamMin, storageMb: p.storageMb } })
    }
    return NextResponse.json({ success: true, message: `已初始化 ${DEFAULT_PLANS.length} 个套餐` })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
