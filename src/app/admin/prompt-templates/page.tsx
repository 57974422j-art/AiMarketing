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

const CATEGORIES = ['海报封面', '产品展示', '品牌宣传', '节日营销', '短视频封面', '文生图', '文生视频', '场景', '数字人']

const IMG_MODELS = [
  { value: 'auto', label: '自动(Auto)', desc: 'Agnes→百炼→硅基' },
  { value: 'agnes', label: 'Agnes AI', desc: '全模态主用' },
  { value: 'dashscope', label: '百炼 wan2.6', desc: '图文生图' },
  { value: 'qwen-image-2.0', label: '通义千问 2.0', desc: '最新轻量' },
  { value: 'qwen-image-2.0-pro', label: '通义千问 2.0 Pro', desc: '最新高质' },
  { value: 'siliconflow', label: '硅基 Z-Image', desc: '备选' },
]
const VID_MODELS = [
  { value: '', label: '自动', desc: 'Agnes→wan2.7' },
  { value: 'agnes', label: 'Agnes AI', desc: '全模态主用' },
  { value: 'doubao', label: 'Doubao', desc: '火山' },
  { value: 'wan2.7', label: 'wan2.7', desc: '百炼' },
  { value: 'happyhorse', label: '快乐小马', desc: '自动配音' },
]

type ModeTab = 'image' | 'video' | 'scene' | 'digital' | 'all'
const SUB_CATS: any = {
  image: ['海报封面', '产品展示', '品牌宣传', '节日营销', '短视频封面'],
  video: ['商业广告', '产品介绍', '品牌故事', '场景宣传'],
  scene: ['商场超市', '乡间地头', '海滩度假', '咖啡书店', '城市街头', '户外露营'],
  digital: ['男性青年', '女性青年', '商务正装', '休闲日常', '古风国潮'],
}

