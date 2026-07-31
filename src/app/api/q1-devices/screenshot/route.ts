import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { q1Info } from '@/lib/device-engine'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const deviceId = parseInt(searchParams.get('deviceId') || '')
    if (!deviceId) return NextResponse.json({ success: false, message: '缺少 deviceId' }, { status: 400 })

    const row: any = await prisma.device.findUnique({ where: { id: deviceId } })
    if (!row) return NextResponse.json({ success: false, message: '设备不存在' }, { status: 404 })
    if (row.type !== 'q1' || !row.apiPort) return NextResponse.json({ success: false, message: '非 Q1 或端口未配置' }, { status: 400 })

    // 通过 FRP 隧道调用截图
    const snapRes = await fetch(`http://localhost:${row.apiPort}/task=snap&level=3`, { signal: AbortSignal.timeout(10000) })
    if (!snapRes.ok) return NextResponse.json({ success: false, message: `截图失败: ${snapRes.status}` }, { status: 502 })

    const buf = await snapRes.arrayBuffer()
    return new NextResponse(Buffer.from(buf), {
      headers: { 'Content-Type': snapRes.headers.get('content-type') || 'image/png' },
    })
  } catch (e: any) {
    console.error('[Q1截图] 失败:', e?.message || e)
    return NextResponse.json({ success: false, message: e?.message || '截图失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
