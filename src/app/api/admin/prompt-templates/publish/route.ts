import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// POST /api/admin/prompt-templates/publish  {ids: number[], published: boolean}
export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (auth?.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  let body: any = {}
  try { body = await req.json() } catch {}
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : []
  const published = !!body.published
  if (ids.length === 0) return NextResponse.json({ success: false, message: '请选择要发布的条目' }, { status: 400 })
  const r = await prisma.promptTemplate.updateMany({ where: { id: { in: ids } }, data: { published } })
  return NextResponse.json({ success: true, message: published ? `已发布 ${r.count} 条到素材库` : `已下架 ${r.count} 条` })
}
