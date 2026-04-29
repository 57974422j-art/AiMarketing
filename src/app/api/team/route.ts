import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role }
}

function generateInviteCode(): string {
  return 'AGENT' + Math.random().toString(36).substring(2, 8).toUpperCase()
}

export async function GET(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }

    let team = null

    if (user.role === 'admin') {
      const teams = await prisma.team.findMany({
        include: {
          owner: { select: { id: true, username: true, name: true } },
          members: {
            include: {
              user: { select: { id: true, username: true, name: true, email: true, role: true } }
            }
          }
        }
      })
      return NextResponse.json({ success: true, data: teams })
    }

    if (user.userId) {
      const userData = await prisma.user.findUnique({
        where: { id: user.userId },
        include: {
          team: {
            include: {
              owner: { select: { id: true, username: true, name: true } },
              members: {
                include: {
                  user: { select: { id: true, username: true, name: true, email: true, role: true } }
                }
              }
            }
          }
        }
      })
      team = userData?.team
    }

    return NextResponse.json({ success: true, data: team })
  } catch (error) {
    console.error('获取团队信息错误:', error)
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
      return NextResponse.json({ success: false, message: '没有权限创建团队' }, { status: 403 })
    }

    const body = await request.json()
    const { name } = body

    if (!name) {
      return NextResponse.json({ success: false, message: '请输入团队名称' }, { status: 400 })
    }

    const existingTeam = await prisma.user.findUnique({
      where: { id: user.userId },
      include: { team: true }
    })

    if (existingTeam?.team) {
      return NextResponse.json({ success: false, message: '您已经在团队中' }, { status: 400 })
    }

    const team = await prisma.team.create({
      data: {
        name,
        ownerId: user.userId
      }
    })

    await prisma.user.update({
      where: { id: user.userId },
      data: { teamId: team.id }
    })

    await prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId: user.userId,
        role: 'leader'
      }
    })

    return NextResponse.json({ success: true, data: team })
  } catch (error) {
    console.error('创建团队错误:', error)
    return NextResponse.json({ success: false, message: '创建失败' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ success: false, message: '只有管理员可以删除团队' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const teamId = parseInt(searchParams.get('teamId') || '0')

    if (!teamId) {
      return NextResponse.json({ success: false, message: '缺少团队ID' }, { status: 400 })
    }

    const team = await prisma.team.findUnique({ where: { id: teamId } })
    if (!team) {
      return NextResponse.json({ success: false, message: '团队不存在' }, { status: 404 })
    }

    await prisma.teamMember.deleteMany({ where: { teamId } })

    await prisma.user.updateMany({
      where: { teamId },
      data: { teamId: null }
    })

    await prisma.team.delete({ where: { id: teamId } })

    return NextResponse.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('删除团队错误:', error)
    return NextResponse.json({ success: false, message: '删除失败' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const { teamId, name, generateAgentCode } = body

    if (!teamId) {
      return NextResponse.json({ success: false, message: '缺少团队ID' }, { status: 400 })
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { members: true }
    })

    if (!team) {
      return NextResponse.json({ success: false, message: '团队不存在' }, { status: 404 })
    }

    const isLeader = team.members.some(m => m.userId === user.userId && m.role === 'leader')
    const isAdmin = user.role === 'admin'

    if (!isLeader && !isAdmin) {
      return NextResponse.json({ success: false, message: '没有权限修改团队' }, { status: 403 })
    }

    const updateData: any = {}
    if (name) updateData.name = name

    if (generateAgentCode && (isLeader || isAdmin)) {
      const agentCode = generateInviteCode()
      await prisma.user.update({
        where: { id: team.ownerId },
        data: { isAgent: true, agentInviteCode: agentCode }
      })
      return NextResponse.json({
        success: true,
        message: '代理邀请码已生成',
        agentCode
      })
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.team.update({
        where: { id: teamId },
        data: updateData
      })
    }

    return NextResponse.json({ success: true, message: '更新成功' })
  } catch (error) {
    console.error('更新团队错误:', error)
    return NextResponse.json({ success: false, message: '更新失败' }, { status: 500 })
  }
}