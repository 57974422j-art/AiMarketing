import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { putObject } from '@/lib/oss'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// POST /api/prompt-templates/upload - 上传图/视频挂到提示词卡片（formData: id + file）
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const form = await request.formData().catch(() => null)
    if (!form) return NextResponse.json({ success: false, message: '无效请求' }, { status: 400 })
    const id = parseInt(String(form.get('id') || ''), 10)
    const file = form.get('file') as File | null
    if (!id || !file) return NextResponse.json({ success: false, message: '缺少 id 或文件' }, { status: 400 })
    if (file.size > 200 * 1024 * 1024) return NextResponse.json({ success: false, message: '文件过大（≤200MB）' }, { status: 413 })

    const tpl = await prisma.promptTemplate.findFirst({ where: { id } })
    if (!tpl) return NextResponse.json({ success: false, message: '模板不存在' }, { status: 404 })

    const buf = Buffer.from(await file.arrayBuffer())
    if (buf.length < 100) return NextResponse.json({ success: false, message: '文件为空' }, { status: 400 })
    const isVideo = file.type.startsWith('video/')
    const ext = isVideo ? 'mp4' : (file.name.split('.').pop() || 'jpg').toLowerCase()
    const key = `prompts/cheerselfai/upload/${id}-${Date.now()}.${ext}`
    await putObject(key, buf, file.type || (isVideo ? 'video/mp4' : 'image/jpeg'))
    const ossUrl = `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${key}`
    await prisma.promptTemplate.update({
      where: { id },
      data: isVideo ? { videoUrl: ossUrl } : { previewUrl: ossUrl, coverUrl: ossUrl },
    })
    return NextResponse.json({ success: true, url: ossUrl, isVideo })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '上传失败' }, { status: 500 })
  }
}

export const runtime = 'nodejs'
