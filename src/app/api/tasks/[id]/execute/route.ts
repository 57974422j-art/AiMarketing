import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })

    await prisma.$executeRawUnsafe('UPDATE PushedTask SET status = ? WHERE id = ? AND userId = ?', '已完成', parseInt(id), auth.userId)
    return NextResponse.json({ success: true, message: '已更新' })
  } catch (e) {
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
