import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// 确保 type 列存在
async function ensureTypeColumn() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE MediaAsset ADD COLUMN type TEXT NOT NULL DEFAULT 'video'`)
  } catch { /* 列已存在则忽略 */ }
}

function detectType(url: string): 'video' | 'image' {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || ''
  return ['mp4', 'mov', 'avi', 'webm'].includes(ext) ? 'video' : 'image'
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    await ensureTypeColumn()
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // video | image | all

    const where: any = auth.role === 'admin' ? {} : { ownerId: auth.userId }
    if (type && type !== 'all') where.type = type

    const data = await prisma.mediaAsset.findMany({ where, orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ success: true, data })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    await ensureTypeColumn()
    const body = await request.json()
    // 支持单条和批量
    const items = Array.isArray(body) ? body : [body]
    const created = []
    for (const item of items) {
      const { ossUrl, title } = item
      if (!ossUrl || !title) continue
      const type = detectType(ossUrl)
      const asset = await prisma.mediaAsset.create({
        data: { ossUrl, title, type, ownerId: auth.userId },
      })
      created.push(asset)
    }
    return NextResponse.json({ success: true, data: created, message: `已添加 ${created.length} 个素材` }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '', 10)
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    const asset = await prisma.mediaAsset.findUnique({ where: { id } })
    if (!asset) return NextResponse.json({ success: false, message: '素材不存在' }, { status: 404 })
    if (auth.role !== 'admin' && asset.ownerId !== auth.userId) {
      return NextResponse.json({ success: false, message: '无权删除' }, { status: 403 })
    }
    await prisma.mediaAsset.delete({ where: { id } })
    return NextResponse.json({ success: true, message: '已删除' })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
