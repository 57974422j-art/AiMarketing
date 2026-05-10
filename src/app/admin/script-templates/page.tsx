'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface ScriptItem {
  id: number
  title: string
  type: string
  content: string
  tags: string
  ownerId: number
  owner?: { id: number; username: string }
  createdAt: string
}

export default function AdminScriptTemplatesPage() {
  const { user, loading: authLoading } = useAuth()
  const [items, setItems] = useState<ScriptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<ScriptItem | null>(null)
  const [title, setTitle] = useState('')
  const [type, setType] = useState('评论')
  const [content, setContent] = useState('')
  const [tagsStr, setTagsStr] = useState('')

  const types = ['评论', '私信', '直播互动']

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadItems()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadItems = async () => {
    try {
      const res = await fetch('/api/script-templates', { credentials: 'include' })
      if (res.ok) { const d = await res.json(); setItems(d.data || []) }
    } catch { console.error('加载失败') }
    finally { setLoading(false) }
  }

  const resetForm = () => { setTitle(''); setType('评论'); setContent(''); setTagsStr('') }

  const openCreate = () => { resetForm(); setEditItem(null); setShowForm(true) }
  const openEdit = (item: ScriptItem) => {
    setEditItem(item); setTitle(item.title); setType(item.type); setContent(item.content)
    try { setTagsStr(JSON.parse(item.tags).join(', ')) } catch { setTagsStr('') }
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!title || !content) { showToast('请填写完整', 'error'); return }
    const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean)
    try {
      const url = '/api/script-templates'
      const method = editItem ? 'PUT' : 'POST'
      const body = editItem ? { id: editItem.id, title, type, content, tags } : { title, type, content, tags }
      const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (res.ok) { setShowForm(false); loadItems() }
      else { const d = await res.json(); showToast(d.message || '操作失败', 'error') }
    } catch { showToast('操作失败', 'error') }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return
    const res = await fetch(`/api/script-templates?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) loadItems(); else showToast('删除失败', 'error')
  }

  const parseTags = (tagsStr: string) => {
    try { return JSON.parse(tagsStr) as string[] } catch { return [] }
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2">无权限访问</p></div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">管理后台 / ADMIN</p>
            <h1 className="text-mono-lg text-white">话术模板库 / SCRIPT TEMPLATES</h1>
            <p className="text-gray-400 text-sm mt-2">总数：<span className="text-emerald-400 font-bold">{items.length}</span></p>
          </div>
          <button onClick={openCreate} className="btn-primary">+ 新建话术</button>
        </div>

        {showForm && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4">{editItem ? '编辑话术' : '新建话术'}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <input className="input-dark" placeholder="标题 *" value={title} onChange={e => setTitle(e.target.value)} />
              <select className="input-dark" value={type} onChange={e => setType(e.target.value)}>
                {types.map(t => <option key={t} value={t} className="bg-gray-900">{t}</option>)}
              </select>
              <input className="input-dark md:col-span-2" placeholder="标签（逗号分隔）" value={tagsStr} onChange={e => setTagsStr(e.target.value)} />
            </div>
            <textarea className="input-dark mb-4 h-32 resize-y" placeholder="话术内容 *" value={content} onChange={e => setContent(e.target.value)} />
            <div className="flex gap-3">
              <button onClick={handleSubmit} className="btn-primary">保存</button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">取消</button>
            </div>
          </div>
        )}

        {loading ? <div className="text-center text-gray-400 py-12">加载中...</div>
        : items.length === 0 ? <div className="card-glass p-12 text-center"><p className="text-gray-400">暂无话术</p></div>
        : <div className="space-y-4">
            {items.map(item => (
              <div key={item.id} className="card-glass p-6">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="text-white font-bold">{item.title}</h3>
                    <div className="flex gap-2 mt-1 text-xs">
                      <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">{item.type}</span>
                      {parseTags(item.tags).map((tag, i) => (
                        <span key={i} className="bg-white/5 text-gray-400 px-2 py-0.5 rounded">#{tag}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => openEdit(item)} className="px-3 py-1 text-xs bg-white/10 text-gray-300 rounded hover:bg-white/20">编辑</button>
                    <button onClick={() => handleDelete(item.id)} className="px-3 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30">删除</button>
                  </div>
                </div>
                <div className="bg-black/30 rounded-lg p-3 mt-2">
                  <p className="text-gray-300 text-sm whitespace-pre-wrap">{item.content}</p>
                </div>
              </div>
            ))}
          </div>}
      </div>
    </div>
  )
}
