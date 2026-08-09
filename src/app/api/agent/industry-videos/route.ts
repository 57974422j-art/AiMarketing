import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** 用户按行业拉当天视频（2026-08-09）：User.industry → IndustryVideo，OSS 签名 URL 播放 */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { industry: true } })
    const industry = request.nextUrl.searchParams.get('industry') || user?.industry || ''
    if (!industry) return NextResponse.json({ success: true, data: { videos: [], message: '请先在设置中登记行业' } })

    const days = parseInt(request.nextUrl.searchParams.get('days') || '1', 10)
    const cutoff = new Date(Date.now() - days * 86400000)
    const rows = await prisma.industryVideo.findMany({
      where: { industry, createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    // OSS 私有 → 签名 URL
    let signed: any[] = rows
    try {
      const { getOSSClient } = await import('@/lib/oss')
      const client = await getOSSClient()
      signed = await Promise.all(rows.map(async (r) => ({
        id: r.id, title: r.title, duration: r.duration, industry: r.industry, source: r.source,
        videoUrl: await client.signatureUrl(r.videoUrl, { expires: 3600 }),
        coverUrl: r.coverUrl ? await client.signatureUrl(r.coverUrl, { expires: 3600 }) : null,
      })))
    } catch (e: any) { console.error('[IndustryVideo] 签名失败:', e.message) }
    return NextResponse.json({ success: true, data: { videos: signed } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
