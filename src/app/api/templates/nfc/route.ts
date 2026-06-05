import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role }
}

export async function GET(request: NextRequest) {
  try {
    const templates = await prisma.nFCRuleTemplate.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    })
    
    return NextResponse.json(templates)
  } catch (error) {
    console.error('获取NFC规则模板错误:', error)
    return NextResponse.json({ success: false, message: '获取失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user || !['editor', 'admin'].includes(user.role)) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }

    const body = await request.json()
    const { name, triggerType, description, contentTitle, contentUrl, contentValue } = body
    
    const template = await prisma.nFCRuleTemplate.create({
      data: {
        name,
        triggerType: triggerType || 'video',
        description,
        contentTitle,
        contentUrl,
        contentValue,
      }
    })
    
    return NextResponse.json({ success: true, template })
  } catch (error) {
    console.error('创建NFC规则模板错误:', error)
    return NextResponse.json({ success: false, message: '创建失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// ====== PUT: 更新 NFC 模板 ======
export async function PUT(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user || !['editor', 'admin'].includes(user.role)) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }

    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json(
        { success: false, message: '缺少模板 ID' },
        { status: 400 }
      )
    }

    // 检查模板是否存在
    const existing = await prisma.nFCRuleTemplate.findUnique({
      where: { id }
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, message: '模板不存在' },
        { status: 404 }
      )
    }

    // 准备更新数据（只更新提供的字段）
    const data: any = {}
    if (updateData.name !== undefined) data.name = updateData.name
    if (updateData.triggerType !== undefined) data.triggerType = updateData.triggerType
    if (updateData.description !== undefined) data.description = updateData.description
    if (updateData.contentTitle !== undefined) data.contentTitle = updateData.contentTitle
    if (updateData.contentUrl !== undefined) data.contentUrl = updateData.contentUrl
    if (updateData.contentValue !== undefined) data.contentValue = updateData.contentValue
    if (updateData.isActive !== undefined) data.isActive = updateData.isActive

    const template = await prisma.nFCRuleTemplate.update({
      where: { id },
      data
    })

    return NextResponse.json({
      success: true,
      template,
      message: 'NFC 模板更新成功'
    })
  } catch (error) {
    console.error('更新NFC规则模板错误:', error)
    return NextResponse.json(
      { success: false, message: '更新失败' },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}

// ====== DELETE: 删除 NFC 模板 ======
export async function DELETE(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user || !['editor', 'admin'].includes(user.role)) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '')

    if (!id) {
      return NextResponse.json(
        { success: false, message: '缺少模板 ID' },
        { status: 400 }
      )
    }

    // 检查模板是否存在
    const existing = await prisma.nFCRuleTemplate.findUnique({
      where: { id }
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, message: '模板不存在' },
        { status: 404 }
      )
    }

    await prisma.nFCRuleTemplate.delete({
      where: { id }
    })

    return NextResponse.json({
      success: true,
      message: 'NFC 模板已删除'
    })
  } catch (error) {
    console.error('删除NFC规则模板错误:', error)
    return NextResponse.json(
      { success: false, message: '删除失败' },
      { status: 500 }
    ) 
  finally {
    await prisma.$disconnect()
  }
}
