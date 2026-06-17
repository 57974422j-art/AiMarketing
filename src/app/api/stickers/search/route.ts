import { NextResponse } from 'next/server'

/**
 * GET /api/stickers/search?q=鼓掌
 * GIPHY 贴纸搜索代理，返回 GIF 贴纸列表
 * 支持 GIPHY_PROXY 环境变量（国内服务器需配置代理访问 GIPHY）
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
      return NextResponse.json({
        success: false,
        message: 'GIPHY API Key 未配置，请在管理后台设置中配置',
      }, { status: 400 })
    }

    const giphyUrl = `https://api.giphy.com/v1/stickers/search?api_key=${apiKey}&q=${encodeURIComponent(q)}&limit=${limit}&lang=zh`

    // 代理支持（国内服务器需科学上网）
    const proxy = process.env.GIPHY_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy
    let fetchOpts: any = {}
    if (proxy) {
      try {
        const { ProxyAgent } = await import('undici')
        fetchOpts.dispatcher = new ProxyAgent(proxy)
      } catch { /* undici 不可用，直连 */ }
    }

    const res = await fetch(giphyUrl, fetchOpts)
    if (!res.ok) {
      return NextResponse.json({
        success: false,
        message: `GIPHY API 返回异常: HTTP ${res.status}`,
      }, { status: 500 })
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
