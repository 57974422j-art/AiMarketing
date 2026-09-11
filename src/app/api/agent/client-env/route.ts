import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

/**
 * 客户端发布运行环境上报/读取（2026-09-10）
 * ★修正：环境是【机器级】的，与账号无关——之前按 userId 存，导致换账号后读不到 → 误报"环境未就绪"
 *   现在：按 userId 存 + 保留"最近一次上报"作兜底（换账号也能读到本机环境）
 * 存储：进程内存（standalone 单进程；服务器重启丢，客户端启动/定期会重新上报）
 */
const g = globalThis as any
if (!g.__clientEnv) g.__clientEnv = { byUser: new Map<number, any>(), last: null }

export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const info = { ...b, updatedAt: Date.now() }
  try {
    g.__clientEnv.byUser.set(auth.userId, info)
    g.__clientEnv.last = info
  } catch (e) {
    g.__clientEnv = { byUser: new Map<number, any>(), last: info }
    g.__clientEnv.byUser.set(auth.userId, info)
  }
  return NextResponse.json({ success: true })
}

export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  const mine = g.__clientEnv?.byUser?.get?.(auth.userId) || null
  // 换账号后本账号可能没上报过 → 回退到"最近一次客户端上报"（同机环境相同）
  return NextResponse.json({ success: true, data: mine || g.__clientEnv?.last || null })
}
