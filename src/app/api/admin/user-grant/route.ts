import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/**
 * ★VF_ADMIN_GRANT_V1（2026-10-28 用户「后台给用户加时间、点数、年卡 —— 我找了没找到」
 *                     + 「以前都是让你们给我命令加时间，太烦了」）
 *
 * 背景（查证结论）：这套能力**从来没做过**。
 *   · `/admin/subscription` 的 `users` tab 只在 `useState` 里定义了，**页面里没有渲染**（空壳）；
 *   · `UserSubscription` 的写入只有三处（领周卡 / 支付回调 / 自动过期）⇒ **没有管理员手动开通的入口**；
 *   · `UserSubscription.paymentMethod` 的注释里早就写了 `manual` ⇒ 当初就预留给"后台手动"。
 * 现在把它补上：查用户 → 看权益 → 加时长 / 加点数 → **两样都落流水**（可对账）。
 *
 * ⚠️ 三条硬口径：
 *   ① **续费不新建**：已有 active 订阅且同一套餐 ⇒ 在 `endDate` 上**累加**，不是覆盖、不是多开一条；
 *   ② **加点数必须造流水**（`PointCardOrder`，`amount=0`、`channel='manual'`），否则余额和账对不上；
 *   ③ **不碰支付链路**：只是插一条 `paymentMethod='manual'` 的记录，支付回调那段一行不改。
 */

async function ensureAdmin(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth || auth.role !== 'admin') return null
  return auth
}

/** 后台赠送点卡：没有就建一张 0 元的，用来挂"手动加点的流水" */
async function ensureManualCard() {
  const NAME = '后台赠送（0元）'
  const found = await prisma.pointCard.findFirst({ where: { name: NAME } })
  if (found) return found
  return await prisma.pointCard.create({
    data: { name: NAME, description: '管理员在后台手动加点时使用的流水载体，不对外售卖', points: 0, price: 0, status: 'disabled', sortOrder: 9999 },
  })
}

