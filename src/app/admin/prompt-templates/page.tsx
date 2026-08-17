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
  industry?: string | null
  coverUrl?: string | null
  tags?: string | null
  author?: string | null
}

interface FetchLog {
  ok: boolean
  source: string
  title?: string
  category?: string
  reason?: string
}

const CATEGORIES = ['海报封面', '产品展示', '品牌宣传', '节日营销', '短视频封面', '文生图', '文生视频', '场景', '数字人', 'AI 工具']
const INDUSTRIES = ['美业', '教育', '电商', '餐饮', '房产', '健身', '旅游', '服装']

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

type ModeTab = 'image' | 'video' | 'scene' | 'digital' | 'learn' | 'all'
type MainTab = 'manage' | 'fetch' | 'generate' | 'maintain'

const SUB_CATS: any = {
  image: ['海报封面', '产品展示', '品牌宣传', '节日营销', '短视频封面'],
  video: ['商业广告', '产品介绍', '品牌故事', '场景宣传'],
  scene: ['商场超市', '乡间地头', '海滩度假', '咖啡书店', '城市街头', '户外露营'],
  digital: ['男性青年', '女性青年', '商务正装', '休闲日常', '古风国潮'],
}

export default function AdminPromptTemplatesPage() {
  const { user, loading: authLoading } = useAuth()
  const [items, setItems] = useState<PromptItem[]>([])
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<PromptItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [filterCat, setFilterCat] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [modeTab, setModeTab] = useState<ModeTab>('image')
  const [modelFilter, setModelFilter] = useState('')  // 2026-08-14 按模型筛选（Seedance/H3/GPT-Image 等）

  // 主 Tab（2026-08-08：逻辑分组，避免按钮混乱）
  const [mainTab, setMainTab] = useState<MainTab>('manage')

  // 选中项
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // 批量操作状态
  const [busy, setBusy] = useState({ fetch: false, imgPreview: false, vidPreview: false, genDigital: false, preseeding: false, aishort: false })
  const [progress, setProgress] = useState({ show: false, text: '' })

  // 生成控制参数
  const [batchLimit, setBatchLimit] = useState(10)
  const [fetchCount, setFetchCount] = useState(10)
  const [imgModel, setImgModel] = useState('auto')
  const [vidModel, setVidModel] = useState('')

  // 抓取日志（2026-08-08：每次抓取的逐条结果，透明可见）
  const [fetchLogs, setFetchLogs] = useState<FetchLog[]>([])
  const [fetchLogLabel, setFetchLogLabel] = useState('')
  // 视频手动抓取（2026-08-10）
  const [vidFetchPlatform, setVidFetchPlatform] = useState('youtube')
  const [vidFetchCount, setVidFetchCount] = useState(3)
  const [vidMinDur, setVidMinDur] = useState(15)
  const [vidMaxDur, setVidMaxDur] = useState(180)
  const [vidKeyword, setVidKeyword] = useState('')
  const [vidFetchBusy, setVidFetchBusy] = useState(false)
  const [vidFetchRunning, setVidFetchRunning] = useState(false)
  const [vidFetchLog, setVidFetchLog] = useState('')
  const refreshVidLog = async () => {
    try {
      const r = await fetch('/api/admin/fetch-videos', { credentials: 'include' })
      const d = await r.json()
      if (d.success && d.data) { setVidFetchRunning(d.data.running); setVidFetchLog(d.data.tail || '') }
    } catch {}
  }
  const handleFetchVideos = async () => {
    setVidFetchBusy(true)
    try {
      const r = await fetch('/api/admin/fetch-videos', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: vidFetchPlatform, count: vidFetchCount, minDuration: vidMinDur, maxDuration: vidMaxDur, keyword: vidKeyword }), credentials: 'include' })
      const d = await r.json()
      if (!d.success) { alert(d.message); return }
      setVidFetchRunning(true)
      // 轮询日志
      const t = setInterval(async () => {
        await refreshVidLog()
        if (!(await (async () => { try { const rr = await fetch('/api/admin/fetch-videos', { credentials: 'include' }); return (await rr.json()).data.running } catch { return false } })())) {
          clearInterval(t); setVidFetchBusy(false)
        }
      }, 5000)
    } catch (e: any) { alert('启动失败: ' + (e?.message || e)) }
    finally { setVidFetchBusy(false) }
  }

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
      else if (modeTab === 'learn') params.set('source', 'cheerselfai')
      // 2026-08-16: all（默认）不传 source——显示全部（自建+学习库+源抓取），分类全量可见
      if (industryFilter) params.set('industry', industryFilter)
      if (modelFilter) params.set('model', modelFilter)
      params.set('page', String(page)); params.set('pageSize', '20')
      const url = '/api/prompt-templates?' + params.toString()
      const r = await fetch(url, { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        const newRows = data.data || []
        setItems(prev => page === 1 ? newRows : [...prev, ...newRows])
        setHasMore((data.total || 0) > page * 20)
        setLoadingMore(false)
      }
    } catch { console.error('load failed') }
    finally { setLoading(false); setLoadingMore(false) }  // 2026-08-16: 失败也重置（避免"加载中…"卡死）
  }

  useEffect(() => { if (!authLoading && user && user.role === 'admin') { setPage(1); loadItems() } }, [filterCat, modeTab, modelFilter])

  const filteredItems = tagFilter ? items.filter(i => (i.tags || '').includes(tagFilter)) : items
  const allTags = Array.from(new Set((items || []).flatMap(i => (i.tags || '').split(',').map(t => t.trim()).filter(Boolean))))

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

  // 发布/下架到素材库（2026-08-10：显式推送，用户媒体库提示词 Tab 可见）
  const publishSelected = async () => {
    const ids = selectedIds.size ? Array.from(selectedIds) : []
    if (ids.length === 0) return
    if (!confirm(`将选中的 ${ids.length} 条提示词发布到用户素材库？`)) return
    const r = await fetch('/api/admin/prompt-templates/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, published: true }), credentials: 'include' })
    const d = await r.json()
    alert(d.message || '完成'); setSelectedIds(new Set())
  }
  const unpublishSelected = async () => {
    const ids = selectedIds.size ? Array.from(selectedIds) : []
    if (ids.length === 0) return
    if (!confirm(`下架选中的 ${ids.length} 条？（用户素材库将不再显示）`)) return
    const r = await fetch('/api/admin/prompt-templates/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, published: false }), credentials: 'include' })
    const d = await r.json()
    alert(d.message || '完成'); setSelectedIds(new Set())
  }
  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return
    const r = await fetch(`/api/prompt-templates?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) { loadItems(); showToast('已删除') } else showToast('删除失败', 'error')
  }

  // ===== 预设 / 抓取 =====
  const [videoOrientation, setVideoOrientation] = useState<'horizontal' | 'vertical'>('horizontal')
  const isVert = videoOrientation === 'vertical'

  const handlePreseed = async () => {
    if (!confirm('将导入 20 条营销提示词模板（内置预设，已有预设时会拒绝）？')) return
    setBusy(p => ({ ...p, preseeding: true }))
    const r = await fetch('/api/seed-prompt-templates', { method: 'POST', credentials: 'include' })
    const d = await r.json()
    showToast(d.message, d.success ? 'success' : 'error')
    if (d.success) loadItems()
    setBusy(p => ({ ...p, preseeding: false }))
  }

  const handleFetch = async (type: 'image' | 'video' | 'scene') => {
    const srcDesc = type === 'image' ? '文生图（Pixabay → 无新素材时自动换 promptbase 免费区）'
      : type === 'video' ? '文生视频（Pixabay）' : '场景图（Pixabay）'
    if (!confirm(`将从外部源抓取 ${fetchCount} 条【${srcDesc}】\n每条需：下载图片 → 转存 OSS → AI 生成提示词 → 入库\n预计耗时约 ${fetchCount * 20} 秒，请耐心等待。`)) return
    setBusy(p => ({ ...p, fetch: true }))
    setFetchLogs([])
    setFetchLogLabel(`抓取中：${type === 'image' ? '文生图' : type === 'video' ? '文生视频' : '场景图'} × ${fetchCount}…`)
    try {
      const qs = type === 'video' ? `?type=${type}&orientation=${videoOrientation}&count=${fetchCount}` : `?type=${type}&count=${fetchCount}`
      const r = await fetch(`/api/fetch-prompts${qs}`, { method: 'POST', credentials: 'include' })
      const d = await r.json()
      showToast(d.message, d.success ? 'success' : 'error')
      if (d.data?.logs) setFetchLogs(d.data.logs)
      setFetchLogLabel(d.message || '')
      if (d.success) loadItems()
    } catch (e: any) { showToast('抓取失败: ' + (e?.message || e), 'error'); setFetchLogLabel('抓取失败') }
    finally { setBusy(p => ({ ...p, fetch: false })) }
  }

  // ===== AiShort 导入 =====
  const handleAIShort = async () => {
    if (!confirm('将从 AiShort 导入约 800 条中文 AI 工具提示词（纯文字无图，如"文章改写/论文降重/法律咨询"）？\n注意：这是批量导入，不是抓图。')) return
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
    const withPreview = items.filter(i => targetIds.includes(i.id) && i.previewUrl)
    if (withPreview.length === 0) { showToast('所选模板没有预览图，请先点「🎨 预览图」生成', 'error'); return }
    const valid = withPreview.filter(i => /^https?:\/\//.test((i.previewUrl || '').trim()))
    const skipped = withPreview.length - valid.length
    if (valid.length === 0) {
      showToast('所选模板预览图均为本地临时图，无法入库，请重新生成预览图', 'error')
      return
    }
    if (!confirm(`将 ${valid.length} 个模板预览图导入素材库？${skipped ? `（已跳过 ${skipped} 个无效地址）` : ''}`)) return
    try {
      const batch = valid.map(item => ({
        title: `模板-${item.title}`,
        ossUrl: item.previewUrl!.trim(),
        prompt: item.prompt,
        category: item.category,
        orientation: videoOrientation === 'vertical' ? 'portrait' : 'landscape',
      }))
      const r = await fetch('/api/media-library', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      })
      const text = await r.text()
      let d: any = null
      try { d = JSON.parse(text) } catch {
        console.error('[导入素材库] 非JSON响应:', text)
        showToast(`导入失败: HTTP ${r.status} ${text.slice(0, 200)}`, 'error')
        return
      }
      showToast(d.message || `已导入 ${valid.length} 个`, d.success ? 'success' : 'error')
      if (d.success) loadItems()
    } catch (e: any) {
      console.error('[导入素材库] 异常:', e)
      showToast('导入失败: ' + (e?.message || e), 'error')
    }
  }

  // ===== 场景生成 =====
  const handleSceneGen = async () => {
    if (!sceneInput.trim()) { showToast('请输入场景描述', 'error'); return }
    setSceneGenerating(true)
    try {
      const r = await fetch('/api/ai-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scene-prompts', scene: sceneInput.trim(), language: 'zh' }),
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
      } else { showToast(d.message || '生成失败', 'error') }
    } catch { showToast('请求失败', 'error') }
    finally { setSceneGenerating(false) }
  }

  // ===== 数字人模板生成 =====
  const handleGenDigital = async () => {
    if (!confirm('生成 6 个数字人口播模板（男性/女性/正装/休闲/古风等）？')) return
    setBusy(p => ({ ...p, genDigital: true }))
    try {
      const r = await fetch('/api/generate-digital-prompts', { method: 'POST', credentials: 'include' })
      const d = await r.json()
      showToast(d.message, d.success ? 'success' : 'error')
      if (d.success) loadItems()
    } catch { showToast('生成失败', 'error') }
    finally { setBusy(p => ({ ...p, genDigital: false })) }
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role !== 'admin') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2">仅管理员可访问</p><p className="text-xs text-gray-500 mt-1">二级客户请到素材库选择模板</p></div></div>

  const MAIN_TABS: { key: MainTab; label: string; desc: string }[] = [
    { key: 'manage', label: '📚 模板管理', desc: '查看/编辑/删除/筛选模板' },
    { key: 'fetch', label: '🌐 素材抓取', desc: '从外部源抓取图/视频/场景模板' },
    { key: 'generate', label: '🤖 AI 生成', desc: '批量生成预览图/视频/数字人/场景' },
    { key: 'maintain', label: '🧹 数据维护', desc: '预设填充/AiShort 导入/清空' },
  ]

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="border-b border-white/10 bg-gray-900/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg font-semibold text-white">提示词模板库 / PROMPT TEMPLATES</h1>
            <span className="text-xs text-gray-500">总数：<span className="text-emerald-400 font-bold">{items.length}</span> / 已选：<span className="text-cyan-400 font-bold">{selectedIds.size}</span></span>
          </div>
          {/* 主 Tab 导航 */}
          <div className="flex gap-1 mt-3 flex-wrap">
            {MAIN_TABS.map(t => (
              <button key={t.key} onClick={() => setMainTab(t.key)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${mainTab === t.key ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}
                title={t.desc}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-5">

        {/* ════════ Tab1 模板管理 ════════ */}
        {mainTab === 'manage' && (
          <div>
            <div className="flex gap-2 mb-4 flex-wrap">
              <button onClick={() => { setModeTab('all'); setFilterCat(''); setSelectedIds(new Set()) }}
                className={`px-3 py-1.5 rounded-lg text-xs border ${modeTab === 'all' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10'}`}>全部</button>
              <button onClick={() => { setModeTab('image'); setFilterCat(''); setSelectedIds(new Set()) }}
                className={`px-3 py-1.5 rounded-lg text-xs border ${modeTab === 'image' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10'}`}>文生图</button>
              <button onClick={() => { setModeTab('video'); setFilterCat(''); setSelectedIds(new Set()) }}
                className={`px-3 py-1.5 rounded-lg text-xs border ${modeTab === 'video' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10'}`}>文生视频</button>
              <button onClick={() => { setModeTab('scene'); setFilterCat(''); setSelectedIds(new Set()) }}
                className={`px-3 py-1.5 rounded-lg text-xs border ${modeTab === 'scene' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10'}`}>场景</button>
              <button onClick={() => { setModeTab('digital'); setFilterCat(''); setSelectedIds(new Set()) }}
                className={`px-3 py-1.5 rounded-lg text-xs border ${modeTab === 'digital' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10'}`}>数字人</button>
              <button onClick={() => { setModeTab('learn'); setFilterCat(''); setSelectedIds(new Set()) }}
                className={`px-3 py-1.5 rounded-lg text-xs border ${modeTab === 'learn' ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' : 'bg-white/5 text-gray-400 border-white/10'}`}>📚 学习库</button>
              <select value={modelFilter} onChange={(e) => { setModelFilter(e.target.value); setSelectedIds(new Set()) }}
                className="px-2 py-1.5 rounded-lg text-xs border bg-black/30 border-white/10 text-gray-300 outline-none focus:border-emerald-500/40">
                <option value="">全部模型</option>
                <option value="Seedance 2.5">Seedance 2.5</option>
                <option value="MiniMax H3">MiniMax H3</option>
                <option value="GPT Image 2">GPT Image 2</option>
                <option value="Seedream 5 Pro">Seedream 5 Pro</option>
                <option value="FLUX 3">FLUX 3</option>
              </select>
              <div className="flex-1" />
              <button onClick={openCreate} className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs hover:bg-emerald-600">＋ 新建模板</button>
            </div>

            {/* 子分类 + 行业筛选 */}
            {modeTab !== 'all' && (
              <div className="flex gap-2 mb-3 flex-wrap">
                <button onClick={() => setFilterCat('')}
                  className={`px-2 py-1 rounded text-[11px] ${!filterCat ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>全部子类</button>
                {(SUB_CATS[modeTab] || []).map((c: string) => (
                  <button key={c} onClick={() => setFilterCat(c)}
                    className={`px-2 py-1 rounded text-[11px] ${filterCat === c ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>{c}</button>
                ))}
              </div>
            )}
            <div className="flex gap-2 mb-4 flex-wrap items-center">
              <span className="text-[10px] text-gray-500 font-mono">行业:</span>
              <button onClick={() => setIndustryFilter('')}
                className={`px-2 py-1 rounded text-[11px] ${!industryFilter ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>全部</button>
              {INDUSTRIES.map((c: string) => (
                <button key={c} onClick={() => setIndustryFilter(c)}
                  className={`px-2 py-1 rounded text-[11px] ${industryFilter === c ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>{c}</button>
              ))}
            </div>
            <div className="flex gap-2 mb-4 flex-wrap items-center">
              <span className="text-[10px] text-gray-500 font-mono">标签:</span>
              <button onClick={() => setTagFilter('')}
                className={`px-2 py-1 rounded text-[11px] ${!tagFilter ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>全部</button>
              {allTags.slice(0, 30).map((t: string) => (
                <button key={t} onClick={() => setTagFilter(tagFilter === t ? '' : t)}
                  className={`px-2 py-1 rounded text-[11px] ${tagFilter === t ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>{t}</button>
              ))}
              {allTags.length > 30 && <span className="text-[10px] text-gray-600">+{allTags.length - 30} 更多</span>}
            </div>

            {/* 新建/编辑表单 */}
            {showForm && (
              <div className="bg-gray-900/60 border border-white/10 rounded-2xl p-5 mb-5">
                <h3 className="text-white font-bold mb-4">{editItem ? '编辑模板 / EDIT' : '新建模板 / NEW'}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" placeholder="标题 / TITLE *" value={title} onChange={e => setTitle(e.target.value)} />
                  <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" value={category} onChange={e => setCategory(e.target.value)}>
                    {CATEGORIES.map(c => <option key={c} value={c} className="bg-gray-900">{c}</option>)}
                  </select>
                  <input className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm md:col-span-2" placeholder="预览图 URL（可选）" value={previewUrl} onChange={e => setPreviewUrl(e.target.value)} />
                </div>
                <textarea className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm mb-4 h-32 w-full resize-y" placeholder="提示词内容 / PROMPT *" value={prompt} onChange={e => setPrompt(e.target.value)} />
                <div className="flex gap-3">
                  <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600 disabled:opacity-50">{submitting ? '保存中...' : '保存'}</button>
                  <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-white/10 text-gray-300 rounded-lg text-sm hover:bg-white/20">取消</button>
                </div>
              </div>
            )}

            {/* 列表 */}
            {loading ? <div className="text-center text-gray-400 py-12">加载中...</div>
            : items.length === 0 ? <div className="bg-gray-900/40 border border-white/10 rounded-2xl p-12 text-center"><p className="text-gray-400">暂无模板</p></div>
            : <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <input type="checkbox" checked={selectedIds.size === filteredItems.length && filteredItems.length > 0} onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-white/20 bg-white/5 accent-emerald-500" />
                  <span className="text-xs text-gray-500 font-mono">全选</span>
                  {selectedIds.size > 0 && <span className="text-xs text-cyan-400 font-mono">已选 {selectedIds.size} 项</span>}
                  {selectedIds.size > 0 && (
                    <button onClick={publishSelected} className="px-2 py-1 rounded bg-emerald-500/20 text-[10px] text-emerald-300 hover:bg-emerald-500/30">📤 发布选中到素材库</button>
                  )}
                  {selectedIds.size > 0 && (
                    <button onClick={unpublishSelected} className="px-2 py-1 rounded bg-white/10 text-[10px] text-gray-300 hover:bg-white/20">↩️ 下架</button>
                  )}
                  {selectedIds.size > 0 && (
                    <button onClick={() => setSelectedIds(new Set())} className="text-[10px] text-gray-500 hover:text-gray-300 ml-2">取消选择</button>
                  )}
                </div>
                <div className={isVert ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'}>
                  {filteredItems.map(item => (
                    <div key={item.id} className={`bg-gray-900/60 border-2 rounded-xl overflow-hidden transition-all ${selectedIds.has(item.id) ? 'border-emerald-500/50' : 'border-white/10'} ${isVert ? 'aspect-[9/16]' : 'aspect-video'}`}>
                      {(item.previewUrl || item.coverUrl) ? (
                        <div className={`relative w-full h-full group bg-black/50 ${(item.previewUrl || item.coverUrl).endsWith('.mp4') ? 'cursor-pointer' : ''}`} onClick={() => (item.previewUrl || item.coverUrl)?.endsWith('.mp4') && setPlayVideo(item.previewUrl || item.coverUrl)}>
                          {(item.previewUrl || item.coverUrl).endsWith('.mp4')
                            ? <video src={item.previewUrl || item.coverUrl} className="w-full h-full object-cover" />
                            : <img src={item.previewUrl || item.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                          }
                          {!(item.previewUrl || item.coverUrl).endsWith('.mp4') && (
                            <div className="hidden group-hover:block fixed z-40 pointer-events-none" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', maxWidth: '60vw', maxHeight: '80vh' }}>
                              <img src={item.previewUrl || item.coverUrl} alt="" className="max-w-[60vw] max-h-[80vh] rounded-xl shadow-2xl border border-white/20" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-2">
                            <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                              className="w-4 h-4 rounded border-white/40 bg-black/30 accent-emerald-500" />
                            <div className="flex gap-1">
                              <button onClick={() => openEdit(item)} className="px-1.5 py-0.5 text-[10px] bg-black/50 text-gray-200 rounded hover:bg-black/70">编辑</button>
                              <button onClick={async () => { const r = await fetch('/api/media-library/promote', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ promptId: item.id }) }); const d = await r.json(); alert(d.success ? '✅ 已添加到公共素材库' : (d.message || '添加失败')) }} className="px-1.5 py-0.5 text-[10px] bg-amber-500/50 text-white rounded hover:bg-amber-500/70">素材库</button>
                              <button onClick={() => handleDelete(item.id)} className="px-1.5 py-0.5 text-[10px] bg-red-500/50 text-white rounded hover:bg-red-500/70">删</button>
                            </div>
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 p-2">
                            <h3 className="text-white text-xs font-bold truncate">{item.title}</h3>
                            <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] ${item.category === '文生图' || item.category === '文生视频' ? 'bg-cyan-500/40 text-cyan-200' : 'bg-emerald-500/40 text-emerald-200'}`}>{item.category}</span>
                            {item.industry ? <span className="inline-block mt-0.5 ml-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/30 text-amber-200">{item.industry}</span> : null}
                            {item.tags ? <div className="mt-0.5 flex gap-1 flex-wrap">{item.tags.split(',').slice(0, 3).map((t: string) => <span key={t} className="px-1 py-0.5 rounded text-[8px] bg-violet-500/20 text-violet-300">{t}</span>)}</div> : null}
                            {item.author ? <div className="text-[8px] text-gray-500 mt-0.5">✍️ {item.author}</div> : null}
                            <p className="text-gray-300 text-[10px] mt-0.5 line-clamp-1">{item.prompt}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                          <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                            className="w-4 h-4 mb-2 rounded border-white/20 bg-white/5 accent-emerald-500" />
                          <h3 className="text-white font-bold text-xs">{item.title}</h3>
                          <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] ${item.category === '文生图' || item.category === '文生视频' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{item.category}</span>
                          {item.industry ? <span className="inline-block mt-1 ml-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300">{item.industry}</span> : null}
                          {item.tags ? <div className="mt-1 flex gap-1 flex-wrap justify-center">{item.tags.split(',').slice(0, 3).map((t: string) => <span key={t} className="px-1 py-0.5 rounded text-[8px] bg-violet-500/20 text-violet-300">{t}</span>)}</div> : null}
                          {item.author ? <div className="text-[8px] text-gray-500 mt-0.5">✍️ {item.author}</div> : null}
                          <p className="text-gray-500 text-[10px] mt-1 line-clamp-2">{item.prompt}</p>
                          <div className="flex gap-2 mt-2">
                            <button onClick={() => openEdit(item)} className="px-2 py-1 text-[10px] bg-white/10 text-gray-300 rounded">编辑</button>
                            <button onClick={async () => { const r = await fetch('/api/media-library/promote', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ promptId: item.id }) }); const d = await r.json(); alert(d.success ? '✅ 已添加到公共素材库' : (d.message || '添加失败')) }} className="px-2 py-1 text-[10px] bg-amber-500/20 text-amber-400 rounded">素材库</button>
                            <button onClick={() => handleDelete(item.id)} className="px-2 py-1 text-[10px] bg-red-500/20 text-red-400 rounded">删</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="text-center py-4">
                  {hasMore ? (
                    <button onClick={() => { setLoadingMore(true); setPage(p => p + 1) }} disabled={loadingMore}
                      className="px-4 py-1.5 rounded-lg text-[11px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
                      {loadingMore ? '加载中…' : `加载更多（已显示 ${items.length} 条）`}
                    </button>
                  ) : (
                    <span className="text-[10px] text-gray-600">— 已全部加载（{items.length} 条）—</span>
                  )}
                </div>
              </div>}
          </div>
        )}

        {/* ════════ Tab2 素材抓取 ════════ */}
        {mainTab === 'fetch' && (
          <div>
            {/* 🎬 视频手动抓取（2026-08-10：替代夜间自动，选平台/数量/时长/关键词） */}
            <div className="bg-gray-900/60 border border-cyan-500/20 rounded-2xl p-4 mb-4">
              <h3 className="text-white font-bold text-sm mb-1">🎬 抓取视频（YouTube/TikTok）</h3>
              <p className="text-[11px] text-gray-500 mb-3">手动抓取短视频到 OSS（私有，按行业推送用）。每条约 30-90 秒，SS 住宅代理下载。</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">平台</label>
                  <select value={vidFetchPlatform} onChange={e => setVidFetchPlatform(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs">
                    <option value="youtube" className="bg-gray-900">YouTube（稳定）</option>
                    <option value="tiktok" className="bg-gray-900">TikTok（实验）</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">数量</label>
                  <input type="number" min={1} max={10} value={vidFetchCount} onChange={e => setVidFetchCount(parseInt(e.target.value) || 3)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">时长范围（秒）</label>
                  <div className="flex items-center gap-1">
                    <input type="number" min={5} value={vidMinDur} onChange={e => setVidMinDur(parseInt(e.target.value) || 15)}
                      className="w-14 bg-white/5 border border-white/10 rounded-lg px-1.5 py-1.5 text-white text-xs text-center" />
                    <span className="text-gray-600 text-[10px]">-</span>
                    <input type="number" max={600} value={vidMaxDur} onChange={e => setVidMaxDur(parseInt(e.target.value) || 180)}
                      className="w-14 bg-white/5 border border-white/10 rounded-lg px-1.5 py-1.5 text-white text-xs text-center" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">关键词/行业</label>
                  <input value={vidKeyword} onChange={e => setVidKeyword(e.target.value)} placeholder="如 餐饮 / restaurant food"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handleFetchVideos} disabled={vidFetchBusy}
                  className="px-4 py-2 bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 rounded-lg text-xs hover:bg-cyan-500/30 disabled:opacity-50">
                  {vidFetchBusy ? '抓取中…' : '▶ 开始抓取'}
                </button>
                {vidFetchRunning && <span className="text-[10px] text-cyan-400 animate-pulse">后台任务运行中…</span>}
                <button onClick={refreshVidLog} className="text-[10px] text-gray-500 hover:text-gray-300">刷新日志</button>
              </div>
              {vidFetchLog && (
                <pre className="mt-3 max-h-40 overflow-y-auto bg-black/30 border border-white/5 rounded-lg p-2 text-[10px] text-emerald-300 whitespace-pre-wrap">{vidFetchLog}</pre>
              )}
            </div>

            <div className="grid md:grid-cols-3 gap-4 mb-5">
              {/* 抓图 */}
              <div className="bg-gray-900/60 border border-white/10 rounded-2xl p-4">
                <h3 className="text-white font-bold text-sm mb-1">🌄 抓取文生图</h3>
                <p className="text-[11px] text-gray-500 mb-3">来源：Pixabay（免费可商用）→ 无新素材时自动换 promptbase 免费区。每条：下载图 → 转存 OSS → AI 生成中文提示词 → 入库。</p>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[11px] text-gray-400">数量</span>
                  <input type="number" min={1} max={20} value={fetchCount} onChange={e => setFetchCount(parseInt(e.target.value) || 10)}
                    className="w-16 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white text-center" />
                  <span className="text-[10px] text-gray-600">条（1-20，建议 10）</span>
                </div>
                <button onClick={() => handleFetch('image')} disabled={busy.fetch}
                  className="w-full px-3 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-lg text-xs hover:bg-emerald-500/30 disabled:opacity-50">
                  {busy.fetch ? '抓取中…' : '开始抓图'}
                </button>
              </div>
              {/* 抓视频 */}
              <div className="bg-gray-900/60 border border-white/10 rounded-2xl p-4">
                <h3 className="text-white font-bold text-sm mb-1">🎬 抓取文生视频</h3>
                <p className="text-[11px] text-gray-500 mb-3">来源：Pixabay 视频库（免费可商用）。每条：下载视频 → 转存 OSS → AI 生成中文提示词 → 入库。</p>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="text-[11px] text-gray-400">朝向</span>
                  <div className="flex gap-1">
                    <button onClick={() => setVideoOrientation('horizontal')} className={`px-2 py-0.5 rounded text-[10px] ${videoOrientation === 'horizontal' ? 'bg-emerald-500 text-white' : 'bg-white/5 text-gray-400 border border-white/10'}`}>横屏</button>
                    <button onClick={() => setVideoOrientation('vertical')} className={`px-2 py-0.5 rounded text-[10px] ${videoOrientation === 'vertical' ? 'bg-emerald-500 text-white' : 'bg-white/5 text-gray-400 border border-white/10'}`}>竖屏</button>
                  </div>
                  <span className="text-[11px] text-gray-400 ml-1">数量</span>
                  <input type="number" min={1} max={10} value={fetchCount} onChange={e => setFetchCount(parseInt(e.target.value) || 5)}
                    className="w-14 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white text-center" />
                </div>
                <button onClick={() => handleFetch('video')} disabled={busy.fetch}
                  className="w-full px-3 py-2 bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 rounded-lg text-xs hover:bg-cyan-500/30 disabled:opacity-50">
                  {busy.fetch ? '抓取中…' : '开始抓视频'}
                </button>
              </div>
              {/* 抓场景 */}
              <div className="bg-gray-900/60 border border-white/10 rounded-2xl p-4">
                <h3 className="text-white font-bold text-sm mb-1">🏞️ 抓取场景图</h3>
                <p className="text-[11px] text-gray-500 mb-3">来源：Pixabay（商场/海滩/咖啡店等场景素材）。每条：下载图 → 转存 OSS → AI 生成中文提示词 → 入库。</p>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[11px] text-gray-400">数量</span>
                  <input type="number" min={1} max={20} value={fetchCount} onChange={e => setFetchCount(parseInt(e.target.value) || 10)}
                    className="w-16 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white text-center" />
                  <span className="text-[10px] text-gray-600">条（1-20）</span>
                </div>
                <button onClick={() => handleFetch('scene')} disabled={busy.fetch}
                  className="w-full px-3 py-2 bg-purple-500/20 border border-purple-500/30 text-purple-300 rounded-lg text-xs hover:bg-purple-500/30 disabled:opacity-50">
                  {busy.fetch ? '抓取中…' : '开始抓场景'}
                </button>
              </div>
            </div>

            {/* 抓取日志（透明反馈：每条结果 + 失败原因） */}
            <div className="bg-gray-900/60 border border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-bold text-sm">📋 抓取日志</h3>
                {fetchLogs.length > 0 && (
                  <button onClick={() => { setFetchLogs([]); setFetchLogLabel('') }} className="text-[10px] text-gray-500 hover:text-gray-300">清空</button>
                )}
              </div>
              {fetchLogLabel && !busy.fetch && <p className="text-xs text-gray-400 mb-2">{fetchLogLabel}</p>}
              {busy.fetch && <p className="text-xs text-emerald-400 animate-pulse mb-2">⏳ 抓取执行中…（每条约 15-25 秒）</p>}
              {fetchLogs.length === 0 && !busy.fetch ? (
                <p className="text-[11px] text-gray-600">暂无日志。点击上方「开始抓图/抓视频/抓场景」后，这里会逐条显示结果（✅ 成功 / ⏭ 跳过 / ❌ 失败原因）。</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {fetchLogs.map((l, i) => (
                    <div key={i} className={`flex items-start gap-2 text-[11px] py-1 px-2 rounded ${l.ok ? 'bg-emerald-500/[0.06] text-emerald-300' : 'bg-red-500/[0.06] text-red-300'}`}>
                      <span>{l.ok ? '✅' : '❌'}</span>
                      <span className="text-gray-500 shrink-0 w-16">[{l.source}]</span>
                      <span className="flex-1 truncate">{l.ok ? `${l.title}（${l.category || ''}）` : (l.title ? `${l.title}：` : '') + (l.reason || '')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════ Tab3 AI 生成 ════════ */}
        {mainTab === 'generate' && (
          <div>
            <div className="bg-gray-900/60 border border-white/10 rounded-2xl p-4 mb-4">
              <h3 className="text-white font-bold text-sm mb-1">🎨 批量生成预览（给模板配图/配视频）</h3>
              <p className="text-[11px] text-gray-500 mb-3">到「模板管理」勾选模板（或对全部模板）批量生成图片/视频预览。生成后可在「模板管理」查看，也可「导入素材库」。</p>
              <div className="flex flex-wrap gap-2 items-center mb-3">
                <span className="text-[10px] text-gray-500">图模型:</span>
                {IMG_MODELS.map(m => (
                  <button key={m.value} onClick={() => setImgModel(m.value)}
                    className={`px-2 py-1 rounded text-[10px] ${imgModel === m.value ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}
                    title={m.desc}>{m.label}</button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 items-center mb-3">
                <span className="text-[10px] text-gray-500">视频模型:</span>
                {VID_MODELS.map(m => (
                  <button key={m.value} onClick={() => setVidModel(m.value)}
                    className={`px-2 py-1 rounded text-[10px] ${vidModel === m.value ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}
                    title={m.desc}>{m.label}</button>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => runBatch('/api/generate-prompt-previews', 'imgPreview')} disabled={busy.imgPreview || busy.vidPreview}
                  className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs hover:bg-emerald-500/30 disabled:opacity-50">
                  {busy.imgPreview ? '生成中...' : '🎨 批量生成图片预览'}
                </button>
                <button onClick={() => runBatch('/api/batch-generate-video-previews', 'vidPreview')} disabled={busy.vidPreview || busy.imgPreview}
                  className="px-3 py-1.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded-lg text-xs hover:bg-cyan-500/30 disabled:opacity-50">
                  {busy.vidPreview ? '生成中...' : '🎬 批量生成视频预览'}
                </button>
                <button onClick={handleGenDigital} disabled={busy.genDigital}
                  className="px-3 py-1.5 bg-purple-500/20 border border-purple-500/30 text-purple-400 rounded-lg text-xs hover:bg-purple-500/30 disabled:opacity-50">
                  {busy.genDigital ? '生成中...' : '🤖 数字人模板 ×6'}
                </button>
                <button onClick={handleImportToMedia}
                  className="px-3 py-1.5 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg text-xs hover:bg-blue-500/30">
                  📦 导入素材库（选中或有图的）
                </button>
              </div>
            </div>

            <div className="bg-gray-900/60 border border-emerald-500/20 rounded-2xl p-4">
              <h3 className="text-white font-bold text-sm mb-1">🏞️ AI 生成场景模板</h3>
              <p className="text-[11px] text-gray-500 mb-3">输入场景描述，AI 生成多条场景类模板（如：夏日海滩度假产品推广）。</p>
              <div className="flex items-center gap-3">
                <input value={sceneInput} onChange={e => setSceneInput(e.target.value)}
                  placeholder="输入场景描述，如：夏日海滩度假产品推广"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-500 focus:outline-none focus:border-emerald-500/50" />
                <button onClick={handleSceneGen} disabled={sceneGenerating || !sceneInput.trim()}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-xs hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed shrink-0">
                  {sceneGenerating ? '生成中...' : 'AI 生成'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════ Tab4 数据维护 ════════ */}
        {mainTab === 'maintain' && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-gray-900/60 border border-white/10 rounded-2xl p-4">
              <h3 className="text-white font-bold text-sm mb-1">📦 预设填充</h3>
              <p className="text-[11px] text-gray-500 mb-3">导入内置的 20 条营销提示词模板（有图有词）。已有预设时会拒绝重复导入。</p>
              <button onClick={handlePreseed} disabled={busy.preseeding}
                className="px-3 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-lg text-xs hover:bg-emerald-500/30 disabled:opacity-50">
                {busy.preseeding ? '填充中...' : '导入 20 条预设'}
              </button>
            </div>
            <div className="bg-gray-900/60 border border-white/10 rounded-2xl p-4">
              <h3 className="text-white font-bold text-sm mb-1">📥 AiShort 提示词导入</h3>
              <p className="text-[11px] text-gray-500 mb-3">从 AiShort 导入约 800 条中文 AI 工具提示词（纯文字无图，如：文章改写/论文降重/法律咨询）。<span className="text-amber-400">注意：这是批量导入（非抓图），导入后模板库会大量增加。</span></p>
              <button onClick={handleAIShort} disabled={busy.aishort}
                className="px-3 py-2 bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 rounded-lg text-xs hover:bg-cyan-500/30 disabled:opacity-50">
                {busy.aishort ? '导入中...' : '导入 AiShort（约 800 条）'}
              </button>
            </div>
          </div>
        )}

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
      </main>
    </div>
  )
}
