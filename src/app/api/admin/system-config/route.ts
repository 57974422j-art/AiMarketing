import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// 管理员权限检查
function isAdmin(request: NextRequest): boolean {
  const role = request.headers.get('X-User-Role')
  return role === 'admin'
}

// GET: 获取系统配置（支持指定 key 列表，或返回全部）
export async function GET(request: NextRequest) {
  try {
    if (!isAdmin(request)) return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const keys = searchParams.get('keys')?.split(',').filter(Boolean)

    const where = keys?.length ? { key: { in: keys } } : {}
    const configs = await prisma.systemConfig.findMany({ where, orderBy: { key: 'asc' } })

    // 转为 key-value 对象
    const data: Record<string, any> = {}
    configs.forEach(c => {
      data[c.key] = { value: c.value, label: c.label, description: c.description }
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[SystemConfig GET] error:', error)
    return NextResponse.json({ success: false, message: '获取配置失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// POST: 批量保存系统配置
export async function POST(request: NextRequest) {
  try {
    if (!isAdmin(request)) return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

    const body = await request.json()
    const { configs } = body as { configs: Array<{ key: string; value: string; label?: string; description?: string }> }

    if (!Array.isArray(configs)) {
      return NextResponse.json({ success: false, message: '参数格式错误：configs 必须是数组' }, { status: 400 })
    }

    for (const item of configs) {
      if (!item.key || typeof item.value !== 'string') continue
      await prisma.systemConfig.upsert({
        where: { key: item.key },
        update: { value: item.value, ...(item.label && { label: item.label }), updatedAt: new Date() },
        create: { key: item.key, value: item.value, label: item.label || '', description: item.description || '' }
      })
    }

    console.log(`[SystemConfig] 已更新 ${configs.length} 条配置`)
    return NextResponse.json({ success: true, message: `已保存 ${configs.length} 条配置` })
  } catch (error) {
    console.error('[SystemConfig POST] error:', error)
    return NextResponse.json({ success: false, message: '保存失败' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
