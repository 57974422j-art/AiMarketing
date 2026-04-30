import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const API_WHITELIST = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/ai-copy',
  '/api/video',
  '/api/ai-agent/generate',
  '/api/ai-agent',
  '/api/projects',
  '/api/projects/create-with-ai'
]

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padding = base64.length % 4
  if (padding) {
    base64 += '='.repeat(4 - padding)
  }
  return atob(base64)
}

function verifyJWT(token: string, secret: string): { userId: number; username: string; role: string; teamId: number | null } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    
    const payload = JSON.parse(base64UrlDecode(parts[1]))
    return payload
  } catch {
    return null
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  if (API_WHITELIST.some(path => pathname.startsWith(path))) {
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