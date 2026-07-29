import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import AlipaySign from '@/lib/alipay'
import { getAuthFromCookie } from '@/lib/api-auth'

const prisma = new PrismaClient()

/** POST /api/point-cards/checkout — 购买点卡下单，返回支付宝付款链接 */
export async function POST(req: NextRequest) {
  try {
    const auth = getAuthFromCookie(req)
    const userId = auth?.userId ?? 0
    if (!userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

    const { cardId, channel = 'alipay' } = await req.json()
    const card = await prisma.pointCard.findFirst({ where: { id: Number(cardId), status: 'active' } })
    if (!card) return NextResponse.json({ success: false, message: '点卡不存在或已下架' }, { status: 400 })

    const orderNo = 'PC' + Date.now().toString() + Math.floor(Math.random() * 1000).toString().padStart(3, '0')
    const amount = card.price
    const expireAt = new Date(Date.now() + 15 * 60 * 1000) // 15 分钟
    const order = await prisma.pointCardOrder.create({
      data: { orderNo, userId, cardId: card.id, channel, amount, points: card.points, subject: '点卡：' + card.name, status: 'pending', expireAt },
    })

    if (channel !== 'alipay') {
      return NextResponse.json({ success: false, message: '当前仅支持支付宝' }, { status: 400 })
    }
    const gateway = 'https://openapi.alipay.com/gateway.do'
    const params: Record<string, any> = {
      app_id: process.env.ALIPAY_APP_ID,
      method: 'alipay.trade.page.pay',
      charset: 'UTF-8',
      sign_type: 'RSA2',
      timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-'),
      version: '1.0',
      notify_url: process.env.ALIPAY_NOTIFY_URL,
      return_url: process.env.ALIPAY_RETURN_URL || (process.env.NEXT_PUBLIC_BASE_URL + '/payment/success'),
      biz_content: JSON.stringify({
        out_trade_no: orderNo,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        total_amount: (amount / 100).toFixed(2),
        subject: '点卡：' + card.name,
        body: `${card.points} 点`,
        passback_params: Buffer.from(JSON.stringify({ module: 'pointcard' })).toString('base64'),
      }),
    }
    const sign = AlipaySign.sign(params)
    params.sign = sign
    const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    const payUrl = `${gateway}?${query}`

    await prisma.pointCardOrder.update({ where: { id: order.id }, data: { payUrl } })
    return NextResponse.json({ success: true, data: { orderNo, payUrl, amount } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
