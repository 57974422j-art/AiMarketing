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
    if (!auth || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
    const codes = await prisma.inviteCode.findMany({
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
    if (!auth || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
    const { role, count } = await request.json()
    if (!['editor', 'end-user'].includes(role)) return NextResponse.json({ success: false, message: '角色无效' }, { status: 400 })
    const num = Math.min(Math.max(count || 1, 1), 50)
    const codes: { code: string; createdBy: number; role: string }[] = []
    for (let i = 0; i < num; i++) codes.push({ code: generateCode(), createdBy: auth.userId, role })
    await prisma.inviteCode.createMany({ data: codes })
    return NextResponse.json({ success: true, message: `已生成 ${num} 个邀请码`, count: num })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '生成失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
