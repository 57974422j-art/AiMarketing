import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth || auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })

  const clients = await prisma.user.findMany({
    where: auth.role === 'admin' ? { role: 'end-user' } : { role: 'end-user', parentId: auth.userId },
    select: { id: true, username: true, name: true },
  })
  return NextResponse.json({ success: true, data: clients })
}