export default function AdminPromptTemplatesPage() {
  const { user, loading: authLoading } = useAuth()
  const [items, setItems] = useState<PromptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<PromptItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [filterCat, setFilterCat] = useState('')
  const [modeTab, setModeTab] = useState<ModeTab>('image')

  // 选中项
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // 批量操作状态
  const [busy, setBusy] = useState({ fetch: false, imgPreview: false, vidPreview: false, genDigital: false, preseeding: false, aishort: false })
  const [progress, setProgress] = useState({ show: false, text: '' })

  // 生成控制参数
  const [batchLimit, setBatchLimit] = useState(10)
  const [imgModel, setImgModel] = useState('auto')
  const [vidModel, setVidModel] = useState('')

  // 场景生成
  const [sceneInput, setSceneInput] = useState('')
  const [sceneGenerating, setSceneGenerating] = useState(false)

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [prompt, setPrompt] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [playVideo, setPlayVideo] = useState('')

  useEffect(() => {
    if (!authLoading && user && user.role === 'admin') loadItems()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadItems = async () => {
    try {
      const params = new URLSearchParams()
      if (filterCat) params.set('category', filterCat)
      else if (modeTab === 'scene') params.set('category', '场景')
      else if (modeTab === 'digital') params.set('category', '数字人')
      else if (modeTab === 'image') params.set('type', 'image')
      else if (modeTab === 'video') params.set('type', 'video')
      const url = '/api/prompt-templates?' + params.toString()
      const r = await fetch(url, { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        setItems(data.data || [])
      }
    } catch { console.error('load failed') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (!authLoading && user && user.role === 'admin') loadItems() }, [filterCat, modeTab])

  const filteredItems = items

  // ===== 选择 =====
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filteredItems.map(i => i.id)))
  }

  // ===== CRUD =====
  const resetForm = () => { setTitle(''); setCategory(CATEGORIES[0]); setPrompt(''); setPreviewUrl('') }
  const openCreate = () => { resetForm(); setEditItem(null); setShowForm(true) }
  const openEdit = (item: PromptItem) => {
    setEditItem(item); setTitle(item.title); setCategory(item.category)
    setPrompt(item.prompt); setPreviewUrl(item.previewUrl || ''); setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!title || !prompt) { showToast('请填写标题和提示词', 'error'); return }
    setSubmitting(true)
    try {
      const url = '/api/prompt-templates'
      const method = editItem ? 'PUT' : 'POST'
      const body = editItem
        ? { id: editItem.id, title, category, prompt, previewUrl: previewUrl || null }
        : { title, category, prompt, previewUrl: previewUrl || null }
      const r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (r.ok) { setShowForm(false); loadItems(); showToast(editItem ? '已更新' : '已创建') }
      else { const d = await r.json(); showToast(d.message || '操作失败', 'error') }
    } catch { showToast('操作失败', 'error') }
    finally { setSubmitting(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return
    const r = await fetch(`/api/prompt-templates?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) { loadItems(); showToast('已删除') } else showToast('删除失败', 'error')
  }

  // ===== 预设 / 抓取 =====
  const handlePreseed = async () => {
    if (!confirm('预设 20 条营销提示词模板？')) return
    setBusy(p => ({ ...p, preseeding: true }))
    const r = await fetch('/api/seed-prompt-templates', { method: 'POST', credentials: 'include' })
    const d = await r.json()
    showToast(d.message, d.success ? 'success' : 'error')
    if (d.success) loadItems()
    setBusy(p => ({ ...p, preseeding: false }))
  }

  const handleFetch = async (type: 'image' | 'video' | 'scene') => {
    if (!confirm(`从外部源抓取${type === 'image' ? '文生图' : '文生视频'}提示词？`)) return
    setBusy(p => ({ ...p, fetch: true }))
    try {
      const r = await fetch(`/api/fetch-prompts?type=${type}`, { method: 'POST', credentials: 'include' })
      const d = await r.json()
      showToast(d.message, d.success ? 'success' : 'error')
      if (d.success) loadItems()
    } catch { showToast('抓取失败', 'error') }
    finally { setBusy(p => ({ ...p, fetch: false })) }
  }

  // ===== AiShort 导入 =====
  const handleAIShort = async () => {
    if (!confirm('从 AiShort 导入中文提示词（约800条）？')) return
    setBusy(p => ({ ...p, aishort: true }))
    try {
      const r = await fetch('/api/seed-from-aishort', { method: 'POST', credentials: 'include' })
      const d = await r.json()
      showToast(d.message, d.success ? 'success' : 'error')
      if (d.success) loadItems()
    } catch { showToast('导入失败', 'error') }
    finally { setBusy(p => ({ ...p, aishort: false })) }
  }

  // ===== 批量生成 =====
  const runBatch = async (endpoint: string, mode: 'imgPreview' | 'vidPreview') => {
    const targetIds = selectedIds.size > 0 ? Array.from(selectedIds) : null
    if (targetIds && targetIds.length === 0) { showToast('请先选择模板', 'error'); return }
    const label = mode === 'imgPreview' ? '预览图' : '视频预览'
    if (targetIds) {
      if (!confirm(`为已选 ${targetIds.length} 个模板生成 ${label}？`)) return
    } else {
      if (!confirm(`为全部模板生成 ${label}（最多 ${batchLimit} 个）？`)) return
    }
    setBusy(p => ({ ...p, [mode]: true }))
    setProgress({ show: true, text: `正在生成 ${label}...` })
    try {
      const r = await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: targetIds,
          limit: targetIds ? targetIds.length : batchLimit,
          model: mode === 'imgPreview' ? imgModel : vidModel,
        }),
      })
      const d = await r.json()
      if (d?.data?.total) setProgress({ show: true, text: `完成 ${d.data.success}/${d.data.total}` })
      showToast(d.message, d.success ? 'success' : 'error')
      loadItems()
    } catch { showToast('生成失败', 'error') }
    finally { setBusy(p => ({ ...p, [mode]: false })); setTimeout(() => setProgress(p => ({ ...p, show: false })), 2000) }
  }

  // ===== 导入素材库 =====
  const handleImportToMedia = async () => {
    const targetIds = selectedIds.size > 0 ? Array.from(selectedIds) : items.map(i => i.id)
    if (targetIds.length === 0) { showToast('没有可选模板', 'error'); return }
    // 筛选有预览图的
    const withPreview = items.filter(i => targetIds.includes(i.id) && i.previewUrl)
    if (withPreview.length === 0) { showToast('所选模板没有预览图，请先生成', 'error'); return }
    if (!confirm(`将 ${withPreview.length} 个模板预览图导入素材库？`)) return
    try {
      const batch = withPreview.map(item => ({
        title: `模板-${item.title}`,
        ossUrl: item.previewUrl!,
        prompt: item.prompt,
        category: item.category,
      }))
      const r = await fetch('/api/media-library', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      })
      const d = await r.json()
      showToast(d.message || `已导入 ${batch.length} 个`, d.success ? 'success' : 'error')
    } catch { showToast('导入失败', 'error') }
  }

  // ===== 场景生成 =====
  const handleSceneGen = async () => {
    if (!sceneInput.trim()) { showToast('请输入场景描述', 'error'); return }
    setSceneGenerating(true)
    try {
      const r = await fetch('/api/ai-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'scene-prompts',
          scene: sceneInput.trim(),
          language: 'zh',
        }),
      })
      const d = await r.json()
      if (d.success && d.prompts) {
        for (const p of d.prompts) {
          await fetch('/api/prompt-templates', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: p.title, category: p.category, prompt: p.prompt }),
          })
        }
        showToast(`已生成 ${d.prompts.length} 条模板`)
        loadItems()
        setSceneInput('')
      } else {
        showToast(d.message || '生成失败', 'error')
      }
    } catch { showToast('请求失败', 'error') }
    finally { setSceneGenerating(false) }
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role !== 'admin') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2">仅管理员可访问</p><p className="text-xs text-gray-500 mt-1">二级客户请到素材库选择模板</p></div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-label mb-2">管理后台 / ADMIN</p>
            <h1 className="text-mono-lg text-white">提示词模板库 / PROMPT TEMPLATES</h1>
            <p className="text-gray-400 text-sm mt-1">总数：<span className="text-emerald-400 font-bold">{items.length}</span> / 已选：<span className="text-cyan-400 font-bold">{selectedIds.size}</span></p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={() => handleFetch('image')} disabled={busy.fetch} className="btn-secondary text-xs py-2">{busy.fetch ? '抓取中' : '🌄 抓取文生图'}</button>
            <button onClick={() => handleFetch('video')} disabled={busy.fetch} className="btn-secondary text-xs py-2">{busy.fetch ? '抓取中' : '🎬 抓取文生视频'}</button>
            <button onClick={() => handleFetch('scene')} disabled={busy.fetch} className="btn-secondary text-xs py-2">{busy.fetch ? '抓取中' : '🏞️ 抓取场景'}</button>
            <button onClick={handlePreseed} disabled={busy.preseeding} className="btn-secondary text-xs py-2">{busy.preseeding ? '填充中' : '📦 预设'}</button>
            <button onClick={handleAIShort} disabled={busy.aishort} className="btn-secondary text-xs py-2">{busy.aishort ? '导入中' : '📥 导入AiShort'}</button>
            <button onClick={openCreate} className="btn-primary text-xs py-2">+ 新建</button>
          </div>
        </div>

        {/* Tab：大分类 */}
        <div className="flex gap-1 mb-4 bg-white/5 rounded-xl p-1 border border-white/10 w-fit">
          {([
            { key: 'all' as const, label: '📋 全部' },
            { key: 'image' as const, label: '🎨 文生图' },
            { key: 'video' as const, label: '🎬 文生视频' },
            { key: 'scene' as const, label: '🏞️ 场景' },
            { key: 'digital' as const, label: '🤖 数字人' },
          ]).map(tab => (
            <button key={tab.key} onClick={() => { setModeTab(tab.key); setFilterCat(''); setSelectedIds(new Set()) }}
              className={`px-4 py-1.5 rounded-lg text-xs font-mono transition-all ${modeTab === tab.key ? 'bg-emerald-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* 批量操作控制栏 */}
        <div className="bg-white/5 rounded-2xl border border-white/10 p-4 mb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 ? (
                <span className="text-xs text-cyan-400 font-mono">已选 {selectedIds.size} 项</span>
              ) : (
                <>
                  <span className="text-xs text-gray-500 font-mono">批量:</span>
                  <input type="number" min={1} max={100} value={batchLimit} onChange={e => setBatchLimit(parseInt(e.target.value) || 10)}
                    className="w-16 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs text-center" />
                  <span className="text-[10px] text-gray-600">条/次</span>
                </>
              )}
            </div>

            {/* 文生图模型 */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">图模型:</span>
              {IMG_MODELS.map(m => (
                <button key={m.value} onClick={() => setImgModel(m.value)}
                  className={`px-2 py-1 rounded text-[10px] ${imgModel === m.value ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>
                  {m.label}
                </button>
              ))}
            </div>

            {/* 文生视频模型 */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">视频模型:</span>
              {VID_MODELS.map(m => (
                <button key={m.value} onClick={() => setVidModel(m.value)}
                  className={`px-2 py-1 rounded text-[10px] ${vidModel === m.value ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2 ml-auto flex-wrap">
              <button onClick={() => runBatch('/api/generate-prompt-previews', 'imgPreview')} disabled={busy.imgPreview || busy.vidPreview}
                className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs hover:bg-emerald-500/30 disabled:opacity-50">
                {busy.imgPreview ? '生成中...' : '🎨 预览图'}
              </button>
              <button onClick={() => runBatch('/api/batch-generate-video-previews', 'vidPreview')} disabled={busy.vidPreview || busy.imgPreview}
                className="px-3 py-1.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded-lg text-xs hover:bg-cyan-500/30 disabled:opacity-50">
                {busy.vidPreview ? '生成中...' : '🎬 视频预览'}
              </button>
              <button onClick={async () => {
                if (!confirm('生成 6 个数字人口播模板？')) return
                setBusy(p => ({ ...p, genDigital: true }))
                try {
                  const r = await fetch('/api/generate-digital-prompts', { method: 'POST', credentials: 'include' })
                  const d = await r.json()
                  showToast(d.message, d.success ? 'success' : 'error')
                  if (d.success) loadItems()
                } catch { showToast('生成失败', 'error') }
                finally { setBusy(p => ({ ...p, genDigital: false })) }
              }} disabled={busy.genDigital}
                className="px-3 py-1.5 bg-purple-500/20 border border-purple-500/30 text-purple-400 rounded-lg text-xs hover:bg-purple-500/30 disabled:opacity-50">
                {busy.genDigital ? '生成中...' : '🤖 数字人模板'}
              </button>
              <button onClick={handleImportToMedia}
                className="px-3 py-1.5 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg text-xs hover:bg-blue-500/30">
                📦 导入素材库
              </button>
            </div>
          </div>
        </div>

        {/* 场景生成 */}
        <div className="bg-gradient-to-r from-emerald-500/5 to-cyan-500/5 rounded-2xl border border-emerald-500/20 p-4 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-xs text-emerald-400 font-mono shrink-0">🏞️ 场景生模板</span>
            <input value={sceneInput} onChange={e => setSceneInput(e.target.value)}
              placeholder="输入场景描述，如：夏日海滩度假产品推广"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-500 focus:outline-none focus:border-emerald-500/50" />
            <button onClick={handleSceneGen} disabled={sceneGenerating || !sceneInput.trim()}
              className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-xs hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed shrink-0">
              {sceneGenerating ? '生成中...' : 'AI 生成'}
            </button>
          </div>
        </div>

        {/* 子分类筛选（根据大分类切换） */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <button onClick={() => setFilterCat('')}
            className={`px-2 py-1 rounded text-xs ${!filterCat ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>
            全部
          </button>
          {(SUB_CATS[modeTab] || []).map((c: string) => (
            <button key={c} onClick={() => setFilterCat(c)}
              className={`px-2 py-1 rounded text-xs ${filterCat === c ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
              {c}
            </button>
          ))}
        </div>

        {/* 表单 */}
        {showForm && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4">{editItem ? '编辑模板 / EDIT' : '新建模板 / NEW'}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <input className="input-dark" placeholder="标题 / TITLE *" value={title} onChange={e => setTitle(e.target.value)} />
              <select className="input-dark" value={category} onChange={e => setCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c} className="bg-gray-900">{c}</option>)}
              </select>
              <input className="input-dark md:col-span-2" placeholder="预览图 URL（可选）" value={previewUrl} onChange={e => setPreviewUrl(e.target.value)} />
            </div>
            <textarea className="input-dark mb-4 h-32 resize-y" placeholder="提示词内容 / PROMPT *" value={prompt} onChange={e => setPrompt(e.target.value)} />
            <div className="flex gap-3">
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary disabled:opacity-50">{submitting ? '保存中...' : '保存'}</button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">取消</button>
            </div>
          </div>
        )}

        {/* 列表 */}
        {loading ? <div className="text-center text-gray-400 py-12">加载中...</div>
        : items.length === 0 ? <div className="card-glass p-12 text-center"><p className="text-gray-400">暂无模板</p></div>
        : <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <input type="checkbox" checked={selectedIds.size === filteredItems.length && filteredItems.length > 0} onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-white/20 bg-white/5 accent-emerald-500" />
              <span className="text-xs text-gray-500 font-mono">全选</span>
              {selectedIds.size > 0 && (
                <span className="text-xs text-cyan-400 font-mono">已选 {selectedIds.size} 项</span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map(item => (
                <div key={item.id} className={`card-glass border-2 transition-all overflow-hidden ${selectedIds.has(item.id) ? 'border-emerald-500/50' : 'border-transparent'}`} style={{ height: '200px' }}>
                  {item.previewUrl ? (
                    <div className={`relative w-full h-full group ${item.previewUrl.endsWith('.mp4') ? 'cursor-pointer' : ''}`} onClick={() => item.previewUrl?.endsWith('.mp4') && setPlayVideo(item.previewUrl)}>
                      {item.previewUrl.endsWith('.mp4')
                        ? <video src={item.previewUrl} className="w-full h-full object-cover" />
                        : <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
                      }
                      {/* 图片 hover 放大预览 */}
                      {!item.previewUrl.endsWith('.mp4') && (
                        <div className="hidden group-hover:block fixed z-40 pointer-events-none" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', maxWidth: '60vw', maxHeight: '80vh' }}>
                          <img src={item.previewUrl} alt="" className="max-w-[60vw] max-h-[80vh] rounded-xl shadow-2xl border border-white/20" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                      {/* 顶部：复选框 + 操作按钮 */}
                      <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-2">
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                          className="w-4 h-4 rounded border-white/40 bg-black/30 accent-emerald-500" />
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(item)} className="px-1.5 py-0.5 text-[10px] bg-black/50 text-gray-200 rounded hover:bg-black/70">编辑</button>
                          <button onClick={() => handleDelete(item.id)} className="px-1.5 py-0.5 text-[10px] bg-red-500/50 text-white rounded hover:bg-red-500/70">删</button>
                        </div>
                      </div>
                      {/* 底部：标题 + 分类 + 提示词 */}
                      <div className="absolute bottom-0 left-0 right-0 p-2">
                        <h3 className="text-white text-xs font-bold truncate">{item.title}</h3>
                        <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] ${item.category === '文生图' || item.category === '文生视频' ? 'bg-cyan-500/40 text-cyan-200' : 'bg-emerald-500/40 text-emerald-200'}`}>
                          {item.category}
                        </span>
                        <p className="text-gray-300 text-[10px] mt-0.5 line-clamp-1">{item.prompt}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                      <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                        className="w-4 h-4 mb-2 rounded border-white/20 bg-white/5 accent-emerald-500" />
                      <h3 className="text-white font-bold text-xs">{item.title}</h3>
                      <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] ${item.category === '文生图' || item.category === '文生视频' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{item.category}</span>
                      <p className="text-gray-500 text-[10px] mt-1 line-clamp-2">{item.prompt}</p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => openEdit(item)} className="px-2 py-1 text-[10px] bg-white/10 text-gray-300 rounded">编辑</button>
                        <button onClick={() => handleDelete(item.id)} className="px-2 py-1 text-[10px] bg-red-500/20 text-red-400 rounded">删</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>}

        {/* 进度弹窗 */}
        {progress.show && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-8 max-w-sm w-full mx-4 text-center">
              <svg className="w-10 h-10 animate-spin text-emerald-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <p className="text-white text-sm font-mono">{progress.text}</p>
            </div>
          </div>
        )}

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
