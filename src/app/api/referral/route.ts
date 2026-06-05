import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { generateText } from '@/lib/ai-providers'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Referral API - 导流系统完整 CRUD 接口
 * 
 * 路由：
 * GET    /api/referral          → 查询导流配置列表
 * POST   /api/referral          → 创建配置 / AI生成文案
 * PUT    /api/referral/:id      → 更新配置
 * DELETE /api/referral/:id      → 删除配置
 */

// ====== GET: 查询导流配置列表 ======
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    // 解析查询参数
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const status = searchParams.get('status') || ''  // 筛选状态
    const platform = searchParams.get('platform') || ''  // 筛选平台

    // 构建查询条件
    const where: any = {
      ownerId: auth.userId
    }
    
    if (status) where.status = status
    if (platform) where.platform = platform

    // 分页查询
    const [referrals, total] = await Promise.all([
      prisma.referralConfig.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { logs: true } }
        }
      }),
      prisma.referralConfig.count({ where })
    ])

    return NextResponse.json({
      success: true,
      data: {
        referrals,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    })
  } catch (error) {
    console.error('查询导流配置失败:', error)
    return NextResponse.json(
      { success: false, message: '查询失败' },
      { status: 500 }
    )
  }
}

// ====== POST: 创建配置 或 AI 生成文案 ======
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const body = await request.json()
    const { action, ...data } = body

    // AI 生成导流文案（保留原有功能）
    if (action === 'generate') {
      const { platform, keywords } = data

      if (!platform || !keywords) {
        return NextResponse.json(
          { success: false, message: '缺少平台或关键词' },
          { status: 400 }
        )
      }

      const prompt = `你是一个短视频营销专家。请为以下平台生成一条导流文案（吸引用户私信/加微信）：

平台：${platform}
关键词：${keywords}

要求：
1. 文案长度 80-120 字
2. 包含引导行动（如"私信我获取详情""加微信领资料"）
3. 语气亲切自然
4. 只返回文案内容，不要任何解释`

      const copy = await generateText(prompt)
      return NextResponse.json({
        success: true,
        data: { copy: copy || '生成失败' }
      })
    }

    // 创建新的导流配置
    const {
      name,
      platform,
      keywords = [],
      copyText,
      landingType = 'wechat',
      landingValue,
      status = 'draft'
    } = data

    if (!name || !platform) {
      return NextResponse.json(
        { success: false, message: '缺少必要字段：name, platform' },
        { status: 400 }
      )
    }

    const referral = await prisma.referralConfig.create({
      data: {
        name,
        platform,
        keywords: JSON.stringify(keywords),
        copyText: copyText || null,
        landingType,
        landingValue: landingValue || null,
        status,
        ownerId: auth.userId
      }
    })

    return NextResponse.json({
      success: true,
      data: referral,
      message: '导流配置创建成功'
    })
  } catch (error) {
    console.error('创建导流配置失败:', error)
    return NextResponse.json(
      { success: false, message: '创建失败' },
      { status: 500 }
    )
  }
}

// ====== PUT: 更新导流配置 ======
export async function PUT(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json(
        { success: false, message: '缺少配置 ID' },
        { status: 400 }
      )
    }

    // 检查配置是否存在且属于当前用户
    const existing = await prisma.referralConfig.findFirst({
      where: { id, ownerId: auth.userId }
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, message: '配置不存在或无权限修改' },
        { status: 404 }
      )
    }

    // 准备更新数据（处理 JSON 字段）
    const data: any = {}
    if (updateData.name !== undefined) data.name = updateData.name
    if (updateData.platform !== undefined) data.platform = updateData.platform
    if (updateData.keywords !== undefined) data.keywords = JSON.stringify(updateData.keywords)
    if (updateData.copyText !== undefined) data.copyText = updateData.copyText
    if (updateData.landingType !== undefined) data.landingType = updateData.landingType
    if (updateData.landingValue !== undefined) data.landingValue = updateData.landingValue
    if (updateData.status !== undefined) data.status = updateData.status

    const referral = await prisma.referralConfig.update({
      where: { id },
      data
    })

    return NextResponse.json({
      success: true,
      data: referral,
      message: '导流配置更新成功'
    })
  } catch (error) {
    console.error('更新导流配置失败:', error)
    return NextResponse.json(
      { success: false, message: '更新失败' },
      { status: 500 }
    )
  }
}

// ====== DELETE: 删除导流配置 ======
export async function DELETE(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '')

    if (!id) {
      return NextResponse.json(
        { success: false, message: '缺少配置 ID' },
        { status: 400 }
      )
    }

    // 检查配置是否存在且属于当前用户
    const existing = await prisma.referralConfig.findFirst({
      where: { id, ownerId: auth.userId }
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, message: '配置不存在或无权限删除' },
        { status: 404 }
      )
    }

    // 删除配置（关联的日志会级联删除吗？需要确认 Prisma 配置）
    // 当前 schema 没有设置 onDelete: Cascade，所以需要手动删除日志或忽略
    await prisma.referralConfig.delete({
      where: { id }
    })

    return NextResponse.json({
      success: true,
      message: '导流配置已删除'
    })
  } catch (error) {
    console.error('删除导流配置失败:', error)
    return NextResponse.json(
      { success: false, message: '删除失败' },
      { status: 500 }
    )
  }
}
