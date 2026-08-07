import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** POST /api/agent/publish-tasks/[id]/done — 客户端执行完成后回写状态 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const id = parseInt(params.id, 10)
    const { status, error } = await request.json()
    const task = await prisma.agentPublishTask.findFirst({ where: { id, userId: auth.userId } })
    if (!task) return NextResponse.json({ success: false, message: '任务不存在' }, { status: 404 })
    const updated = await prisma.agentPublishTask.update({
      where: { id },
      data: { status: status === 'succeeded' ? 'succeeded' : 'failed', error: error || null },
    })
    return NextResponse.json({ success: true, data: updated })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
