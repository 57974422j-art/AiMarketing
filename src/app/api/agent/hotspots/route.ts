import { NextRequest, NextResponse } from 'next/server'

// 今日热点接口（融合 BaiLongma 热点推荐：多源聚合，免 key，本地缓存 1 小时）
// 取法参考 BaiLongma trending.js / hotspots.js：中国热榜走免 key 聚合 + 全球走 HackerNews/Reddit，
// 多源容错，单个源失败不影响其他。

export const dynamic = 'force-dynamic'

type HotItem = { title: string; hot?: string; url?: string }
type HotSource = { source: string; region: 'cn' | 'global'; items: HotItem[] }

// 主源：免 key 聚合（hot-api.vhan.eu.org/v2?type=all，一次拿全部榜单）——2026-08-11：vvhan 官方接口已失效，彻底清除
const CN_SOURCES = ['微博', '抖音', '知乎', '小红书', '今日头条', '百度热搜']

// 内置兜底热点：当免 key 源 / tophub 全部拉取失败时返回
const FALLBACK: Record<string, HotItem[]> = {
  微博: [
    { title: 'AI 生成内容监管新规今日生效', hot: '982万' },
    { title: '国货品牌双十一预售破纪录', hot: '761万' },
    { title: '文旅城市夜经济持续升温', hot: '654万' },
    { title: '年轻人力推City Walk慢旅行', hot: '533万' },
    { title: '新能源车下乡补贴加码', hot: '488万' },
    { title: '国产大模型集体降价', hot: '421万' },
  ],
  抖音: [
    { title: '知识类短视频完播率翻倍', hot: '873万' },
    { title: '乡村生活纪录片爆火', hot: '690万' },
    { title: '非遗手艺人的千万粉丝路', hot: '612万' },
    { title: 'AI 配音让老视频焕发新生', hot: '540万' },
    { title: '小众运动成新流量密码', hot: '498万' },
  ],
  知乎: [
    { title: '如何评价大模型推理成本下降', hot: '3.2万讨论' },
    { title: '普通人如何抓住 AI 红利', hot: '2.7万讨论' },
    { title: '内容创作者的护城河在哪', hot: '1.9万讨论' },
    { title: '县域经济的机会与陷阱', hot: '1.4万讨论' },
    { title: '短视频平台的算法逻辑', hot: '1.1万讨论' },
  ],
  小红书: [
    { title: '新手宝妈的副业打卡清单', hot: '45万赞' },
    { title: '低成本家居改造灵感', hot: '38万赞' },
    { title: '一人食的治愈晚餐', hot: '31万赞' },
    { title: '通勤穿搭显高公式', hot: '27万赞' },
    { title: '周末周边游宝藏路线', hot: '22万赞' },
  ],
  今日头条: [
    { title: '多地推出促消费新举措', hot: '612万' },
    { title: '数字人民币试点扩围', hot: '503万' },
    { title: '县域物流提速助力农产品出村', hot: '411万' },
    { title: ' AI 助农直播带货成新趋势', hot: '356万' },
    { title: '老旧小区适老化改造推进', hot: '298万' },
  ],
  百度热搜: [
    { title: '今日油价迎来年内最大降幅', hot: '488万' },
    { title: '多所高校公布招生新规', hot: '401万' },
    { title: '国产操作系统生态扩容', hot: '355万' },
    { title: '夏季避暑游热度攀升', hot: '312万' },
    { title: 'AI 写作工具使用规范出台', hot: '276万' },
  ],
  微信: [
    { title: '公众号改版后阅读量回升', hot: '32万' },
    { title: '视频号本地生活成新风口', hot: '28万' },
    { title: '私域运营的三个关键动作', hot: '21万' },
    { title: '企业微信连接消费者新玩法', hot: '17万' },
  ],
  HackerNews: [
    { title: 'Show HN: A new open-source vector database' },
    { title: 'Why we migrated off microservices' },
    { title: 'The state of Rust in 2026' },
    { title: 'Building local-first AI apps' },
  ],
  Reddit: [
    { title: 'Self-hosting is easier than ever now' },
    { title: 'What is your favorite terminal setup?' },
    { title: 'AI coding assistants changed my workflow' },
    { title: 'Small teams shipping fast with Rust' },
  ],
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

// 免 key 主源：一次拉全部榜单，按 name 匹配各平台（2026-08-11：替代失效的 vvhan 官方接口）
async function fetchVhanAll(): Promise<Record<string, HotItem[]>> {
  const out: Record<string, HotItem[]> = {}
  try {
    const r = await fetch('https://hot-api.vhan.eu.org/v2?type=all', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(9000) })
    if (!r.ok) return out
    const d = await r.json()
    const boards: any[] = d?.data || []
    const pick = (keys: string[]) => (board: any) => keys.some((k) => String(board?.name || '').includes(k))
    const map: [string, string[]][] = [
      ['微博', ['微博']],
      ['抖音', ['抖音']],
      ['知乎', ['知乎']],
      ['小红书', ['小红书']],
      ['今日头条', ['头条']],
      ['百度热搜', ['百度']],
    ]
    for (const [source, keys] of map) {
      const board = boards.find(pick(keys))
      const list: any[] = board?.data || board?.list || []
      out[source] = (Array.isArray(list) ? list : []).slice(0, 12)
        .map((it: any, i: number) => ({ title: String(it.title || it.name || '').trim(), hot: it.hot ? String(it.hot) : undefined, rank: i + 1 }))
        .filter((it: HotItem) => it.title)
    }
  } catch {}
  return out
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

    // 并行抓取：国内免 key 榜单 + 全球 HackerNews/Reddit
    const vhanAll = await fetchVhanAll()
    const [hn, reddit] = await Promise.all([fetchHackerNews(), fetchReddit()])

    // 2026-08-11：免 key 源为主 → tophub 兜底 → 内置 FALLBACK
    const cnSources: HotSource[] = await Promise.all(CN_SOURCES.map(async (source) => {
      if (vhanAll[source]?.length) return { source, region: 'cn' as const, items: vhanAll[source] }
      const th = await fetchTophub(source)
      if (th?.length) return { source, region: 'cn' as const, items: th }
      return { source, region: 'cn' as const, items: (FALLBACK[source] || []) }
    }))

    const sources: HotSource[] = [
      ...cnSources,
      { source: 'HackerNews', region: 'global' as const, items: hn.length ? hn : (FALLBACK['HackerNews'] || []) },
      { source: 'Reddit', region: 'global' as const, items: reddit.length ? reddit : (FALLBACK['Reddit'] || []) },
    ].filter((s) => s.items.length > 0)

    cache = { at: now, data: sources }
    return NextResponse.json({ success: true, sources, cached: false })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}
