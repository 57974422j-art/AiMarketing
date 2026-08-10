'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface IndustryVideo {
  id: number; industry: string; title: string; videoUrl: string; coverUrl?: string | null
  source: string; duration?: number | null; keyword?: string | null; createdAt: string
}

const INDUSTRIES = ['餐饮', '美业', '教育', '电商', '旅游', '健身', '汽车', '房产']

export default function IndustryVideosPage() {
  const router = useRouter()
  const [list, setList] = useState<IndustryVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [industry, setIndustry] = useState('')
  const [days, setDays] = useState(7)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/admin/industry-videos?days=${days}${industry ? '&industry=' + encodeURIComponent(industry) : ''}`, { credentials: 'include' })
      .then(r => r.json()).then(d => setList(Array.isArray(d?.data) ? d.data : []))
      .catch(() => setList([])).finally(() => setLoading(false))
  }, [industry, days])
  useEffect(() => { load() }, [load])

  const del = async (id: number) => {
    if (!confirm('确定删除该视频？')) return
    const r = await fetch(`/api/admin/industry-videos?id=${id}`, { method: 'DELETE', credentials: 'include' })
    const d = await r.json()
    if (d.success) load(); else alert(d.message || '删除失败')
  }
  const cleanup = async () => {
    if (!confirm(`清理 ${days} 天前的所有行业视频？（谨慎）`)) return
    const r = await fetch(`/api/admin/industry-videos?days=${days}`, { method: 'DELETE', credentials: 'include' })
    const d = await r.json()
    alert(d.message || '完成'); load()
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white">
      <header className="border-b border-white/10 bg-[#0a0e17]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3 flex-wrap">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-white text-sm">← 返回</button>
          <h1 className="text-lg font-semibold">🎬 行业视频库</h1>
          <span className="text-xs text-gray-500">YouTube/TikTok 抓取入库（OSS 私有）· 按行业推送用</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex gap-2 mb-4 flex-wrap items-center">
          <button onClick={() => setIndustry('')}
            className={`px-3 py-1.5 rounded-lg text-xs border ${!industry ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10'}`}>全部行业</button>
          {INDUSTRIES.map(c => (
            <button key={c} onClick={() => setIndustry(industry === c ? '' : c)}
              className={`px-3 py-1.5 rounded-lg text-xs border ${industry === c ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10'}`}>{c}</button>
          ))}
          <div className="flex-1" />
          <select value={days} onChange={e => setDays(parseInt(e.target.value) || 7)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white">
            {[1, 3, 7, 30].map(d => <option key={d} value={d} className="bg-gray-900">近 {d} 天</option>)}
          </select>
          <button onClick={cleanup} className="px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs hover:bg-red-500/25">🧹 清理过期</button>
        </div>

        {loading ? <div className="text-gray-500 text-center py-16">加载中…</div>
        : list.length === 0 ? <div className="text-gray-500 text-center py-16">暂无行业视频 —— 到「提示词模板库 → 素材抓取 → 抓取视频」手动抓取</div>
        : <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map(v => (
            <div key={v.id} className="rounded-xl border border-white/10 bg-white/[0.04] overflow-hidden hover:border-emerald-400/40 transition-all">
              <div className="aspect-video bg-black/40 relative">
                {v.coverUrl ? <img src={v.coverUrl} alt="" className="w-full h-full object-cover" />
                  : <video src={v.videoUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />}
                {v.duration && <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white">{v.duration}s</span>}
                <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-emerald-500/80 text-[10px] text-black font-medium">{v.industry}</span>
              </div>
              <div className="p-3">
                <div className="text-xs font-medium line-clamp-1">{v.title}</div>
                <div className="mt-1 text-[10px] text-gray-500">{v.source} · {v.keyword || ''} · {new Date(v.createdAt).toLocaleDateString('zh-CN')}</div>
                <div className="mt-2 flex gap-2">
                  <a href={v.videoUrl} target="_blank" rel="noreferrer" className="flex-1 text-center px-2 py-1 rounded bg-white/10 text-[10px] text-white hover:bg-white/20">▶️ 播放</a>
                  <button onClick={() => del(v.id)} className="px-2 py-1 rounded bg-red-500/20 text-[10px] text-red-300 hover:bg-red-500/30">🗑 删</button>
                </div>
              </div>
            </div>
          ))}
        </div>}
      </main>
    </div>
  )
}
