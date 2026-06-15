import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// GET — 返回当前用户绑定的设备（用于storage推送弹窗）
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

    // 通过 Account → Device 查用户绑定的设备
    const accounts = await prisma.account.findMany({
      where: { userId: auth.userId, deviceId: { not: null } },
      include: { device: { select: { id: true, name: true, apiPort: true, type: true, status: true } } },
    })

    // 去重，只用 Q1 设备
    const seen = new Set<number>()
    const devices: Array<{ id: number; name: string; apiPort: number | null; type: string; status: string }> = []
    for (const acct of accounts) {
      if (acct.device && !seen.has(acct.device.id) && acct.device.type === 'q1') {
        seen.add(acct.device.id)
        devices.push(acct.device)
      }
    }

    return NextResponse.json({ success: true, data: devices })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
