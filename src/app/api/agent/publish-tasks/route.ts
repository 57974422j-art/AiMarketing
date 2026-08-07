import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/**
 * C2 发布闭环：AgentPublishTask 任务管理
 * POST  /api/agent/publish-tasks            — 创建发布任务（Agent publish_content 调用）
 * GET   /api/agent/publish-tasks?status=    — 查询（客户端 my-fingerprint 拉待发布）
 * POST  /api/agent/publish-tasks/[id]/done  — 回写执行结果
 */
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证，请先登录' }, { status: 401 })
  try {
    const { platform, videoName, title, description = '', topics = [], socialAccountId } = await request.json()
    if (!platform || !videoName || !title) {
      return NextResponse.json({ success: false, message: '缺少参数（platform/videoName/title）' }, { status: 400 })
    }
    const task = await prisma.agentPublishTask.create({
      data: {
        userId: auth.userId,
        platform: String(platform).toLowerCase(),
        videoName,
        title,
        description,
        topics: JSON.stringify(topics || []),
        socialAccountId: socialAccountId || null,
      },
    })
    return NextResponse.json({ success: true, data: task })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证，请先登录' }, { status: 401 })
  try {
    const status = request.nextUrl.searchParams.get('status') || 'pending'
    const tasks = await prisma.agentPublishTask.findMany({
      where: { userId: auth.userId, status },
      orderBy: { createdAt: 'asc' },
      take: 50,
    })
    return NextResponse.json({
      success: true,
      data: tasks.map((t) => ({
        id: t.id,
        platform: t.platform,
        videoName: t.videoName,
        title: t.title,
        description: t.description,
        topics: (() => { try { return JSON.parse(t.topics || '[]') } catch { return [] } })(),
        socialAccountId: t.socialAccountId,
        status: t.status,
        error: t.error,
        createdAt: t.createdAt,
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权
export const dynamic = 'force-dynamic'
