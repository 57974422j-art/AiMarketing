import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** 发布次数统计（2026-08-08：大屏"发布次数"竖排数据源） */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const rows = await prisma.agentPublishTask.groupBy({
      by: ['platform'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }) as any[]
    const data = rows.map((r: any) => ({ platform: r.platform, count: r._count.id }))
    return NextResponse.json({ success: true, data })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
