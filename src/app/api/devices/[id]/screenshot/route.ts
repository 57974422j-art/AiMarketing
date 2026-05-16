import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    const row: any = await prisma.device.findUnique({ where: { id: parseInt(params.id) } })
    if (!row) return NextResponse.json({ success: false, message: '设备不存在' }, { status: 404 })
    if (row.type !== 'q1' || !row.apiPort) return NextResponse.json({ success: false, message: '仅 Q1 设备支持截图' }, { status: 400 })

    const snapRes = await fetch(`http://localhost:${row.apiPort}/task=snap&level=3`, { signal: AbortSignal.timeout(10000) })
    if (!snapRes.ok) return NextResponse.json({ success: false, message: `截图失败: ${snapRes.status}` }, { status: 502 })

    const buf = await snapRes.arrayBuffer()
    return new NextResponse(Buffer.from(buf), {
      headers: { 'Content-Type': snapRes.headers.get('content-type') || 'image/png' },
    })
  } catch (e: any) {
    console.error('[截图] 失败:', e?.message || e)
    return NextResponse.json({ success: false, message: e?.message || '截图失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
