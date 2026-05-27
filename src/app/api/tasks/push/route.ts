import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

async function ensureTable() {
  try { await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PushedTask (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, deviceSerial TEXT NOT NULL, platform TEXT NOT NULL, action TEXT NOT NULL, keywords TEXT DEFAULT \'\', videoUrl TEXT DEFAULT \'\', title TEXT DEFAULT \'\', hook TEXT DEFAULT \'\', status TEXT DEFAULT \'待执行\', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)') } catch {}
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromHeaders(request)
    if (!auth) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
    await ensureTable()

    const { deviceSerial, platform, action, keywords, videoUrl, title, hook } = await request.json()
    if (!deviceSerial || !platform || !action) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 })
    }

    const device = await prisma.account.findFirst({
      where: { userId: auth.userId, accountId: deviceSerial, isBound: true },
    })
    if (!device) return NextResponse.json({ success: false, message: '设备未绑定' }, { status: 403 })

    await prisma.$executeRawUnsafe(
      'INSERT INTO PushedTask (userId, deviceSerial, platform, action, keywords, videoUrl, title, hook) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      auth.userId, deviceSerial, platform, action, keywords || '', videoUrl || '', title || '', hook || ''
    )

    return NextResponse.json({ success: true, message: '任务已推送' })
  } catch (e: any) {
    console.error('tasks/push error:', e)
    return NextResponse.json({ success: false, error: e.message })
  } finally { await prisma.$disconnect() }
}
