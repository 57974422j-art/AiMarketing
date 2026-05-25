import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const serial = searchParams.get('serial')
    if (!serial) return NextResponse.json({ success: false, message: '缺少 serial' }, { status: 400 })

    const rows = await prisma.$queryRawUnsafe(
      'SELECT * FROM PushedTask WHERE deviceSerial = ? AND userId = ? ORDER BY createdAt DESC',
      serial, auth.userId
    ) as any[]

    return NextResponse.json({ success: true, data: rows || [] })
  } catch (e) {
    return NextResponse.json({ success: true, data: [] })
  } finally { await prisma.$disconnect() }
}