export async function GET(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if (!auth) return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })

  const q = String(new URL(request.url).searchParams.get('q') || '').trim()
  try {
    // 支持按 ID / 用户名 / 邮箱 / 姓名 搜；空 = 最近 20 个
    let where: any = {}
    if (q) {
      const asId = Number(q)
      where = {
        OR: [
          ...(Number.isFinite(asId) && asId > 0 ? [{ id: asId }] : []),
          { username: { contains: q } },
          { email: { contains: q } },
          { name: { contains: q } },
        ],
      }
    }
    const users = await prisma.user.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 20,
      select: {
        id: true, username: true, name: true, email: true, role: true, pointBalance: true, createdAt: true,
        subscriptions: {
          where: { status: 'active' },
          orderBy: { endDate: 'desc' },
          take: 2,
          select: { id: true, planId: true, startDate: true, endDate: true, paymentMethod: true, plan: { select: { name: true, durationMonths: true, price: true } } },
        },
      },
    })
    const plans = await prisma.subscriptionPlan.findMany({
      where: { status: 'active' },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, durationMonths: true, price: true, monthlyTokens: true },
    })
    const now = Date.now()
    return NextResponse.json({
      success: true,
      data: {
        plans,
        users: users.map((u) => {
          const act = u.subscriptions.find((s) => s.endDate.getTime() > now) || null
          return {
            id: u.id, username: u.username, name: u.name, email: u.email, role: u.role,
            pointBalance: u.pointBalance, createdAt: u.createdAt,
            planName: act?.plan?.name || null,
            planId: act?.planId || null,
            endDate: act ? act.endDate : null,
            daysLeft: act ? Math.max(0, Math.ceil((act.endDate.getTime() - now) / 86400000)) : 0,
            payMethod: act?.paymentMethod || null,
          }
        }),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: String(e?.message || e) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if (!auth) return NextResponse.json({ success: false, message: '无权访问' }, { status: 403 })

  let body: any = {}
  try { body = await request.json() } catch { /* ignore */ }
  const userId = Number(body?.userId)
  const action = String(body?.action || '')
  const reason = String(body?.reason || '').slice(0, 200) || '后台手动发放'
  if (!Number.isFinite(userId) || userId <= 0) return NextResponse.json({ success: false, message: '缺少用户 ID' }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, pointBalance: true } })
  if (!user) return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 })

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const orderNo = 'manual-' + stamp + '-' + userId

  try {
    /* ── ① 加时长 / 开套餐 ─────────────────────────────────────────── */
    if (action === 'plan') {
      const planId = Number(body?.planId)
      const days = Number(body?.days)
      if (!Number.isFinite(planId) || planId <= 0) return NextResponse.json({ success: false, message: '请选择套餐' }, { status: 400 })
      const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId }, select: { id: true, name: true, durationMonths: true } })
      if (!plan) return NextResponse.json({ success: false, message: '套餐不存在' }, { status: 404 })

      // 天数：显式给了就用显式值（"加 30 天"这种），否则按套餐月数
      const addDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : Math.max(1, plan.durationMonths * 30)
      const now = new Date()

      // 已有 active 且**同一套餐** ⇒ 在 endDate 上累加（不新建、不多开一条）
      const cur = await prisma.userSubscription.findFirst({
        where: { userId, planId, status: 'active' },
        orderBy: { endDate: 'desc' },
      })
      if (cur && cur.endDate.getTime() > now.getTime()) {
        const next = new Date(cur.endDate.getTime() + addDays * 86400000)
        await prisma.userSubscription.update({
          where: { id: cur.id },
          data: { endDate: next, paymentMethod: 'manual', orderNo },
        })
        return NextResponse.json({
          success: true,
          message: '已续费「' + plan.name + '」+' + addDays + ' 天 ⇒ ' + next.toLocaleDateString('zh-CN'),
          data: { endDate: next, addedDays: addDays, mode: 'renew' },
        })
      }

      // 没有 active（或换了套餐）⇒ 旧的全部置 expired，再开一条新的
      await prisma.userSubscription.updateMany({ where: { userId, status: 'active' }, data: { status: 'expired' } })
      const end = new Date(now.getTime() + addDays * 86400000)
      const created = await prisma.userSubscription.create({
        data: { userId, planId, startDate: now, endDate: end, status: 'active', paymentMethod: 'manual', orderNo },
      })
      return NextResponse.json({
        success: true,
        message: '已开通「' + plan.name + '」' + addDays + ' 天 ⇒ ' + end.toLocaleDateString('zh-CN'),
        data: { id: created.id, endDate: end, addedDays: addDays, mode: 'new' },
      })
    }

    /* ── ② 加点数（永久余额，不过期）───────────────────────────────── */
    if (action === 'points') {
      const pts = Number(body?.points)
      if (!Number.isFinite(pts) || Math.trunc(pts) === 0) return NextResponse.json({ success: false, message: '点数必须是正整数或负整数' }, { status: 400 })
      const delta = Math.trunc(pts)
      // 不能扣成负数
      const cur = user.pointBalance || 0
      if (cur + delta < 0) return NextResponse.json({ success: false, message: '扣减后余额为负（当前 ' + cur + ' 点）' }, { status: 400 })

      const card = await ensureManualCard()
      await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { pointBalance: { increment: delta } } }),
        // 必须造流水 —— 否则余额和账对不上（`points` 是下单时快照，用实际增减量）
        prisma.pointCardOrder.create({
          data: {
            orderNo, userId, cardId: card.id, channel: 'manual', amount: 0,
            points: delta, subject: reason, status: 'paid', paidAt: new Date(),
          },
        }),
      ])
      const after = await prisma.user.findUnique({ where: { id: userId }, select: { pointBalance: true } })
      return NextResponse.json({
        success: true,
        message: '已' + (delta > 0 ? '加 ' : '扣 ') + Math.abs(delta) + ' 点 ⇒ 余额 ' + (after?.pointBalance ?? 0) + ' 点',
        data: { pointBalance: after?.pointBalance ?? 0, delta },
      })
    }

    return NextResponse.json({ success: false, message: '未知操作：' + action }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: '操作失败：' + String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
