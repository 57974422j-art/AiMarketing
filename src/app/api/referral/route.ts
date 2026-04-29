import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

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
    
    const referrals = await prisma.referral.findMany({
      where: user.role === 'admin' ? {} : { userId: user.userId },
      orderBy: { createdAt: 'desc' }
    })
    
    return NextResponse.json({ success: true, data: referrals })
  } catch (error) {
    console.error('获取引流数据失败:', error)
    return NextResponse.json({ success: false, message: '获取失败' }, { status: 500 })
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
    const { name, platform, triggerType, keyword, responseMessage, dailyLimit } = body
    
    if (!name || !platform || !responseMessage) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }
    
    const referral = await prisma.referral.create({
      data: {
        name,
        platform,
        triggerType: triggerType || '自动回复',
        keyword: keyword || '',
        responseMessage,
        dailyLimit: dailyLimit || 100,
        status: 'active',
        userId: user.userId
      }
    })
    
    return NextResponse.json({ success: true, data: referral }, { status: 201 })
  } catch (error) {
    console.error('创建引流任务失败:', error)
    return NextResponse.json({ success: false, message: '创建失败' }, { status: 500 })
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
    const { id, name, platform, triggerType, keyword, responseMessage, dailyLimit, status } = body
    
    const existing = await prisma.referral.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ success: false, message: '引流任务不存在' }, { status: 404 })
    }
    
    if (existing.userId !== user.userId && user.role !== 'admin') {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }
    
    const referral = await prisma.referral.update({
      where: { id },
      data: { name, platform, triggerType, keyword, responseMessage, dailyLimit, status }
    })
    
    return NextResponse.json({ success: true, data: referral })
  } catch (error) {
    console.error('更新引流任务失败:', error)
    return NextResponse.json({ success: false, message: '更新失败' }, { status: 500 })
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
    
    const existing = await prisma.referral.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ success: false, message: '引流任务不存在' }, { status: 404 })
    }
    
    if (existing.userId !== user.userId && user.role !== 'admin') {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }
    
    await prisma.referral.delete({ where: { id } })
    
    return NextResponse.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('删除引流任务失败:', error)
    return NextResponse.json({ success: false, message: '删除失败' }, { status: 500 })
  }
}