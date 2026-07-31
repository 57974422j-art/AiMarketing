import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })

    const task = await prisma.automationTask.findUnique({ where: { id: parseInt(id, 10) } })
    if (!task) return NextResponse.json({ success: false, message: '任务不存在' }, { status: 404 })
    if (task.status !== '等待中' && task.status !== '执行中') {
      return NextResponse.json({ success: false, message: '该任务无法取消' }, { status: 400 })
    }

    await prisma.automationTask.update({
      where: { id: task.id },
      data: { status: '失败' },
    })

    await prisma.taskLog.create({
      data: { taskId: task.id, action: '取消', result: '用户手动取消', errorMessage: null },
    })

    return NextResponse.json({ success: true, message: '任务已取消' })
  } catch (error) {
    console.error('取消任务失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
