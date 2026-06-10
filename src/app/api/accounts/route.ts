import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { allocateCdpPort, releaseCdpPort } from '@/lib/quota-manager'

const prisma = new PrismaClient()

function getUserContext(request: NextRequest) {
  const userId = request.headers.get('X-User-Id')
  const role = request.headers.get('X-User-Role')
  if (!userId || !role) return null
  return { userId: parseInt(userId), role, teamId: parseInt(request.headers.get('X-User-Team-Id') || '') || null }
}

export async function GET(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    let where: any = {}
    const baseInclude: any = { user: { select: { id: true, username: true, name: true, parentId: true, parent: { select: { id: true, username: true, name: true } } } }, device: { select: { id: true, name: true } } }
    if (user.role === 'admin') { where = {} }
    else if (user.role === 'editor') { where = { OR: [{ user: { parentId: user.userId } }, { userId: user.userId }] } }
    else { where = { userId: user.userId } }
    const accounts = await prisma.account.findMany({ where, include: baseInclude, orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ success: true, data: accounts })
  } catch (e) { console.error(e); return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

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

export async function PUT(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user || user.role === 'end-user') return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    const body = await request.json()
    const { id, deviceId, remark, accountId: updateAccountId } = body
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })

    // 查出当前账号信息（需要知道 bindType 和 userId）
    const account = await prisma.account.findUnique({ where: { id: parseInt(id) } })
    if (!account) return NextResponse.json({ success: false, message: '账号不存在' }, { status: 404 })

    const data: any = {}
    const targetUserId = account.userId

    // ── 解绑操作（deviceId='' 或 deviceId=null）──
    if (deviceId === '' || deviceId === null || deviceId === undefined) {
      data.deviceId = null
      data.status = '未绑定'
      data.isBound = false
      // 指纹浏览器解绑：释放端口
      if (account.bindType === 'manual' && (account as any).cdpPort) {
        await releaseCdpPort(targetUserId, (account as any).cdpPort)
        ;(data as any).cdpPort = null
      }
    }
    // ── 指纹浏览器自动分配端口 ──
    else if (account.bindType === 'manual') {
      // 如果还没分配过端口，自动分配一个
      if (!(account as any).cdpPort) {
        try {
          const port = await allocateCdpPort(targetUserId)
          ;(data as any).cdpPort = port
          data.status = '已绑定'
          data.isBound = true
        } catch (allocErr: any) {
          return NextResponse.json({ success: false, message: allocErr.message || '端口分配失败，配额已满或端口池耗尽' }, { status: 409 })
        }
      }
      // 已有端口则直接标记为已绑定
      else {
        data.status = '已绑定'
        data.isBound = true
      }
      data.deviceId = null
    }
    // ── Q1 设备绑定 ──
    else if (deviceId && deviceId !== 'local') {
      data.deviceId = parseInt(deviceId)
      data.status = '已绑定'
      data.isBound = true
    }
    // ── USB 本地设备绑定 ──
    else if (deviceId === 'local') {
      data.deviceId = null
      data.status = '已绑定'
      data.isBound = true
    }

    if (remark !== undefined) data.remark = remark
    await prisma.account.update({ where: { id: parseInt(id) }, data })
    return NextResponse.json({ success: true, message: '已更新', data })
  } catch (e: any) { console.error(e); return NextResponse.json({ success: false, message: e.message || '更新失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = getUserContext(request)
    if (!user) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '')
    if (!id) return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 })
    // 删除前释放指纹端口配额
    const account = await prisma.account.findUnique({ where: { id } })
    if (account?.bindType === 'manual' && (account as any).cdpPort) {
      await releaseCdpPort(account.userId, (account as any).cdpPort)
    }
    await prisma.account.delete({ where: { id } })
    return NextResponse.json({ success: true, message: '已删除' })
  } catch (e: any) { console.error(e); return NextResponse.json({ success: false, message: e.message || '删除失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}
