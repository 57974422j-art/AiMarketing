import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { signedUrl } from '@/lib/oss'

const prisma = new PrismaClient()

/** GET /api/admin/feedback — 反馈列表（status 筛选、分页、图片签名链接） */
export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'all'
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)))

  const where: any = {}
  if (status !== 'all') where.status = status

  try {
    const [list, total, grouped] = await Promise.all([
      prisma.feedback.findMany({
        where,
        include: { user: { select: { username: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.feedback.count({ where }),
      prisma.feedback.groupBy({ by: ['status'], _count: { _all: true } }),
    ])

    const summary: Record<string, number> = { all: await prisma.feedback.count() }
    grouped.forEach((g: any) => { summary[g.status] = g._count._all })

    const data = await Promise.all(list.map(async fb => ({
      ...fb,
      imageUrls: fb.images ? await Promise.all((JSON.parse(fb.images) as string[]).map(k => signedUrl(k, 24 * 3600))) : [],
    })))

    return NextResponse.json({ success: true, data: { list: data, total, page, pageSize, summary } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

/** PUT /api/admin/feedback — 更新状态/回复 { id, status?, reply? } */
export async function PUT(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
  }

  try {
    const { id, status, reply } = await req.json()
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    const data: any = {}
    if (status) data.status = status
    if (reply !== undefined) data.reply = reply
    await prisma.feedback.update({ where: { id: parseInt(id) }, data })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
