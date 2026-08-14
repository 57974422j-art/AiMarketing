import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { generateMusic } from '@/lib/minimax-music'

// POST /api/music/generate - AI 生成背景音乐（Minimax music-3.0）
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请登录' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const prompt = String(body?.prompt || '').trim()
    if (!prompt) return NextResponse.json({ success: false, message: '请输入音乐风格描述（如：欢快的电子音乐背景乐）' }, { status: 400 })
    if (prompt.length > 2000) return NextResponse.json({ success: false, message: '描述过长（≤2000 字符）' }, { status: 400 })
    const result = await generateMusic(prompt)
    if (!result.ok) {
      return NextResponse.json({
        success: false,
        message: result.error || '生成失败',
        needsPayment: result.needsPayment || false,
      }, { status: result.needsPayment ? 402 : 500 })
    }
    return NextResponse.json({ success: true, url: result.url, poweredBy: 'Minimax music-3.0' })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || '生成失败' }, { status: 500 })
  }
}

export const runtime = 'nodejs'
