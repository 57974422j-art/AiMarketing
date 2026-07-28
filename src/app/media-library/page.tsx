'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Asset {
  id: number
  title: string
  ossUrl: string
  prompt?: string
  type?: string
  category?: string
  orientation?: string
}

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'landscape', label: '横屏' },
  { key: 'portrait', label: '竖屏' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function MediaLibraryPage() {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('all')
  const [items, setItems] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    const orientation = tab === 'all' ? 'all' : tab
    fetch(`/api/media-library?source=public&orientation=${orientation}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d?.data) ? d.data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [tab])

  useEffect(() => { load() }, [load])

  const openClone = (a: Asset) => {
    const params = new URLSearchParams({ prompt: a.prompt || a.title })
    if (a.type === 'video') {
      params.set('mode', 'clone')
      params.set('refVideo', a.ossUrl)
      router.push(`/text-to-video?${params.toString()}`)
    } else {
      params.set('refUrl', a.ossUrl)
      router.push(`/text-to-video?${params.toString()}`)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 px-4 py-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-xl font-bold text-white mb-1">公共素材库</h1>
        <p className="text-xs text-gray-500 mb-4">
          所有成员共享的素材，支持按横屏 / 竖屏筛选；视频可直接「克隆」生成同风格的新片。
        </p>
        <div className="flex gap-2 mb-5">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-lg text-xs border transition-colors ${tab === t.key ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-gray-500 text-sm py-20 text-center">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-gray-500 text-sm py-20 text-center">暂无素材</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map(a => (
              <div key={a.id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className={`${a.type === 'video' ? 'aspect-video' : 'aspect-square'} bg-black/40 flex items-center justify-center overflow-hidden`}>
                  {a.type === 'video' ? (
                    <video src={a.ossUrl} className="w-full h-full object-cover" muted />
                  ) : (
                    <img src={a.ossUrl} alt={a.title} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="p-2">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-white text-xs font-medium truncate">{a.title}</h3>
                    <span className="text-[10px] text-gray-500 shrink-0 ml-1">{a.type === 'video' ? '🎬' : '🖼️'}</span>
                  </div>
                  <button onClick={() => openClone(a)}
                    className={`w-full mt-1 py-1.5 text-[11px] rounded-lg border transition-colors ${a.type === 'video' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30' : 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30'}`}>
                    {a.type === 'video' ? '🎬 克隆视频' : '✨ 用到文生视频'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
