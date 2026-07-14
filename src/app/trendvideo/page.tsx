'use client'

import { useState } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface TrendingItem {
  id: string; title: string; platform: string; hotness: number
  url: string; image: string; description: string
  category?: string; aiComment?: string; viralFactors?: string[]
}

const PLATFORMS = ['YouTube', 'TikTok', 'Twitter', 'Bilibili', 'Douyin']

export default function TrendVideoPage() {
  const { user } = useAuth()
  const [keyword, setKeyword] = useState('')
  const [platforms, setPlatforms] = useState<string[]>(['YouTube', 'TikTok'])
  const [results, setResults] = useState<TrendingItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [insightItem, setInsightItem] = useState<any>(null)
  const [insightLoading, setInsightLoading] = useState(false)

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
        body: JSON.stringify({ keyword, platforms }),
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

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-4 md:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <p className="text-label mb-1">AI 营创作业平台 / 趋势猎手</p>
          <h1 className="text-mono-lg text-white mb-1">🔍 趋势猎手 / TrendVideo</h1>
          <p className="text-xs text-gray-500">AI 搜索全球热门趋势，深度爆款分析，一键合成视频</p>
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
                  <div className="aspect-video bg-white/5 relative overflow-hidden">
                    <img src={item.image} alt="" className="w-full h-full object-cover"
                      referrerPolicy="no-referrer" />
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/60 rounded text-[9px] text-white font-mono">{item.platform}</span>
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-emerald-500 rounded-full text-[9px] text-black font-bold">{item.hotness}°</span>
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
