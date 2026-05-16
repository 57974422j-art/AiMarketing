import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    const body = await request.json()
    const { deviceId, command } = body
    if (!deviceId || !command) return NextResponse.json({ success: false, message: '缺少 deviceId 或 command' }, { status: 400 })

    const device: any = await prisma.device.findUnique({ where: { id: parseInt(deviceId) } })
    if (!device || device.type !== 'q1' || !device.ip || !device.apiPort) {
      return NextResponse.json({ success: false, message: '设备不可用' }, { status: 400 })
    }

    const res = await fetch(`http://${device.ip}:${device.apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent(command)}`, { signal: AbortSignal.timeout(30000) })
    const text = await res.text()
    return NextResponse.json({ success: res.ok, output: text.substring(0, 2000) })
  } catch (e: any) {
    console.error('[Q1 Shell] 失败:', e?.message || e)
    return NextResponse.json({ success: false, message: e?.message || '执行失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
