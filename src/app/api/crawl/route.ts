import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

// 2026-08-13: crawl4ai 代理——Agent 网页抓取工具的后端
// 转发到服务器本地 crawl4ai 容器（127.0.0.1:11235），登录用户可用
const CRAWL4AI_URL = process.env.CRAWL4AI_URL || 'http://127.0.0.1:11235'
const CRAWL4AI_TOKEN = process.env.CRAWL4AI_API_TOKEN || ''

export const dynamic = 'force-dynamic'

import { crawlWeb, isBlockedCrawlUrl } from '@/lib/crawl4ai'


// GET /api/crawl?url=xxx&mode=markdown
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
  const url = request.nextUrl.searchParams.get('url')
  if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ success: false, message: 'url 无效（仅 http/https）' }, { status: 400 })
  // 防 SSRF：拒绝内网/保留地址
  if (isBlockedCrawlUrl(url)) return NextResponse.json({ success: false, message: '目标地址不允许访问' }, { status: 403 })
  const mode = request.nextUrl.searchParams.get('mode') || 'markdown'
  const r = await crawlWeb(url)
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 502 })
  return NextResponse.json({ success: true, data: r })
}

// POST /api/crawl  {url, mode}
export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
  let body: any = {}
  try { body = await request.json() } catch {}
  const url = (body.url || '').trim()
  if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ success: false, message: 'url 无效' }, { status: 400 })
  const r = await crawlWeb(url)
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 502 })
  return NextResponse.json({ success: true, data: r })
}
