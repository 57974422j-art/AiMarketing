import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()
const CONFIG_KEY = 'payment_settings'

// 仅这些字段加密存储；其余（AppID/公钥/网关/通知地址）明文即可
const SENSITIVE_FIELDS = ['wechatApiKey', 'alipayPrivateKey']
const SECRET = process.env.ENCRYPTION_KEY || 'aimarketing-2026-secret-key-32c'
function getKey() {
  return Buffer.from(SECRET.padEnd(32, '0').slice(0, 32))
}
function encrypt(text: string): string {
  const cipher = crypto.createCipheriv('aes-256-cbc', getKey(), Buffer.alloc(16, 0))
  return cipher.update(text, 'utf8', 'hex') + cipher.final('hex')
}
function decrypt(hex: string): string {
  const decipher = crypto.createDecipheriv('aes-256-cbc', getKey(), Buffer.alloc(16, 0))
  return decipher.update(hex, 'hex', 'utf8') + decipher.final('utf8')
}

/** GET — 读取支付配置（敏感字段解密后返回，避免前端看到密文） */
export async function GET() {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } })
    const data = row ? JSON.parse(row.value) : {}
    for (const f of SENSITIVE_FIELDS) {
      if (data[f]) {
        try { data[f] = decrypt(data[f]) } catch { /* 已是明文则跳过 */ }
      }
    }
    return NextResponse.json({ success: true, data })
  } catch (e: any) {
    // 可能 SystemConfig 表还没建，返回空
    return NextResponse.json({ success: true, data: {} })
  }
}

/** POST — 保存支付配置（敏感字段加密存储） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const encrypted = { ...body }
    for (const f of SENSITIVE_FIELDS) {
      if (body[f]) encrypted[f] = encrypt(body[f])
    }

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

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
