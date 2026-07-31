import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import { getPaymentConfig } from '@/lib/payment-config'
import { buildPagePayUrl, AlipayConfig } from '@/lib/alipay'

const prisma = new PrismaClient()

/** 从 cookie token 解析 userId（HMAC-SHA256，与 login 保持一致） */
function getUserIdFromRequest(req: NextRequest): number | null {
  const token = req.cookies.get('token')?.value
  if (!token) return null
  const JWT_SECRET = process.env.JWT_SECRET || 'aimarketing-secret-key-2024'
  try {
    const [header, payload, signature] = token.split('.')
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
    if (signature !== expected) return null
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof data.userId === 'number' ? data.userId : null
  } catch {
    return null
  }
}

/** 生成商户订单号：yyyyMMddHHmmss + 6位随机 */
function genOrderNo(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const rnd = crypto.randomBytes(3).toString('hex')
  return `AM${ts}${rnd}`
}

/**
 * POST /api/subscription/checkout — 创建支付订单并返回支付宝支付跳转 URL
 * body: { planId: number, channel?: 'alipay' }
 */
export async function POST(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req)
    if (!userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const planId = Number(body.planId)
    const channel = body.channel || 'alipay'
    if (!planId) return NextResponse.json({ success: false, message: '缺少套餐参数' }, { status: 400 })

    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } })
    if (!plan || plan.status !== 'active') {
      return NextResponse.json({ success: false, message: '套餐不可用' }, { status: 400 })
    }

    // 金额(分)：优先折扣价
    const amount = plan.discountPrice && plan.discountPrice > 0 ? plan.discountPrice : plan.price
    if (!amount || amount <= 0) {
      return NextResponse.json({ success: false, message: '套餐金额无效' }, { status: 400 })
    }

    const cfg = await getPaymentConfig()

    if (channel === 'alipay') {
      if (!cfg.alipayEnabled) {
        return NextResponse.json({ success: false, message: '支付宝支付未启用' }, { status: 400 })
      }
      if (!cfg.alipayAppId || !cfg.alipayPrivateKey) {
        return NextResponse.json({ success: false, message: '支付宝配置不完整' }, { status: 400 })
      }
    } else {
      return NextResponse.json({ success: false, message: '暂不支持该支付方式' }, { status: 400 })
    }

    const orderNo = genOrderNo()
    const subject = `${plan.name}`
    const expireAt = new Date(Date.now() + 30 * 60 * 1000) // 30 分钟有效

    // 建订单（pending）
    await prisma.paymentOrder.create({
      data: { orderNo, userId, planId: plan.id, channel, amount, subject, status: 'pending', expireAt },
    })

    // 构造支付宝 wap 支付跳转 URL
    const alipayCfg: AlipayConfig = {
      appId: cfg.alipayAppId!,
      privateKey: cfg.alipayPrivateKey!,
      publicKey: cfg.alipayPublicKey || '',
      gateway: cfg.alipayGateway || 'https://openapi.alipay.com/gateway.do',
      notifyUrl: cfg.alipayNotifyUrl || 'https://ai-niuma.cc/api/payment/alipay/notify',
      returnUrl: 'https://ai-niuma.cc/my-subscription',
    }
    const payUrl = buildPagePayUrl(alipayCfg, {
      out_trade_no: orderNo,
      total_amount: (amount / 100).toFixed(2), // 元，两位小数
      subject,
      product_code: 'FAST_INSTANT_TRADE_PAY',
    })

    await prisma.paymentOrder.update({ where: { orderNo }, data: { payUrl } })

    return NextResponse.json({ success: true, data: { orderNo, payUrl, amount } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
