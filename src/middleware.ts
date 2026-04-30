import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

const API_WHITELIST = ['/api/auth/login', '/api/auth/register']

function verifyJWT(token: string, secret: string): { userId: number; username: string; role: string; teamId: number | null } | null {
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

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  if (API_WHITELIST.includes(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get('token')?.value

  if (!token) {
    return NextResponse.json(
      { success: false, message: '未登录，请先登录' },
      { status: 401 }
    )
  }

  const JWT_SECRET = process.env.JWT_SECRET || 'aimarketing-secret-key-2024'
  const payload = verifyJWT(token, JWT_SECRET)

  if (!payload) {
    return NextResponse.json(
      { success: false, message: '无效的登录状态，请重新登录' },
      { status: 401 }
    )
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('X-User-Id', payload.userId.toString())
  requestHeaders.set('X-User-Role', payload.role)
  requestHeaders.set('X-User-Team-Id', payload.teamId?.toString() || '')

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

export const config = {
  matcher: ['/api/:path*'],
}