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
  const PAGE_SIZE = 20

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams()
      if (source) q.set('source', source)
      if (model) q.set('model', model)
      q.set('page', String(page)); q.set('pageSize', String(PAGE_SIZE))
      const r = await fetch('/api/prompt-templates?' + q.toString(), { credentials: 'include' })
      const d = await r.json()
      setItems(d.data || []); setTotal(d.total || 0)
    } catch {} finally { setLoading(false) }
  }, [source, model, page])

  useEffect(() => { if (!authLoading && user) load() }, [load, authLoading, user])

  const copyPrompt = (it: PItem) => {
    navigator.clipboard?.writeText(it.prompt).then(() => {
      setCopiedId(it.id); setTimeout(() => setCopiedId(null), 1500)
    }).catch(() => {})
  }
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
        </div>

        {loading ? <p className="text-xs text-gray-600">加载中…</p> : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map(it => (
                <div key={it.id} className="rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden flex flex-col">
                  {it.previewUrl || it.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.previewUrl || it.coverUrl} alt={it.title || 'prompt'} className="w-full h-36 object-cover bg-black/40"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  ) : (
                    <div className="w-full h-20 bg-gradient-to-br from-white/5 to-transparent flex items-center justify-center text-[10px] text-gray-700">无封面</div>
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
                      {it.originalUrl && (
                        <a href={it.originalUrl} target="_blank" rel="noreferrer"
                          className="px-2.5 py-1 rounded-md text-[10px] bg-white/5 text-gray-400 border border-white/10 hover:text-cyan-300">原文 ↗</a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {items.length === 0 && <p className="text-xs text-gray-600 py-10 text-center">无匹配内容</p>}

            {/* 分页 */}
            <div className="flex items-center justify-center gap-3 mt-6">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-4 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-40">← 上一页</button>
              <span className="text-xs text-gray-500">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="px-4 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-40">下一页 →</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
