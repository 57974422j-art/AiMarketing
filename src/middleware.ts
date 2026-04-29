import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/config',
]

const PUBLIC_PREFIXES = [
  '/api/auth',
  '/_next',
  '/favicon',
  '/public',
]

function verifyJWT(token: string, secret: string): { userId: number; username: string; role: string } | null {
  try {
    const [header, payload, signature] = token.split('.')
    const expectedSignature = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url')
    if (signature !== expectedSignature) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString())
  } catch {
    return null
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/login' || pathname === '/register' || pathname === '/') {
    return NextResponse.next()
  }

  for (const path of PUBLIC_PATHS) {
    if (pathname === path || pathname.startsWith(path + '/')) {
      return NextResponse.next()
    }
  }

  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return NextResponse.next()
    }
  }

  const token = request.cookies.get('token')?.value

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, message: '未登录，请先登录' },
        { status: 401 }
      )
    }

    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const JWT_SECRET = process.env.JWT_SECRET || 'aimarketing-secret-key-2024'
  const payload = verifyJWT(token, JWT_SECRET)

  if (!payload) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, message: '无效的登录状态，请重新登录' },
        { status: 401 }
      )
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('X-User-Id', payload.userId.toString())
  requestHeaders.set('X-User-Role', payload.role)

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon).*)',
  ],
}