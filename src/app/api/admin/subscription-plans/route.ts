import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** GET /api/admin/subscription-plans — 获取所有套餐 */
export async function GET() {
  try {
    const plans = await prisma.subscriptionPlan.findMany({ orderBy: { sortOrder: 'asc' } })
    return NextResponse.json({ success: true, data: plans })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

/** POST /api/admin/subscription-plans — 新增套餐 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const plan = await prisma.subscriptionPlan.create({ data: body })
    return NextResponse.json({ success: true, data: plan })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 400 })
  }
}
