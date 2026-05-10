'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface PromptItem {
  id: number
  title: string
  category: string
  prompt: string
  previewUrl: string | null
}

const CATEGORIES = ['海报封面', '产品展示', '品牌宣传', '节日营销', '短视频封面']

export default function AdminPromptTemplatesPage() {
  const { user, loading: authLoading } = useAuth()
  const [items, setItems] = useState<PromptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<PromptItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [filterCat, setFilterCat] = useState('')
  const [generatingPreviews, setGeneratingPreviews] = useState(false)

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [prompt, setPrompt] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadItems()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadItems = async () => {
    try {
      const url = filterCat ? `/api/prompt-templates?category=${encodeURIComponent(filterCat)}` : '/api/prompt-templates'
      const r = await fetch(url, { credentials: 'include' })
      if (r.ok) setItems((await r.json()).data || [])
    } catch { console.error('load failed') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (!authLoading && user && user.role !== 'end-user') loadItems() }, [filterCat])

  const resetForm = () => { setTitle(''); setCategory(CATEGORIES[0]); setPrompt(''); setPreviewUrl('') }
  const openCreate = () => { resetForm(); setEditItem(null); setShowForm(true) }
  const openEdit = (item: PromptItem) => {
    setEditItem(item); setTitle(item.title); setCategory(item.category)
    setPrompt(item.prompt); setPreviewUrl(item.previewUrl || ''); setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!title || !prompt) { showToast('请填写标题和提示词 / TITLE & PROMPT REQUIRED', 'error'); return }
    setSubmitting(true)
    try {
      const url = '/api/prompt-templates'
      const method = editItem ? 'PUT' : 'POST'
      const body = editItem
        ? { id: editItem.id, title, category, prompt, previewUrl: previewUrl || null }
        : { title, category, prompt, previewUrl: previewUrl || null }
      const r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (r.ok) { setShowForm(false); loadItems(); showToast(editItem ? '已更新 / UPDATED' : '已创建 / CREATED') }
      else { const d = await r.json(); showToast(d.message || '操作失败 / FAILED', 'error') }
    } catch { showToast('操作失败 / FAILED', 'error') }
    finally { setSubmitting(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此模板？ / DELETE THIS TEMPLATE?')) return
    const r = await fetch(`/api/prompt-templates?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) { loadItems(); showToast('已删除 / DELETED') } else showToast('删除失败 / DELETE FAILED', 'error')
  }

  const handlePreseed = async () => {
    if (!confirm('预设 20 条营销提示词模板？ / PRESET 20 TEMPLATES?')) return
    const r = await fetch('/api/seed-prompt-templates', { method: 'POST', credentials: 'include' })
    const d = await r.json()
    showToast(d.message, d.success ? 'success' : 'error')
    if (d.success) loadItems()
  }

  const handleGeneratePreviews = async () => {
    if (!confirm('AI 生成预览图（需配置 API Key）？ / GENERATE PREVIEW IMAGES?')) return
    setGeneratingPreviews(true)
    showToast('开始生成... / GENERATING...')
    try {
      const r = await fetch('/api/generate-prompt-previews', { method: 'POST', credentials: 'include' })
      const d = await r.json()
      showToast(d.message, d.success ? 'success' : 'error')
      loadItems()
    } catch { showToast('生成失败 / FAILED', 'error') }
    finally { setGeneratingPreviews(false) }
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400"><span>加载中</span><span className="text-xs opacity-50 ml-1">/ LOADING</span></div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2"><span>无权限</span><span className="text-xs opacity-50 ml-1">/ ACCESS DENIED</span></p></div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2"><span>管理后台</span><span className="text-xs opacity-50 ml-1">/ ADMIN</span></p>
            <h1 className="text-mono-lg text-white"><span>提示词模板库</span><span className="text-sm opacity-50 ml-2">/ PROMPT TEMPLATES</span></h1>
            <p className="text-gray-400 text-sm mt-2"><span>总数</span><span className="text-xs opacity-50 ml-1">/ TOTAL</span>：<span className="text-emerald-400 font-bold">{items.length}</span></p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleGeneratePreviews} disabled={generatingPreviews} className="btn-secondary text-sm">
              {generatingPreviews ? <><span>生成中</span><span className="text-xs opacity-50 ml-1">/ BUSY</span></> : <><span>🎨 生成预览图</span><span className="text-xs opacity-50 ml-1">/ PREVIEW</span></>}
            </button>
            <button onClick={handlePreseed} className="btn-secondary text-sm"><span>预设模板</span><span className="text-xs opacity-50 ml-1">/ PRESET</span></button>
            <button onClick={openCreate} className="btn-primary"><span>+ 新建</span><span className="text-xs opacity-50 ml-1">/ NEW</span></button>
          </div>
        </div>

        {/* 分类筛选 */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <button onClick={() => setFilterCat('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono ${!filterCat ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
            <span>全部</span><span className="text-[10px] opacity-50 ml-1">/ ALL</span>
          </button>
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setFilterCat(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono ${filterCat === c ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
              {c}
            </button>
          ))}
        </div>

        {showForm && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4">{editItem ? <><span>编辑模板</span><span className="text-xs opacity-50 ml-1">/ EDIT</span></> : <><span>新建模板</span><span className="text-xs opacity-50 ml-1">/ NEW</span></>}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <input className="input-dark" placeholder="标题 / TITLE *" value={title} onChange={e => setTitle(e.target.value)} />
              <select className="input-dark" value={category} onChange={e => setCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c} className="bg-gray-900">{c}</option>)}
              </select>
              <input className="input-dark md:col-span-2" placeholder="预览图 URL / PREVIEW URL（可选）" value={previewUrl} onChange={e => setPreviewUrl(e.target.value)} />
            </div>
            <textarea className="input-dark mb-4 h-32 resize-y" placeholder="提示词内容 / PROMPT *" value={prompt} onChange={e => setPrompt(e.target.value)} />
            <div className="flex gap-3">
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary disabled:opacity-50">{submitting ? <><span>保存中</span><span className="text-xs opacity-50 ml-1">/ SAVING</span></> : <><span>保存</span><span className="text-xs opacity-50 ml-1">/ SAVE</span></>}</button>
              <button onClick={() => setShowForm(false)} className="btn-secondary"><span>取消</span><span className="text-xs opacity-50 ml-1">/ CANCEL</span></button>
            </div>
          </div>
        )}

        {loading ? <div className="text-center text-gray-400 py-12"><span>加载中</span><span className="text-xs opacity-50 ml-1">/ LOADING</span></div>
        : items.length === 0 ? <div className="card-glass p-12 text-center"><p className="text-gray-400"><span>暂无提示词模板</span><span className="text-xs opacity-50 ml-1">/ EMPTY</span></p></div>
        : <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.map(item => (
              <div key={item.id} className="card-glass p-5">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0 mr-3">
                    <h3 className="text-white font-bold text-sm truncate">{item.title}</h3>
                    <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400">{item.category}</span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => openEdit(item)} className="px-2 py-1 text-xs bg-white/10 text-gray-300 rounded hover:bg-white/20"><span>编辑</span><span className="text-[10px] opacity-50 ml-1">/ EDIT</span></button>
                    <button onClick={() => handleDelete(item.id)} className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30"><span>删除</span><span className="text-[10px] opacity-50 ml-1">/ DEL</span></button>
                  </div>
                </div>
                <div className="bg-black/30 rounded-lg p-3 mt-2">
                  <p className="text-gray-400 text-xs truncate">{item.prompt}</p>
                </div>
                {item.previewUrl && (
                  <img src={item.previewUrl} alt={item.title} className="mt-2 rounded-lg w-full h-32 object-cover" />
                )}
              </div>
            ))}
          </div>}
      </div>
    </div>
  )
}
