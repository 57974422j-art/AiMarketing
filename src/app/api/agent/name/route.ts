import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/**
 * 自定义 AI 名称（2026-08-07）
 * GET /api/agent/name   → { name }（User.agentName || SystemConfig.agent_name || ''）
 * PUT /api/agent/name   → body { name }（用户级起名；空则回退默认）
 */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const user = await prisma.user.findUnique({ where: { id: auth.userId } })
    if (user?.agentName) return NextResponse.json({ success: true, data: { name: user.agentName, source: 'user' } })
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'agent_name' } })
    return NextResponse.json({ success: true, data: { name: cfg?.value || '', source: cfg?.value ? 'global' : 'default' } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const { name } = await request.json()
    const clean = String(name || '').trim().slice(0, 20)
    const user = await prisma.user.update({
      where: { id: auth.userId },
      data: { agentName: clean || null },
    })
    return NextResponse.json({ success: true, data: { name: user.agentName || '' } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
