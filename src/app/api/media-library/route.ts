import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

async function ensureTable() {
  try { await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS MediaAsset (id INTEGER PRIMARY KEY AUTOINCREMENT, ossUrl TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT \'video\', prompt TEXT DEFAULT \'\', category TEXT DEFAULT \'\', source TEXT DEFAULT \'public\', ownerId INTEGER, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)') } catch {}
  const migrations = [
    `ALTER TABLE MediaAsset ADD COLUMN type TEXT NOT NULL DEFAULT 'video'`,
    `ALTER TABLE MediaAsset ADD COLUMN prompt TEXT DEFAULT ''`,
    `ALTER TABLE MediaAsset ADD COLUMN category TEXT DEFAULT ''`,
    `ALTER TABLE MediaAsset ADD COLUMN source TEXT DEFAULT 'public'`,
  ]
  for (const sql of migrations) { try { await prisma.$executeRawUnsafe(sql) } catch {} }
}

function detectType(url: string): 'video' | 'image' {
  const clean = url.split('?')[0].split('#')[0]
  const ext = clean.split('.').pop()?.toLowerCase() || ''
  return ['mp4', 'mov', 'avi', 'webm'].includes(ext) ? 'video' : 'image'
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    await ensureTable()
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const source = searchParams.get('source')
    const category = searchParams.get('category')

    let sql = 'SELECT * FROM MediaAsset'
    const params: any[] = []
    const conds: string[] = []
    if (auth.role === 'end-user') { conds.push('(ownerId = ? OR source = ?)'); params.push(auth.userId, 'public') }
    if (type && type !== 'all') { conds.push('type = ?'); params.push(type) }
    if (category) { conds.push('category = ?'); params.push(category) }
    if (source) { conds.push('source = ?'); params.push(source) }
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
    const created: any[] = []
    for (const item of items) {
      const { ossUrl, title, prompt, category, source } = item
      if (!ossUrl || !title) continue
      const type = detectType(ossUrl)
      await prisma.$executeRawUnsafe(
        'INSERT INTO MediaAsset (ossUrl, title, prompt, type, category, source, ownerId) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ossUrl, title, prompt || '', type, category || '', source || 'public', auth.userId
      )
      created.push({ ossUrl, title, type, prompt })
    }
    return NextResponse.json({ success: true, data: created, message: `已添加 ${created.length} 个素材` }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    const body = await request.json()
    const { id, prompt, category } = body
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    // 收藏：复制一条公共素材到用户自己名下
    if (body.action === 'favorite') {
      const rows = await prisma.$queryRawUnsafe('SELECT * FROM MediaAsset WHERE id = ?', id) as any[]
      if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ success: false, message: '素材不存在' }, { status: 404 })
      const src = rows[0]
      await prisma.$executeRawUnsafe(
        'INSERT INTO MediaAsset (ossUrl, title, prompt, type, category, source, ownerId) VALUES (?, ?, ?, ?, ?, ?, ?)',
        src.ossUrl, src.title, src.prompt || '', src.type, src.category || '', 'private', auth.userId
      )
      return NextResponse.json({ success: true, message: '已收藏' })
    }
    await prisma.$executeRawUnsafe('UPDATE MediaAsset SET prompt = ?, category = ? WHERE id = ?', prompt || '', category || '', id)
    return NextResponse.json({ success: true, message: '已更新' })
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
