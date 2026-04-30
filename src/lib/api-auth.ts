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