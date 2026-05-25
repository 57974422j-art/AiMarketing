import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const serial = searchParams.get('serial')
    if (!serial) return NextResponse.json({ success: false, message: '缺少 serial' }, { status: 400 })

    const rows = await prisma.$queryRawUnsafe(
      'SELECT * FROM PushedTask WHERE deviceSerial = ? AND status = ? ORDER BY createdAt DESC',
      serial, '待执行'
    ) as any[]

    return NextResponse.json({ success: true, data: rows || [] })
  } catch (e: any) {
    console.error('tasks/mine error:', e.message)
    return NextResponse.json({ success: false, error: e.message })
  } finally { await prisma.$disconnect() }
}
