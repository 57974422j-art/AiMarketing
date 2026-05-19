import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

async function getVisibleGroups(auth: { userId: number; role: string }) {
  const include = {
    owner: { select: { id: true, username: true } },
    items: { include: { socialAccount: { select: { id: true, platform: true, username: true, status: true } } } },
  }
  if (auth.role === 'admin') {
    return prisma.accountGroup.findMany({ include, orderBy: { id: 'desc' } })
  }
  return prisma.accountGroup.findMany({ where: { ownerId: auth.userId }, include, orderBy: { id: 'desc' } })
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })
    return NextResponse.json({ success: true, data: await getVisibleGroups(auth) })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    const body = await request.json()

    if (body.name && !body.socialAccountId) {
      const group = await prisma.accountGroup.create({ data: { name: body.name, ownerId: auth.userId } })
      return NextResponse.json({ success: true, data: group }, { status: 201 })
    }

    if (body.groupId && body.socialAccountId) {
      const group = await prisma.accountGroup.findUnique({ where: { id: body.groupId } })
      if (!group) return NextResponse.json({ success: false, message: '分组不存在' }, { status: 404 })
      if (auth.role !== 'admin' && group.ownerId !== auth.userId) return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
      const item = await prisma.accountGroupItem.upsert({
        where: { groupId_socialAccountId: { groupId: body.groupId, socialAccountId: body.socialAccountId } },
        update: {},
        create: { groupId: body.groupId, socialAccountId: body.socialAccountId },
      })
      return NextResponse.json({ success: true, data: item }, { status: 201 })
    }
    return NextResponse.json({ success: false, message: '参数无效' }, { status: 400 })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    if (auth.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '', 10)
    const groupId = parseInt(searchParams.get('groupId') || '', 10)
    const socialAccountId = parseInt(searchParams.get('socialAccountId') || '', 10)

    if (id) {
      const group = await prisma.accountGroup.findUnique({ where: { id } })
      if (!group) return NextResponse.json({ success: false, message: '分组不存在' }, { status: 404 })
      if (auth.role !== 'admin' && group.ownerId !== auth.userId) return NextResponse.json({ success: false, message: '无权删除' }, { status: 403 })
      await prisma.accountGroupItem.deleteMany({ where: { groupId: id } })
      await prisma.accountGroup.delete({ where: { id } })
      return NextResponse.json({ success: true, message: '分组已删除' })
    }

    if (groupId && socialAccountId) {
      const item = await prisma.accountGroupItem.findFirst({ where: { groupId, socialAccountId } })
      if (!item) return NextResponse.json({ success: false, message: '该账号不在此分组' }, { status: 404 })
      const group = await prisma.accountGroup.findUnique({ where: { id: groupId } })
      if (auth.role !== 'admin' && group?.ownerId !== auth.userId) return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
      await prisma.accountGroupItem.delete({ where: { id: item.id } })
      return NextResponse.json({ success: true, message: '已移出分组' })
    }
    return NextResponse.json({ success: false, message: '参数无效' }, { status: 400 })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
