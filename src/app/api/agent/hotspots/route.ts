import { NextRequest, NextResponse } from 'next/server'
// ★TOPIC_SEARCH_V1：热点接口在 middleware 白名单里（免登录），所以要自己从 cookie 解析用户
import { getAuthFromCookie } from '@/lib/api-auth'

// 今日热点接口（融合 BaiLongma 热点推荐：多源聚合，免 key，本地缓存 1 小时）
// 取法参考 BaiLongma trending.js / hotspots.js：中国热榜走免 key 聚合 + 全球走 HackerNews/Reddit，
// 多源容错，单个源失败不影响其他。

export const dynamic = 'force-dynamic'

type HotItem = { title: string; hot?: string; url?: string }
type HotSource = { source: string; region: 'cn' | 'global'; items: HotItem[]; fetchedAt?: number }

// 主源：免 key 聚合（hot-api.vhan.eu.org/v2?type=all，一次拿全部榜单）——2026-08-11：vvhan 官方接口已失效，彻底清除
const CN_SOURCES = ['微博', '抖音', '知乎', '小红书', '今日头条', '百度热搜', 'B站', '快手', '36氪', '网易', '虎扑']

// 2026-09-13: FALLBACK 假数据【已删除】
//   原来：所有源失败时返回写死的假热点（用户看到「3 个月不变」就是这个）
//   现在：抓不到就【不显示该源】——宁可少，也不造假

// 2026-09-13: 国内源改造——服务器可直调的（实测 200；微博/B站等需 cookie 的改由客户端采集上报）
const HOT_UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }

