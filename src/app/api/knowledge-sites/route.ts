import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// GET /api/knowledge-sites - 知识库站点列表（可按 category 筛）
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const cat = new URL(request.url).searchParams.get('category') || ''
    const sites = await prisma.knowledgeSite.findMany({
      where: cat ? { category: cat } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return NextResponse.json({ success: true, data: sites })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message }, { status: 500 })
  }
}

// POST /api/knowledge-sites - 添加站点（url/title/desc/category）
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const { url, title, desc, category } = await request.json().catch(() => ({}))
    if (!url || !/^https?:\/\//.test(String(url))) return NextResponse.json({ success: false, message: '无效 URL（需 http/https）' }, { status: 400 })
    const exist = await prisma.knowledgeSite.findFirst({ where: { url: String(url) } })
    if (exist) return NextResponse.json({ success: false, message: '该站点已在知识库' }, { status: 409 })
    const site = await prisma.knowledgeSite.create({
      data: { url: String(url), title: String(title || ''), desc: String(desc || ''), category: String(category || ''), addedBy: auth.userId },
    })
    return NextResponse.json({ success: true, data: site })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message }, { status: 500 })
  }
}

// DELETE /api/knowledge-sites?id=X
export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const id = parseInt(new URL(request.url).searchParams.get('id') || '', 10)
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    await prisma.knowledgeSite.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message }, { status: 500 })
  }
}

export const runtime = 'nodejs'
