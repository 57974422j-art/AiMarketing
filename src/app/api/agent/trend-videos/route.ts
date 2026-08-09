import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

/**
 * 视频推荐（2026-08-08，大屏右柱 + 视频事件流）
 * GET /api/agent/trend-videos → 每平台 1-3 条视频（TikTok/YouTube/X）
 * Serper videos 搜索，内存缓存 24h（省免费额度，每日刷新一次）
 */
let videoCache: { at: number; data: any[] } | null = null
const TTL = 24 * 60 * 60 * 1000

const PLATFORMS = [
  { key: 'TikTok', q: 'site:tiktok.com viral video trending' },
  { key: 'YouTube', q: 'site:youtube.com trending video shorts' },
  { key: 'X(Twitter)', q: 'site:x.com video viral' },
]

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  const key = process.env.SERPER_API_KEY
  // 2026-08-09：无 key 不报 400（前端大屏会崩溃）——返回空，前端显示"未配置"提示
  if (!key) return NextResponse.json({ success: true, data: { videos: [], cached: false, message: '未配置 SERPER_API_KEY（后台设置页添加）' } })

  try {
    const now = Date.now()
    if (videoCache && now - videoCache.at < TTL) {
      return NextResponse.json({ success: true, data: { videos: videoCache.data, cached: true, refreshedAt: new Date(videoCache.at).toISOString() } })
    }

    const results = await Promise.all(PLATFORMS.map(async (p) => {
      try {
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: p.q, num: 6, type: 'videos', hl: 'en', gl: 'us' }),
          signal: AbortSignal.timeout(15000),
        })
        if (!r.ok) return { platform: p.key, videos: [] }
        const d = await r.json()
        const videos = (d.videos || []).slice(0, 3).map((v: any) => ({
          title: v.title || '', url: v.link || '', thumbnail: v.thumbnail || '',
          duration: v.duration || '', channel: v.channel || '', views: v.views || '',
        }))
        return { platform: p.key, videos }
      } catch { return { platform: p.key, videos: [] } }
    }))

    const videos = results.flatMap(r => r.videos.map(v => ({ ...v, platform: r.platform })))
    videoCache = { at: now, data: videos }
    return NextResponse.json({ success: true, data: { videos, cached: false, refreshedAt: new Date(now).toISOString() } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
