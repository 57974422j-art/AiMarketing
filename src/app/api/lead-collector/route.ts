import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { checkQuota, incrementUsage } from '@/lib/quota'

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
    
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'tasks'
    
    if (type === 'leads') {
      const leads = await prisma.leadCollector.findMany({
        where: user.role === 'admin' ? {} : { userId: user.userId },
        orderBy: { createdAt: 'desc' }
      })
      return NextResponse.json({ success: true, data: leads })
    } else {
      const tasks = await prisma.leadTask.findMany({
        where: user.role === 'admin' ? {} : { userId: user.userId },
        orderBy: { createdAt: 'desc' }
      })
      return NextResponse.json({ success: true, data: tasks })
    }
  } catch (error) {
    console.error('获取数据失败:', error)
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
    
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'tasks'
    const body = await request.json()
    
    if (type === 'leads') {
      const { keyword, platform } = body
      if (!keyword) {
        return NextResponse.json({ success: false, message: '缺少关键词' }, { status: 400 })
      }
      
      const quotaResult = await checkQuota(user.userId, '意向采集')
      if (!quotaResult.allowed) {
        return NextResponse.json({ success: false, message: quotaResult.message }, { status: 403 })
      }
      
      const lead = await prisma.leadCollector.create({
        data: {
          keyword,
          platform: platform || 'all',
          status: 'active',
          userId: user.userId
        }
      })
      
      await incrementUsage(user.userId, '意向采集', 1)
      
      return NextResponse.json({ success: true, data: lead }, { status: 201 })
    } else {
      const { name, platform, targetUrl, keywords } = body
      if (!name || !platform) {
        return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
      }
      
      const task = await prisma.leadTask.create({
        data: {
          name,
          platform,
          targetUrl: targetUrl || '',
          keywords: keywords || [],
          status: 'pending',
          collectedCount: 0,
          userId: user.userId
        }
      })
      return NextResponse.json({ success: true, data: task }, { status: 201 })
    }
  } catch (error) {
    console.error('创建数据失败:', error)
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
    
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'tasks'
    const body = await request.json()
    const { id, ...updateData } = body
    
    if (type === 'leads') {
      const existing = await prisma.leadCollector.findUnique({ where: { id } })
      if (!existing) {
        return NextResponse.json({ success: false, message: '不存在' }, { status: 404 })
      }
      if (existing.userId !== user.userId && user.role !== 'admin') {
        return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
      }
      const lead = await prisma.leadCollector.update({ where: { id }, data: updateData })
      return NextResponse.json({ success: true, data: lead })
    } else {
      const existing = await prisma.leadTask.findUnique({ where: { id } })
      if (!existing) {
        return NextResponse.json({ success: false, message: '不存在' }, { status: 404 })
      }
      if (existing.userId !== user.userId && user.role !== 'admin') {
        return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
      }
      const task = await prisma.leadTask.update({ where: { id }, data: updateData })
      return NextResponse.json({ success: true, data: task })
    }
  } catch (error) {
    console.error('更新失败:', error)
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
    const type = searchParams.get('type') || 'tasks'
    const id = parseInt(searchParams.get('id') || '0')
    
    if (!id) {
      return NextResponse.json({ success: false, message: '缺少ID' }, { status: 400 })
    }
    
    if (type === 'leads') {
      const existing = await prisma.leadCollector.findUnique({ where: { id } })
      if (!existing) {
        return NextResponse.json({ success: false, message: '不存在' }, { status: 404 })
      }
      if (existing.userId !== user.userId && user.role !== 'admin') {
        return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
      }
      await prisma.leadCollector.delete({ where: { id } })
    } else {
      const existing = await prisma.leadTask.findUnique({ where: { id } })
      if (!existing) {
        return NextResponse.json({ success: false, message: '不存在' }, { status: 404 })
      }
      if (existing.userId !== user.userId && user.role !== 'admin') {
        return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
      }
      await prisma.leadTask.delete({ where: { id } })
    }
    
    return NextResponse.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('删除失败:', error)
    return NextResponse.json({ success: false, message: '删除失败' }, { status: 500 })
  }
}