import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

function generateCode(): string {
  return randomBytes(4).toString('hex').toUpperCase()
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权查看' }, { status: 403 })
    const where = auth.role === 'admin' ? {} : { createdBy: auth.userId }
    const codes = await prisma.inviteCode.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { usedByUser: { select: { username: true } }, creator: { select: { username: true } } },
    })
    return NextResponse.json({ success: true, data: codes })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '加载失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    let { role, count } = await request.json()
    // admin 可生成任意角色，editor 只能生成 end-user
    if (auth.role === 'editor') role = 'end-user'
    if (!['editor', 'end-user'].includes(role)) return NextResponse.json({ success: false, message: '角色无效' }, { status: 400 })
    const num = Math.min(Math.max(count || 1, 1), 50)
    const codes: { code: string; createdBy: number; role: string }[] = []
    for (let i = 0; i < num; i++) codes.push({ code: generateCode(), createdBy: auth.userId, role })
    await prisma.inviteCode.createMany({ data: codes })
    return NextResponse.json({ success: true, message: `已生成 ${num} 个邀请码`, count: num })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '生成失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
