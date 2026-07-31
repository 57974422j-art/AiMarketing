import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { signedUrl } from '@/lib/oss'

const prisma = new PrismaClient()

/**
 * GET /api/admin/generation-records — 生成记录总表（替代登服务器 grep 日志）
 * 筛选: status / type / q(用户名·邮箱·taskId) / missingOss=1(成功但未转存OSS，需补下载)
 * 分页: page / pageSize；返回状态汇总 summary
 */
export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'all'
  const type = searchParams.get('type') || 'all'
  const q = (searchParams.get('q') || '').trim()
  const missingOss = searchParams.get('missingOss') === '1'
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)))

  const where: any = {}
  if (status !== 'all') where.status = status
  if (type !== 'all') where.type = type
  if (missingOss) { where.status = 'succeeded'; where.storageUrl = null }
  if (q) {
    where.OR = [
      { platformTaskId: { contains: q } },
      { prompt: { contains: q } },
      { user: { username: { contains: q } } },
      { user: { email: { contains: q } } },
    ]
  }

  try {
    const [records, total, grouped] = await Promise.all([
      prisma.generationRecord.findMany({
        where,
        include: { user: { select: { username: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.generationRecord.count({ where }),
      prisma.generationRecord.groupBy({ by: ['status'], _count: { _all: true } }),
    ])

    const summary: Record<string, number> = { all: await prisma.generationRecord.count() }
    grouped.forEach((g: any) => { summary[g.status] = g._count._all })
    // 防投诉重点指标：成功但 OSS 未落库
    summary.missingOss = await prisma.generationRecord.count({ where: { status: 'succeeded', storageUrl: null } })

    return NextResponse.json({ success: true, data: { records, total, page, pageSize, summary } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

/**
 * POST /api/admin/generation-records — 两个动作:
 * { action: 'sign', storageUrl }        → 返回 OSS 临时签名链接（客服发给客户兜底）
 * { action: 'redownload', recordId }    → 成功但没转存的记录，从 platformUrl 补下载转存 OSS
 */
export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
  }

  try {
    const body = await req.json()

    if (body.action === 'sign') {
      if (!body.storageUrl) return NextResponse.json({ success: false, message: '缺少 storageUrl' }, { status: 400 })
      const url = await signedUrl(body.storageUrl, 24 * 3600)
      return NextResponse.json({ success: true, url })
    }

    if (body.action === 'redownload') {
      const rec = await prisma.generationRecord.findUnique({ where: { id: parseInt(body.recordId) } })
      if (!rec) return NextResponse.json({ success: false, message: '记录不存在' }, { status: 404 })
      if (!rec.platformUrl) return NextResponse.json({ success: false, message: '该记录无平台URL，无法补下载' }, { status: 400 })
      if (rec.storageUrl) return NextResponse.json({ success: false, message: '该记录已有OSS地址，无需补下载' }, { status: 400 })

      const { putObject } = await import('@/lib/oss')
      const res = await fetch(rec.platformUrl)
      if (!res.ok) return NextResponse.json({ success: false, message: `平台URL已失效 HTTP ${res.status}` }, { status: 502 })
      const buffer = Buffer.from(await res.arrayBuffer())
      const contentType = res.headers.get('content-type') || ''
      const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('png') ? 'png'
        : contentType.includes('jpeg') ? 'jpg' : contentType.includes('mp3') || contentType.includes('mpeg') ? 'mp3'
        : (rec.platformUrl.split('?')[0].match(/\.([a-zA-Z0-9]{2,5})$/)?.[1] || 'bin')
      const key = `generations/${rec.userId}/${rec.id}_${Date.now()}.${ext}`
      await putObject(key, buffer, contentType || undefined)
      await prisma.generationRecord.update({
        where: { id: rec.id },
        data: { storageUrl: key, errorMessage: null },
      })
      return NextResponse.json({ success: true, storageUrl: key })
    }

    return NextResponse.json({ success: false, message: '未知 action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
