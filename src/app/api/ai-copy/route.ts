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
  console.log('========== POST /api/ai-copy 被调用 ==========')
  try {
    const user = getUserContext(request)
    console.log('user:', user)
    
    if (user && !checkPermission(user.role, 'write')) {
      return NextResponse.json({ success: false, message: '没有权限' }, { status: 403 })
    }
    
    const body = await request.json()
    const { keywords, platform, style, provider } = body
    
    if (!keywords || !platform || !style) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }
    
    if (!isAIConfigured()) {
      // 静默降级：返回空数组，不打扰用户
      return NextResponse.json({ success: true, copies: [] })
    }
    
    const userId = user ? user.userId : null
    const quotaResult = await checkQuota(userId, '文案生成')
    if (!quotaResult.allowed) {
      return NextResponse.json({ success: false, message: quotaResult.message }, { status: 403 })
    }
    
    const prompt = `请为以下产品生成 5 条适合 ${platform} 平台的营销文案，风格为 ${style}。

产品关键词：${keywords}

要求每条文案包含以下格式（用空行分隔每条）：
【标题】（不超过20字，吸引眼球）
【正文】（50-100字，生动描述产品特点和价值）
【标签】（2-3个#话题标签，适合${platform}平台）

示例格式：
【标题】双十一必买清单来了！
【正文】错过等一年！全场低至5折，满减叠加优惠券，买到就是赚到。赶紧加购物车，手慢无！
【标签】#双十一 #省钱攻略 #购物狂欢

开始生成 5 条文案：`
    
    const result = await generateText(prompt, {
      temperature: 0.8,
      maxTokens: 2000
    }, provider)
    
    console.log('=== AI 生成结果 ===')
    console.log(result)
    
    if (!result) {
      return NextResponse.json({ success: false, message: 'AI 生成失败，请重试' }, { status: 500 })
    }
    
    // 解析 AI 返回的文案（提取标题、正文、标签）
    function parseCopyBlocks(text: string): { title: string; content: string; tags: string[] }[] {
      const blocks: { title: string; content: string; tags: string[] }[] = []
      // 按 【标题】 分割
      const parts = text.split(/【标题】/).filter(Boolean)
      
      for (const part of parts) {
        const titleLine = part.trim().split('\n')[0]?.trim() || ''
        
        // 找【正文】
        const bodyMatch = part.match(/【正文】([\s\S]*?)(?=【标签】|$)/)
        const body = bodyMatch?.[1]?.trim() || ''
        
        // 找【标签】- 使用贪婪匹配捕获标签内容
        const tagsMatch = part.match(/【标签】([\s\S]*?)(?=\n\n【标题】|$)/)
        const tagStr = tagsMatch?.[1]?.trim() || ''
        // 按 # 分割并清理每个标签
        const tags = tagStr.split('#').filter(t => t.trim()).map(t => t.trim()).filter(Boolean)
        
        if (titleLine && body) {
          blocks.push({ 
            title: titleLine, 
            content: body, 
            tags: tags.length > 0 ? tags : ['营销文案'] 
          })
        }
      }
      
      return blocks
    }
    
    const parsedCopies = parseCopyBlocks(result)
    console.log('解析后文案数量:', parsedCopies.length)
    
    if (user) {
      const createdTasks: any[] = []
      for (const copy of parsedCopies) {
        const copyTask = await prisma.copyTask.create({
          data: {
            keywords: body.keywords || '',
            platform: body.platform || '通用',
            style: body.style || '标准',
            resultJson: JSON.stringify(copy), // 存储解析后的对象
            user: { connect: { id: user.userId } }
          }
        })
        createdTasks.push({ ...copy, id: copyTask.id })
      }
      await incrementUsage(user.userId, '文案生成', 1)
      return NextResponse.json({ success: true, copies: createdTasks })
    } else {
      return NextResponse.json({ success: true, copies: parsedCopies })
    }
  } catch (error) {
    console.error('==================== AI 文案生成错误 ====================')
    console.error('错误类型:', error?.constructor?.name)
    console.error('错误消息:', error instanceof Error ? error.message : String(error))
    console.error('完整错误:', error)
    console.error('======================================================')
    return NextResponse.json({ 
      success: false, 
      message: error instanceof Error ? error.message : '生成失败',
      error: String(error)
    }, { status: 500 })
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