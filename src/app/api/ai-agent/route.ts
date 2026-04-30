import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import prisma from '@/lib/prisma'


const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role }
}

function checkPermission(role: string, action: 'read' | 'write' | 'delete'): boolean {
  switch (action) {
    case 'read': return ['viewer', 'editor', 'admin'].includes(role)
    case 'write': return ['editor', 'admin'].includes(role)
    case 'delete': return role === 'admin'
    default: return false
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }
    
    if (!checkPermission(user.role, 'read')) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }
    
    const agents = await prisma.aIAgent.findMany({
      where: user.role === 'admin' ? {} : { userId: user.userId },
      include: { trainingDocuments: true },
      orderBy: { createdAt: 'desc' }
    })
    
    return NextResponse.json({ success: true, data: agents })
  } catch (error) {
    console.error('获取AI员工列表失败:', error)
    return NextResponse.json({ success: false, message: '获取AI员工列表失败' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }
    
    if (!checkPermission(user.role, 'write')) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }
    
    const body = await request.json()
    const { name, welcomeMessage, replyStyle, promptTemplate } = body
    
    if (!name) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }
    
    const agent = await prisma.aIAgent.create({
      data: {
        name,
        welcomeMessage: welcomeMessage || '您好！',
        replyStyle: replyStyle || '亲切',
        promptTemplate: promptTemplate || '你是一个专业的客服助手，请根据提供的上下文信息回复用户的问题。',
        userId: user.userId
      }
    })
    
    return NextResponse.json({ success: true, data: agent }, { status: 201 })
  } catch (error) {
    console.error('创建AI员工失败:', error)
    return NextResponse.json({ success: false, message: '创建AI员工失败' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }
    
    if (!checkPermission(user.role, 'write')) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }
    
    const body = await request.json()
    const { id, name, welcomeMessage, replyStyle, promptTemplate } = body
    
    const existing = await prisma.aIAgent.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ success: false, message: 'AI员工不存在' }, { status: 404 })
    }
    
    if (existing.userId !== user.userId && user.role !== 'admin') {
      return NextResponse.json({ success: false, message: '没有权限修改此AI员工' }, { status: 403 })
    }
    
    const agent = await prisma.aIAgent.update({
      where: { id },
      data: { name, welcomeMessage, replyStyle, promptTemplate }
    })
    
    return NextResponse.json({ success: true, data: agent })
  } catch (error) {
    console.error('更新AI员工失败:', error)
    return NextResponse.json({ success: false, message: '更新AI员工失败' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }
    
    if (!checkPermission(user.role, 'delete')) {
      return NextResponse.json({ success: false, message: '只有管理员可以删除' }, { status: 403 })
    }
    
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '0')
    
    if (!id) {
      return NextResponse.json({ success: false, message: '缺少ID' }, { status: 400 })
    }
    
    const existing = await prisma.aIAgent.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ success: false, message: 'AI员工不存在' }, { status: 404 })
    }
    
    if (existing.userId !== user.userId && user.role !== 'admin') {
      return NextResponse.json({ success: false, message: '没有权限删除此AI员工' }, { status: 403 })
    }
    
    await prisma.aIAgent.delete({ where: { id } })
    
    return NextResponse.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('删除AI员工失败:', error)
    return NextResponse.json({ success: false, message: '删除AI员工失败' }, { status: 500 })
  }
}