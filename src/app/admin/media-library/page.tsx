'use client'
import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface MediaItem {
  id: number; ossUrl: string; title: string; type: string
  prompt: string; category: string; source: string
  purpose?: string; industry?: string; platform?: string
  thumbnailUrl?: string; originalUrl?: string
  ownerId: number; createdAt: string
}

export default function AdminMediaLibraryPage() {
  const { user, loading: authLoading } = useAuth()
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [ossUrl, setOssUrl] = useState('')
  const [prompt, setPrompt] = useState('')
  const [typeTab, setTypeTab] = useState<string>('video')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [playVideo, setPlayVideo] = useState('')
  const [favIds, setFavIds] = useState<Set<number>>(new Set())
  const [purposeFilter, setPurposeFilter] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')

  const filtered = useMemo(() => items.filter(i =>
    (!purposeFilter || i.purpose === purposeFilter) &&
    (!industryFilter || i.industry === industryFilter)
  ), [items, purposeFilter, industryFilter])
  const purposeOptions = useMemo(() => Array.from(new Set(items.map(i => i.purpose).filter(Boolean))), [items])
  const industryOptions = useMemo(() => Array.from(new Set(items.map(i => i.industry).filter(Boolean))), [items])

  const TABS = [
    { key: 'video', label: '🎬 视频' },
    { key: 'image', label: '🖼️ 图片' },
    { key: 'scene', label: '🏞️ 场景' },
    { key: 'digital', label: '🤖 数字人' },
    { key: 'all', label: '📋 全部' },
  ]

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadItems()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user, typeTab])

  const loadItems = async () => {
    try {
      const params = new URLSearchParams()
      if (typeTab === 'scene') params.set('category', '场景')
      else if (typeTab === 'digital') params.set('category', '数字人')
      else params.set('type', typeTab)
      const r = await fetch(`/api/media-library?${params}`, { credentials: 'include' })
      if (r.ok) setItems((await r.json()).data || [])
    } catch {} finally { setLoading(false) }
  }

  const handleAdd = async () => {
    if (!title || !ossUrl) { showToast('请填写完整', 'error'); return }
    if (!ossUrl.startsWith('http')) { showToast('OSS 地址必须是完整 URL', 'error'); return }
    setAdding(true)
    const r = await fetch('/api/media-library', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, ossUrl, prompt }) })
    if (r.ok) { setShowForm(false); setTitle(''); setOssUrl(''); setPrompt(''); loadItems(); showToast('素材已添加') }
    else { const d = await r.json(); showToast(d.message || '添加失败', 'error') }
    setAdding(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return
    const r = await fetch(`/api/media-library?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) { loadItems(); showToast('已删除') } else { showToast('删除失败', 'error') }
  }

  const handleFavorite = async (item: MediaItem) => {
    if (favIds.has(item.id)) return
    const r = await fetch('/api/media-library', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, action: 'favorite' }) })
    if (r.ok) { setFavIds(p => new Set(p).add(item.id)); showToast('已收藏到我的') }
    else showToast('收藏失败', 'error')
  }

  const handleUse = (item: MediaItem, target: 'image' | 'video') => {
    const params = new URLSearchParams({ prompt: item.prompt || item.title, refUrl: item.ossUrl })
    window.open(target === 'image' ? `/image-generator?${params}` : `/text-to-video?${params}`, '_blank')
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2">无权限</p></div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-label mb-2">管理后台 / ADMIN</p>
            <h1 className="text-mono-lg text-white">素材库 / MEDIA LIBRARY</h1>
            <p className="text-gray-400 text-sm mt-1">总数：<span className="text-emerald-400 font-bold">{items.length}</span></p>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm py-2">{showForm ? '取消' : '+ 添加素材'}</button>
        </div>

        {/* 添加表单 */}
        {showForm && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4">添加素材</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <input className="input-dark" placeholder="素材标题 *" value={title} onChange={e => setTitle(e.target.value)} />
              <input className="input-dark" placeholder="OSS URL *" value={ossUrl} onChange={e => setOssUrl(e.target.value)} />
              <input className="input-dark" placeholder="提示词（可选）" value={prompt} onChange={e => setPrompt(e.target.value)} />
            </div>
            <button onClick={handleAdd} disabled={!title || !ossUrl || adding} className="btn-primary">{adding ? '添加中...' : '添加'}</button>
          </div>
        )}

        {/* Tab */}
        <div className="flex gap-1 mb-4 bg-white/5 rounded-xl p-1 border border-white/10 w-fit flex-wrap">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setTypeTab(tab.key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-mono transition-all ${typeTab === tab.key ? 'bg-emerald-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-4 flex-wrap items-center">
          <select value={purposeFilter} onChange={e => setPurposeFilter(e.target.value)} className="input-dark text-xs px-2 py-1 rounded-lg">
            <option value="">全部用途</option>
            {purposeOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={industryFilter} onChange={e => setIndustryFilter(e.target.value)} className="input-dark text-xs px-2 py-1 rounded-lg">
            <option value="">全部行业</option>
            {industryOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {loading ? <div className="text-center text-gray-400 py-12">加载中...</div>
        : filtered.length === 0 ? <div className="card-glass p-12 text-center"><p className="text-gray-400">暂无素材</p></div>
        : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(item => (
              <div key={item.id} className="card-glass overflow-hidden group">
                {/* 媒体内容 */}
                <div className={`${item.type === 'video' ? 'aspect-video' : 'aspect-square'} bg-black/40 flex items-center justify-center overflow-hidden relative cursor-pointer`}
                  onClick={() => item.type === 'video' && setPlayVideo(item.ossUrl)}>
                  {item.type === 'video' ? (
                    item.thumbnailUrl
                      ? <img src={item.thumbnailUrl} className="w-full h-full object-cover" />
                      : <video src={item.ossUrl} className="w-full h-full object-cover" />
                  ) : (
                    <img src={item.thumbnailUrl || item.ossUrl} alt={item.title} className="w-full h-full object-cover" />
                  )}
                  {item.type === 'video' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-12 h-12 rounded-full bg-white/80 flex items-center justify-center">
                        <div className="w-0 h-0 border-t-8 border-b-8 border-l-12 border-transparent border-l-gray-900 ml-1" />
                      </div>
                    </div>
                  )}
                </div>

                {/* 信息区 */}
                <div className="p-3">
                  <div className="flex flex-wrap gap-1 mb-1">
                    {item.purpose && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">{item.purpose}</span>}
                    {item.industry && <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400">{item.industry}</span>}
                    {item.platform && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">{item.platform}</span>}
                  </div>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-white font-medium text-xs truncate">{item.title}</h3>
                    <span className="text-[10px] text-gray-500 shrink-0 ml-1">
                      {item.type === 'video' ? '🎬' : '🖼️'}
                    </span>
                  </div>

                  {/* 提示词 */}
                  {item.prompt && (
                    <div className="mb-2">
                      <p className="text-gray-400 text-[10px] leading-relaxed">
                        {expanded.has(item.id) || item.prompt.length < 80
                          ? item.prompt
                          : item.prompt.substring(0, 80) + '...'}
                        {item.prompt.length >= 80 && (
                          <button onClick={() => setExpanded(p => { const n = new Set(p); expanded.has(item.id) ? n.delete(item.id) : n.add(item.id); return n })}
                            className="text-cyan-400 ml-1">{expanded.has(item.id) ? '收起' : '更多'}</button>
                        )}
                      </p>
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {item.type === 'image' && (
                      <button onClick={() => handleUse(item, 'image')}
                        className="px-2 py-1 text-[10px] bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded hover:bg-emerald-500/30">
                        使用到文生图
                      </button>
                    )}
                    <button onClick={() => handleUse(item, 'video')}
                      className="px-2 py-1 text-[10px] bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded hover:bg-cyan-500/30">
                      使用到文生视频
                    </button>
                    {!favIds.has(item.id) && (
                      <button onClick={() => handleFavorite(item)}
                        className="px-2 py-1 text-[10px] bg-purple-500/20 border border-purple-500/30 text-purple-400 rounded hover:bg-purple-500/30">
                        收藏
                      </button>
                    )}
                    <button onClick={() => handleDelete(item.id)}
                      className="px-2 py-1 text-[10px] bg-red-500/20 border border-red-500/30 text-red-400 rounded hover:bg-red-500/30 ml-auto">
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>}

        {/* 视频播放弹窗 */}
        {playVideo && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center" onClick={() => setPlayVideo('')}>
            <video src={playVideo} controls autoPlay className="max-w-[80vw] max-h-[80vh] rounded-xl" onClick={e => e.stopPropagation()} />
          </div>
        )}
      </div>
    </div>
  )
}
