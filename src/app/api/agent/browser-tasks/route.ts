import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** 浏览器任务（客户端执行器用）：GET ?status=pending 拉任务 / POST 回执结果 */
export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  const status = req.nextUrl.searchParams.get('status') || 'pending'
  const tasks = await prisma.agentBrowserTask.findMany({ where: { userId: auth.userId, status }, orderBy: { id: 'asc' }, take: 5 })
  return NextResponse.json({ success: true, data: tasks })
}

export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  try {
    const b = await req.json()
    const id = Number(b.id)
    const t = await prisma.agentBrowserTask.findFirst({ where: { id, userId: auth.userId } })
    if (!t) return NextResponse.json({ success: false, message: '任务不存在' }, { status: 404 })
    const upd: any = { status: String(b.status || 'succeeded') }
    if (b.result !== undefined) upd.result = String(b.result).slice(0, 4000)
    if (b.error !== undefined) upd.error = String(b.error).slice(0, 1000)
    await prisma.agentBrowserTask.update({ where: { id }, data: upd })
    return NextResponse.json({ success: true })
  } catch (e: any) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }) }
}
