import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// POST /api/media-library/promote - 把提示词条目添加到公共素材库（PromptTemplate → MediaAsset source=public）
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const { promptId, promptIds } = await request.json().catch(() => ({}))
    const ids = promptIds && Array.isArray(promptIds) ? promptIds.map(Number) : (promptId ? [Number(promptId)] : [])
    if (!ids.length || ids.some((x: number) => !x)) return NextResponse.json({ success: false, message: '缺少 promptId' }, { status: 400 })

    const tpls = await prisma.promptTemplate.findMany({ where: { id: { in: ids } } })
    if (!tpls.length) return NextResponse.json({ success: false, message: '提示词不存在' }, { status: 404 })

    let added = 0, skipped = 0, noMedia = 0
    const results = []
    for (const tpl of tpls) {
      const exist = await prisma.mediaAsset.findFirst({ where: { source: 'public', prompt: tpl.prompt } })
      if (exist) { skipped++; continue }
      const mediaUrl = tpl.videoUrl || tpl.coverUrl || tpl.previewUrl || ''
      if (!mediaUrl) { noMedia++; continue }
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
      added++
      results.push({ id: asset.id, isVideo })
    }
    return NextResponse.json({ success: true, data: results, added, skipped, noMedia })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '添加失败' }, { status: 500 })
  }
}

export const runtime = 'nodejs'
