import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

// 阶段三·读取当前用户的长期记忆（给前端认知地图用）
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromHeaders(request)
    if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    // AgentMemory.userId 存的是 username（非数字 id），先取用户
    const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
    const username = user?.username || String(auth.userId)
    const rows = await prisma.agentMemory.findMany({
      where: { userId: username },
      orderBy: { salience: 'desc' },
      take: 30,
    })
    await prisma.$disconnect()
    return NextResponse.json({
      success: true,
      items: rows.map((r: any) => ({ id: r.id, content: r.content, tags: r.tags, salience: r.salience })),
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
