import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

async function ensureTable() {
  // 添加 type 列（首次运行自动创建）
  try { await prisma.$executeRawUnsafe(`ALTER TABLE MediaAsset ADD COLUMN type TEXT NOT NULL DEFAULT 'video'`) } catch {}
}

function detectType(url: string): 'video' | 'image' {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || ''
  return ['mp4', 'mov', 'avi', 'webm'].includes(ext) ? 'video' : 'image'
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    await ensureTable()
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')

    let sql = 'SELECT * FROM MediaAsset'
    const params: any[] = []
    const conds: string[] = []
    if (auth.role !== 'admin') { conds.push('ownerId = ?'); params.push(auth.userId) }
    if (type && type !== 'all') { conds.push('type = ?'); params.push(type) }
    if (conds.length > 0) sql += ' WHERE ' + conds.join(' AND ')
    sql += ' ORDER BY createdAt DESC'

    const data = params.length > 0
      ? await prisma.$queryRawUnsafe(sql, ...params)
      : await prisma.$queryRawUnsafe(sql)
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
    await ensureTable()
    const body = await request.json()
    const items = Array.isArray(body) ? body : [body]
    const created = []
    for (const item of items) {
      const { ossUrl, title } = item
      if (!ossUrl || !title) continue
      const type = detectType(ossUrl)
      const result = await prisma.$executeRawUnsafe(
        'INSERT INTO MediaAsset (ossUrl, title, type, ownerId) VALUES (?, ?, ?, ?)',
        ossUrl, title, type, auth.userId
      )
      created.push({ ossUrl, title, type })
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
    const id = parseInt(new URL(request.url).searchParams.get('id') || '', 10)
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    const rows = await prisma.$queryRawUnsafe('SELECT * FROM MediaAsset WHERE id = ?', id) as any[]
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ success: false, message: '素材不存在' }, { status: 404 })
    }
    if (auth.role !== 'admin' && rows[0].ownerId !== auth.userId) {
      return NextResponse.json({ success: false, message: '无权删除' }, { status: 403 })
    }
    await prisma.$executeRawUnsafe('DELETE FROM MediaAsset WHERE id = ?', id)
    return NextResponse.json({ success: true, message: '已删除' })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
