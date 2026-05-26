import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10)
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })

    await prisma.$executeRawUnsafe('UPDATE PushedTask SET status = ? WHERE id = ?', '已完成', id)
    return NextResponse.json({ success: true, message: '已更新' })
  } catch (e: any) {
    console.error('tasks/execute error:', e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
