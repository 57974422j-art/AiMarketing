import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 说明：Next.js 14 的 middleware 只能运行在 Edge Runtime，
// 因此这里不能使用 node:crypto，也不能直接查询 Prisma（都不被 Edge 支持）。
// 订阅门控改为「登录时把订阅到期时间写进 JWT(subExp)」，middleware 仅解 payload 比时间。

const API_WHITELIST = [
  '/login',
  '/register',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth',
  '/api/subscription',
  '/api/payment',
  '/api/devices/heartbeat',
  '/api/migrate-template-urls',
  '/api/tasks/mine',
  '/api/tts',
  '/api/mediacrawler/qrcode',
]

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padding = base64.length % 4
  if (padding) base64 += '='.repeat(4 - padding)
  return atob(base64)
}

interface JwtPayload {
  userId: number
  username: string
  role: string
  teamId: number | null
  subExp?: number // 订阅到期时间（毫秒时间戳）；admin 可无
}

function decodeJWT(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    return JSON.parse(base64UrlDecode(parts[1]))
  } catch {
    return null
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!pathname.startsWith('/api/')) return NextResponse.next()

  // 精确匹配：Electron 下载素材端点（自带 userId 参数鉴权），不拦截
  if (pathname === '/api/storage/file') return NextResponse.next()

  if (API_WHITELIST.some(path => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  const token = request.cookies.get('token')?.value
  if (!token) {
    return NextResponse.json({ success: false, message: '未登录，请先登录' }, { status: 401 })
  }

  const payload = decodeJWT(token)
  if (!payload) {
    return NextResponse.json({ success: false, message: '无效的登录状态，请重新登录' }, { status: 401 })
  }

  // 订阅门控策略（2026-07-27 调整）：
  // 不再在 middleware 层对未订阅用户做全局硬拦截——否则会连「套餐卡片 / 工作台 /
  // 账号列表」等查看类接口一起挡掉，导致用户看不到内容、无法自助充值。
  // 真正的付费动作由各路由内的 checkFeatureAccess(User.paidFeatures) / quota-checker
  // 单独做软拦截，返回「需要充值开通」提示（免费 LLM 等始终放行）。
  // 这样未订阅用户仍可浏览内容并前往充值。仅未登录（无 token）时返回 401。

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('X-User-Id', payload.userId.toString())
  requestHeaders.set('X-User-Role', payload.role)
  requestHeaders.set('X-User-Team-Id', payload.teamId?.toString() || '')

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/api/:path*'],
}
