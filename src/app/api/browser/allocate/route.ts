import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { allocateCdpPort } from '@/lib/quota-manager'

const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  if (!userId) return null
  return { userId: parseInt(userId, 10) }
}

// 动态分配端口：从全局端口池中取一个空闲端口（不绑账号、不写库）
// 订阅校验由全局 middleware 拦截（非白名单 + 无有效订阅 → 403）
export async function POST(request: NextRequest) {
  try {
    const ctx = getUserContext(request)
    if (!ctx) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const platform = body.platform || 'douyin'

    const port = await allocateCdpPort(ctx.userId, platform)
    return NextResponse.json({ success: true, data: { port, platform } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '分配端口失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
