import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role, teamId: parseInt(request.headers.get('X-User-Team-Id') || '') || null }
}

// GET /api/accounts
//   admin  → 全部（含 device + user）
//   editor → 自己下属终端登记的
//   end-user → 自己的
export async function GET(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

    let where: any = {}
    const baseInclude: any = { user: { select: { id: true, username: true, name: true, parentId: true, parent: { select: { id: true, username: true, name: true } } } }, device: { select: { id: true, name: true } } }

    if (user.role === 'admin') {
      where = {}
    } else if (user.role === 'editor') {
      where = { OR: [{ user: { parentId: user.userId } }, { userId: user.userId }] }
    } else {
      where = { userId: user.userId }
    }

    const accounts = await prisma.account.findMany({ where, include: baseInclude, orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ success: true, data: accounts })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

// POST /api/accounts — 登记（只限本人）
export async function POST(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    const body = await request.json()
    const { accountName, platform, accountId, bindType, password, mobile, remark } = body
    if (!accountName || !platform) return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })

    const account = await prisma.account.create({
      data: { accountName, platform, accountId: accountId || '', bindType: bindType || 'device', password: password || '', mobile: mobile || '', remark: remark || '', userId: user.userId },
    })
    return NextResponse.json({ success: true, message: '添加成功', account })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '添加失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

// PUT /api/accounts — 绑定设备（仅 editor/admin）
export async function PUT(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user || user.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    const body = await request.json()
    const { id, deviceId } = body
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })

    await prisma.account.update({
      where: { id: parseInt(id) },
      data: { deviceId: deviceId ? parseInt(deviceId) : null, status: deviceId ? '已绑定' : '未绑定', isBound: !!deviceId },
    })
    return NextResponse.json({ success: true, message: '绑定成功' })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '绑定失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

// DELETE /api/accounts
export async function DELETE(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '')
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })

    if (user.role !== 'admin') {
      const acct = await prisma.account.findUnique({ where: { id } })
      if (!acct || acct.userId !== user.userId) return NextResponse.json({ success: false, message: '只能删除自己的' }, { status: 403 })
    }
    await prisma.account.delete({ where: { id } })
    return NextResponse.json({ success: true, message: '已删除' })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '删除失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
