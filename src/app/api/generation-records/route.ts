import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// GET /api/generation-records?type=text2img&limit=50&offset=0  （查自己的生成历史，2026-08-10）
export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const type = sp.get('type') || ''
  const limit = Math.min(parseInt(sp.get('limit') || '50'), 100)
  const offset = parseInt(sp.get('offset') || '0')
  const where: any = { userId: auth.userId, ...(type ? { type } : {}) }
  const total = await prisma.generationRecord.count({ where })
  const rows = await prisma.generationRecord.findMany({
    where, orderBy: { createdAt: 'desc' }, skip: offset, take: limit,
    select: { id: true, type: true, provider: true, model: true, status: true, costPoints: true,
      prompt: true, platformUrl: true, storageUrl: true, errorMessage: true, createdAt: true },
  })
  return NextResponse.json({ success: true, data: { list: rows, total, limit, offset } })
}
