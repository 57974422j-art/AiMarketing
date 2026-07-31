import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    const body = await request.json()
    const { command } = body
    if (!command) return NextResponse.json({ success: false, message: '缺少 command' }, { status: 400 })

    const row: any = await prisma.device.findUnique({ where: { id: parseInt(params.id) } })
    if (!row) return NextResponse.json({ success: false, message: '设备不存在' }, { status: 404 })
    if (row.type !== 'q1' || !row.apiPort) return NextResponse.json({ success: false, message: '仅 Q1 设备支持 Shell' }, { status: 400 })

    const res = await fetch(`http://localhost:${row.apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent(command)}`, { signal: AbortSignal.timeout(30000) })
    const text = await res.text()
    return NextResponse.json({ success: res.ok, output: text.substring(0, 2000) })
  } catch (e: any) {
    console.error('[Shell] 失败:', e?.message || e)
    return NextResponse.json({ success: false, message: e?.message || '执行失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
