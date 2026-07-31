import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// 辅助：过滤可见数据
async function getVisiblePois(auth: { userId: number; role: string }) {
  if (auth.role === 'admin') {
    return prisma.poiAddress.findMany({
      include: { owner: { select: { id: true, username: true } } },
      orderBy: { id: 'desc' },
    })
  }
  return prisma.poiAddress.findMany({
    where: { ownerId: auth.userId },
    orderBy: { id: 'desc' },
  })
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })
    const data = await getVisiblePois(auth)
    return NextResponse.json({ success: true, data })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    const body = await request.json()
    const { name, address, lat, lng, platform } = body
    if (!name || !address || lat == null || lng == null || !platform) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }
    const poi = await prisma.poiAddress.create({
      data: { name, address, lat: parseFloat(lat), lng: parseFloat(lng), platform, ownerId: auth.userId },
    })
    return NextResponse.json({ success: true, data: poi }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    const body = await request.json()
    const { id, name, address, lat, lng, platform } = body
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    const poi = await prisma.poiAddress.findUnique({ where: { id } })
    if (!poi) return NextResponse.json({ success: false, message: '地址不存在' }, { status: 404 })
    if (auth.role !== 'admin' && poi.ownerId !== auth.userId) {
      return NextResponse.json({ success: false, message: '无权修改' }, { status: 403 })
    }
    const updated = await prisma.poiAddress.update({
      where: { id },
      data: { name, address, lat: lat != null ? parseFloat(lat) : undefined, lng: lng != null ? parseFloat(lng) : undefined, platform },
    })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '', 10)
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    const poi = await prisma.poiAddress.findUnique({ where: { id } })
    if (!poi) return NextResponse.json({ success: false, message: '地址不存在' }, { status: 404 })
    if (auth.role !== 'admin' && poi.ownerId !== auth.userId) {
      return NextResponse.json({ success: false, message: '无权删除' }, { status: 403 })
    }
    await prisma.poiAddress.delete({ where: { id } })
    return NextResponse.json({ success: true, message: '已删除' })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
