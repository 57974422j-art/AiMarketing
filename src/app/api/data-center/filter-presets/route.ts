import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 筛选方案 CRUD API
 *
 * GET    /api/data-center/filter-presets?entityType=video   → 列出方案
 * POST   /api/data-center/filter-presets                     → 创建方案
 * PUT    /api/data-center/filter-presets                     → 更新方案
 * DELETE /api/data-center/filter-presets?id=xx               → 删除方案
 */

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const entityType = searchParams.get('entityType') || ''
    const includeShared = searchParams.get('shared') === '1'

    const where: any = { userId: auth.userId }
    if (entityType) where.entityType = entityType
    // 共享方案：自己创建的共享方案 + 其他人标记为共享的
    if (includeShared) {
      where.OR = [
        { userId: auth.userId },
        { isShared: true, userId: { not: auth.userId } },
      ]
      delete where.userId
    }

    const presets = await prisma.filterPreset.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        description: true,
        entityType: true,
        filters: true,
        isDefault: true,
        isShared: true,
        createdAt: true,
        owner: { select: { id: true, name: true, username: true } },
      },
    })

    return NextResponse.json({ success: true, data: presets })
  } catch (error: any) {
    console.error('[筛选方案API] 查询失败:', error)
    return NextResponse.json({ success: false, message: error.message || '查询失败' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const body = await request.json()
    const { name, description, entityType = 'video', filters = '{}', isDefault = false, isShared = false } = body

    if (!name) return NextResponse.json({ success: false, message: '缺少方案名称' }, { status: 400 })
    if (!['video', 'comment', 'lead', 'user', 'trending'].includes(entityType)) {
      return NextResponse.json({ success: false, message: '无效的实体类型' }, { status: 400 })
    }

    // 如果设为默认，先取消同类型其他默认
    if (isDefault) {
      await prisma.filterPreset.updateMany({
        where: { userId: auth.userId, entityType },
        data: { isDefault: false },
      })
    }

    const preset = await prisma.filterPreset.create({
      data: {
        name,
        description: description || null,
        entityType,
        filters: typeof filters === 'string' ? filters : JSON.stringify(filters),
        isDefault,
        isShared,
        userId: auth.userId,
      },
    })

    return NextResponse.json({ success: true, data: preset, message: '方案创建成功' })
  } catch (error: any) {
    console.error('[筛选方案API] 创建失败:', error)
    if (error.code === 'P2002') {
      return NextResponse.json({ success: false, message: '同名方案已存在（同类型下名称不可重复）' }, { status: 409 })
    }
    return NextResponse.json({ success: false, message: error.message || '创建失败' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const body = await request.json()
    const { id, name, description, entityType, filters, isDefault, isShared } = body

    if (!id) return NextResponse.json({ success: false, message: '缺少方案ID' }, { status: 400 })

    // 验证所有权
    const existing = await prisma.filterPreset.findFirst({
      where: { id, OR: [{ userId: auth.userId }, { isShared: true }] },
    })
    if (!existing) return NextResponse.json({ success: false, message: '方案不存在或无权限' }, { status: 404 })
    // 共享方案只能所有者修改
    if (existing.userId !== auth.userId && existing.isShared) {
      return NextResponse.json({ success: false, message: '共享方案只能由创建者修改' }, { status: 403 })
    }

    // 如果设为默认，先取消同类型其他默认
    if (isDefault) {
      await prisma.filterPreset.updateMany({
        where: { userId: auth.userId, entityType: existing.entityType },
        data: { isDefault: false },
      })
    }

    const updateData: any = { updatedAt: new Date() }
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (entityType !== undefined) updateData.entityType = entityType
    if (filters !== undefined) updateData.filters = typeof filters === 'string' ? filters : JSON.stringify(filters)
    if (isDefault !== undefined) updateData.isDefault = isDefault
    if (isShared !== undefined) updateData.isShared = isShared

    const preset = await prisma.filterPreset.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ success: true, data: preset, message: '方案更新成功' })
  } catch (error: any) {
    console.error('[筛选方案API] 更新失败:', error)
    return NextResponse.json({ success: false, message: error.message || '更新失败' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '0')

    if (!id) return NextResponse.json({ success: false, message: '缺少方案ID' }, { status: 400 })

    // 验证所有权（只能删除自己的）
    const existing = await prisma.filterPreset.findFirst({
      where: { id, userId: auth.userId },
    })
    if (!existing) return NextResponse.json({ success: false, message: '方案不存在或无权限' }, { status: 404 })

    await prisma.filterPreset.delete({ where: { id } })

    return NextResponse.json({ success: true, message: '方案已删除' })
  } catch (error: any) {
    console.error('[筛选方案API] 删除失败:', error)
    return NextResponse.json({ success: false, message: error.message || '删除失败' }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