/** 今日头条热榜（服务器直调） */
async function fetchToutiao(): Promise<HotItem[]> {
  try {
    const r = await fetch('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', {
      headers: HOT_UA, signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return []
    const d = await r.json()
    return ((d?.data as any[]) || []).slice(0, 12).map((it, i) => ({
      title: String(it?.Title || '').trim(),
      hot: it?.HotValue ? String(it.HotValue) : undefined,
      rank: i + 1,
    })).filter((it) => it.title)
  } catch { return [] }
}

/** 百度热搜（服务器直调） */
async function fetchBaidu(): Promise<HotItem[]> {
  try {
    const r = await fetch('https://top.baidu.com/api/board?platform=wise&tab=realtime', {
      headers: HOT_UA, signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return []
    const d = await r.json()
    const cards = (d?.data?.cards as any[]) || []
    // 2026-09-13 修：百度返回多包了一层——真正列表在 cards[0].content[0].content
    //   原来取 cards[0].content → 只有 1 个元素且无 query/word 字段 → 被过滤 → 百度榜全空
    const lvl1 = (cards[0]?.content as any[]) || []
    const items = ((lvl1[0]?.content as any[]) || (Array.isArray(cards[0]?.content) && !lvl1[0]?.content ? lvl1 : []))
    return items.slice(0, 12).map((it, i) => ({
      title: String(it?.query || it?.word || '').trim(),
      hot: it?.hotScore ? String(it.hotScore) : undefined,
      rank: i + 1,
    })).filter((it) => it.title)
  } catch { return [] }
}

// 全球源：HackerNews 官方 API（免 key）
// tophub.today 次级兜底（首页解析板块 → 详情页解析榜单）
let tophubNodes: { name: string; id: string }[] | null = null
async function fetchTophub(source: string): Promise<HotItem[] | null> {
  try {
    const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    // 1) 首页解析板块 id（缓存）
    if (!tophubNodes) {
      const home = await (await fetch('https://tophub.today/', { headers: UA, signal: AbortSignal.timeout(15000) })).text()
      // tophub 渲染怪癖：href 的 id 属于"上一个"板块（名在前、id 在后，错位一位）
      const names = [...home.matchAll(/zb-kc-Cb">([^<]+)<span>([^<]+)<\/span>/g)].map((m) => m[1] + m[2])
      const ids = [...home.matchAll(/href="\/n\/([A-Za-z0-9]+)"/g)].map((m) => m[1])
      tophubNodes = names.map((n, i) => ({ name: n, id: ids[i + 1] || '' })).filter((n) => n.id)
    }
    // 模糊匹配：板块名与源名前 2 字匹配（"百度热搜"↔"百度实时热点"、"抖音"↔"抖音总榜"）
    const key = source.slice(0, 2)
    const node = tophubNodes?.find((n) => n.name.includes(key))
    if (!node) return null
    // 2) 详情页解析榜单（tr 行：排名/标题/热度）
    const page = await (await fetch(`https://tophub.today/n/${node.id}`, { headers: UA, signal: AbortSignal.timeout(15000) })).text()
    const rows = page.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || []
    const items: HotItem[] = []
    for (const row of rows.slice(1, 13)) {
      // 列结构不固定（微博=[排名,标题,热度]；百度/抖音=[排名,空,标题+热度]）→ 取非排名非 icon 的最长文本为标题
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1].replace(/<[^>]+>/g, ' ').replace(/&\#x?\w+;/g, '').replace(/\s+/g, ' ').trim())
      const cands = cells.filter((t) => t && !/^\d+[.、]?$/.test(t) && !/^\d+(\.\d+)?[万亿]?$/.test(t))
      if (!cands.length) continue
      const title = cands.reduce((a, b) => (b.length > a.length ? b : a), cands[0]).slice(0, 60)
      const hotM = title.match(/(\d+(\.\d+)?[万亿]?)$/)
      items.push({ title, hot: hotM ? hotM[1] : undefined })
    }
    return items.length ? items : null
  } catch (e: any) { console.log('[Tophub]', source, '抓取失败:', e?.message?.slice(0, 60)); return null }
}

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

// 2026-09-13: fetchVhanAll【已删除】——hot-api.vhan.eu.org 能返回 200 但数据停在 2025-04-08（僵尸源）



// 2026-09-13: 客户端采集上报的缓存（微博/B站/抖音/小红书/快手）
//   客户端每天首次启动时采集 → POST /api/agent/hotspot-report → 落到此文件
const REPORT_FILE = '/root/AiMarketing/data/hotspot-report.json'

async function getReportedSources(): Promise<HotSource[]> {
  try {
    const fs = await import('node:fs/promises')
    const raw = await fs.readFile(REPORT_FILE, 'utf-8')
    const d = JSON.parse(raw)
    const list: HotSource[] = []
    const now = Date.now()
    for (const [k, v] of Object.entries(d || {})) {
      const vv: any = v
      if (!vv?.items?.length) continue
      // 超过 24 小时视为过期（不显示旧数据）
      if (vv.fetchedAt && now - Number(vv.fetchedAt) > 24 * 60 * 60 * 1000) continue
      list.push({ source: String(k), region: 'cn', items: vv.items, fetchedAt: Number(vv.fetchedAt) || undefined })
    }
    return list
  } catch {
    return []
  }
}

// 内存缓存（单进程内 1 小时有效；与 BaiLongma hotspot 缓存策略一致）
let cache: { at: number; data: HotSource[] } | null = null
const TTL = 60 * 60 * 1000

// ═══ ★TOPIC_SEARCH_V1（2026-09-16 第3批）：按用户画像里的主题去【搜索】热点 ═══
//   诉求：不再只推"大家都一样的总榜"，而是按用户关心的主题推（如 admin 的 AI）
//   主题来源：User.industry（主主题）+ AgentMemory 标签含 '画像,主题' 的「用户关注主题」
async function getUserKeywords(userId: number): Promise<string[]> {
  const kws: string[] = []
  try {
    const { PrismaClient } = await import('@prisma/client')
    const p = new PrismaClient()
    const u = await p.user.findUnique({ where: { id: userId }, select: { username: true, industry: true } })
    const username = u?.username || String(userId)
    if (u?.industry) kws.push(String(u.industry).trim())
    const ms = await p.agentMemory.findMany({
      where: { userId: username, tags: { contains: '画像,主题' } }, take: 5,
    })
    for (const m of ms) {
      String(m.content || '').replace(/^用户关注主题[：:]\s*/, '').split(/[,，、]/).forEach((x) => {
        const t = x.trim()
        if (t && !kws.includes(t)) kws.push(t)
      })
    }
    await p.$disconnect()
  } catch (e) {}
  return kws.filter(Boolean).slice(0, 4)
}

// 按关键词搜索（先用 HackerNews Algolia —— 服务器实测可访问、官方 API、JSON 好解析）
async function searchByKeywords(keywords: string[]): Promise<HotSource[]> {
  const ts = Date.now()
  const out: HotSource[] = []
  await Promise.all(keywords.slice(0, 4).map(async (kw) => {
    // ★TOPIC_GROUP_V1：中文关键词【跳过 HN】—— HN 是英文技术站，搜中文几乎没结果（用户实测"智能体"只出 1 条）
    //   中文主题等中文源（客户端已登录浏览器搜 微博/B站/抖音/快手）做好后再接
    if (/[\u4e00-\u9fa5]/.test(String(kw))) return
    try {
      const u = 'https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=8&query=' + encodeURIComponent(kw)
      const r = await fetch(u, { headers: { 'User-Agent': 'AiMarketing/1.0' }, signal: AbortSignal.timeout(12000) })
      if (!r.ok) return
      const d: any = await r.json()
      const items = (d.hits || [])
        .filter((h: any) => h && h.title)
        .slice(0, 8)
        .map((h: any, i: number) => ({
          title: String(h.title),
          hot: String(h.points ?? ''),
          url: h.url || ('https://news.ycombinator.com/item?id=' + h.objectID),
          rank: i + 1,
        }))
      if (items.length) out.push({ source: 'HN·' + kw, region: 'global', items, fetchedAt: ts })
    } catch (e) {}
  }))
  return out
}

// ★TOPIC_MERGE_FIX：把"按主题搜索 + 合并"抽出来 —— 缓存分支与正常分支都要调用
//   （原来只在正常分支做，导致命中 1h 缓存时主题源永远不出现）
async function withTopicSources(request: NextRequest, base: HotSource[]): Promise<HotSource[]> {
  try {
    const auth = getAuthFromCookie(request as any)
    if (auth?.userId) {
      const kws = await getUserKeywords(auth.userId)
      if (kws.length) {
        const topicSources = await searchByKeywords(kws)
        return [...topicSources, ...base]   // 主题结果排最前
      }
    }
  } catch (e) {}
  return base
}

export async function GET(request: NextRequest) {
  try {
    const now = Date.now()
    if (cache && now - cache.at < TTL) {
      // ★TOPIC_MERGE_FIX：缓存分支【也要】追加主题源（主题结果本身不进缓存）
      const merged = await withTopicSources(request, cache.data)
      return NextResponse.json({ success: true, sources: merged, cached: true })
    }

    const ts = Date.now()
    // 2026-09-13 改造：① 服务器直调【今日头条 + 百度热搜】（实测 200，秒级）
    //              ② 客户端采集上报（微博/B站/抖音/小红书/快手——需 cookie/签名，见 /api/agent/hotspot-report）
    //              ③ 抓不到就【不显示该源】——不再用假数据兜底
    // ★TOPIC_SEARCH_V1：摘掉 Reddit —— 实测服务器网络到不了（HTTP 000 超时），
    //   每次都白等并拖慢整条链路；fetchReddit 定义保留，将来网络可达可再启用
    const [toutiao, baidu, hn, reported] = await Promise.all([
      fetchToutiao(), fetchBaidu(), fetchHackerNews(), getReportedSources(),
    ])

    const cnSources: HotSource[] = []
    if (toutiao.length) cnSources.push({ source: '今日头条', region: 'cn', items: toutiao, fetchedAt: ts })
    if (baidu.length) cnSources.push({ source: '百度热搜', region: 'cn', items: baidu, fetchedAt: ts })
    // 客户端上报（新鲜度由上报时写入的 fetchedAt 决定，超 24h 视为过期）
    for (const r of reported) cnSources.push(r)

    const sources: HotSource[] = [
      ...cnSources,
      ...(hn.length ? [{ source: 'HackerNews', region: 'global' as const, items: hn, fetchedAt: ts }] : []),
    ]

    cache = { at: now, data: sources }

    // ★TOPIC_SEARCH_V1：按【当前用户的主题】搜索 —— 这部分【不进全局缓存】（每人主题不同）
    return NextResponse.json({ success: true, sources: await withTopicSources(request, sources), cached: false })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
