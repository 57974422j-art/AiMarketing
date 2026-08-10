import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// PUT /api/admin/subscription-plans/:id — 更新套餐（2026-08-10 补：此前只有 POST，前端编辑保存 404 导致改动不生效）
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id || '0')
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    let body: any = {}
    try { body = await req.json() } catch {}
    // 字段白名单（防注入无关字段）
    const allowed = ['name', 'description', 'price', 'discountPrice', 'durationMonths', 'monthlyTokens',
      'deepseekTokens', 'llmTokens', 'text2imgQuota', 'text2videoQuota', 'digitalHumanMin', 'liveStreamMin',
      'storageMb', 'status', 'sortOrder']
    const data: any = {}
    for (const k of allowed) {
      if (body[k] !== undefined) data[k] = body[k]
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ success: false, message: '无更新字段' }, { status: 400 })
    const plan = await prisma.subscriptionPlan.update({ where: { id }, data })
    return NextResponse.json({ success: true, data: plan })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 400 })
  }
}

// DELETE /api/admin/subscription-plans/:id
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id || '0')
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    await prisma.subscriptionPlan.delete({ where: { id } })
    return NextResponse.json({ success: true, message: '已删除' })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 400 })
  }
}

export const dynamic = 'force-dynamic'
