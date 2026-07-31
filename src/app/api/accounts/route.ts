import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

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
    // 指纹浏览器（manual）：用户自助，登记即可用，无需管理员授权
    // 魔云腾/云手机（device）等仍保持「未绑定」，需管理员在后台绑定授权
    const effectiveBindType = bindType || 'device'
    const isSelfService = effectiveBindType === 'manual'
    const account = await prisma.account.create({
      data: {
        accountName, platform, accountId: accountId || '', bindType: effectiveBindType,
        password: password || '', mobile: mobile || '', remark: remark || '', userId: user.userId,
        isBound: isSelfService,
        status: isSelfService ? '已绑定' : '未绑定',
      },
    })
    return NextResponse.json({ success: true, message: isSelfService ? '添加成功，指纹浏览器已可用' : '添加成功，等待管理员绑定设备', account })
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

    // ── 解绑操作（deviceId='' 表示明确解绑）──
    if (deviceId === '') {
      data.deviceId = null
      data.status = '未绑定'
      data.isBound = false
      // 动态端口模型：端口随会话动态分配/释放，解绑无需释放固定端口
    }
    // ── 指纹浏览器绑定（动态端口模型：不再分配固定端口，端口随启动会话分配）──
    else if (account.bindType === 'manual') {
      // 每用户每平台唯一：同平台已有其它已绑定的 manual 账号则拒绝（多开需再订阅名额）
      const dup = await prisma.account.findFirst({
        where: { userId: targetUserId, platform: account.platform, bindType: 'manual', isBound: true, id: { not: parseInt(id) } },
      })
      if (dup) {
        return NextResponse.json({ success: false, message: '该平台已绑定一个账号，多开需再订阅名额' }, { status: 409 })
      }
      data.status = '已绑定'
      data.isBound = true
      data.deviceId = null
    }
    // ── Q1 设备绑定（代理商批量运维，保留授权）──
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
    // 动态端口模型：账号删除无需释放固定端口
    await prisma.account.delete({ where: { id } })
    return NextResponse.json({ success: true, message: '已删除' })
  } catch (e: any) { console.error(e); return NextResponse.json({ success: false, message: e.message || '删除失败' }, { status: 500 })
  } finally { await prisma.$disconnect() }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
