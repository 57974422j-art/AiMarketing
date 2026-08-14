import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// GET /api/music/library - 音乐库列表（我的 + 公共）
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请登录' }, { status: 401 })
  try {
    const mine = await prisma.mediaAsset.findMany({
      where: { ownerId: auth.userId, type: 'audio', category: 'music' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const pub = await prisma.mediaAsset.findMany({
      where: { source: 'public', type: 'audio', category: 'music' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({ success: true, data: { mine, public: pub } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '加载失败' }, { status: 500 })
  }
}

// POST /api/music/library - 标记公开（admin）或 设置私有；body: { id, isPublic }
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请登录' }, { status: 401 })
  try {
    const { id, isPublic } = await request.json().catch(() => ({}))
    if (!id) return NextResponse.json({ success: false, message: '缺少音乐ID' }, { status: 400 })
    const asset = await prisma.mediaAsset.findFirst({ where: { id: Number(id) } })
    if (!asset) return NextResponse.json({ success: false, message: '音乐不存在' }, { status: 404 })
    // 仅 admin 可设为公开；本人可改回私有
    if (isPublic && auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可设为公开' }, { status: 403 })
    if (!isPublic && asset.ownerId !== auth.userId && auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '无权限' }, { status: 403 })
    }
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { source: isPublic ? 'public' : 'private' } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '操作失败' }, { status: 500 })
  }
}

// DELETE /api/music/library?id=xxx - 删除自己的音乐（admin 可删任意）
export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请登录' }, { status: 401 })
  try {
    const id = parseInt(new URL(request.url).searchParams.get('id') || '')
    if (!id) return NextResponse.json({ success: false, message: '缺少音乐ID' }, { status: 400 })
    const asset = await prisma.mediaAsset.findFirst({ where: { id } })
    if (!asset) return NextResponse.json({ success: false, message: '音乐不存在' }, { status: 404 })
    if (asset.ownerId !== auth.userId && auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '无权限' }, { status: 403 })
    }
    await prisma.mediaAsset.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '删除失败' }, { status: 500 })
  }
}

export const runtime = 'nodejs'
