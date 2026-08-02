import { NextRequest, NextResponse } from 'next/server'

// 今日热点接口（融合 BaiLongma 热点推荐：多源聚合，免 key，本地缓存 1 小时）
// 取法参考 BaiLongma trending.js / hotspots.js：中国热榜走 vvhan 聚合 + 全球走 HackerNews/Reddit，
// 多源容错，单个源失败不影响其他。

export const dynamic = 'force-dynamic'

type HotItem = { title: string; hot?: string }
type HotSource = { source: string; items: HotItem[] }

// 主源：vvhan 聚合（中国热榜）
const VVHAN: { source: string; url: string }[] = [
  { source: '微博', url: 'https://api.vvhan.com/api/hotlist/wbHot' },
  { source: '抖音', url: 'https://api.vvhan.com/api/hotlist/douyinHot' },
  { source: '知乎', url: 'https://api.vvhan.com/api/hotlist/zhihuHot' },
  { source: '小红书', url: 'https://api.vvhan.com/api/hotlist/xiaohongshu' },
  { source: '今日头条', url: 'https://api.vvhan.com/api/hotlist/toutiao' },
  { source: '百度热搜', url: 'https://api.vvhan.com/api/hotlist/baiduRD' },
]

// 全球源：HackerNews 官方 API（免 key）
async function fetchHackerNews(): Promise<HotItem[]> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 6000)
    const r = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) return []
    const ids: number[] = await r.json()
    const top = ids.slice(0, 10)
    const items = await Promise.all(
      top.map(async (id) => {
        try {
          const c = new AbortController()
          const ct = setTimeout(() => c.abort(), 4000)
          const ir = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { signal: c.signal })
          clearTimeout(ct)
          if (!ir.ok) return null
          const d = await ir.json()
          return d?.title ? { title: String(d.title) } : null
        } catch { return null }
      })
    )
    return items.filter(Boolean) as HotItem[]
  } catch { return [] }
}

// 全球源：Reddit 公开 JSON（免 key）
async function fetchReddit(): Promise<HotItem[]> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 6000)
    const r = await fetch('https://www.reddit.com/r/all/hot.json?limit=10', {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'AiMarketing/1.0' },
    })
    clearTimeout(t)
    if (!r.ok) return []
    const d = await r.json()
    const list: any[] = d?.data?.children || []
    return list
      .map((c: any) => c?.data?.title)
      .filter(Boolean)
      .slice(0, 10)
      .map((title: string) => ({ title: String(title) }))
  } catch { return [] }
}

async function fetchVvhan(src: string, url: string): Promise<HotItem[]> {
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
  } catch { return [] }
}

// 内存缓存（单进程内 1 小时有效；与 BaiLongma hotspot 缓存策略一致）
let cache: { at: number; data: HotSource[] } | null = null
const TTL = 60 * 60 * 1000

export async function GET(request: NextRequest) {
  try {
    const now = Date.now()
    if (cache && now - cache.at < TTL) {
      return NextResponse.json({ success: true, sources: cache.data, cached: true })
    }

    // 并行抓取：国内 vvhan 多平台 + 全球 HackerNews/Reddit
    const vvhanResults = await Promise.all(VVHAN.map((e) => fetchVvhan(e.source, e.url)))
    const [hn, reddit] = await Promise.all([fetchHackerNews(), fetchReddit()])

    const sources: HotSource[] = [
      ...VVHAN.map((e, i) => ({ source: e.source, items: vvhanResults[i] })),
      { source: 'HackerNews', items: hn },
      { source: 'Reddit', items: reddit },
    ].filter((s) => s.items.length > 0)

    cache = { at: now, data: sources }
    return NextResponse.json({ success: true, sources, cached: false })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
