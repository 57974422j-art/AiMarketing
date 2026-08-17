import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// POST /api/media-library/promote - 把提示词条目添加到公共素材库（PromptTemplate → MediaAsset source=public）
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const { promptId } = await request.json().catch(() => ({}))
    if (!promptId) return NextResponse.json({ success: false, message: '缺少 promptId' }, { status: 400 })
    const tpl = await prisma.promptTemplate.findFirst({ where: { id: Number(promptId) } })
    if (!tpl) return NextResponse.json({ success: false, message: '提示词不存在' }, { status: 404 })

    // 已添加过（同 prompt 同标题）则跳过
    const exist = await prisma.mediaAsset.findFirst({ where: { source: 'public', prompt: tpl.prompt } })
    if (exist) return NextResponse.json({ success: false, message: '该素材已在公共素材库' }, { status: 409 })

    const mediaUrl = tpl.videoUrl || tpl.coverUrl || tpl.previewUrl || ''
    if (!mediaUrl) return NextResponse.json({ success: false, message: '该条目无图/视频，无法添加到素材库' }, { status: 400 })
    const isVideo = !!tpl.videoUrl
    const asset = await prisma.mediaAsset.create({
      data: {
        title: tpl.title || '素材',
        ossUrl: mediaUrl,
        url: mediaUrl,
        type: isVideo ? 'video' : 'image',
        prompt: tpl.prompt || '',
        category: tpl.category || '',
        source: 'public',
        ownerId: auth.userId,
      },
    })
    return NextResponse.json({ success: true, data: asset, isVideo })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '添加失败' }, { status: 500 })
  }
}

export const runtime = 'nodejs'
