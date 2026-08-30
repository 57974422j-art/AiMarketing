import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic' // 2026-08-29: 防预渲染（API 无 request 静态生成会崩）
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** 工具箱管理（admin）：GET 列表 / POST 添加工具 */
export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  const tools = await prisma.agentTool.findMany({ orderBy: { id: 'asc' } })
  return NextResponse.json({ success: true, data: tools })
}

export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  try {
    const b = await req.json()
    const name = String(b.name || '').trim().toLowerCase()
    if (!name || !/^[a-z0-9_]+$/.test(name)) return NextResponse.json({ success: false, message: '工具名需字母数字下划线' }, { status: 400 })
    const exist = await prisma.agentTool.findUnique({ where: { name } })
    if (exist) return NextResponse.json({ success: false, message: '工具已存在' }, { status: 400 })
    const t = await prisma.agentTool.create({
      data: {
        name,
        title: String(b.title || name),
        description: String(b.description || ''),
        parameters: String(b.parameters || '{}'),
        endpoint: String(b.endpoint || ''),
        enabled: b.enabled !== false,
        roles: String(b.roles || 'all'),
      },
    })
    return NextResponse.json({ success: true, data: t })
  } catch (e: any) { return NextResponse.json({ success: false, message: e.message }, { status: 500 }) }
}
