import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** GET /api/admin/usage-stats?month=2026-06 — 全平台用量统计 */
export async function GET(req: NextRequest) {
  try {
    const month = new URL(req.url).searchParams.get('month') || new Date().toISOString().slice(0, 7)
    const logs = await prisma.usageLog.findMany({
      where: { createdAt: { gte: new Date(month + '-01'), lt: new Date(month + '-31') } },
      include: { user: { select: { id: true, username: true, email: true } } },
    })

    // 按用户聚合
    const userMap = new Map<number, any>()
    for (const l of logs) {
      if (!userMap.has(l.userId)) {
        userMap.set(l.userId, { userId: l.userId, username: l.user.username, email: l.user.email, llmTokens: 0, text2img: 0, text2video: 0 })
      }
      const u = userMap.get(l.userId)!
      if (l.action === 'llm') u.llmTokens += (l.tokens || 0)
      if (l.action === 'text2img') u.text2img += (l.count || 1)
      if (l.action === 'text2video') u.text2video += (l.count || 1)
    }

    const users = Array.from(userMap.values())
    const totals = {
      llmTokens: users.reduce((a, u) => a + u.llmTokens, 0),
      text2img: users.reduce((a, u) => a + u.text2img, 0),
      text2video: users.reduce((a, u) => a + u.text2video, 0),
    }

    return NextResponse.json({ success: true, data: { month, totals, users } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
