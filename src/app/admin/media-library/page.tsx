'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface MediaItem {
  id: number; ossUrl: string; title: string; type: string; ownerId: number; createdAt: string
}

export default function AdminMediaLibraryPage() {
  const { user, loading: authLoading } = useAuth()
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [ossUrl, setOssUrl] = useState('')
  const [typeTab, setTypeTab] = useState<'video' | 'image' | 'all'>('video')

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadItems()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user, typeTab])

  const loadItems = async () => {
    try {
      const url = `/api/media-library?type=${typeTab}`
      const r = await fetch(url, { credentials: 'include' })
      if (r.ok) setItems((await r.json()).data || [])
    } catch {} finally { setLoading(false) }
  }

  const handleAdd = async () => {
    if (!title || !ossUrl) { showToast('请填写完整', 'error'); return }
    if (!ossUrl.startsWith('http')) { showToast('OSS 地址必须是完整 URL', 'error'); return }
    setAdding(true)
    const r = await fetch('/api/media-library', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, ossUrl }) })
    if (r.ok) { setShowForm(false); setTitle(''); setOssUrl(''); loadItems(); showToast('素材已添加') }
    else { const d = await r.json(); showToast(d.message || '添加失败', 'error') }
    setAdding(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return
    const r = await fetch(`/api/media-library?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) { loadItems(); showToast('已删除') } else { showToast('删除失败', 'error') }
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

        {/* Tab */}
        <div className="flex gap-1 mb-4 bg-white/5 rounded-xl p-1 border border-white/10 w-fit">
          {([
            { key: 'video' as const, label: '🎬 视频' },
            { key: 'image' as const, label: '🖼️ 图片' },
            { key: 'all' as const, label: '📋 全部' },
          ]).map(tab => (
            <button key={tab.key} onClick={() => setTypeTab(tab.key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-mono transition-all ${typeTab === tab.key ? 'bg-emerald-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {showForm && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4">添加素材</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <input className="input-dark" placeholder="素材标题 *" value={title} onChange={e => setTitle(e.target.value)} />
              <input className="input-dark" placeholder="OSS URL *（自动识别视频/图片）" value={ossUrl} onChange={e => setOssUrl(e.target.value)} />
            </div>
            <button onClick={handleAdd} disabled={!title || !ossUrl || adding} className="btn-primary">{adding ? '添加中...' : '添加'}</button>
          </div>
        )}

        {loading ? <div className="text-center text-gray-400 py-12">加载中...</div>
        : items.length === 0 ? <div className="card-glass p-12 text-center"><p className="text-gray-400">暂无素材</p></div>
        : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map(item => (
              <div key={item.id} className="card-glass p-3 group">
                <div className={`${item.type === 'video' ? 'aspect-video' : 'aspect-square'} bg-black/40 rounded-lg mb-2 flex items-center justify-center overflow-hidden`}>
                  {item.type === 'video' ? (
                    <video src={item.ossUrl} className="w-full h-full object-cover" controls />
                  ) : (
                    <img src={item.ossUrl} alt={item.title} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-white font-medium text-xs truncate">{item.title}</h3>
                    <span className="text-[10px] text-gray-600">{item.type === 'video' ? '🎬 视频' : '🖼️ 图片'}</span>
                  </div>
                  <button onClick={() => handleDelete(item.id)} className="text-[10px] text-red-400 hover:text-red-300 ml-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">删除</button>
                </div>
              </div>
            ))}
          </div>}
      </div>
    </div>
  )
}
