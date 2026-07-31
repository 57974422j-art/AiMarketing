import { NextResponse } from 'next/server'

/**
 * GET /api/stickers/search?q=鼓掌
 * GIPHY 贴纸搜索代理，返回 GIF 贴纸列表
 * 通过 OVERSEAS_PROXY 环境变量指定 CF Worker 代理地址
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const q = url.searchParams.get('q') || ''
    const limit = parseInt(url.searchParams.get('limit') || '8')

    if (!q.trim()) {
      return NextResponse.json({ success: false, message: '请输入搜索词' }, { status: 400 })
    }

    const apiKey = process.env.GIPHY_API_KEY
    if (!apiKey) {
      return NextResponse.json({ success: false, message: 'GIPHY API Key 未配置' }, { status: 400 })
    }

    const giphyUrl = `https://api.giphy.com/v1/stickers/search?api_key=${apiKey}&q=${encodeURIComponent(q)}&limit=${limit}&lang=zh`
    const proxy = process.env.OVERSEAS_PROXY
    const fetchUrl = proxy ? `${proxy}?url=${encodeURIComponent(giphyUrl)}` : giphyUrl

    const res = await fetch(fetchUrl)
    if (!res.ok) {
      return NextResponse.json({ success: false, message: `GIPHY 返回 HTTP ${res.status}` }, { status: 500 })
    }

    const data = await res.json()
    const stickers = (data.data || []).map((s: any) => ({
      id: s.id,
      url: s.images?.downsized?.url || s.images?.original?.url || '',
      thumb: s.images?.preview_gif?.url || s.images?.fixed_height_small?.url || '',
      title: s.title || '',
    })).filter((s: any) => s.url)

    return NextResponse.json({ success: true, total: stickers.length, data: stickers })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: `搜索失败: ${e.message}` }, { status: 500 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
