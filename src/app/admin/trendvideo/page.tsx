'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface TrendingItem {
  id: string; title: string; platform: string; hotness: number
  url: string; image: string; description: string
  category?: string; aiComment?: string; viralFactors?: string[]
}

// 注意：搬家时漏了 Instagram，这里补回，支持单独取 IG 视频
const PLATFORMS = ['YouTube', 'TikTok', 'Twitter', 'Instagram', 'Bilibili', 'Douyin']

export default function AdminTrendVideoPage() {
  const { user, loading: authLoading } = useAuth()
  const [authorized, setAuthorized] = useState(false)

  const [keyword, setKeyword] = useState('')
  const [platforms, setPlatforms] = useState<string[]>(['YouTube', 'TikTok', 'Instagram'])
  const [results, setResults] = useState<TrendingItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [insightItem, setInsightItem] = useState<any>(null)
  const [insightLoading, setInsightLoading] = useState(false)

  useEffect(() => {
    if (!authLoading) setAuthorized(user?.role === 'admin')
  }, [authLoading, user])

  const togglePlatform = (p: string) => {
    setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  }

  const handleSearch = async () => {
    if (!keyword.trim()) { showToast('请输入关键词', 'error'); return }
    setLoading(true)
    try {
      const r = await fetch(`/api/trendvideo?action=search`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, platforms, count: 20 }),
      })
      const d = await r.json()
      if (d.success) { setResults(d.data); showToast(`找到 ${d.data.length} 条趋势`) }
      else showToast(d.message, 'error')
    } catch { showToast('搜索失败', 'error') }
    setLoading(false)
  }

  const handleAnalyze = async () => {
    setAnalyzing(true)
    try {
      const r = await fetch(`/api/trendvideo?action=analyze`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: results }),
      })
      const d = await r.json()
      if (d.success) { setResults(d.data); showToast('AI 分析完成') }
      else showToast(d.message, 'error')
    } catch { showToast('分析失败', 'error') }
    setAnalyzing(false)
  }

  const handleInsight = async (item: TrendingItem) => {
    setInsightItem(null); setInsightLoading(true)
    try {
      const r = await fetch(`/api/trendvideo?action=insight`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item }),
      })
      const d = await r.json()
      if (d.success) setInsightItem(d.data)
    } catch {}
    setInsightLoading(false)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // 导出采集到的数据为 JSON
  const handleExport = () => {
    if (results.length === 0) { showToast('暂无可导出数据', 'error'); return }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(results, null, 2))
    const a = document.createElement('a')
    a.href = dataStr
    a.download = `trend_${Date.now()}.json`
    a.click()
    showToast('已导出 JSON')
  }

  // 播放：打开原视频/原文链接
  const handlePlay = (item: TrendingItem) => {
    if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer')
    else showToast('该条目无可用链接', 'error')
  }

  // 下载单条封面图
  const handleDownloadImg = async (item: TrendingItem) => {
    const src = item.imageUrl || item.image
    if (!src) { showToast('无封面可下载', 'error'); return }
    try {
      const r = await fetch(src)
      const blob = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${(item.title || 'cover').slice(0, 20)}.jpg`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch { showToast('封面下载失败', 'error') }
  }

  if (authLoading) return <div className="p-8 text-sm text-gray-400">加载中...</div>
  if (!authorized) return <div className="p-8 text-sm text-gray-400">需要管理员权限才能访问此模块</div>

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <p className="text-label mb-1">管理中心 / 趋势猎手</p>
          <h1 className="text-mono-lg text-white mb-1">🔍 趋势猎手 / TrendVideo（采集）</h1>
          <p className="text-xs text-gray-500">AI 搜索全球热门趋势，采集视频信息，支持播放与下载</p>
        </div>

        {/* 搜索栏 */}
        <div className="card-glass p-5 mb-5">
          <div className="flex gap-2 mb-3">
            <input value={keyword} onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="例如：AI新工具、TikTok爆款、护肤趋势..."
              className="input-dark flex-1 rounded-xl px-4 py-2.5 text-sm" />
            <button onClick={handleSearch} disabled={loading || !keyword.trim()}
              className="px-6 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-medium hover:bg-emerald-600 disabled:opacity-40 transition">
              {loading ? '搜索中...' : '🔍 搜索'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(p => (
              <button key={p} onClick={() => togglePlatform(p)}
                className={`px-3 py-1 rounded-lg text-[10px] font-medium transition ${platforms.includes(p) ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border' : 'bg-white/5 text-gray-500 border border-white/5'}`}>
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* 结果 */}
        {results.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-400">{results.length} 条结果，已选 {selectedIds.size} 条</p>
              <div className="flex gap-2">
                <button onClick={handleExport}
                  className="px-4 py-1.5 bg-white/5 border border-white/10 text-gray-300 rounded-lg text-xs hover:bg-white/10 transition">
                  ⬇ 导出 JSON
                </button>
                <button onClick={handleAnalyze} disabled={analyzing}
                  className="px-4 py-1.5 bg-purple-500/20 border border-purple-500/30 text-purple-400 rounded-lg text-xs hover:bg-purple-500/30 disabled:opacity-40 transition">
                  {analyzing ? '分析中...' : '🧠 AI 深度分析'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {results.map(item => (
                <div key={item.id}
                  onClick={() => toggleSelect(item.id)}
                  className={`card-glass rounded-xl overflow-hidden cursor-pointer transition ${selectedIds.has(item.id) ? 'ring-2 ring-emerald-500' : 'hover:border-white/10'}`}>
                  <div className="aspect-video bg-white/5 relative overflow-hidden group">
                    <img src={item.image} alt="" className="w-full h-full object-cover"
                      referrerPolicy="no-referrer" />
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/60 rounded text-[9px] text-white font-mono">{item.platform}</span>
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-emerald-500 rounded-full text-[9px] text-black font-bold">{item.hotness}°</span>
                    {/* 播放 / 下载封面 */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                      <button onClick={(e) => { e.stopPropagation(); handlePlay(item) }}
                        className="px-3 py-1.5 bg-emerald-500 text-black text-[10px] font-bold rounded-lg hover:bg-emerald-400">▶ 播放</button>
                      <button onClick={(e) => { e.stopPropagation(); handleDownloadImg(item) }}
                        className="px-3 py-1.5 bg-white/90 text-black text-[10px] font-bold rounded-lg hover:bg-white">⬇ 封面</button>
                    </div>
                  </div>
                  <div className="p-3 space-y-1">
                    <h3 className="text-xs font-medium text-gray-200 line-clamp-2">{item.title}</h3>
                    <p className="text-[10px] text-gray-500 line-clamp-2">{item.description}</p>
                    {item.category && (
                      <span className="inline-block px-1.5 py-0.5 bg-purple-500/10 rounded text-[9px] text-purple-400">{item.category}</span>
                    )}
                    {item.aiComment && <p className="text-[10px] text-gray-400 italic">{item.aiComment}</p>}
                    {item.viralFactors?.length && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.viralFactors.map(f => <span key={f} className="text-[8px] text-gray-600 bg-white/5 rounded px-1">#{f}</span>)}
                      </div>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); handleInsight(item) }}
                      className="text-[10px] text-blue-400 hover:underline mt-1">📊 深度洞察</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {insightLoading && (
          <div className="card-glass p-5 mt-4 text-center animate-pulse text-sm text-blue-400">AI 分析中...</div>
        )}
        {insightItem && (
          <div className="card-glass p-5 mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">📊 爆款深度洞察</h3>
              <button onClick={() => setInsightItem(null)} className="text-gray-500">✕</button>
            </div>
            <div>
              <h4 className="text-[10px] text-emerald-400 font-bold uppercase mb-1">爆款逻辑</h4>
              <p className="text-xs text-gray-300">{insightItem.summary}</p>
            </div>
            <div>
              <h4 className="text-[10px] text-emerald-400 font-bold uppercase mb-1">核心脚本</h4>
              <pre className="text-[10px] text-gray-400 bg-black/30 rounded-lg p-3 whitespace-pre-wrap">{insightItem.script}</pre>
            </div>
            <div>
              <h4 className="text-[10px] text-emerald-400 font-bold uppercase mb-1">PPT 结构建议</h4>
              <div className="space-y-2">
                {insightItem.pptStructure?.map((s: any, i: number) => (
                  <div key={i} className="bg-white/[0.03] rounded-lg p-3 border-l-2 border-emerald-500">
                    <p className="text-xs text-white font-medium">{s.title}</p>
                    <ul className="text-[10px] text-gray-500 mt-1 space-y-0.5">
                      {s.content?.map((c: string, j: number) => <li key={j}>· {c}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {!loading && results.length === 0 && (
          <div className="card-glass p-12 text-center">
            <p className="text-5xl mb-4">🔍</p>
            <p className="text-sm text-gray-400">输入关键词，AI 将在全球主流平台实时搜索热门趋势</p>
            <p className="text-[10px] text-gray-600 mt-2">需先在管理后台配置 Gemini API</p>
          </div>
        )}
      </div>
    </div>
  )
}
