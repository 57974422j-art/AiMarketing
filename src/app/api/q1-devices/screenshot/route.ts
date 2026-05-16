import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const deviceId = parseInt(searchParams.get('deviceId') || '')
    if (!deviceId) return NextResponse.json({ success: false, message: '缺少 deviceId' }, { status: 400 })

    const device: any = await prisma.device.findUnique({ where: { id: deviceId } })
    if (!device) return NextResponse.json({ success: false, message: '设备不存在' }, { status: 404 })
    if (device.type !== 'q1') return NextResponse.json({ success: false, message: '非 Q1 设备' }, { status: 400 })
    if (!device.ip || !device.apiPort) return NextResponse.json({ success: false, message: '设备 IP/端口未配置' }, { status: 400 })

    // 调用 Q1 截图 API
    const snapRes = await fetch(`http://${device.ip}:${device.apiPort}/task=snap&level=3`, { signal: AbortSignal.timeout(10000) })
    if (!snapRes.ok) return NextResponse.json({ success: false, message: `截图失败: ${snapRes.status}` }, { status: 502 })

    // 返回图片
    const buf = await snapRes.arrayBuffer()
    return new NextResponse(Buffer.from(buf), {
      headers: { 'Content-Type': snapRes.headers.get('content-type') || 'image/png' },
    })
  } catch (e: any) {
    console.error('[Q1截图] 失败:', e?.message || e)
    return NextResponse.json({ success: false, message: e?.message || '截图失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
