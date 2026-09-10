import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

/**
 * 客户端发布运行环境上报/读取（2026-09-10）
 * 客户端启动自检后 POST 上报（Python 版本/路径、playwright、browser_use、是否就绪）
 * AGENT 自检弹窗 GET 读取展示
 * 存储：进程内存（standalone 单进程；服务器重启丢，客户端启动会重新上报）
 */
const g = globalThis as any
if (!g.__clientEnv) g.__clientEnv = new Map<number, any>()

export async function POST(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  g.__clientEnv.set(auth.userId, { ...b, updatedAt: Date.now() })
  return NextResponse.json({ success: true })
}

export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  return NextResponse.json({ success: true, data: g.__clientEnv.get(auth.userId) || null })
}
