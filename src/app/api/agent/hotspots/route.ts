import { NextRequest, NextResponse } from 'next/server'

// 今日热点接口（融合 BaiLongma 热点推荐：真实热榜聚合，免 key，本地缓存 1 小时）
// 取法参考 BaiLongma hotspot.js / trending.js：中国热榜走 vvhan 聚合 API，多源容错。

export const dynamic = 'force-dynamic'

type HotItem = { title: string; hot?: string }
type HotSource = { source: string; items: HotItem[] }

// 各平台对应的热榜端点（主源 vvhan，附备选源，多源容错）
const ENDPOINTS: { source: string; url: string }[] = [
  { source: '微博', url: 'https://api.vvhan.com/api/hotlist/wbHot' },
  { source: '抖音', url: 'https://api.vvhan.com/api/hotlist/douyinHot' },
  { source: '知乎', url: 'https://api.vvhan.com/api/hotlist/zhihuHot' },
  { source: '小红书', url: 'https://api.vvhan.com/api/hotlist/xiaohongshu' },
]

// 备选源：BaiLongma 同款容错思路，主源失败自动尝试
const FALLBACKS: { source: string; url: string }[] = [
  { source: '今日头条', url: 'https://api.vvhan.com/api/hotlist/toutiao' },
  { source: '百度热搜', url: 'https://api.vvhan.com/api/hotlist/baiduRD' },
]

// 内存缓存（单进程内 1 小时有效；与 BaiLongma hotspot 缓存策略一致）
let cache: { at: number; data: HotSource[] } | null = null
const TTL = 60 * 60 * 1000

async function fetchOne(src: string, url: string): Promise<HotItem[]> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 6000)
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } })
    clearTimeout(t)
    if (!r.ok) return []
    const d = await r.json()
    const list: any[] = d?.data?.list || d?.data || []
    return (Array.isArray(list) ? list : [])
      .slice(0, 12)
      .map((it: any) => ({
        title: String(it.title || it.word || it.name || '').trim(),
        hot: it.hot ? String(it.hot) : undefined,
      }))
      .filter((it: HotItem) => it.title)
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  try {
    const now = Date.now()
    if (cache && now - cache.at < TTL) {
      return NextResponse.json({ success: true, sources: cache.data, cached: true })
    }
    const results = await Promise.all(ENDPOINTS.map((e) => fetchOne(e.source, e.url)))
    let sources: HotSource[] = ENDPOINTS.map((e, i) => ({
      source: e.source,
      items: results[i],
    })).filter((s) => s.items.length > 0)

    // 主源凑不够 3 个，用备选源补足
    if (sources.length < 3) {
      const fbResults = await Promise.all(FALLBACKS.map((e) => fetchOne(e.source, e.url)))
      const fbSources: HotSource[] = FALLBACKS.map((e, i) => ({
        source: e.source,
        items: fbResults[i],
      })).filter((s) => s.items.length > 0)
      sources = [...sources, ...fbSources].slice(0, 4)
    }

    cache = { at: now, data: sources }
    return NextResponse.json({ success: true, sources, cached: false })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
