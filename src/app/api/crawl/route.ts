import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

// 2026-08-13: crawl4ai 代理——Agent 网页抓取工具的后端
// 转发到服务器本地 crawl4ai 容器（127.0.0.1:11235），登录用户可用
const CRAWL4AI_URL = process.env.CRAWL4AI_URL || 'http://127.0.0.1:11235'
const CRAWL4AI_TOKEN = process.env.CRAWL4AI_API_TOKEN || ''

export const dynamic = 'force-dynamic'

async function callCrawl4ai(url: string, mode: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (CRAWL4AI_TOKEN) headers['Authorization'] = `Bearer ${CRAWL4AI_TOKEN}`
    // 简单模式：同步 /crawl
    const r = await fetch(`${CRAWL4AI_URL}/crawl`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ urls: [url], priority: 10, max_depth: 1, verbose: false }),
      signal: AbortSignal.timeout(60000),
    })
    if (!r.ok) return { ok: false, error: `crawl4ai HTTP ${r.status}` }
    const d = await r.json()
    const first = Array.isArray(d?.results) ? d.results[0] : null
    const md = first?.markdown || first?.cleaned_html || ''
    return { ok: true, data: { markdown: String(md).substring(0, 50000), title: first?.metadata?.title || '', url } }
  } catch (e: any) {
    return { ok: false, error: `crawl4ai 调用失败: ${e?.message || e}` }
  }
}

// GET /api/crawl?url=xxx&mode=markdown
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
  const url = request.nextUrl.searchParams.get('url')
  if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ success: false, message: 'url 无效（仅 http/https）' }, { status: 400 })
  // 防 SSRF：拒绝内网/保留地址
  try {
    const host = new URL(url).hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || /^(10|127|0)\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) {
      return NextResponse.json({ success: false, message: '目标地址不允许访问' }, { status: 403 })
    }
  } catch { return NextResponse.json({ success: false, message: 'url 无效' }, { status: 400 }) }
  const mode = request.nextUrl.searchParams.get('mode') || 'markdown'
  const r = await callCrawl4ai(url, mode)
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 502 })
  return NextResponse.json({ success: true, data: r.data })
}

// POST /api/crawl  {url, mode}
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
  let body: any = {}
  try { body = await request.json() } catch {}
  const url = (body.url || '').trim()
  if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ success: false, message: 'url 无效' }, { status: 400 })
  const r = await callCrawl4ai(url, body.mode || 'markdown')
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 502 })
  return NextResponse.json({ success: true, data: r.data })
}
