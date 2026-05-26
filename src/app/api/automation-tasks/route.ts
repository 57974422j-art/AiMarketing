import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    let tasks
    if (auth.role === 'admin') {
      tasks = await prisma.automationTask.findMany({
        include: { creator: { select: { id: true, username: true, name: true } }, device: { select: { id: true, name: true } }, taskLogs: { orderBy: { createdAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      })
    } else {
      tasks = await prisma.automationTask.findMany({
        where: { createdBy: auth.userId },
        include: { creator: { select: { id: true, username: true, name: true } }, device: { select: { id: true, name: true } }, taskLogs: { orderBy: { createdAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      })
    }

    return NextResponse.json({ success: true, data: tasks })
  } catch (error) {
    console.error('获取任务列表失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    const body = await request.json()
    const { type, params, assignedDeviceId } = body

    const validTypes = ['互关', '点赞', '评论', '转发', '发布视频']
    if (!type || !validTypes.includes(type)) {
      return NextResponse.json({ success: false, message: '无效的任务类型' }, { status: 400 })
    }

    const task = await prisma.automationTask.create({
      data: { type, status: '等待中', params: JSON.stringify(params || {}), assignedDeviceId: assignedDeviceId || null, createdBy: auth.userId },
    })

    return NextResponse.json({ success: true, data: task }, { status: 201 })
  } catch (error) {
    console.error('创建任务失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
