import { NextResponse } from 'next/server'
import { get as httpsGet } from 'https'

/**
 * GET /api/stickers/search?q=鼓掌
 * GIPHY 贴纸搜索代理，返回 GIF 贴纸列表
 * 国内服务器需配置 HTTPS_PROXY 代理环境变量
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

    // 使用 https 原生模块（自动读取 HTTPS_PROXY 环境变量）
    const data = await new Promise<any>((resolve, reject) => {
      httpsGet(giphyUrl, (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => { body += chunk.toString() })
        res.on('end', () => {
          try { resolve(JSON.parse(body)) }
          catch (e) { reject(new Error(`解析失败: HTTP ${res.statusCode}`)) }
        })
      }).on('error', reject)
    })

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
