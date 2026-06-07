import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 线索看板 API（增强版，支持更多筛选）
 *
 * GET /api/data-center/leads?page=1&size=20&status=new&platform=douyin&keyword=xxx&minScore=0.5&taskId=5
 */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const size = Math.min(100, Math.max(1, parseInt(searchParams.get('size') || '20')))
    const status = searchParams.get('status')
    const platform = searchParams.get('platform')
    const keyword = searchParams.get('keyword')?.trim()
    const minScore = parseFloat(searchParams.get('minScore') || '0')
    const hasContact = searchParams.get('hasContact')
    const taskId = searchParams.get('taskId')
    const sort = searchParams.get('sort') || 'createdAt'
    const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc'

    // 基础权限过滤
    const where: any = {
      OR: [{ ownerId: auth.userId }, { assignedTo: auth.userId }],
    }
    if (status) where.status = status
    if (platform) where.platform = platform
    if (keyword) where.rawContent = { contains: keyword }
    if (minScore > 0) where.intentScore = { gte: minScore }
    if (hasContact === 'true') where.contactInfo = { not: '' }
    if (taskId) where.taskId = parseInt(taskId)

    const allowedSorts = ['createdAt', 'intentScore', 'updatedAt']
    const orderByField = allowedSorts.includes(sort) ? sort : 'createdAt'

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { [orderByField]: order },
        skip: (page - 1) * size,
        take: size,
        include: {
          task: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true, username: true } },
          assignee: { select: { id: true, name: true, username: true } },
        },
      }),
      prisma.lead.count({ where }),
    ])

    // 状态分布统计
    const statusStats = await prisma.lead.groupBy({
      by: ['status'],
      _count: { id: true },
      where: {
        OR: [{ ownerId: auth.userId }, { assignedTo: auth.userId }],
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        list: leads,
        pagination: { page, size, total, totalPages: Math.ceil(total / size) },
        stats: statusStats.map(s => ({ status: s.status, count: s._count.id })),
      },
    })
  } catch (error: any) {
    console.error('[线索看板API] 错误:', error)
    return NextResponse.json(
      { success: false, message: error.message || '获取线索数据失败' },
      { status: 500 }
    )
  }
}
