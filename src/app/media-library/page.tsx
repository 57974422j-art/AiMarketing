'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Asset {
  id: number
  ossUrl: string
  title: string
  prompt?: string
  category?: string
  type?: string
  orientation?: string
}

const TABS = [
  { key: 'landscape', label: '横屏' },
  { key: 'portrait', label: '竖屏' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function MediaLibraryPage() {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('landscape')
  const [items, setItems] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)

  const isPortrait = tab === 'portrait'

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/media-library?source=public&orientation=${tab}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d?.data) ? d.data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [tab])

  useEffect(() => { load() }, [load])

  const [cloneBatchId, setCloneBatchId] = useState<string | null>(null)
  const [cloneResult, setCloneResult] = useState('')

  const openClone = (url: string, title: string) => {
    const id = `ml_${Date.now()}`
    setCloneBatchId(id)
    setCloneResult('')
    window.open(`/text-to-video?mode=clone&refVideo=${encodeURIComponent(url)}&prompt=${encodeURIComponent('基于参考视频《' + title + '》生成同风格新片')}`, '_blank')
    setTimeout(() => { setCloneBatchId(null) }, 2500)
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white">
      <header className="border-b border-white/10 bg-[#0a0e17]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-white text-sm">← 返回</button>
          <h1 className="text-lg font-semibold">🗂️ 公共素材库</h1>
          <span className="text-xs text-gray-500 hidden sm:inline">所有成员共享 · 鼠标悬停卡片可查看 / 克隆</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex gap-2 mb-5">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm border transition-colors ${tab === t.key ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center text-gray-500 py-20">加载中…</div>
        ) : items.length === 0 ? (
          <div className="text-center text-gray-500 py-20">该方向暂无公共素材</div>
        ) : (
          <div className={isPortrait ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'}>
            {items.map(a => {
              const isVideo = (a.type || (a.ossUrl?.match(/\.(mp4|webm|mov|m3u8)$/i) ? 'video' : 'image')) === 'video'
              return (
                <div key={a.id} className="group relative rounded-xl overflow-hidden border border-white/10 bg-white/5">
                  <div className={isPortrait ? 'aspect-[9/16]' : 'aspect-video'}>
                    {isVideo
                      ? <video src={a.ossUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                      : <img src={a.ossUrl} alt={a.title} className="w-full h-full object-cover" />}
                  </div>

                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />
                  <div className="absolute bottom-0 left-0 right-0 p-2.5">
                    <div className="text-white text-xs font-medium truncate">{a.title}</div>
                    {a.category && (
                      <span className="mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {a.category}
                      </span>
                    )}
                  </div>

                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => window.open(a.ossUrl, '_blank')}
                      className="px-3 py-1.5 rounded-lg bg-white/15 backdrop-blur-sm text-white/90 text-xs border border-white/25 hover:bg-white/25 transition-colors">
                      查看
                    </button>
                    {isVideo && (
                      <button onClick={() => openClone(a.ossUrl, a.title)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/25 backdrop-blur-sm text-emerald-200 text-xs border border-emerald-400/40 hover:bg-emerald-500/40 transition-colors">
                        🎬 克隆
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
