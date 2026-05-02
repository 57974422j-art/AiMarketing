import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role }
}

// POST /api/templates/{id}/review - 审核模板
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = getUserContext(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
    }

    const id = parseInt(params.id)
    const body = await request.json()
    const { status } = body

    if (!['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ success: false, message: '状态值无效' }, { status: 400 })
    }

    const template = await prisma.copyTemplate.update({
      where: { id },
      data: { status }
    })

    return NextResponse.json({ success: true, template })
  } catch (error) {
    console.error('审核模板错误:', error)
    return NextResponse.json({ success: false, message: '审核失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
