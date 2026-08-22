import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/**
 * GET /api/agent/suggestions — 主动推送建议（阶段2，Tick 简化版）
 * 按规则生成 2-4 条主动建议：用户画像缺失 → onboarding；进行中的生成任务 → 进度提醒；
 * 常规内容/热点建议。前端每 10 分钟拉一次，点击 prompt 作为下一条消息发给 Agent。
 */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证，请先登录' }, { status: 401 })

  try {
    // AgentMemory.userId 存的是 username（非数字 id），需先取用户
    const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { username: true } })
    const username = user?.username || String(auth.userId)

    const [memories, pending] = await Promise.all([
      prisma.agentMemory.findMany({
        where: { userId: username, visibility: { in: ['user', 'all'] } },
        orderBy: { salience: 'desc' },
        take: 12,
      }),
      prisma.generationRecord.findMany({
        where: { userId: auth.userId, status: { in: ['pending', 'processing'] } },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { id: true, type: true, prompt: true, createdAt: true },
      }),
    ])

    const suggestions: { type: string; title: string; desc: string; prompt: string }[] = []
    const hasProfile = memories.some(m => (m.tags || '').includes('画像') || (m.tags || '').includes('profile'))

    if (!hasProfile) {
      suggestions.push({
        type: 'onboarding',
        title: '让我更懂你',
        desc: '回答几个问题，我会记住你的行业与偏好，推荐更精准',
        prompt: '开始了解我的情况吧（行业、产品、常发平台、目标人群）',
      })
    }
    if (pending.length > 0) {
      suggestions.push({
        type: 'task',
        title: `你有 ${pending.length} 个生成任务进行中（生成中，完成后自动显示结果；可随时问我进度）`,
        desc: pending[0].prompt ? `「${pending[0].prompt.slice(0, 24)}…」` : 'AI 生成中',
        prompt: '帮我查一下我最近的生成任务进度',
      })
    }
    if (suggestions.length < 3) {
      suggestions.push({
        type: 'hotspot',
        title: '看看今日热点',
        desc: '蹭热点做内容，点击让我结合热点给你 3 个选题',
        prompt: '今天有什么热点可以蹭？给我 3 个选题',
      })
    }
    suggestions.push({
      type: 'content',
      title: '把文案变成视频',
      desc: '一键成片：文案+素材 → 配音字幕成品',
      prompt: '帮我把一段文案做成带配音和字幕的视频',
    })

    return NextResponse.json({ success: true, data: suggestions.slice(0, 4) })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
