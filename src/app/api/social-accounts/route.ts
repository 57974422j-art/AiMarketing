import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/**
 * GET /api/social-accounts
 * 社交账号列表（按权限过滤）
 */
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) {
      return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    }

    let accounts

    if (auth.role === 'admin') {
      accounts = await prisma.socialAccount.findMany({
        include: {
          user: { select: { id: true, username: true, name: true } },
          device: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    } else if (auth.role === 'editor') {
      accounts = await prisma.socialAccount.findMany({
        where: { userId: auth.userId },
        include: {
          user: { select: { id: true, username: true, name: true } },
          device: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    } else {
      return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })
    }

    return NextResponse.json({ success: true, data: accounts })
  } catch (error) {
    console.error('获取账号列表失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * POST /api/social-accounts
 * 绑定社交账号
 */
export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) {
      return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
    }
    if (auth.role === 'end-user') {
      return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 })
    }

    const body = await request.json()
    const { platform, username, password, deviceId } = body

    if (!platform || !username || !password) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }

    // 简单 Base64 加密密码（生产环境建议使用更强加密）
    const encryptedPassword = Buffer.from(password).toString('base64')

    const account = await prisma.socialAccount.create({
      data: {
        platform,
        username,
        password: encryptedPassword,
        deviceId: deviceId || null,
        userId: auth.userId,
        status: '已绑定',
      },
    })

    // 更新设备池已用窗口
    if (deviceId) {
      const pool = await prisma.devicePool.findFirst({ where: { ownerId: auth.userId } })
      if (pool) {
        await prisma.devicePool.update({
          where: { id: pool.id },
          data: { usedWindows: { increment: 1 } },
        })
      }
    }

    return NextResponse.json({ success: true, data: account }, { status: 201 })
  } catch (error) {
    console.error('绑定账号失败:', error)
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
