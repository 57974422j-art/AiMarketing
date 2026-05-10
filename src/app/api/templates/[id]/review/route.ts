import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// POST /api/templates/{id}/review - 审核模板
export async function POST(
  request: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
    }

    const { id: rawId } = await routeParams
    const id = parseInt(rawId, 10)
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
