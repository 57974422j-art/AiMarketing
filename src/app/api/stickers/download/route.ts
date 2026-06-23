import { NextResponse } from 'next/server'

/**
 * GET /api/stickers/download?url=ENCODED_GIF_URL
 * 代理下载 GIPHY GIF 文件（走 OVERSEAS_PROXY），返回图片二进制
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const target = url.searchParams.get('url')
    if (!target) return NextResponse.json({ success: false, message: 'Missing ?url=' }, { status: 400 })

    const proxy = process.env.OVERSEAS_PROXY
    const fetchUrl = proxy ? `${proxy}?url=${encodeURIComponent(target)}` : target

    const res = await fetch(fetchUrl)
    if (!res.ok) {
      return NextResponse.json({ success: false, message: `下载失败: HTTP ${res.status}` }, { status: 500 })
    }

    const contentType = res.headers.get('content-type') || 'image/gif'
    const buffer = await res.arrayBuffer()

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: `下载失败: ${e.message}` }, { status: 500 })
  }
}
