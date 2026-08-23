import { NextRequest, NextResponse } from 'next/server'

// 2026-08-23: 客户端浏览器登录态上报——agent 页把本地检测的登录平台 POST 上来，AI 发布前可查
import { setBrowserStatus, getBrowserStatus } from '@/lib/browser-status'

function getUserId(req: NextRequest): number | null {
  try {
    const token = req.cookies.get('token')?.value
    if (!token) return null
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return payload.userId || null
  } catch { return null }
}

// POST  { accounts: [{id,name,loggedIn}] }
export async function POST(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  try {
    const body = await req.json()
    const accounts = Array.isArray(body?.accounts) ? body.accounts : []
    setBrowserStatus(userId, accounts)
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ success: false }, { status: 400 }) }
}

// GET → { accounts: [{id,name,loggedIn}] }（AI/前端查）
export async function GET(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })
  return NextResponse.json({ success: true, accounts: getBrowserStatus(userId) })
}
