import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role }
}

export async function GET(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const teamId = parseInt(searchParams.get('teamId') || '0')

    if (!teamId) {
      return NextResponse.json({ success: false, message: '缺少团队ID' }, { status: 400 })
    }

    const members = await prisma.teamMember.findMany({
      where: { teamId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            role: true,
            createdAt: true
          }
        }
      }
    })

    return NextResponse.json({ success: true, data: members })
  } catch (error) {
    console.error('获取成员列表错误:', error)
    return NextResponse.json({ success: false, message: '获取失败' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }

    if (!['editor', 'admin'].includes(user.role)) {
      return NextResponse.json({ success: false, message: '没有权限添加成员' }, { status: 403 })
    }

    const body = await request.json()
    const { teamId, username, email, role } = body

    if (!teamId || !username) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { members: true }
    })

    if (!team) {
      return NextResponse.json({ success: false, message: '团队不存在' }, { status: 404 })
    }

    const isLeader = team.members.some(m => m.userId as any === user.userId as any && m.role === 'leader')
    const isAdmin = user.role === 'admin'

    if (!isLeader && !isAdmin) {
      return NextResponse.json({ success: false, message: '没有权限添加成员' }, { status: 403 })
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          email ? { email } : undefined
        ].filter(Boolean) as any
      }
    })

    if (!existingUser) {
      return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 })
    }

    const existingMember = await prisma.teamMember.findFirst({
      where: { teamId, userId: existingUser.id }
    })

    if (existingMember) {
      return NextResponse.json({ success: false, message: '该用户已在团队中' }, { status: 400 })
    }

    const member = await prisma.teamMember.create({
      data: {
        teamId,
        userId: existingUser.id,
        role: role || 'viewer'
      }
    })

    await prisma.user.update({
      where: { id: existingUser.id },
      data: { teamId }
    })

    return NextResponse.json({ success: true, data: member })
  } catch (error) {
    console.error('添加成员错误:', error)
    return NextResponse.json({ success: false, message: '添加失败' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const { memberId, role } = body

    if (!memberId || !role) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }

    const member = await prisma.teamMember.findUnique({
      where: { id: memberId },
      include: { team: true }
    })

    if (!member) {
      return NextResponse.json({ success: false, message: '成员不存在' }, { status: 404 })
    }

    const currentUserMember = await prisma.teamMember.findFirst({
      where: { teamId: member.teamId, userId: user.userId as any }
    })

    const isLeader = currentUserMember?.role === 'leader'
    const isAdmin = user.role === 'admin'

    if (!isLeader && !isAdmin) {
      return NextResponse.json({ success: false, message: '没有权限修改成员角色' }, { status: 403 })
    }

    if (member.role === 'leader' && role !== 'leader' && !isAdmin) {
      return NextResponse.json({ success: false, message: '转让团长权限需要管理员操作' }, { status: 403 })
    }

    await prisma.teamMember.update({
      where: { id: memberId },
      data: { role }
    })

    return NextResponse.json({ success: true, message: '角色更新成功' })
  } catch (error) {
    console.error('修改角色错误:', error)
    return NextResponse.json({ success: false, message: '更新失败' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const memberId = parseInt(searchParams.get('memberId') || '0')

    if (!memberId) {
      return NextResponse.json({ success: false, message: '缺少成员ID' }, { status: 400 })
    }

    const member = await prisma.teamMember.findUnique({
      where: { id: memberId },
      include: { team: true }
    })

    if (!member) {
      return NextResponse.json({ success: false, message: '成员不存在' }, { status: 404 })
    }

    const currentUserMember = await prisma.teamMember.findFirst({
      where: { teamId: member.teamId, userId: user.userId as any }
    })

    const isLeader = currentUserMember?.role === 'leader'
    const isAdmin = user.role === 'admin'

    if (!isLeader && !isAdmin) {
      return NextResponse.json({ success: false, message: '没有权限移除成员' }, { status: 403 })
    }

    if (member.role === 'leader') {
      return NextResponse.json({ success: false, message: '团长不能移除自己' }, { status: 403 })
    }

    await prisma.user.update({
      where: { id: member.userId as any },
      data: { teamId: null }
    })

    await prisma.teamMember.delete({ where: { id: memberId } })

    return NextResponse.json({ success: true, message: '移除成功' })
  } catch (error) {
    console.error('移除成员错误:', error)
    return NextResponse.json({ success: false, message: '移除失败' }, { status: 500 })
  }
}