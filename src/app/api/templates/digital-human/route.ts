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
    const templates = await prisma.digitalHumanTemplate.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    })
    
    return NextResponse.json(templates)
  } catch (error) {
    console.error('获取数字人模板错误:', error)
    return NextResponse.json({ success: false, message: '获取失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user || !['editor', 'admin'].includes(user.role)) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }

    const body = await request.json()
    const { title, script, humanId, humanName, humanAvatar, humanGender, humanVoice, background, duration, thumbnail } = body
    
    const template = await prisma.digitalHumanTemplate.create({
      data: {
        title,
        script,
        humanId,
        humanName,
        humanAvatar,
        humanGender,
        humanVoice,
        background,
        duration: duration || 30,
        thumbnail
      }
    })
    
    return NextResponse.json({ success: true, template })
  } catch (error) {
    console.error('创建数字人模板错误:', error)
    return NextResponse.json({ success: false, message: '创建失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
