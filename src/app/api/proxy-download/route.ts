import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

// 2026-08-12 #4: 登录 + 防 SSRF（拒绝内网/保留地址/非 http(s)）
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local')) return true
  // IPv4 内网段
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [parseInt(m[1]), parseInt(m[2])]
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
  }
  return false
}

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth?.userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const url = request.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 })
  let parsed: URL
  try { parsed = new URL(url) } catch { return NextResponse.json({ error: 'URL 无效' }, { status: 400 }) }
  if (!['http:', 'https:'].includes(parsed.protocol)) return NextResponse.json({ error: '仅支持 http/https' }, { status: 400 })
  if (isBlockedHost(parsed.hostname)) return NextResponse.json({ error: '目标地址不允许访问' }, { status: 403 })

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

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
