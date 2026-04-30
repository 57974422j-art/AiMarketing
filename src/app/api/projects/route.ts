import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  const teamId = request.headers.get('X-User-Team-Id')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role, teamId: teamId ? parseInt(teamId) : null }
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

    let whereClause: any = {}
    if (user.role === 'admin') {
      whereClause = {}
    } else if (user.teamId) {
      whereClause = { user: { teamId: user.teamId } }
    } else {
      whereClause = { user: { id: user.userId as any } }
    }

    const projects = await prisma.project.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: { assets: true }
    })
    
    const projectsWithCount = projects.map(project => ({
      ...project,
      assetCount: project.assets.length
    }))
    
    return NextResponse.json(projectsWithCount)
  } catch (error) {
    console.error('获取项目列表错误:', error)
    return NextResponse.json({ success: false, message: '获取项目列表失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
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
    const { name, description } = body
    
    if (!name) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }
    
    const project = await prisma.project.create({
      data: {
        name,
        description: description || null,
        userId: user.userId as any
      }
    })
    
    return NextResponse.json({ success: true, message: '项目创建成功', project })
  } catch (error) {
    console.error('创建项目错误:', error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '创建项目失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
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
    const { id, name, description } = body
    
    const existing = await prisma.project.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ success: false, message: '项目不存在' }, { status: 404 })
    }
    
    if (existing.userId as any !== user.userId as any && user.role !== 'admin') {
      return NextResponse.json({ success: false, message: '没有权限修改此项目' }, { status: 403 })
    }
    
    const project = await prisma.project.update({
      where: { id },
      data: { name, description }
    })
    
    return NextResponse.json({ success: true, message: '项目更新成功', project })
  } catch (error) {
    console.error('更新项目错误:', error)
    return NextResponse.json({ success: false, message: '更新项目失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }
    
    if (!checkPermission(user.role, 'delete')) {
      return NextResponse.json({ success: false, message: '只有管理员可以删除项目' }, { status: 403 })
    }
    
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '0')
    
    if (!id) {
      return NextResponse.json({ success: false, message: '缺少项目ID' }, { status: 400 })
    }
    
    const existing = await prisma.project.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ success: false, message: '项目不存在' }, { status: 404 })
    }
    
    if (existing.userId as any !== user.userId as any && user.role !== 'admin') {
      return NextResponse.json({ success: false, message: '没有权限删除此项目' }, { status: 403 })
    }
    
    await prisma.project.delete({ where: { id } })
    
    return NextResponse.json({ success: true, message: '项目删除成功' })
  } catch (error) {
    console.error('删除项目错误:', error)
    return NextResponse.json({ success: false, message: '删除项目失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}