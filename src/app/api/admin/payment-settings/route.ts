import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()
const CONFIG_KEY = 'payment_settings'

/** GET — 读取支付配置 */
export async function GET() {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } })
    const data = row ? JSON.parse(row.value) : {}
    return NextResponse.json({ success: true, data })
  } catch (e: any) {
    // 可能 SystemConfig 表还没建，返回空
    return NextResponse.json({ success: true, data: {} })
  }
}

/** POST — 保存支付配置 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    // 加密存储敏感字段
    const encrypted = { ...body }
    if (body.wechatApiKey) encrypted.wechatApiKey = encrypt(body.wechatApiKey)
    if (body.alipayPrivateKey) encrypted.alipayPrivateKey = encrypt(body.alipayPrivateKey)

    await prisma.systemConfig.upsert({
      where: { key: CONFIG_KEY },
      update: { value: JSON.stringify(encrypted) },
      create: { key: CONFIG_KEY, value: JSON.stringify(encrypted) },
    })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 简易加密（生产环境应换 AES）
const SECRET = process.env.ENCRYPTION_KEY || 'aimarketing-2026-secret-key-32c'
function encrypt(text: string): string {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(SECRET.padEnd(32, '0').slice(0, 32)), Buffer.alloc(16, 0))
  return cipher.update(text, 'utf8', 'hex') + cipher.final('hex')
}
