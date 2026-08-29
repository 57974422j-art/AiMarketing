import { NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

/** 客户端 browser-use 执行器取 DASHSCOPE key（admin）——spawn Python 用 */
export async function GET() {
  const auth = getAuthFromHeaders()
  if (!auth?.userId || auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  return NextResponse.json({ success: true, data: { dashscopeKey: process.env.DASHSCOPE_API_KEY || '' } })
}
