import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 })

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) {
      console.error('[ProxyDownload] fetch 失败:', url.substring(0, 80), 'status:', res.status)
      return NextResponse.json({ error: `下载失败，远程服务器返回 ${res.status}` }, { status: 502 })
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const buffer = await res.arrayBuffer()
    const isVideo = contentType.startsWith('video/')
    const ext = isVideo ? 'mp4' : 'png'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="download-${Date.now()}.${ext}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (e: any) {
    console.error('[ProxyDownload] 异常:', e?.message || e)
    return NextResponse.json({ error: `下载代理错误: ${e?.message || '未知错误'}` }, { status: 502 })
  }
}
