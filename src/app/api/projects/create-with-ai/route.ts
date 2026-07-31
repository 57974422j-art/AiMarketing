import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) {
      return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    }

    const body = await request.json()
    const { name, description, industry, goals, platforms } = body

    if (!name?.trim()) {
      return NextResponse.json({ success: false, message: '项目名称不能为空' }, { status: 400 })
    }

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        userId: auth.userId,
      },
    })

    console.log('[CreateWithAI] 项目创建成功:', project.id, 'industry:', industry, 'goals:', goals, 'platforms:', platforms)

    return NextResponse.json({
      success: true,
      data: project,
      message: '项目创建成功！可以开始使用 AI 工具创作内容了。',
    })
  } catch (error) {
    console.error('[CreateWithAI] 错误:', error)
    return NextResponse.json({ success: false, message: '创建失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
