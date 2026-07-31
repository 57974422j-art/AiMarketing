import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// GET — 查询诊断报告列表
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = parseInt(url.searchParams.get('limit') || '20')
    const app = url.searchParams.get('app') || ''
    const resolved = url.searchParams.get('resolved')

    const where: any = {}
    if (app) where.app = app
    if (resolved !== null && resolved !== '') where.resolved = resolved === 'true'

    const [items, total] = await Promise.all([
      prisma.scriptDiagnosis.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.scriptDiagnosis.count({ where }),
    ])

    return NextResponse.json({ items, total, page, limit })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST — 写入诊断报告（由DeepSeek分析线程调用）
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const report = await prisma.scriptDiagnosis.create({
      data: {
        app: body.app || '抖音',
        step: body.step || 'UNKNOWN',
        errorLog: body.errorLog || '',
        screenshot: body.screenshot || null,
        diagnosis: body.diagnosis || '',
        severity: body.severity || 'warning',
        ownerId: body.ownerId || null,
      },
    })
    return NextResponse.json(report, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH — 标记已解决
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    await prisma.scriptDiagnosis.update({
      where: { id: body.id },
      data: { resolved: true },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
