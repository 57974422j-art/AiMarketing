import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

const DEFAULT_CONFIG = {
  keywords: ['火锅', '美业', '减肥'],
  timeStart: '09:00',
  timeEnd: '23:00',
  actions: ['search', 'like', 'comment'],
  leadGen: {},
}

// GET /api/task-configs?accountId=x&deviceId=x
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const accountId = parseInt(searchParams.get('accountId') || '')
    const deviceId = parseInt(searchParams.get('deviceId') || '')

    if (!accountId) return NextResponse.json({ success: false, message: '缺少 accountId' }, { status: 400 })

    let config = await prisma.taskConfig.findFirst({
      where: { accountId, deviceId: deviceId || undefined },
    })

    if (!config) {
      config = await prisma.taskConfig.create({
        data: {
          accountId,
          deviceId: deviceId || null,
          platform: searchParams.get('platform') || '抖音',
          keywords: JSON.stringify(DEFAULT_CONFIG.keywords),
          timeStart: DEFAULT_CONFIG.timeStart,
          timeEnd: DEFAULT_CONFIG.timeEnd,
          actions: JSON.stringify(DEFAULT_CONFIG.actions),
          leadGen: JSON.stringify(DEFAULT_CONFIG.leadGen),
          createdBy: auth.userId,
        },
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        ...config,
        keywords: JSON.parse(config.keywords),
        actions: JSON.parse(config.actions),
        leadGen: JSON.parse(config.leadGen),
      },
    })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

// PUT /api/task-configs
export async function PUT(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })

    const body = await request.json()
    const { accountId, deviceId, platform, keywords, timeStart, timeEnd, actions, leadGen } = body
    if (!accountId) return NextResponse.json({ success: false, message: '缺少 accountId' }, { status: 400 })

    const existing = await prisma.taskConfig.findFirst({
      where: { accountId, deviceId: deviceId || null },
    })

    const data: any = {}
    if (platform) data.platform = platform
    if (keywords) data.keywords = JSON.stringify(keywords)
    if (timeStart) data.timeStart = timeStart
    if (timeEnd) data.timeEnd = timeEnd
    if (actions) data.actions = JSON.stringify(actions)
    if (leadGen) data.leadGen = JSON.stringify(leadGen)

    if (existing) {
      await prisma.taskConfig.update({ where: { id: existing.id }, data })
    } else {
      await prisma.taskConfig.create({
        data: {
          accountId,
          deviceId: deviceId || null,
          platform: platform || '抖音',
          keywords: JSON.stringify(keywords || DEFAULT_CONFIG.keywords),
          timeStart: timeStart || DEFAULT_CONFIG.timeStart,
          timeEnd: timeEnd || DEFAULT_CONFIG.timeEnd,
          actions: JSON.stringify(actions || DEFAULT_CONFIG.actions),
          leadGen: JSON.stringify(leadGen || DEFAULT_CONFIG.leadGen),
          createdBy: auth.userId,
        },
      })
    }

    return NextResponse.json({ success: true, message: '配置已保存' })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '保存失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
