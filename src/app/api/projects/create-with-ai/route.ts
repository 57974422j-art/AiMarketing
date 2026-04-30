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

export async function POST(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const { industry, goals, projectName, projectDescription } = body

    if (!projectName) {
      return NextResponse.json({ success: false, message: '缺少项目名称' }, { status: 400 })
    }

    const project = await prisma.project.create({
      data: {
        name: projectName,
        description: projectDescription || `${industry}行业的${(goals || []).join('、')}营销项目`,
        userId: user.userId
      }
    })

    return NextResponse.json({ success: true, message: '项目创建成功', project })
  } catch (error) {
    console.error('创建项目错误:', error)
    return NextResponse.json({ success: false, message: '创建项目失败' }, { status: 500 })
  }
}
