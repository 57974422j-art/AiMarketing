import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/**
 * GET /api/agent/media — 媒体舞台聚合数据（阶段1，对齐 BaiLongma 媒体舞台）
 * 返回：BGM 音乐库（BgmTrack）+ 用户最近的 AI 生成记录（text2video/text2img/digital_human）
 */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证，请先登录' }, { status: 401 })

  try {
    const [bgm, records] = await Promise.all([
      prisma.bgmTrack.findMany({ take: 20, orderBy: { createdAt: 'desc' } }),
      prisma.generationRecord.findMany({
        where: {
          userId: auth.userId,
          status: 'succeeded',
          type: { in: ['text2video', 'text2img', 'digital_human', 'ai_chat'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
    ])

    return NextResponse.json({
      success: true,
      data: {
        bgm: bgm.map((t) => ({ id: t.id, title: t.title, mood: t.mood || '', url: t.url })),
        records: records.map((r) => ({
          id: r.id,
          type: r.type,
          url: r.storageUrl || r.platformUrl || '',
          prompt: r.prompt || '',
          createdAt: r.createdAt,
        })),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
