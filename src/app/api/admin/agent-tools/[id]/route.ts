import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** 工具箱管理（admin）：PATCH 开关/编辑 / DELETE 删除 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  try {
    const id = Number(params.id)
    const b = await req.json().catch(() => ({}))
    const t = await prisma.agentTool.update({ where: { id }, data: {
      ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}),
      ...(b.title ? { title: String(b.title) } : {}),
      ...(b.description !== undefined ? { description: String(b.description) } : {}),
      ...(b.roles ? { roles: String(b.roles) } : {}),
    } })
    return NextResponse.json({ success: true, data: t })
  } catch (e: any) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }) }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  try { await prisma.agentTool.delete({ where: { id: Number(params.id) } }); return NextResponse.json({ success: true }) }
  catch (e: any) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }) }
}
