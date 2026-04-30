import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { generateText, isAIConfigured } from '@/lib/ai-providers'
import { checkQuota, incrementUsage } from '@/lib/quota'

const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  const teamId = request.headers.get('X-User-Team-Id')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role, teamId: teamId ? parseInt(teamId) : null }
}

function checkPermission(role: string, action: 'read' | 'write' | 'delete'): boolean {
  switch (action) {
    case 'read': return ['viewer', 'editor', 'admin'].includes(role)
    case 'write': return ['editor', 'admin'].includes(role)
    case 'delete': return role === 'admin'
    default: return false
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }
    
    if (!checkPermission(user.role, 'read')) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }

    let whereClause: any = {}
    if (user.role === 'admin') {
      whereClause = {}
    } else if (user.teamId) {
      whereClause = { user: { teamId: user.teamId } }
    } else {
      whereClause = { user: { id: user.userId as any } }
    }

    const copyTasks = await prisma.copyTask.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    })
    
    return NextResponse.json(copyTasks)
  } catch (error) {
    console.error('获取文案历史错误:', error)
    return NextResponse.json({ success: false, message: '获取失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }
    
    if (!checkPermission(user.role, 'write')) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }
    
    const body = await request.json()
    const { keywords, platform, style } = body
    
    if (!keywords || !platform || !style) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }
    
    if (!isAIConfigured()) {
      return NextResponse.json({ success: false, message: 'AI 接口未配置' }, { status: 400 })
    }
    
    const quotaResult = await checkQuota(user.userId as any, '文案生成')
    if (!quotaResult.allowed) {
      return NextResponse.json({ success: false, message: quotaResult.message }, { status: 403 })
    }
    
    const prompt = `请为以下产品生成 5 条适合 ${platform} 平台的营销文案，风格为 ${style}：

产品关键词：${keywords}

要求：
1. 每条文案独立成段
2. 包含相关话题标签
3. 符合 ${platform} 平台的语言风格和用户习惯
4. 突出产品特点和价值
5. 每条文案末尾添加 [字数:XX] [场景:XX] 标签

示例：
🔥 口红太绝了！我不允许你还不知道这个秘密... #口红 #好物推荐 [字数:28] [场景:日常分享]

开始生成：`
    
    const result = await generateText(prompt, {
      temperature: 0.8,
      maxTokens: 2000
    })
    
    const copies = result.split('\n').filter(line => line.trim() !== '')
    
    const createdTasks = []
    for (const copy of copies) {
      const copyTask = await prisma.copyTask.create({
        data: {
          keywords: body.keywords || '',
          platform: body.platform || '通用',
          style: body.style || '标准',
          resultJson: JSON.stringify({ copies: [copy] }),
          user: { connect: { id: user.userId } }
        }
      })
    }
    
    await incrementUsage(user.userId as any, '文案生成', 1)
    
    return NextResponse.json({ success: true, copies: createdTasks })
  } catch (error) {
    console.error('AI 文案生成错误:', error)
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '生成失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    }
    
    if (!checkPermission(user.role, 'delete')) {
      return NextResponse.json({ success: false, message: '只有管理员可以删除' }, { status: 403 })
    }
    
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '0')
    
    if (!id) {
      return NextResponse.json({ success: false, message: '缺少ID' }, { status: 400 })
    }
    
    const existing = await prisma.copyTask.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ success: false, message: '不存在' }, { status: 404 })
    }
    
    if (existing.userId as any !== user.userId as any && user.role !== 'admin') {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }
    
    await prisma.copyTask.delete({ where: { id } })
    
    return NextResponse.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('删除错误:', error)
    return NextResponse.json({ success: false, message: '删除失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}