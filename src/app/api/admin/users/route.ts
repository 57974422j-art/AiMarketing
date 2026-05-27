import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { randomBytes, scrypt } from 'crypto'
import { promisify } from 'util'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()
const scryptAsync = promisify(scrypt)

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hashed = await scryptAsync(password, salt, 64) as Buffer
  return `${salt}:${hashed.toString('hex')}`
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })
    }

    const users = await prisma.user.findMany({
      where: { role: { in: ['editor', 'end-user'] } },
      select: {
        id: true, username: true, name: true, email: true, createdAt: true, role: true, plan: true, parentId: true,
        devicePools: { select: { totalWindows: true, usedWindows: true } },
        parent: { select: { id: true, username: true, name: true } },
        _count: { select: { children: true, socialAccounts: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Get social accounts for all users
    const userIds = users.map(u => u.id)
    const allAccounts = await prisma.account.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, platform: true, status: true },
    })
    const accountsByUser: Record<number, { platform: string; status: string }[]> = {}
    for (const a of allAccounts) {
      if (!accountsByUser[a.userId]) accountsByUser[a.userId] = []
      accountsByUser[a.userId].push({ platform: a.platform, status: a.status })
    }

    const data = users.map((e) => ({
      id: e.id, username: e.username, name: e.name, email: e.email,
      createdAt: e.createdAt, role: e.role, plan: e.plan || 'free',
      parentId: e.parentId,
      parent: e.parent ? { id: e.parent.id, username: e.parent.username, name: e.parent.name } : null,
      childrenCount: e._count.children,
      totalWindows: e.devicePools[0]?.totalWindows ?? 0,
      usedWindows: e.devicePools[0]?.usedWindows ?? 0,
      boundAccounts: e._count.socialAccounts,
      socialAccounts: accountsByUser[e.id] || [],
    }))

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('获取客户列表失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })
    }

    const body = await request.json()
    const { username, email, password, name, role, totalWindows } = body

    if (!username || !email || !password || !role) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }
    if (!['editor', 'end-user'].includes(role)) {
      return NextResponse.json({ success: false, message: '角色无效' }, { status: 400 })
    }

    const existing = await prisma.user.findFirst({ where: { OR: [{ username }, { email }] } })
    if (existing) {
      return NextResponse.json({ success: false, message: '用户名或邮箱已存在' }, { status: 400 })
    }

    const passwordHash = await hashPassword(password)
    const user = await prisma.user.create({
      data: { username, email, passwordHash, name, role, parentId: auth.userId },
    })

    // 如果是 editor，创建设备池
    if (role === 'editor') {
      await prisma.devicePool.create({
        data: { ownerId: user.id, totalWindows: totalWindows || 10, usedWindows: 0 },
      })
    }

    return NextResponse.json({ success: true, message: '创建成功', data: { id: user.id, username: user.username, role: user.role } }, { status: 201 })
  } catch (error) {
    console.error('创建用户失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })
    }
    const body = await request.json()
    const { userId, totalWindows } = body
    if (!userId || totalWindows == null || totalWindows < 0) {
      return NextResponse.json({ success: false, message: '参数无效' }, { status: 400 })
    }
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.role !== 'editor') {
      return NextResponse.json({ success: false, message: '用户不存在或非二级客户' }, { status: 404 })
    }
    const existingPool = await prisma.devicePool.findFirst({ where: { ownerId: userId } })
    if (existingPool) {
      await prisma.devicePool.update({ where: { id: existingPool.id }, data: { totalWindows } })
    } else {
      await prisma.devicePool.create({ data: { ownerId: userId, totalWindows, usedWindows: 0 } })
    }
    return NextResponse.json({ success: true, message: '配额已更新' })
  } catch (error) {
    console.error('更新配额失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
