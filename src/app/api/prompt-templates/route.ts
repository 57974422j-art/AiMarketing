import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'

const prisma = new PrismaClient()

/** 判断是否为外部临时链接（需要转存到自己的 OSS） */
function isTempUrl(url: string): boolean {
  return url.includes('dashscope') || url.includes('siliconflow') || url.includes('Expires=') || url.includes('OSSAccessKeyId=') || !url.includes(process.env.OSS_BUCKET || 'aitrader-marketing')
}

/** 下载临时链接文件并转存到自己的 OSS，返回永久链接 */
async function relocateToOSS(url: string, ext: string): Promise<string | null> {
  if (!process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_BUCKET) return null
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(60000) })
    if (!resp.ok) return null
    const buf = await resp.arrayBuffer()
    const tempPath = join(process.cwd(), 'temp', `relocate_${Date.now()}.${ext}`)
    writeFileSync(tempPath, new Uint8Array(buf))

    const OSS = (await import('ali-oss')).default
    const client = new OSS({
      region: process.env.OSS_REGION || 'oss-cn-hangzhou',
      accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
      bucket: process.env.OSS_BUCKET!,
      secure: true,
    })
    const ossName = `previews/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    await client.put(ossName, tempPath, { headers: { 'x-oss-object-acl': 'public-read' } })
    unlinkSync(tempPath)
    return `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION || 'oss-cn-hangzhou'}.aliyuncs.com/${ossName}`
  } catch (e) {
    console.error('[转存OSS] 失败:', e)
    return null
  }
}

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS PromptTemplate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  prompt TEXT NOT NULL,
  previewUrl TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
)
`

const CATEGORIES = ['海报封面', '产品展示', '品牌宣传', '节日营销', '短视频封面', '文生图', '文生视频', '场景', '数字人']

async function ensureTable() {
  await prisma.$executeRawUnsafe(CREATE_TABLE_SQL)
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    await ensureTable()
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const type = searchParams.get('type') // 'image' | 'video'
    let sql = 'SELECT * FROM PromptTemplate'
    const params: any[] = []
    const conditions: string[] = []

    if (category) { conditions.push('category = ?'); params.push(category) }
    if (type === 'image') { conditions.push("(category = '文生图' OR category NOT IN ('文生视频'))") }
    if (type === 'video') { conditions.push("category = '文生视频'") }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ')
    sql += ' ORDER BY id ASC'

    let rows: any[]
    if (params.length > 0) {
      rows = await prisma.$queryRawUnsafe(sql, ...params)
    } else {
      rows = await prisma.$queryRawUnsafe(sql)
    }
    return NextResponse.json({ success: true, data: rows })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    await ensureTable()
    const body = await request.json()
    const { title, category, prompt, previewUrl } = body
    if (!title || !category || !prompt) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }
    if (!CATEGORIES.includes(category)) {
      return NextResponse.json({ success: false, message: '分类无效' }, { status: 400 })
    }
    // 如果 previewUrl 是临时链接（dashscope等），自动转存到自己的 OSS
    let finalUrl = previewUrl || null
    if (finalUrl && isTempUrl(finalUrl)) {
      const ext = finalUrl.endsWith('.png') ? 'png' : finalUrl.endsWith('.mp4') ? 'mp4' : 'jpg'
      const ossUrl = await relocateToOSS(finalUrl, ext)
      if (ossUrl) finalUrl = ossUrl
      else console.warn(`[模板] 转存失败, 保留原链接: ${finalUrl?.substring(0, 60)}`)
    }
    const result = await prisma.$executeRawUnsafe(
      'INSERT INTO PromptTemplate (title, category, prompt, previewUrl) VALUES (?, ?, ?, ?)',
      title, category, prompt, finalUrl
    )
    return NextResponse.json({ success: true, message: '创建成功' }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    await ensureTable()
    const body = await request.json()
    const { id, title, category, prompt, previewUrl } = body
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    const existing = await prisma.$queryRawUnsafe('SELECT id FROM PromptTemplate WHERE id = ?', id)
    if (!Array.isArray(existing) || existing.length === 0) {
      return NextResponse.json({ success: false, message: '模板不存在' }, { status: 404 })
    }
    // 如果 previewUrl 是临时链接，自动转存到自己的 OSS
    let finalUrl = previewUrl ?? null
    if (finalUrl && isTempUrl(finalUrl)) {
      const ext = finalUrl.endsWith('.png') ? 'png' : finalUrl.endsWith('.mp4') ? 'mp4' : 'jpg'
      const ossUrl = await relocateToOSS(finalUrl, ext)
      if (ossUrl) finalUrl = ossUrl
      else console.warn(`[模板] 转存失败, 保留原链接: ${finalUrl?.substring(0, 60)}`)
    }
    await prisma.$executeRawUnsafe(
      'UPDATE PromptTemplate SET title = ?, category = ?, prompt = ?, previewUrl = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      title, category, prompt, finalUrl, id
    )
    return NextResponse.json({ success: true, message: '已更新' })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    await ensureTable()
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '', 10)
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    await prisma.$executeRawUnsafe('DELETE FROM PromptTemplate WHERE id = ?', id)
    return NextResponse.json({ success: true, message: '已删除' })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
