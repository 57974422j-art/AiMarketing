'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers'

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
  { key: 'image', label: '🖼 图片' },
  { key: 'video', label: '🎬 视频' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function MediaLibraryPage() {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [tab, setTab] = useState<TabKey>('image')
  // 2026-08-12: 支持 ?tab=prompts 直达提示词库（agent 首页卡片入口）
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'prompts' || t === 'image' || t === 'video') setTab(t)
  }, [])
  const [items, setItems] = useState<Asset[]>([])
  const [promptList, setPromptList] = useState<any[]>([])
  const [promptTotal, setPromptTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState('')
  const [manageMode, setManageMode] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [deleting, setDeleting] = useState(false)
  // 2026-08-16: 滚动到底加载下一页
  useEffect(() => {
    const onScroll = () => {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 400 && hasMore && !loadingMore) {
        setLoadingMore(true); setPage(p => p + 1)
      }
    }
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [hasMore, loadingMore])
  useEffect(() => { setPage(1) }, [tab, search])

  const isPortrait = tab === 'portrait'

  const load = useCallback(() => {
    setLoading(true)
    if (tab === 'prompts') {
      fetch(`/api/prompts-public?limit=20&offset=${(page - 1) * 20}${search.trim() ? '&keyword=' + encodeURIComponent(search.trim()) : ''}`, { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          const list = Array.isArray(d?.data?.list) ? d.data.list : []
          setPromptList(prev => page === 1 ? list : [...prev, ...list])
          setPromptTotal(d?.data?.total || 0)
          setHasMore((d?.data?.total || 0) > page * 20)
          setLoadingMore(false)
        })
        .catch(() => setPromptList([]))
        .finally(() => setLoading(false))
      return
    }
    fetch(`/api/media-library?source=public&type=${tab === 'image' ? 'image' : 'video'}&limit=20&offset=${(page - 1) * 20}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { const list = Array.isArray(d?.data) ? d.data : []; setItems(prev => page === 1 ? list : [...prev, ...list]); setHasMore(list.length === 20); setLoadingMore(false) })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [tab, search, page])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const q = search.trim().toLowerCase()
    return items.filter(a => (a.title || '').toLowerCase().includes(q) || (a.category || '').toLowerCase().includes(q))
  }, [items, search])

  const toggleCheck = (id: number) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    const ids = filtered.map(a => a.id)
    const allChecked = ids.every(id => checked.has(id))
    setChecked(prev => {
      const next = new Set(prev)
      ids.forEach(id => { if (allChecked) next.delete(id); else next.add(id) })
      return next
    })
  }

  const deleteOne = async (id: number) => {
    if (!confirm('确定删除这条素材？')) return
    const r = await fetch(`/api/media-library?id=${id}`, { method: 'DELETE', credentials: 'include' })
    const d = await r.json()
    alert(d.message || '操作完成')
    if (d.success) { setChecked(prev => { const n = new Set(prev); n.delete(id); return n }); load() }
  }

  const deleteSelected = async () => {
    const ids = [...checked]
    if (ids.length === 0) return
    if (!confirm(`确定删除选中的 ${ids.length} 条素材？`)) return
    setDeleting(true)
    try {
      const r = await fetch(`/api/media-library?ids=${ids.join(',')}`, { method: 'DELETE', credentials: 'include' })
      const d = await r.json()
      alert(d.message || '操作完成')
      if (d.success) { setChecked(new Set()); setManageMode(false); load() }
    } finally { setDeleting(false) }
  }

  const [cloneBatchId, setCloneBatchId] = useState<string | null>(null)

  const openClone = (url: string, title: string) => {
    const id = `ml_${Date.now()}`
    setCloneBatchId(id)
    window.open(`/text-to-video?mode=clone&refVideo=${encodeURIComponent(url)}&prompt=${encodeURIComponent('基于参考视频《' + title + '》生成同风格新片')}`, '_blank')
    setTimeout(() => { setCloneBatchId(null) }, 2500)
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white">
      <header className="border-b border-white/10 bg-[#0a0e17]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-semibold">🗂️ 公共素材库</h1>
          <span className="text-xs text-gray-500 hidden sm:inline">所有成员共享 · 悬停卡片可查看 / 克隆</span>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索素材…"
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-600 focus:border-emerald-400/50 focus:outline-none w-44" />

          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex gap-2 mb-4">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm border transition-colors ${tab === t.key ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>
              {t.label}
            </button>
          ))}
          <span className="ml-auto self-center text-xs text-gray-500">{filtered.length} 条素材</span>
        </div>

        {/* admin 管理条（仅 admin 可见，防止普通用户全选克隆报错） */}
        {isAdmin && manageMode && (
          <div className="flex items-center gap-3 mb-4 px-3 py-2.5 rounded-xl bg-red-500/[0.07] border border-red-500/20">
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={filtered.length > 0 && filtered.every(a => checked.has(a.id))}
                onChange={toggleAll} className="accent-red-400 w-4 h-4" />
              全选（{filtered.length}）
            </label>
            <button onClick={deleteSelected} disabled={deleting || checked.size === 0}
              className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs hover:bg-red-500/30 disabled:opacity-40 transition-colors">
              {deleting ? '删除中…' : `🗑 删除选中 (${checked.size})`}
            </button>
            <span className="text-[10px] text-gray-500">管理员批量清理（旧 OSS 失效素材）</span>
          </div>
        )}

        {tab === 'prompts' ? (
          loading ? <div className="text-center text-gray-500 py-20">加载中…</div>
          : promptList.length === 0 ? <div className="text-center text-gray-500 py-20">{search ? '没有匹配的提示词' : '暂无已发布的提示词'}</div>
          : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {promptList.map((pt: any) => (
                <div key={pt.id} className="group rounded-xl overflow-hidden border border-white/10 bg-white/[0.04] hover:border-emerald-400/40 transition-all flex flex-col">
                  <div className="aspect-video bg-black/40 overflow-hidden">
                    {pt.coverUrl
                      ? <img src={pt.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                      : <div className="w-full h-full flex items-center justify-center text-2xl opacity-30">💡</div>}
                  </div>
                  <div className="p-2.5 flex flex-col flex-1">
                    <div className="text-xs font-medium line-clamp-1">{pt.title || '未命名提示词'}</div>
                    <div className="mt-1 text-[9px] text-gray-500 line-clamp-2">{pt.prompt}</div>
                    {pt.tags && <div className="mt-1.5 flex gap-1 flex-wrap">{pt.tags.split(',').slice(0, 3).map((t: string) => <span key={t} className="px-1 py-0.5 rounded text-[8px] bg-violet-500/20 text-violet-300">{t}</span>)}</div>}
                    <div className="mt-auto pt-2 flex gap-1.5">
                      <button onClick={() => navigator.clipboard?.writeText(pt.prompt)} className="flex-1 px-1.5 py-1 rounded bg-white/10 text-[10px] text-gray-200 hover:bg-white/20">📋 复制</button>
                      <button onClick={() => window.open(`/image-generator?prompt=${encodeURIComponent(pt.prompt)}`, '_blank')}
                        className="flex-1 px-1.5 py-1 rounded bg-emerald-500/20 text-[10px] text-emerald-300 hover:bg-emerald-500/30">✨ 用这个生成</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : loading ? (
          <div className="text-center text-gray-500 py-20">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-500 py-20">{search ? '没有匹配的素材' : '该方向暂无公共素材'}</div>
        ) : (
          <div className={isPortrait ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'}>
            {filtered.map(a => {
              const isVideo = (a.type || (a.ossUrl?.match(/\.(mp4|webm|mov|m3u8)$/i) ? 'video' : 'image')) === 'video'
              return (
                <div key={a.id} className="rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden flex flex-col">
                  <div className="relative">
                    {isVideo ? (
                      <video src={a.ossUrl} controls playsInline preload="metadata" className="w-full h-40 object-cover bg-black/60" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.ossUrl} alt={a.title} className="w-full h-36 object-cover bg-black/40 transition-transform duration-300 hover:scale-105" loading="lazy" />
                    )}
                  </div>
                  <div className="p-2.5 flex flex-col flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[11px] text-gray-200 truncate flex-1">{a.title || '素材'}</p>
                      {a.category && <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[9px]">{a.category}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 mt-2">
                      <button onClick={() => window.open(a.ossUrl, '_blank')}
                        className="px-2 py-1 rounded-md text-[10px] bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10">查看</button>
                      <button onClick={() => router.push(`/agent?media=${encodeURIComponent(a.ossUrl)}&mt=${isVideo ? 'video' : 'image'}`)}
                        className="px-2 py-1 rounded-md text-[10px] bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25">🤖 AGENT</button>
                      {!isVideo && (
                        <button onClick={() => router.push(`/image-generator?media=${encodeURIComponent(a.ossUrl)}`)}
                          className="px-2 py-1 rounded-md text-[10px] bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25">🎨 生图</button>
                      )}
                      {isVideo && (
                        <button onClick={() => openClone(a.ossUrl, a.title)}
                          className="px-2 py-1 rounded-md text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25">🎬 克隆</button>
                      )}
                    </div>
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
