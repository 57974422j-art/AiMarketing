import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()
const CONFIG_KEY = 'payment_settings'
const SENSITIVE_FIELDS = ['wechatApiKey', 'alipayPrivateKey']
const SECRET = process.env.ENCRYPTION_KEY || 'aimarketing-2026-secret-key-32c'

function getKey() {
  return Buffer.from(SECRET.padEnd(32, '0').slice(0, 32))
}

function decrypt(hex: string): string {
  const decipher = crypto.createDecipheriv('aes-256-cbc', getKey(), Buffer.alloc(16, 0))
  return decipher.update(hex, 'hex', 'utf8') + decipher.final('utf8')
}

export interface PaymentConfig {
  wechatAppId: string
  wechatMchId: string
  wechatApiKey: string
  wechatEnabled: boolean
  alipayAppId: string
  alipayPrivateKey: string
  alipayPublicKey: string
  alipayEnabled: boolean
  alipayGateway: string
  alipayNotifyUrl: string
}

/**
 * 服务端读取支付配置（自动解密敏感字段）。
 * 仅后端调用，私钥绝不返回给前端。
 */
export async function getPaymentConfig(): Promise<Partial<PaymentConfig>> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } })
    if (!row) return {}
    const data = JSON.parse(row.value)
    for (const f of SENSITIVE_FIELDS) {
      if (data[f]) {
        try { data[f] = decrypt(data[f]) } catch { /* 已是明文则跳过 */ }
      }
    }
    return data
  } catch {
    return {}
  }
}


/** 2026-08-18 隐患③: 清理过期 pending 订单（惰性——下单/查单时调用） */
export async function cleanupExpiredOrders(): Promise<number> {
  try {
    const r = await prisma.paymentOrder.updateMany({
      where: { status: 'pending', expireAt: { lt: new Date() } },
      data: { status: 'closed' },
    })
    return r.count
  } catch { return 0 }
}
