'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface PromptItem {
  id: number; title?: string | null; prompt: string; category?: string | null
  tags?: string | null; author?: string | null; coverUrl?: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (prompt: string) => void   // 点击卡片 -> 写入生成框
  mode?: 'prompts' | 'video' | 'image' // 2026-08-23: 数据源切换——prompts=/api/prompts-public；video/image=公共素材(MediaAsset)
}

interface MediaItem {
  id: number; title: string; prompt?: string; thumbnailUrl?: string | null
  ossUrl?: string; coverUrl?: string | null; type?: string; duration?: number | null
}

// canvas.best PromptSelectDialog 式提示词库（2026-08-12）
// 左栏: 分类单选 + 标签多选; 右侧: 搜索(防抖) + 卡片网格 + 无限滚动
// 数据源: /api/prompts-public（服务端搜索/标签/分页）
const PAGE = 24

export default function PromptLibraryDialog({ open, onClose, onSelect, mode = 'prompts' }: Props) {
  const [keyword, setKeyword] = useState('')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [list, setList] = useState<PromptItem[]>([])
  const [mediaList, setMediaList] = useState<MediaItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  // 搜索防抖 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebounced(keyword), 300)
    return () => clearTimeout(t)
  }, [keyword])

  const reqSeq = useRef(0)
  const load = useCallback(async (pg: number, append: boolean) => {
    const seq = ++reqSeq.current  // #19: 请求序号，旧请求结果丢弃
    setLoading(true)
    try {
      const sp = new URLSearchParams()
      if (debounced) sp.set('keyword', debounced)
      if (category) sp.set('tag', category)
      if (tags.length) sp.set('tag', tags[0])   // 接口单 tag 参数，取首个（多选后续可扩展）
      sp.set('limit', String(PAGE))
      sp.set('offset', String(pg * PAGE))
      if (mode === 'video' || mode === 'image') {
        // 2026-08-23: 公共素材库（MediaAsset 带 prompt）——做视频/图片参考，与发布机制无关
        const r = await fetch(`/api/media-library?source=public&type=${mode}&limit=${PAGE}&offset=${pg * PAGE}`, { credentials: 'include' })
        const d = await r.json()
        if (seq !== reqSeq.current) return
        const rows: MediaItem[] = Array.isArray(d?.data) ? d.data : []
        setMediaList(prev => append ? [...prev, ...rows] : rows)
        setTotal(d?.data?.total || rows.length || 0)
        return
      }
      const r = await fetch(`/api/prompts-public?${sp}`, { credentials: 'include' })
      const d = await r.json()
      if (seq !== reqSeq.current) return  // 旧请求丢弃
      const rows: PromptItem[] = d?.data?.list || []
      setList(prev => append ? [...prev, ...rows] : rows)
      setTotal(d?.data?.total || 0)
    } catch {} finally { if (seq === reqSeq.current) setLoading(false) }
  }, [debounced, category, tags])

  useEffect(() => { if (!open) return; setPage(0); setList([]); setMediaList([]); load(0, false) }, [open, debounced, category, tags, mode, load])

  // 无限滚动
  const onScroll = useCallback(() => {
    const el = boxRef.current
    if (!el || loading) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) {
      const next = page + 1
      setPage(next)
      load(next, true)
    }
  }, [loading, page, load])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    list.forEach(it => (it.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 6).forEach(t => s.add(t)))
    return Array.from(s).slice(0, 24)
  }, [list])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
      <div className="w-[880px] max-w-[94vw] h-[78vh] rounded-2xl border border-white/15 bg-[#10131c] flex overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* 左栏: 分类 + 标签（仅 prompts 模式；video/image 显示数据源说明） */}
        {mode !== 'prompts' && (
        <div className="w-[200px] shrink-0 border-r border-white/10 p-4 overflow-y-auto">
          <div className="text-xs text-gray-400 mb-2">数据源 / SOURCE</div>
          <div className="text-[10px] text-gray-500 leading-relaxed">
            {mode === 'video' ? `🎬 公共视频素材库（${total} 条）——每条自带 AI 提示词，点击填入生成框` : `🖼 公共图片素材库（${total} 条）——点击填入提示词`}
            <div className="mt-3 pt-3 border-t border-white/10 text-gray-600">素材来自公共资源，可作参考</div>
          </div>
        </div>
        )}
        {mode === 'prompts' && (
        <div className="w-[200px] shrink-0 border-r border-white/10 p-4 overflow-y-auto">
          <div className="text-xs text-gray-400 mb-2">分类 / CATEGORY</div>
          <div className="flex flex-col gap-1">
            <button onClick={() => setCategory('')} className={`text-left px-2 py-1.5 rounded text-xs ${!category ? 'bg-violet-500/20 text-violet-300' : 'text-gray-400 hover:bg-white/5'}`}>全部</button>
            {['风景', '人物', '产品', '美食', '科技', '建筑', '动物', '插画', '3D', '海报'].map(c => (
              <button key={c} onClick={() => setCategory(c)} className={`text-left px-2 py-1.5 rounded text-xs ${category === c ? 'bg-violet-500/20 text-violet-300' : 'text-gray-400 hover:bg-white/5'}`}>{c}</button>
            ))}
          </div>
          {allTags.length > 0 && (
            <>
              <div className="text-xs text-gray-400 mt-4 mb-2">标签 / TAGS</div>
              <div className="flex flex-wrap gap-1">
                {allTags.map(t => (
                  <button key={t} onClick={() => setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [t])}
                    className={`px-1.5 py-0.5 rounded text-[10px] border ${tags.includes(t) ? 'border-violet-400/60 text-violet-300 bg-violet-500/15' : 'border-white/10 text-gray-400 hover:border-white/30'}`}>{t}</button>
                ))}
              </div>
            </>
          )}
        </div>
        )}

        {/* 右侧: 搜索 + 卡片 */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-4 border-b border-white/10 flex items-center gap-3">
            <h3 className="text-sm font-semibold shrink-0">{mode === 'prompts' ? '📚 提示词库' : mode === 'video' ? '🎬 视频参考素材' : '🖼 图片参考素材'}</h3>
            <span className="text-[10px] text-gray-500 shrink-0">共 {total} 条 · 点击卡片插入生成框</span>
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜索提示词 / 关键词..."
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-violet-400/50" />
            <button onClick={onClose} className="text-gray-400 hover:text-white text-sm px-2">✕</button>
          </div>

          <div ref={boxRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-4">
            {(mode !== 'prompts' ? mediaList.length === 0 : list.length === 0) && !loading && <div className="text-gray-500 text-center py-16 text-sm">没有匹配的提示词</div>}
            {mode !== 'prompts' && (
            <div className="grid grid-cols-2 gap-3">
              {mediaList.map(it => (
                <button key={it.id} onClick={() => { onSelect(it.prompt || ''); onClose() }}
                  className="text-left rounded-xl border border-white/10 bg-white/[0.04] overflow-hidden hover:border-emerald-400/50 hover:bg-white/[0.08] transition-all group">
                  <div className="relative aspect-video bg-black/40 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.thumbnailUrl || it.coverUrl || it.ossUrl || ''} alt="" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    <span className="absolute top-1.5 left-1.5 text-[9px] px-1.5 py-0.5 rounded bg-black/60 text-emerald-300">{mode === 'video' ? '▶ 视频' : '图片'}</span>
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] font-medium truncate group-hover:text-emerald-300">{it.title || '(无标题)'}</div>
                    {it.prompt && <div className="mt-1 text-[9px] text-gray-500 line-clamp-2">{it.prompt}</div>}
                  </div>
                </button>
              ))}
            </div>
            )}
            {mode === 'prompts' && (
            <div className="grid grid-cols-2 gap-3">
              {list.map(it => (
                <button key={it.id} onClick={() => { onSelect(it.prompt); onClose() }}
                  className="text-left rounded-xl border border-white/10 bg-white/[0.04] p-3 hover:border-violet-400/50 hover:bg-white/[0.08] transition-all group">
                  <div className="text-xs font-medium truncate group-hover:text-violet-300">{it.title || '(无标题)'}</div>
                  <div className="mt-1 text-[10px] text-gray-500 line-clamp-3">{it.prompt}</div>
                  {(it.tags || it.category) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(it.tags || it.category || '').split(',').filter(Boolean).slice(0, 4).map((t, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-gray-400">{t.trim()}</span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
            )}
            {loading && <div className="text-center text-gray-500 text-xs py-6">加载中…</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
