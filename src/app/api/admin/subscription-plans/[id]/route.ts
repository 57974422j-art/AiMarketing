import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** PUT — 更新套餐 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json()
    const plan = await prisma.subscriptionPlan.update({ where: { id: parseInt(params.id) }, data: body })
    return NextResponse.json({ success: true, data: plan })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 400 })
  }
}

/** DELETE — 删除套餐 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.subscriptionPlan.delete({ where: { id: parseInt(params.id) } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 400 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
