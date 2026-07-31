import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

async function ensureTable() {
  try { await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS MediaAsset (id INTEGER PRIMARY KEY AUTOINCREMENT, ossUrl TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT \'video\', prompt TEXT DEFAULT \'\', category TEXT DEFAULT \'\', source TEXT DEFAULT \'public\', ownerId INTEGER, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)') } catch {}
  const migrations = [
    `ALTER TABLE MediaAsset ADD COLUMN ossUrl TEXT DEFAULT ''`,
    `ALTER TABLE MediaAsset ADD COLUMN type TEXT NOT NULL DEFAULT 'video'`,
    `ALTER TABLE MediaAsset ADD COLUMN prompt TEXT DEFAULT ''`,
    `ALTER TABLE MediaAsset ADD COLUMN category TEXT DEFAULT ''`,
    `ALTER TABLE MediaAsset ADD COLUMN source TEXT DEFAULT 'public'`,
    `ALTER TABLE MediaAsset ADD COLUMN purpose TEXT DEFAULT ''`,
    `ALTER TABLE MediaAsset ADD COLUMN industry TEXT DEFAULT ''`,
    `ALTER TABLE MediaAsset ADD COLUMN platform TEXT DEFAULT ''`,
    `ALTER TABLE MediaAsset ADD COLUMN thumbnailUrl TEXT DEFAULT ''`,
    `ALTER TABLE MediaAsset ADD COLUMN originalUrl TEXT DEFAULT ''`,
    `ALTER TABLE MediaAsset ADD COLUMN orientation TEXT DEFAULT 'unknown'`,
  ]
  for (const sql of migrations) { try { await prisma.$executeRawUnsafe(sql) } catch {} }
  // 回填：若历史数据走 Prisma 的 url 列（prisma db push 建的表），同步到 ossUrl，避免旧素材丢失
  try { await prisma.$executeRawUnsafe('UPDATE MediaAsset SET ossUrl = url WHERE (ossUrl IS NULL OR ossUrl = \'\') AND url IS NOT NULL') } catch {}
  // 回填：图片默认归横屏，避免未知方向在横/竖 tab 都看不到
  try { await prisma.$executeRawUnsafe("UPDATE MediaAsset SET orientation = 'landscape' WHERE (orientation IS NULL OR orientation = '' OR orientation = 'unknown') AND type = 'image'") } catch {}
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
    const orientation = searchParams.get('orientation')

    let sql = 'SELECT * FROM MediaAsset'
    const params: any[] = []
    const conds: string[] = []
    if (auth.role === 'end-user') { conds.push('(ownerId = ? OR source = ?)'); params.push(auth.userId, 'public') }
    if (type && type !== 'all') { conds.push('type = ?'); params.push(type) }
    if (category) { conds.push('category = ?'); params.push(category) }
    if (source) { conds.push('source = ?'); params.push(source) }
    if (orientation && orientation !== 'all') { conds.push('orientation = ?'); params.push(orientation) }
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
    const skipped: string[] = []
    for (const item of items) {
      const { ossUrl, title, prompt, category, source, purpose, industry, platform, thumbnailUrl, originalUrl, type, orientation } = item
      if (!ossUrl || !title) { skipped.push(String(title || '未命名')); continue }
      // 去重：同 ossUrl 已存在则跳过，避免重复素材
      try {
        const exist = await prisma.$queryRawUnsafe('SELECT id FROM MediaAsset WHERE ossUrl = ? LIMIT 1', ossUrl) as any[]
        if (Array.isArray(exist) && exist.length > 0) { skipped.push(title); continue }
      } catch { /* 忽略查重异常，继续插入 */ }
      const t = type || detectType(ossUrl)
      await prisma.$executeRawUnsafe(
        'INSERT INTO MediaAsset (ossUrl, title, prompt, type, category, source, purpose, industry, platform, thumbnailUrl, originalUrl, ownerId, orientation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ossUrl, title, prompt || '', t, category || '', source || 'public', purpose || '', industry || '', platform || '', thumbnailUrl || '', originalUrl || '', auth.userId, orientation || 'unknown'
      )
      created.push({ ossUrl, title, type: t })
    }
    const msg = `已添加 ${created.length} 个素材${skipped.length ? `，${skipped.length} 个跳过（重复或无标题）` : ''}`
    return NextResponse.json({ success: true, data: created, message: msg }, { status: 201 })
  } catch (e) {
    console.error('[media-library POST] 异常:', e)
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, message: '服务器错误: ' + msg }, { status: 500 })
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

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
