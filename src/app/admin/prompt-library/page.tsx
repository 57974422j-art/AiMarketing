'use client'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/app/providers'

interface PItem {
  id: number
  title?: string
  prompt: string
  category?: string
  model?: string
  source?: string
  author?: string
  originalUrl?: string
  previewUrl?: string
  coverUrl?: string
  videoUrl?: string
}

const SOURCES = [
  { v: '', label: '全部来源' },
  { v: 'cheerselfai', label: '📚 cheerselfai 学习库' },
  { v: 'canvas', label: 'canvas.best 源' },
  { v: '', label: '—' },
]
const MODELS = ['', 'Seedance 2.5', 'MiniMax H3', 'GPT Image 2', 'Seedream 5 Pro', 'FLUX 3']

export default function PromptLibraryPage() {
  const { user, authLoading } = useAuth()
  const [source, setSource] = useState('')
  const [model, setModel] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<PItem[]>([])
  const [loading, setLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [fetchingId, setFetchingId] = useState<number | null>(null)
  const PAGE_SIZE = 20

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams()
      if (source) q.set('source', source)
      if (model) q.set('model', model)
      if (keyword) q.set('keyword', keyword)
      q.set('page', String(page)); q.set('pageSize', String(PAGE_SIZE))
      const r = await fetch('/api/prompt-templates?' + q.toString(), { credentials: 'include' })
      const d = await r.json()
      setItems(d.data || []); setTotal(d.total || 0)
    } catch {} finally { setLoading(false) }
  }, [source, model, page])

  useEffect(() => { if (!authLoading && user) load() }, [load, authLoading, user])
  // 防抖搜索（输入停止 500ms 后触发）
  useEffect(() => {
    const t = setTimeout(() => { setKeyword(searchInput.trim()); setPage(1) }, 500)
    return () => clearTimeout(t)
  }, [searchInput])

  const copyPrompt = (it: PItem) => {
    navigator.clipboard?.writeText(it.prompt).then(() => {
      setCopiedId(it.id); setTimeout(() => setCopiedId(null), 1500)
    }).catch(() => {})
  }
  const uploadMedia = async (it: PItem, file: File) => {
    setFetchingId(it.id)
    try {
      const fd = new FormData()
      fd.append('id', String(it.id)); fd.append('file', file)
      const r = await fetch('/api/prompt-templates/upload', { method: 'POST', credentials: 'include', body: fd })
      const d = await r.json()
      if (d.success) load()
      else alert(d.message || '上传失败')
    } catch { alert('上传失败（网络）') } finally { setFetchingId(null) }
  }
  const fetchImage = async (it: PItem) => {
    setFetchingId(it.id)
    try {
      const r = await fetch(`/api/prompt-templates/fetch-image?id=${it.id}`, { method: 'POST', credentials: 'include' })
      const d = await r.json()
      if (d.success) load()
      else alert(d.message || '拉图失败')
    } catch { alert('拉图失败（网络）') } finally { setFetchingId(null) }
  }
  const delItems = async (ids: number[]) => {
    setDeleting(true)
    try {
      for (const id of ids) await fetch(`/api/prompt-templates?id=${id}`, { method: 'DELETE', credentials: 'include' })
      setSelected(new Set())
      load()
    } catch {} finally { setDeleting(false) }
  }
  const toggleSel = (id: number) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allSelected = items.length > 0 && items.every(i => selected.has(i.id))
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (authLoading || !user) return <div className="min-h-screen bg-[#0a0f1c] text-white p-6 text-sm text-gray-500">加载中…</div>

  return (
    <div className="min-h-screen bg-[#0a0f1c] text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
          <div>
            <h1 className="text-lg font-mono tracking-[0.2em]">📚 提示词资源库 / PROMPT LIBRARY</h1>
            <p className="text-xs text-gray-500 mt-1">外部抓取 + 来源同步内容 · 分页浏览 · 共 {total} 条</p>
          </div>
        </div>

        {/* 搜索框（按提示词内容搜） */}
        <div className="mb-3">
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="🔍 搜索提示词/标题/模型（粘贴提示词片段查是否已存在）"
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 outline-none focus:border-emerald-500/40" />
        </div>
        {/* 筛选栏 */}
        <div className="flex gap-2 mb-4 flex-wrap items-center">
          <select value={source} onChange={(e) => { setSource(e.target.value); setPage(1) }}
            className="px-3 py-1.5 rounded-lg text-xs bg-black/30 border border-white/10 text-gray-300 outline-none focus:border-emerald-500/40">
            {SOURCES.filter(s => s.label !== '—').map(s => <option key={s.v || s.label} value={s.v}>{s.label}</option>)}
          </select>
          <select value={model} onChange={(e) => { setModel(e.target.value); setPage(1) }}
            className="px-3 py-1.5 rounded-lg text-xs bg-black/30 border border-white/10 text-gray-300 outline-none focus:border-emerald-500/40">
            {MODELS.map(m => <option key={m || 'all'} value={m}>{m || '全部模型'}</option>)}
          </select>
          <span className="text-[10px] text-gray-600">第 {page}/{totalPages} 页</span>
          <button onClick={() => setSelected(allSelected ? new Set() : new Set(items.map(i => i.id)))}
            className="px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10">{allSelected ? '取消全选' : `全选本页（${items.length}）`}</button>
          {selected.size > 0 && (
            <button onClick={() => { if (confirm(`删除选中的 ${selected.size} 条？`)) delItems([...selected]) }} disabled={deleting}
              className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 disabled:opacity-50">
              {deleting ? '删除中…' : `🗑 删除选中（${selected.size}）`}
            </button>
          )}
        </div>

        {loading ? <p className="text-xs text-gray-600">加载中…</p> : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map(it => (
                <div key={it.id} className={`rounded-xl border bg-white/[0.03] overflow-hidden flex flex-col relative ${selected.has(it.id) ? 'border-emerald-500/50' : 'border-white/[0.08]'}`}>
                  <label className="absolute top-2 left-2 z-10 flex items-center gap-1 cursor-pointer bg-black/40 rounded px-1.5 py-0.5">
                    <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleSel(it.id)} className="accent-emerald-500" />
                    <span className="text-[9px] text-gray-300">{it.id}</span>
                  </label>
                  {it.videoUrl ? (
                    <video src={it.videoUrl} controls preload="metadata" className="w-full h-40 object-cover bg-black/60" />
                  ) : it.previewUrl || it.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.previewUrl || it.coverUrl} alt={it.title || 'prompt'} className="w-full h-36 object-cover bg-black/40"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  ) : (
                    <div className="w-full h-20 bg-gradient-to-br from-white/5 to-transparent flex items-center justify-center">
                      <button onClick={() => fetchImage(it)} disabled={fetchingId === it.id}
                        className="px-2.5 py-1 rounded-md text-[10px] bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-50">
                        {fetchingId === it.id ? '拉取中…' : '🖼 拉取图片'}
                      </button>
                    </div>
                  )}
                  <div className="p-3 flex flex-col flex-1 min-h-0">
                    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                      {it.model && <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/25 text-[9px]">{it.model}</span>}
                      {it.category && <span className="px-1.5 py-0.5 rounded bg-white/5 text-gray-500 text-[9px]">{it.category}</span>}
                      {it.author && <span className="text-[9px] text-gray-600">@{it.author}</span>}
                    </div>
                    <p className="text-[11px] text-gray-300 leading-snug line-clamp-3 flex-1">{it.prompt}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => copyPrompt(it)}
                        className="px-2.5 py-1 rounded-md text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25">
                        {copiedId === it.id ? '✅ 已复制' : '📋 复制'}
                      </button>
                      <button onClick={async () => {
                        const r = await fetch('/api/media-library/promote', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ promptId: it.id }) })
                        const d = await r.json()
                        alert(d.success ? '✅ 已添加到公共素材库' : (d.message || '添加失败'))
                      }}
                        className="px-2 py-1 rounded-md text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25">📥 素材库</button>
                      <label className="px-2 py-1 rounded-md text-[10px] bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 cursor-pointer">
                        📤 上传{fetchingId === it.id ? '中…' : ''}
                        <input type="file" accept="image/*,video/*" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMedia(it, f); e.target.value = '' }} />
                      </label>
                      {it.originalUrl && (
                        <a href={it.originalUrl} target="_blank" rel="noreferrer"
                          className="px-2.5 py-1 rounded-md text-[10px] bg-white/5 text-gray-400 border border-white/10 hover:text-cyan-300">原文 ↗</a>
                      )}
                      <button onClick={() => { if (confirm('删除这条？')) delItems([it.id]) }}
                        className="px-2 py-1 rounded-md text-[10px] bg-red-500/10 text-red-300 border border-red-500/20 hover:bg-red-500/20">🗑</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {items.length === 0 && <p className="text-xs text-gray-600 py-10 text-center">无匹配内容</p>}

            {/* 分页：页码条（当前窗口 10 页 + 首/尾跳转） */}
            <div className="flex items-center justify-center gap-1.5 mt-6 flex-wrap">
              <button onClick={() => setPage(1)} disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-40">« 首页</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-40">‹</button>
              {(() => {
                const win = 10
                const start = Math.max(1, Math.floor((page - 1) / win) * win + 1)
                const end = Math.min(totalPages, start + win - 1)
                const btns = []
                for (let p = start; p <= end; p++) {
                  btns.push(
                    <button key={p} onClick={() => setPage(p)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs border ${page === p ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10'}`}>{p}</button>
                  )
                }
                return btns
              })()}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-40">›</button>
              <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-40">尾页 »</button>
              <span className="text-xs text-gray-600 ml-2">第 {page}/{totalPages} 页 · 共 {total} 条</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
