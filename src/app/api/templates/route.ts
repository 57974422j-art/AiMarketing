import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role }
}

// POST /api/templates - 创建模板（分享到创意库）
export async function POST(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) {
      return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
    }

    const body = await request.json()
    const { type, data } = body

    if (!type || !data) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }

    let template;
    
    switch (type) {
      case 'copy': {
        // 文案模板
        template = await prisma.copyTemplate.create({
          data: {
            title: data.title || '未命名文案',
            content: data.content,
            platform: data.platform,
            style: data.style,
            tags: data.tags ? JSON.stringify(data.tags) : null,
            status: 'pending', // 待审核
            userId: user.userId
          }
        })
        break;
      }
      case 'video': {
        // 视频模板
        template = await prisma.videoTemplate.create({
          data: {
            title: data.title || '未命名视频',
            description: data.description,
            prompt: data.prompt,
            duration: data.duration || 30,
            style: data.style || '电影感',
            thumbnail: data.thumbnail,
            videoUrl: data.videoUrl
          }
        })
        break;
      }
      case 'digital-human': {
        // 数字人模板
        template = await prisma.digitalHumanTemplate.create({
          data: {
            title: data.title || '未命名数字人',
            script: data.script,
            humanId: data.humanId,
            humanName: data.humanName,
            humanAvatar: data.humanAvatar,
            humanGender: data.humanGender,
            humanVoice: data.humanVoice,
            background: data.background,
            duration: data.duration || 30,
            thumbnail: data.thumbnail
          }
        })
        break;
      }
      case 'nfc': {
        // NFC规则模板
        template = await prisma.nFCRuleTemplate.create({
          data: {
            name: data.name || '未命名规则',
            triggerType: data.triggerType,
            description: data.description,
            contentTitle: data.contentTitle,
            contentUrl: data.contentUrl,
            contentValue: data.contentValue,
            status: data.status || 'active'
          }
        })
        break;
      }
      default:
        return NextResponse.json({ success: false, message: '不支持的模板类型' }, { status: 400 })
    }

    return NextResponse.json({ 
      success: true, 
      message: '已提交到创意库，待审核后展示',
      template 
    })
  } catch (error) {
    console.error('创建模板错误:', error)
    return NextResponse.json({ success: false, message: '创建失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// GET /api/templates - 获取模板列表（支持状态筛选）
export async function GET(request: NextRequest) {
  try {
    const user = getUserContext(request)
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const status = searchParams.get('status')

    // 状态筛选仅限管理员
    if (status && user?.role !== 'admin') {
      return NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
    }

    let templates: { copy: any[]; video: any[]; digitalHuman: any[]; nfc: any[] } = {
      copy: [], video: [], digitalHuman: [], nfc: []
    }

    if (!type || type === 'copy') {
      templates.copy = await (prisma.copyTemplate.findMany({
        where: status ? { status } : undefined,
        include: { user: { select: { username: true } } },
        orderBy: { createdAt: 'desc' }
      }) as any)
    }
    if (!type || type === 'video') {
      templates.video = await prisma.videoTemplate.findMany({
        orderBy: { createdAt: 'desc' }
      })
    }
    if (!type || type === 'digitalHuman') {
      templates.digitalHuman = await prisma.digitalHumanTemplate.findMany({
        orderBy: { createdAt: 'desc' }
      })
    }
    if (!type || type === 'nfc') {
      templates.nfc = await prisma.nFCRuleTemplate.findMany({
        orderBy: { createdAt: 'desc' }
      })
    }

    // 如果指定了 type 和 status，只返回对应类型
    if (type === 'copy' && status) {
      return NextResponse.json(templates.copy)
    }

    return NextResponse.json(templates)
  } catch (error) {
    console.error('获取模板错误:', error)
    return NextResponse.json({ success: false, message: '获取失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
