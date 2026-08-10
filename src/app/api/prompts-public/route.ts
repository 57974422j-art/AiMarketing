import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// GET /api/prompts-public?tag=&keyword=&limit=&offset=  （仅返回已发布，登录用户可见）
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const tag = sp.get('tag') || ''
  const keyword = (sp.get('keyword') || '').trim()
  const limit = Math.min(parseInt(sp.get('limit') || '60'), 200)
  const offset = parseInt(sp.get('offset') || '0')
  const where: any = { published: true, isActive: true }
  if (tag) where.tags = { contains: tag }
  if (keyword) {
    where.OR = [
      { title: { contains: keyword } },
      { prompt: { contains: keyword } },
      { tags: { contains: keyword } },
      { category: { contains: keyword } },
    ]
  }
  const total = await prisma.promptTemplate.count({ where })
  const rows = await prisma.promptTemplate.findMany({
    where, orderBy: { updatedAt: 'desc' }, skip: offset, take: limit,
    select: { id: true, title: true, prompt: true, category: true, tags: true, author: true, coverUrl: true, industry: true, imageMode: true },
  })
  return NextResponse.json({ success: true, data: { list: rows, total } })
}
