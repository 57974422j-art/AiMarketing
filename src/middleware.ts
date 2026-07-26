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

  // 全局订阅门控：非 admin 必须持有未过期订阅（订阅到期时间随 JWT 携带）。
  // 老 token 无 subExp 字段 → 视为需要重新登录以刷新订阅信息。
  if (payload.role !== 'admin') {
    const subExp = payload.subExp || 0
    if (!subExp || subExp < Date.now()) {
      return NextResponse.json(
        { success: false, message: '订阅已到期或未订阅，请前往订阅页购买', code: 'NO_SUBSCRIPTION' },
        { status: 403 },
      )
    }
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('X-User-Id', payload.userId.toString())
  requestHeaders.set('X-User-Role', payload.role)
  requestHeaders.set('X-User-Team-Id', payload.teamId?.toString() || '')

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/api/:path*'],
}
