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
  '/api/admin/industry-videos/upload', // 2026-08-10：本机脚本上传行业视频（路由内已校验本机/admin）
  '/api/agent/hotspots', // 2026-08-11：热点是公开榜单数据，免登录可看 + 自检可验证（避免 401 误报 0 来源）
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

// 2026-08-05 修复 ISSUES #1：Edge Runtime 下用 Web Crypto (HMAC-SHA256) 校验 JWT 签名，
// 与 src/app/api/auth/login/route.ts 的 createHmac('sha256', secret) 签发逻辑完全对应。
// 2026-08-07：兼容 Authorization Bearer header（Electron 客户端无 cookie，走 header 鉴权）
function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m ? m[1] : null
}

function base64UrlToBytes(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padding = base64.length % 4
  if (padding) base64 += '='.repeat(4 - padding)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function verifyJWTSignature(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const [header, payload, signature] = parts
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    return await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(signature),
      encoder.encode(header + '.' + payload),
    )
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  // 2026-08-12 #1: 代理模式（客户端 standalone，API_TARGET 设置）本地不验签——
  // 请求全部代理到服务器，由服务器 middleware 验签（避免客户端无 JWT_SECRET 401 / secret 泄露进客户端包）
  if (process.env.API_TARGET) return NextResponse.next()

  const { pathname } = request.nextUrl

  if (!pathname.startsWith('/api/')) return NextResponse.next()

  // 精确匹配：Electron 下载素材端点（自带 userId 参数鉴权），不拦截
  if (pathname === '/api/storage/file') return NextResponse.next()

  if (API_WHITELIST.some(path => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  let token = getBearerToken(request)
  if (!token) {
    token = request.cookies.get('token')?.value || null
  }
  if (!token) {
    return NextResponse.json({ success: false, message: '未登录，请先登录' }, { status: 401 })
  }

  const payload = decodeJWT(token)
  if (!payload) {
    return NextResponse.json({ success: false, message: '无效的登录状态，请重新登录' }, { status: 401 })
  }

  // JWT HS256 验签（2026-08-05）：防止伪造 token 提权；密钥与 login/route.ts 一致
  const JWT_SECRET = process.env.JWT_SECRET // 2026-08-12 #1: 去硬编码 fallback，必须显式配置
  const signatureValid = await verifyJWTSignature(token, JWT_SECRET)
  if (!signatureValid) {
    return NextResponse.json({ success: false, message: '登录状态无效，请重新登录' }, { status: 401 })
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
