import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** 行业视频管理（2026-08-09）
 * POST 入库（yt_dlp_fetch.py 调用）；GET 列表；DELETE ?days= 清理 N 天前
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { key, coverKey, title, duration, industry, keyword, source = 'youtube' } = body
    if (!key || !industry) return NextResponse.json({ success: false, message: '缺少 key/industry' }, { status: 400 })
    const row = await prisma.industryVideo.create({
      data: { industry, title: title || keyword || '视频', videoUrl: key, coverUrl: coverKey || null, source, duration: duration || null, keyword: keyword || null },
    })
    return NextResponse.json({ success: true, data: { id: row.id } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  try {
    const industry = request.nextUrl.searchParams.get('industry') || ''
    const days = parseInt(request.nextUrl.searchParams.get('days') || '3', 10)
    const cutoff = new Date(Date.now() - days * 86400000)
    const rows = await prisma.industryVideo.findMany({
      where: { ...(industry ? { industry } : {}), createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return NextResponse.json({ success: true, data: rows })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  try {
    const idParam = parseInt(request.nextUrl.searchParams.get('id') || '0', 10)
    const days = parseInt(request.nextUrl.searchParams.get('days') || '3', 10)
    // 单条删除（2026-08-10 B：页面单删）
    if (idParam) {
      const row = await prisma.industryVideo.findUnique({ where: { id: idParam } })
      if (!row) return NextResponse.json({ success: false, message: '视频不存在' }, { status: 404 })
      await prisma.industryVideo.delete({ where: { id: idParam } })
      try {
        const { getOSSClient } = await import('@/lib/oss')
        const client = await getOSSClient()
        const keys = [row.videoUrl, row.coverUrl].filter(Boolean).map((u: string) => { try { return decodeURIComponent(new URL(u).pathname.replace(/^\//, '')) } catch { return u } })
        await Promise.all(keys.map((k: string) => client.delete(k).catch(() => {})))
      } catch {}
      return NextResponse.json({ success: true, message: '已删除' })
    }
    const cutoff = new Date(Date.now() - days * 86400000)
    const old = await prisma.industryVideo.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true, videoUrl: true, coverUrl: true } })
    // 删库
    const del = await prisma.industryVideo.deleteMany({ where: { createdAt: { lt: cutoff } } })
    // 删 OSS 文件（私有 bucket key）
    let ossDeleted = 0
    try {
      const { getOSSClient } = await import('@/lib/oss')
      const client = await getOSSClient()
      for (const row of old) {
        try { await client.delete(row.videoUrl); ossDeleted++ } catch {}
        if (row.coverUrl) { try { await client.delete(row.coverUrl) } catch {} }
      }
    } catch {}
    return NextResponse.json({ success: true, message: `清理 ${del.count} 条库记录 + ${ossDeleted} 个 OSS 文件（${days} 天前）` })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
