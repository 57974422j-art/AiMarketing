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
    let bestBuf: ArrayBuffer | null = null
    let bestCtype = 'image/png'
    for (const lv of [3, 2, 1]) {
      const snapRes = await fetch('http://localhost:' + row.apiPort + '/task=snap&level=' + lv, { signal: AbortSignal.timeout(10000) })
      if (!snapRes.ok) continue
      const buf = await snapRes.arrayBuffer()
      if (!bestBuf || buf.byteLength > bestBuf.byteLength) { bestBuf = buf; bestCtype = snapRes.headers.get('content-type') || 'image/png' }
    }
    if (!bestBuf) return NextResponse.json({ success: false, message: '截图失败' }, { status: 502 })
    return new NextResponse(Buffer.from(bestBuf), {
      headers: { 'Content-Type': bestCtype, 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '截图失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
