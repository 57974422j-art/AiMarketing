import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

/**
 * Google 搜索（Serper）— 2026-08-07
 * POST /api/agent/search  body { q, type?: 'web'|'videos'|'news', num?: 5 }
 * 语音/文字呼出：「帮我搜XX」「找XX视频」「看看XX新闻」
 */
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  const key = process.env.SERPER_API_KEY
  if (!key) return NextResponse.json({ success: false, message: '未配置 SERPER_API_KEY（admin 设置页填写）' }, { status: 400 })

  try {
    const { q, type = 'web', num = 5 } = await request.json()
    if (!q || typeof q !== 'string') return NextResponse.json({ success: false, message: '缺少搜索词' }, { status: 400 })

    const hasCJK = /[\u4e00-\u9fff]/.test(q)
    const body: Record<string, any> = {
      q: q.slice(0, 200),
      num: Math.min(10, Math.max(1, num)),
      hl: hasCJK ? 'zh-cn' : 'en',
      gl: hasCJK ? 'cn' : 'us',
    }
    if (type === 'videos' || type === 'news') body.type = type

    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return NextResponse.json({ success: false, message: `Serper HTTP ${res.status}，请检查 API Key` }, { status: 502 })
    const data = await res.json()

    if (type === 'videos') {
      const items = (data.videos || []).slice(0, num).map((v: any) => ({
        title: v.title || '', url: v.link || '', thumbnail: v.thumbnail || '', channel: v.channel || '',
        duration: v.duration || '', views: v.views || '', date: v.date || '',
      }))
      return NextResponse.json({ success: true, data: { type, items } })
    }
    if (type === 'news') {
      const items = (data.news || []).slice(0, num).map((n: any) => ({
        title: n.title || '', url: n.link || '', snippet: n.snippet || '', date: n.date || '', source: n.source || '',
      }))
      return NextResponse.json({ success: true, data: { type, items } })
    }
    const items = (data.organic || []).slice(0, num).map((r: any) => ({
      title: r.title || '', url: r.link || '', snippet: r.snippet || '',
    }))
    return NextResponse.json({ success: true, data: { type: 'web', items } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
