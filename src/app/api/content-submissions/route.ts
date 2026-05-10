import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/**
 * GET /api/content-submissions
 * 素材列表（按权限过滤）
 *   admin: 全部
 *   editor: 自己及下级终端客户提交的素材
 *   end-user: 自己提交的素材
 */
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) {
      return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    }

    let submissions

    if (auth.role === 'admin') {
      submissions = await prisma.contentSubmission.findMany({
        include: {
          submitter: { select: { id: true, username: true, name: true } },
          reviewer: { select: { id: true, username: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    } else if (auth.role === 'editor') {
      // 二级客户：看到自己的提交 + 下级 end-user 的提交（parentId = 自己）
      submissions = await prisma.contentSubmission.findMany({
        where: {
          OR: [
            { submitterId: auth.userId },
            { submitter: { parentId: auth.userId } },
          ],
        },
        include: {
          submitter: { select: { id: true, username: true, name: true } },
          reviewer: { select: { id: true, username: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    } else {
      // end-user：只看自己提交的
      submissions = await prisma.contentSubmission.findMany({
        where: { submitterId: auth.userId },
        include: {
          submitter: { select: { id: true, username: true, name: true } },
          reviewer: { select: { id: true, username: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    }

    return NextResponse.json({ success: true, data: submissions })
  } catch (error) {
    console.error('获取素材列表失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * POST /api/content-submissions
 * 终端客户提交素材（end-user 专用）
 */
export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) {
      return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    }

    const body = await request.json()
    const { videoUrl, caption, targetPlatform } = body

    if (!videoUrl || !caption || !targetPlatform) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }

    const submission = await prisma.contentSubmission.create({
      data: {
        videoUrl,
        caption,
        targetPlatform,
        status: '待审核',
        submitterId: auth.userId,
      },
    })

    return NextResponse.json({ success: true, data: submission }, { status: 201 })
  } catch (error) {
    console.error('提交素材失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
