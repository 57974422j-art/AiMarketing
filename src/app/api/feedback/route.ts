import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { putObject, signedUrl } from '@/lib/oss'

export const runtime = 'nodejs'
const prisma = new PrismaClient()

const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 单张 10MB
const IMG_MAGIC: Array<{ bytes: number[]; ext: string; mime: string }> = [
  { bytes: [0xff, 0xd8, 0xff], ext: 'jpg', mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], ext: 'png', mime: 'image/png' },
  { bytes: [0x47, 0x49, 0x46], ext: 'gif', mime: 'image/gif' },
  { bytes: [0x52, 0x49, 0x46, 0x46], ext: 'webp', mime: 'image/webp' },
]

function sniffImage(buf: Buffer): { ext: string; mime: string } | null {
  for (const m of IMG_MAGIC) {
    if (m.bytes.every((b, i) => buf[i] === b)) return { ext: m.ext, mime: m.mime }
  }
  return null
}

/** POST /api/feedback — 提交反馈（multipart: type / content / images[]，图片存 OSS） */
export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const fd = await req.formData()
    const type = String(fd.get('type') || '问题')
    const content = String(fd.get('content') || '').trim()
    if (!content) return NextResponse.json({ success: false, message: '请填写反馈内容' }, { status: 400 })
    if (content.length > 2000) return NextResponse.json({ success: false, message: '内容过长（最多2000字）' }, { status: 400 })

    // 图片上传 OSS
    const files = fd.getAll('images').filter(f => f instanceof File) as File[]
    if (files.length > MAX_IMAGES) return NextResponse.json({ success: false, message: `最多上传 ${MAX_IMAGES} 张图片` }, { status: 400 })

    const keys: string[] = []
    for (const f of files) {
      if (f.size > MAX_IMAGE_BYTES) return NextResponse.json({ success: false, message: `图片 ${f.name} 超过 10MB` }, { status: 400 })
      const buf = Buffer.from(await f.arrayBuffer())
      const kind = sniffImage(buf)
      if (!kind) return NextResponse.json({ success: false, message: `文件 ${f.name} 不是有效图片` }, { status: 400 })
      const key = `feedback/${auth.userId}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${kind.ext}`
      await putObject(key, buf, kind.mime)
      keys.push(key)
    }

    const fb = await prisma.feedback.create({
      data: { userId: auth.userId, type, content, images: keys.length ? JSON.stringify(keys) : null },
    })
    return NextResponse.json({ success: true, id: fb.id, message: '反馈已提交，感谢！' })
  } catch (e: any) {
    console.error('[反馈] 提交失败:', e?.message)
    return NextResponse.json({ success: false, message: e?.message || '提交失败' }, { status: 500 })
  }
}

/** GET /api/feedback — 我的反馈列表（图片换成 1h 签名链接） */
export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const list = await prisma.feedback.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const data = await Promise.all(list.map(async fb => ({
      ...fb,
      imageUrls: fb.images ? await Promise.all((JSON.parse(fb.images) as string[]).map(k => signedUrl(k))) : [],
    })))
    return NextResponse.json({ success: true, data })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '查询失败' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
