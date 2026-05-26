import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') || ''
  const count = parseInt(request.nextUrl.searchParams.get('count') || '5')
  if (!q) return NextResponse.json({ success: false, message: '缺少搜索词' }, { status: 400 })

  try {
    const url = `https://duckduckgo.com/i.js?q=${encodeURIComponent(q)}&o=json&p=1&s=0&f=,,,&vqd=`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    })
    const data = await res.json()
    const images = (data.results || []).slice(0, count).map((r: any) => ({
      url: r.image,
      thumb: r.thumbnail,
      title: r.title,
    }))

    return NextResponse.json({ success: true, data: images })
  } catch (e: any) {
    console.error('search-images error:', e)
    return NextResponse.json({ success: false, error: e.message })
  }
}
