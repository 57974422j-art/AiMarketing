'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface TrendingItem {
  id: number
  platform: string
  category: string
  title: string
  heatValue: number | null
  description: string | null
  coverUrl: string | null
  rank: number | null
  crawledAt: string
}

const CATEGORY_LABELS: Record<string, string> = {
  hot: '🔥 热门',
  daily: '📅 每日',
  weekly: '📆 每周',
}

export default function TrendingPage() {
  const [trending, setTrending] = useState<TrendingItem[]>([])
  const [categories, setCategories] = useState<Array<{ category: string; count: number }>>([])
  const [platforms, setPlatforms] = useState<Array<{ platform: string; count: number }>>([])
  const [loading, setLoading] = useState(true)

  const [category, setCategory] = useState('')
  const [platform, setPlatform] = useState('')

  const fetchTrending = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (category) params.set('category', category)
      if (platform) params.set('platform', platform)

      const res = await fetch(`/api/data-center/trending?${params}`, { credentials: 'include' })
      const json = await res.json()
      if (json.success) {
        setTrending(json.data.list)
        if (json.data.filters?.categories) setCategories(json.data.filters.categories)
        if (json.data.filters?.platforms) setPlatforms(json.data.filters.platforms)
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [category, platform])

  useEffect(() => { fetchTrending() }, [fetchTrending])

  // 根据热度值计算颜色
  function getHeatColor(heat?: number | null): string {
    if (!heat) return 'text-gray-500'
    if (heat > 1e8) return 'text-red-400'
    if (heat > 5e7) return 'text-orange-400'
    if (heat > 2e7) return 'text-yellow-400'
    if (heat > 1e7) return 'text-cyan-400'
    return 'text-gray-300'
  }

  function formatHeat(n?: number | null): string {
    if (!n) return '-'
    if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`
    if (n >= 1e4) return `${(n / 1e4).toFixed(0)}万`
    return String(Math.round(n))
  }

  // 排名徽章样式
  function rankBadge(rank: number | null): string {
    if (!rank) return 'bg-white/10 text-gray-500'
    switch (rank) {
      case 1: return 'bg-gradient-to-r from-red-500 to-orange-500 text-white'
      case 2: return 'bg-gradient-to-r from-orange-400 to-yellow-500 text-white'
      case 3: return 'bg-gradient-to-r from-yellow-400 to-green-400 text-white'
      default: return 'bg-white/10 text-gray-400'
    }
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <p className="text-label mb-2">数据管理中心 / DATA CENTER</p>
          <h1 className="text-mono-lg text-white">热榜追踪 / TRENDING TRACKER</h1>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          <Link href="/data-center" className="px-3 py-1.5 bg-white/5 text-gray-400 rounded-xl hover:bg-white/10 font-mono text-sm">← 返回仪表盘</Link>
        </div>

        {/* 工具栏 */}
        <form onSubmit={(e) => { e.preventDefault(); fetchTrending() }}
          className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4 mb-6 flex flex-wrap gap-3 items-center"
        >
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none">
            <option value="" className="bg-gray-900">全部分类</option>
            {categories.map(c => (
              <option key={c.category} value={c.category} className="bg-gray-900">
                {CATEGORY_LABELS[c.category] || c.category} ({c.count})
              </option>
            ))}
          </select>

          <select value={platform} onChange={(e) => setPlatform(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none">
            <option value="" className="bg-gray-900">全部平台</option>
            {platforms.map(p => (
              <option key={p.platform} value={p.platform} className="bg-gray-900">{p.platform}</option>
            ))}
          </select>

          <button type="submit" className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-mono text-sm">REFRESH</button>
        </form>

        {/* 热榜列表 */}
        {loading ? (
          <div className="text-center py-24"><p className="text-gray-500 font-mono animate-pulse">LOADING...</p></div>
        ) : trending.length === 0 ? (
          <div className="text-center py-24 bg-white/5 rounded-2xl border border-white/10">
            <p className="text-gray-500 font-mono text-lg mb-2">NO TRENDING DATA</p>
            <p className="text-gray-600 font-mono text-sm">暂无热门话题数据，请先执行采集任务</p>
          </div>
        ) : (
          <div className="space-y-2">
            {trending.map((item, idx) => (
              <div key={item.id}
                className={`flex items-center gap-4 p-4 rounded-2xl transition-colors ${
                  item.rank && item.rank <= 3 ? 'bg-white/[0.08] border border-white/15' : 'bg-white/5 border border-white/10'
                } hover:bg-white/[0.08]`}
              >
                {/* 排名 */}
                <span className={`w-10 h-10 flex items-center justify-center rounded-xl font-bold font-mono text-sm shrink-0 ${rankBadge(item.rank)}`}>
                  {item.rank ?? idx + 1}
                </span>

                {/* 封面 */}
                {item.coverUrl && (
                  <img src={item.coverUrl} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0" loading="lazy" />
                )}

                {/* 内容 */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-white font-mono mb-1 truncate group-hover:text-emerald-300">
                    {item.title}
                  </h3>
                  {item.description && (
                    <p className="text-xs text-gray-500 font-mono line-clamp-1 mb-1">{item.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded font-mono`}>
                      {item.platform}
                    </span>
                    <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded font-mono">
                      {CATEGORY_LABELS[item.category] || item.category}
                    </span>
                    <span className="text-[11px] text-gray-600 font-mono">
                      {new Date(item.crawledAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                </div>

                {/* 热度 */}
                <div className="shrink-0 text-right">
                  <p className={`text-lg font-bold font-mono ${getHeatColor(item.heatValue)}`}>
                    {formatHeat(item.heatValue)}
                  </p>
                  <p className="text-[10px] text-gray-600 font-mono">热度</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
