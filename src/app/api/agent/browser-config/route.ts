import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic' // 2026-08-29: 防预渲染（GET 无 request→headers in undefined）
import { getAuthFromHeaders } from '@/lib/api-auth'

/** 客户端 browser-use 执行器取 DASHSCOPE key（admin）——spawn Python 用 */
export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  return NextResponse.json({ success: true, data: { dashscopeKey: process.env.DASHSCOPE_API_KEY || '' } })
}
