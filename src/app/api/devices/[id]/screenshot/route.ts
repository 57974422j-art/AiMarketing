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
    
    // 方案1：screencap + download 拿全分辨率截图
    const ts = Date.now()
    await fetch('http://localhost:' + row.apiPort + '/modifydev?cmd=6&cmdline=' + encodeURIComponent('screencap -p /sdcard/screen_' + ts + '.png'), { signal: AbortSignal.timeout(10000) })
    const dlRes = await fetch('http://localhost:' + row.apiPort + '/download?path=' + encodeURIComponent('/sdcard/screen_' + ts + '.png'), { signal: AbortSignal.timeout(10000) })
    if (dlRes.ok) {
      const buf = await dlRes.arrayBuffer()
      return new NextResponse(Buffer.from(buf), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      })
    }
    // 方案2：回退 Q1 snap API
    const snapRes = await fetch('http://localhost:' + row.apiPort + '/task=snap&level=3', { signal: AbortSignal.timeout(10000) })
    if (!snapRes.ok) return NextResponse.json({ success: false, message: '截图失败' }, { status: 502 })
    const buf = await snapRes.arrayBuffer()
    return new NextResponse(Buffer.from(buf), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '截图失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
