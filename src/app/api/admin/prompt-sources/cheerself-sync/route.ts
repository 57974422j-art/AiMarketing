import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// POST /api/admin/prompt-sources/cheerself-sync - 后台触发 cheerselfai 抓取脚本（不阻塞）
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  try {
    const cwd = process.cwd()
    const cmd = `node --env-file=.env.local scripts/fetch-cheerself-prompts.mjs > /tmp/cheerself-sync.log 2>&1 &`
    exec(cmd, { cwd, shell: '/bin/bash' })
    return NextResponse.json({ success: true, message: '同步已启动（后台运行，约 2-5 分钟）' })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '启动失败' }, { status: 500 })
  }
}

// GET - 状态（cheerselfai 入库数）
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const total = await prisma.promptTemplate.count({ where: { source: 'cheerselfai' } })
    const withCover = await prisma.promptTemplate.count({ where: { source: 'cheerselfai', previewUrl: { not: '' } } })
    const byModel = await prisma.promptTemplate.groupBy({ by: ['model'], where: { source: 'cheerselfai' }, _count: true })
    return NextResponse.json({ success: true, data: { total, withCover, byModel: byModel.map(m => ({ model: m.model, count: m._count })) } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message }, { status: 500 })
  }
}

export const runtime = 'nodejs'
