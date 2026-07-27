import type { NextApiRequest } from 'next'

export interface AuthUser {
  userId: number
  role: string
  teamId: number | null
}

export function getAuthFromHeaders(request: Request | NextApiRequest): AuthUser | null {
  let headers: Headers

  if ('headers' in request && request.headers instanceof Headers) {
    headers = request.headers
  } else if ('headers' in request && typeof request.headers === 'object') {
    headers = new Headers(request.headers as Record<string, string>)
  } else {
    return null
  }

  const userIdStr = headers.get('X-User-Id')
  const role = headers.get('X-User-Role')
  const teamIdStr = headers.get('X-User-Team-Id')

  if (!userIdStr || !role) {
    return null
  }

  const userId = parseInt(userIdStr, 10)
  const teamId = teamIdStr ? parseInt(teamIdStr, 10) : null

  if (isNaN(userId)) {
    return null
  }

  return { userId, role, teamId }
}

/**
 * 从登录 Cookie（token，JWT）解析当前用户。
 * 用于 middleware 白名单路径（如 /api/subscription/*），这些路径不会被注入 X-User-Id 头，
 * 因此不能依赖 getAuthFromHeaders，必须直接读 cookie。
 */
export function getAuthFromCookie(request: Request | NextApiRequest): AuthUser | null {
  let cookie = ''
  if (request && 'headers' in request) {
    const h = request.headers as any
    cookie = typeof h.get === 'function' ? (h.get('cookie') || '') : (h.cookie || '')
  }
  if (!cookie) return null

  const m = cookie.match(/(?:^|;\s*)token=([^;]+)/)
  const token = m?.[1]
  if (!token) return null

  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
    const userId = Number(payload.userId)
    if (!userId || !payload.role) return null
    return { userId, role: payload.role, teamId: (payload.teamId as number) ?? null }
  } catch {
    return null
  }
}