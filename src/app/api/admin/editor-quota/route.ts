/**
 * GET  /api/admin/editor-quota     — admin 获取所有 editor 配额
 * PUT  /api/admin/editor-quota     — admin 更新某个 editor 的配额
 *
 * 仅 admin 可访问
 */

import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getOrCreateQuota, updateQuota, getAllQuotas } from '@/lib/quota-manager'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const userId = (request as any).user?.id
    const role = (request as any).user?.role

    if (role !== 'admin') {
      return NextResponse.json({ message: '仅管理员可访问' }, { status: 403 })
    }

    const quotas = await getAllQuotas()
    return NextResponse.json({ success: true, data: quotas })
  } catch (err: any) {
    console.error('[editor-quota] GET error:', err)
    return NextResponse.json({ message: err.message || '获取失败' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = (request as any).user?.id
    const role = (request as any).user?.role

    if (role !== 'admin') {
      return NextResponse.json({ message: '仅管理员可访问' }, { status: 403 })
    }

    const body = await request.json()
    const { editorId, q1Containers, fingerprintPorts, realPhones, portRangeStart, portRangeEnd } = body

    if (!editorId) {
      return NextResponse.json({ message: '缺少 editorId' }, { status: 400 })
    }

    // 验证 editor 存在且角色正确
    const editor = await prisma.user.findUnique({ where: { id: editorId } })
    if (!editor || editor.role !== 'editor') {
      return NextResponse.json({ message: '用户不存在或不是 editor' }, { status: 400 })
    }

    // 构建更新字段（只传有值的）
    const fields: Record<string, number> = {}
    if (typeof q1Containers === 'number') fields.q1Containers = Math.max(0, q1Containers)
    if (typeof fingerprintPorts === 'number') fields.fingerprintPorts = Math.max(0, fingerprintPorts)
    if (typeof realPhones === 'number') fields.realPhones = Math.max(0, realPhones)
    if (typeof portRangeStart === 'number') fields.portRangeStart = Math.max(1024, portRangeStart)
    if (typeof portRangeEnd === 'number') fields.portRangeEnd = Math.min(65535, portRangeEnd)

    const quota = await updateQuota(editorId, fields)

    return NextResponse.json({ success: true, data: quota, message: '配额已更新' })
  } catch (err: any) {
    console.error('[editor-quota] PUT error:', err)
    return NextResponse.json({ message: err.message || '更新失败' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
