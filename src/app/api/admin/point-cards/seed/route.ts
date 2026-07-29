import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** 示例点卡（仅在点卡表为空时初始化，避免重复） */
const SEED = [
  { name: '1000 点体验包', description: '适合首次体验，点数永不过期（1 点 = ¥0.01）', points: 1000, price: 990, sortOrder: 0 },
  { name: '5000 点标准包', description: '性价比之选，点数永不过期', points: 5000, price: 3990, sortOrder: 1 },
  { name: '20000 点畅享包', description: '重度用户推荐，点数永不过期', points: 20000, price: 12990, sortOrder: 2 },
]

/** POST /api/admin/point-cards/seed — 初始化示例点卡（仅当表为空） */
export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })
  }
  try {
    const existing = await prisma.pointCard.count()
    if (existing > 0) {
      return NextResponse.json({ success: false, message: `已存在 ${existing} 张点卡，无需重复初始化` })
    }
    await prisma.pointCard.createMany({ data: SEED.map(s => ({ ...s, status: 'active' })) })
    return NextResponse.json({ success: true, message: `已初始化 ${SEED.length} 张示例点卡` })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
