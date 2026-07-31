import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromCookie } from '@/lib/api-auth'

const prisma = new PrismaClient()

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 列出当前用户的草稿（按创建时间倒序，最新在前） */
export async function GET(request: NextRequest) {
  const auth = getAuthFromCookie(request)
  if (!auth) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  }

  const drafts = await prisma.contentDraft.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ success: true, drafts })
}

/** 保存一条草稿 */
export async function POST(request: NextRequest) {
  const auth = getAuthFromCookie(request)
  if (!auth) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const platform = String(body.platform || '').trim()
  const title = String(body.title || '').trim()
  if (!title) {
    return NextResponse.json({ success: false, message: '标题不能为空' }, { status: 400 })
  }

  const topicsRaw = body.topics
  const topics =
    Array.isArray(topicsRaw)
      ? JSON.stringify(topicsRaw)
      : topicsRaw
        ? String(topicsRaw)
        : '[]'

  const draft = await prisma.contentDraft.create({
    data: {
      userId: auth.userId,
      platform,
      title,
      description: String(body.description || ''),
      topics,
      coverImage: body.coverImage ? String(body.coverImage) : null,
      videoName: body.videoName ? String(body.videoName) : null,
    },
  })

  return NextResponse.json({ success: true, draft })
}

/** 删除一条草稿（仅能删自己的） */
export async function DELETE(request: NextRequest) {
  const auth = getAuthFromCookie(request)
  if (!auth) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  }

  const id = request.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ success: false, message: '缺少草稿 id' }, { status: 400 })
  }

  await prisma.contentDraft.deleteMany({
    where: { id: String(id), userId: auth.userId },
  })

  return NextResponse.json({ success: true })
}
