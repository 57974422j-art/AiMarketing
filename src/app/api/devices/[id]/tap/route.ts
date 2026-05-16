import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    const body = await request.json()
    const { x, y } = body
    if (x == null || y == null) return NextResponse.json({ success: false, message: '缺少 x/y' }, { status: 400 })

    const row: any = await prisma.device.findUnique({ where: { id: parseInt(params.id) } })
    if (!row || row.type !== 'q1' || !row.apiPort) return NextResponse.json({ success: false, message: '仅 Q1 设备支持' }, { status: 400 })

    // 通过 Shell input tap 走 FRP 隧道 localhost:apiPort
    const res = await fetch(`http://localhost:${row.apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent(`input tap ${x} ${y}`)}`, { signal: AbortSignal.timeout(8000) })
    const text = await res.text()
    return NextResponse.json({ success: res.ok, output: text.substring(0, 500) })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '点击失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
