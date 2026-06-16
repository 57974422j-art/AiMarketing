'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { showToast } from '@/components/Toast'
import { useAuth } from '@/app/providers'

export default function AutoCompilePage() {
  const [mode, setMode] = useState<'free' | 'smart' | 'storage'>('free')
  const [text, setText] = useState('')
  const [images, setImages] = useState<File[]>([])
  const [voice, setVoice] = useState('zh_female_vv_uranus_bigtts')
  const [ratio, setRatio] = useState('16:9')
  const [resolution, setResolution] = useState('1080p')
  const [duration, setDuration] = useState<number>(30) // 0=auto(文案结束)
  const [showSubs, setShowSubs] = useState(true)
  const [stickerText, setStickerText] = useState('')
  const [stickerPos, setStickerPos] = useState('tl')
  const [stickerOn, setStickerOn] = useState(false)
  const [titleText, setTitleText] = useState('')
  const [titleOn, setTitleOn] = useState(false)
  const [colorFilter, setColorFilter] = useState('')
  const { user } = useAuth()
  const [showPushDlg, setShowPushDlg] = useState(false)
  const [clients, setClients] = useState<any[]>([])
  const [pushClient, setPushClient] = useState<any>(null)
  const [pushLoading, setPushLoading] = useState(false)
  const [subtitleSize, setSubtitleSize] = useState(36)
  const [bgm, setBgm] = useState<{name:string;url:string;custom?:boolean} | null>(null)
  const [bgmFile, setBgmFile] = useState<File | null>(null)
  const [musicList, setMusicList] = useState<Array<{name:string;url:string;duration:string;mood:string}>>([])
  const [bgmPlaying, setBgmPlaying] = useState<string | null>(null) // 当前试听的BGM url
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [genInput, setGenInput] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [aiKeywords, setAiKeywords] = useState<string[]>([]) // AI返回的每行搜图关键词
  const [searchQuery, setSearchQuery] = useState('') // 搜图区独立搜索关键词

  // 新增：字幕时间戳模式 + 手动编辑 + 仓库选择
  const [subtitleMode, setSubtitleMode] = useState<'tts-sync' | 'manual'>('tts-sync')
  const [editSubtitles, setEditSubtitles] = useState<Array<{start:number; end:number; text:string}>>([])
  const [showSubEditor, setShowSubEditor] = useState(false)
  const [storageFiles, setStorageFiles] = useState<Array<{name:string;isVideo:boolean;thumbUrl?:string}>>([])
  const [showStorageDlg, setShowStorageDlg] = useState(false)
  const [storageList, setStorageList] = useState<any[]>([])
  const [storageLoading, setStorageLoading] = useState(false)

  // ── 智能成片模式（Smart Compile）──
  const [smartMode, setSmartMode] = useState(false)
  const [transition, setTransition] = useState('fade')
  const [transitionDur, setTransitionDur] = useState(0.8)
  const [kenBurns, setKenBurns] = useState('zoomin')
  const [subtitleStyle, setSubtitleStyle] = useState('highlight')
  const [stickerFiles, setStickerFiles] = useState<File[]>([])
  const [stickerPosList, setStickerPosList] = useState<string[]>(['br'])
  const [costEstimate, setCostEstimate] = useState<any>(null)

  useEffect(() => {
    fetch('/api/bgm').then(r=>r.json()).then(d => {
      if (d.success && d.data?.length > 0) setMusicList(d.data)
    }).catch(() => {})
  }, [])

  // 加载 storage 仓库文件列表
  const loadStorageFiles = useCallback(async () => {
    setStorageLoading(true)
    try {
      const r = await fetch(`/api/storage/files?userId=${user?.id || 0}`, { credentials: 'include' })
      const d = await r.json()
      if (d.success) setStorageList(d.data.files || [])
      else showToast(d.message || '加载失败', 'error')
    } catch { showToast('加载仓库失败', 'error') }
    finally { setStorageLoading(false) }
  }, [user?.id])

  // 打开仓库选择弹窗
  const openStorageDlg = () => {
    setShowStorageDlg(true)
    if (storageList.length === 0) loadStorageFiles()
  }

  // 切换仓库文件的选中状态
  const toggleStorageFile = (f: any) => {
    setStorageFiles(prev => {
      const exists = prev.find(x => x.name === f.name)
      if (exists) return prev.filter(x => x.name !== f.name)
      if (prev.length >= 20) { showToast('最多选20个素材', 'error'); return prev }
      return [...prev, { name: f.name, isVideo: f.isVideo, thumbUrl: f.thumbUrl }]
    })
  }

// 浏览器兼容的UUID生成
const genId = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16) })

  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<Record<number, Array<{url:string;thumb:string;title:string}>>>({})
  const [selectedImages, setSelectedImages] = useState<Record<number, {url:string;title:string}>>({})
  const [checkedImages, setCheckedImages] = useState<Array<{url:string;title:string}>>([]) // 搜图多选暂存区


  // 统一素材列表（合并搜图+仓库+本地上传，支持拖拽排序）
  interface MaterialItem {
    id: string; url: string; thumb: string; title: string;
    source: 'search' | 'storage' | 'local'; file?: File; storageName?: string;
  }
  const [materialList, setMaterialList] = useState<MaterialItem[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  // 拖拽排序处理
  const handleDragStart = (idx: number) => setDragIdx(idx)
  const handleDragOver = (e: React.DragEvent) => e.preventDefault()
  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return
    setMaterialList(prev => {
      const list = [...prev]
      const [moved] = list.splice(dragIdx!, 1)
      list.splice(targetIdx, 0, moved)
      return list
    })
    setDragIdx(null)
  }
  // 注释：旧逻辑已移除 — 之前 useEffect([selectedImages]) 会在每次搜索时用单张图覆盖 materialList
  // 现在统一通过「搜图区多选(checkedImages) → 点追加按钮」手动加入 materialList，避免互相干扰

  const fileRef = useRef<HTMLInputElement>(null)
  const localFileRef = useRef<HTMLInputElement>(null)  // 搜图区本地上传
  const bgmRef = useRef<HTMLInputElement>(null)

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const MAX_FILES = 20; const MAX_SIZE = 100 * 1024 * 1024
    const newFiles = Array.from(e.target.files || [])
    const allFiles = [...images, ...newFiles]
    if (allFiles.length > MAX_FILES) { showToast("素材最多20个，当前共" + allFiles.length + "个", "error"); return }
    const totalSize = allFiles.reduce((s, f) => s + f.size, 0)
    if (totalSize > MAX_SIZE) { showToast("素材超过100MB，请压缩后再试", "error"); return }
    const files = Array.from(e.target.files || [])
    setImages(prev => [...prev, ...files].slice(0, 20))
  }
  const removeFile = (i: number) => setImages(prev => prev.filter((_, idx) => idx !== i))

  // 搜图区：本地上传 → 追加到统一素材列表
  const handleLocalUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    if (materialList.length + files.length > 20) { showToast('素材最多20个', 'error'); return }
    const newItems: MaterialItem[] = files.map(f => ({
      id: genId(),
      url: URL.createObjectURL(f),
      thumb: URL.createObjectURL(f),
      title: f.name,
      source: 'local' as const,
      file: f
    }))
    setMaterialList(prev => [...prev, ...newItems])
    e.target.value = ''
  }
  // 搜图区：仓库选择 → 追加到统一素材列表
  const addStorageToMaterials = (files: Array<{name:string; isVideo:boolean; thumbUrl?:string}>) => {
    if (materialList.length + files.length > 20) { showToast('素材最多20个', 'error'); return }
    const newItems: MaterialItem[] = files.map(f => ({
      id: genId(),
      url: `/api/storage/serve?file=${encodeURIComponent(f.name)}`,
      thumb: f.thumbUrl || '/api/storage/serve?file=' + encodeURIComponent(f.name),
      title: f.name,
      source: 'storage' as const,
      storageName: f.name
    }))
    setMaterialList(prev => [...prev, ...newItems])
  }

  const handleAutoSearch = useCallback(async (forceQuery?: string) => {
    // 强制搜索模式（AI生成等场景直接传入关键词）
    if (forceQuery?.trim()) {
      setSearching(true); setSearchResults({}); setCheckedImages([])
      try {
        const r = await fetch('/api/search-images?q=' + encodeURIComponent(forceQuery.trim()) + '&count=6')
        const d = await r.json()
        console.log(`[搜图] 强制搜索 "${forceQuery.trim()}":`, d.success ? `${d.data.length}张` : '失败', d)
        if (d.success && d.data.length > 0) {
          setSearchResults({ '0': d.data })
          // 不再自动选中第1张，让用户通过 checkedImages 多选
        }
      } catch (e) { console.error('[搜图] 强制搜索异常:', e) }
      setSearching(false); setProgress(0)
      return
    }
    // 独立搜索模式：用 searchQuery state
    if (searchQuery.trim()) {
      setSearching(true); setSearchResults({}); setCheckedImages([])
      try {
        const r = await fetch('/api/search-images?q=' + encodeURIComponent(searchQuery.trim()) + '&count=6')
        const d = await r.json()
        console.log(`[搜图] 独立搜索 "${searchQuery.trim()}":`, d.success ? `${d.data.length}张` : '失败', d)
        if (d.success && d.data.length > 0) {
          setSearchResults({ '0': d.data })
          // 不再自动选中第1张，让用户通过 checkedImages 多选
        }
      } catch (e) { console.error('[搜图] 独立搜索异常:', e) }
      setSearching(false); setProgress(0)
      return
    }
    // 按文案行搜索模式
    const lines = text.split('\n').filter(Boolean)
    if (lines.length === 0) { showToast('请先输入文案或搜索关键词', 'error'); return }
    setSearching(true); setSearchResults({}); setCheckedImages([])
    let successCount = 0
    for (let i = 0; i < lines.length; i++) {
      const query = (aiKeywords[i] || lines[i]).slice(0, 50)
      console.log(`[搜图] 第${i+1}行 搜索关键词: "${query}"`)
      try {
        const r = await fetch('/api/search-images?q=' + encodeURIComponent(query) + '&count=6')
        const d = await r.json()
        console.log(`[搜图] 第${i+1}行 结果:`, d.success ? `${d.data.length}张` : '失败', d)
        if (d.success && d.data.length > 0) {
          setSearchResults(prev => ({ ...prev, [i]: d.data }))
          successCount++
        }
        setProgress(Math.round(((i + 1) / lines.length) * 100))
      } catch (e) {
        console.error(`[搜图] 第${i+1}行 异常:`, e)
      }
    }
    setSearching(false); setProgress(0)
    if (successCount > 0) {
      showToast(`✅ 搜到 ${successCount}/${lines.length} 行配图，请在下方勾选需要的图片后点"追加"加入素材列表`, 'success')
    } else {
      showToast('⚠️ 未搜到图片，请更换文案后重试', 'error')
    }
  }, [text, aiKeywords])

  const saveToStorage = async (url: string) => {
    const taskId = url.split("id=")[1]
    if (!taskId) return
    try {
      const r = await fetch("/api/storage/save", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({taskId}) })
      const d = await r.json()
      if (d.success) showToast("已保存到仓库", "success")
      else showToast(d.message || "保存失败", "error")
    } catch { showToast("保存失败", "error") }
  }

  // ── 智能成片费用估算 ──
  const fetchCostEstimate = useCallback(async () => {
    if (!smartMode) { setCostEstimate(null); return }
    try {
      const r = await fetch(`/api/video/auto-compile?action=cost&duration=${duration}&subtitleMode=${subtitleMode}&transition=${transition}&kenBurns=${kenBurns}`)
      const d = await r.json()
      if (d.success) setCostEstimate(d.data)
    } catch {}
  }, [smartMode, duration, subtitleMode, transition, kenBurns])

  // ── 从文案自动生成时间戳（用于手动编辑导入）──
  const importFromText = useCallback(() => {
    const lines = text.split('\n').filter((l: string) => l.trim())
    if (lines.length === 0) return
    const totalSec = duration || 30
    let cursor = 0
    const subs: Array<{start:number; end:number; text:string}> = []
    for (const line of lines) {
      const chars = line.trim().length || 1
      const segLen = (totalSec / (text.replace(/\s/g,'').length || totalSec)) * chars
      const start = Math.round(cursor * 100) / 100
      const end = Math.round((cursor + segLen) * 100) / 100
      subs.push({ start, end, text: line.trim() })
      cursor += segLen
    }
    setEditSubtitles(subs)
    setShowSubEditor(true)
    showToast(`已导入 ${subs.length} 条时间戳`, 'success')
  }, [text, duration])

  useEffect(() => { if (smartMode) fetchCostEstimate() }, [fetchCostEstimate])

  const stickerFileRef = useRef<HTMLInputElement>(null)

  const handleStickerFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (stickerFiles.length + files.length > 8) { showToast('最多8个贴纸', 'error'); return }
    setStickerFiles(prev => [...prev, ...files].slice(0, 8))
    setStickerPosList(prev => [...prev, ...Array(files.length).fill('br')].slice(0, 8))
  }

  const removeSticker = (i: number) => {
    setStickerFiles(prev => prev.filter((_, idx) => idx !== i))
    setStickerPosList(prev => prev.filter((_, idx) => idx !== i))
  }

  const handleSubmit = async () => {
    if (!text.trim()) { showToast('请输入文案', 'error'); return }
    // 统一校验：所有模式都用 materialList
    if (materialList.length === 0 && mode !== 'free') { showToast('请先添加素材（搜索/上传/仓库）', 'error'); return }
    // 兼容旧 free 模式的 images state
    if (materialList.length === 0 && images.length === 0) { showToast('请上传素材或添加素材', 'error'); return }

    setProcessing(true); setProgress(10); setVideoUrl('')
    try {
      setProgress(20)
      const fd = new FormData()
      fd.append('text', text); fd.append('voice', voice)
      fd.append('duration', String(duration))
      fd.append('ratio', ratio); fd.append('resolution', resolution); fd.append('subtitleSize', String(subtitleSize))
      fd.append('showSubs', String(showSubs))
      fd.append('subtitleMode', subtitleMode)
      if (subtitleMode === 'manual' && editSubtitles.length > 0) {
        const srt = editSubtitles.map((sub, i) => {
          function fmt(n: number) { const s = Math.floor(n); const ms = Math.round((n - s) * 1000); return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')},${String(ms).padStart(3,'0')}` }
          return `${i+1}\n${fmt(sub.start)} --> ${fmt(sub.end)}\n${sub.text}`
        }).join('\n')
        fd.append('customSrt', srt)
      }
      // 注意：mode 不在此处预设置，统一在下方素材收集逻辑中根据实际来源设置唯一一次
      // （FormData 同名 key 多次 append 时，后端 f.get() 取第一个值，会导致覆盖失效）
      if (stickerOn) { fd.append('stickerText', stickerText); fd.append('stickerPos', stickerPos) }
      if (titleOn) fd.append('titleText', titleText)
      fd.append('colorFilter', colorFilter)
      fd.append('smartMode', String(smartMode))
      if (smartMode) {
        fd.append('transition', transition)
        fd.append('transitionDur', String(transitionDur))
        fd.append('kenBurns', kenBurns)
        fd.append('subtitleStyle', subtitleStyle)
        if (stickerFiles.length > 0) {
          stickerFiles.forEach(sf => fd.append('stickerUploads', sf))
          fd.append('stickers', JSON.stringify(stickerFiles.map((_, i) => ({
            src: `sticker${i}.png`,
            position: stickerPosList[i] || 'br',
          }))))
        }
      }
      if (bgmFile) fd.append('bgm', bgmFile)
      else if (bgm?.url) fd.append('bgmUrl', bgm.url)
      // 统一素材收集（从 materialList 按来源拆分）
      if (materialList.length > 0) {
        const localFiles = materialList.filter(m => m.source === 'local' && m.file).map(m => m.file!)
        const searchUrls = materialList.filter(m => m.source === 'search').map(m => m.url)
        const storageNames = materialList.filter(m => m.source === 'storage').map(m => ({ name: m.storageName || '' }))

        // 有本地文件 → 用 free 模式的 media 字段
        if (localFiles.length > 0) {
          fd.append('mode', 'free')
          localFiles.forEach(f => fd.append('media', f))
          // 同时追加网络图片URL
          if (searchUrls.length > 0) fd.append('imageUrls', JSON.stringify(searchUrls))
          if (storageNames.length > 0) { fd.append('storageFiles', JSON.stringify(storageNames)); if (user?.id) fd.append('userId', String(user.id)) }
        }
        // 纯网络图片 → 用 smart 模式
        else if (searchUrls.length > 0) {
          fd.append('mode', 'smart')
          const allUrls = [...searchUrls, ...storageNames.map(n => `/api/storage/serve?file=${encodeURIComponent(n.name)}`)]
          fd.append('imageUrls', JSON.stringify(allUrls))
          if (storageNames.length > 0 && user?.id) fd.append('userId', String(user.id))
        }
        // 纯仓库文件
        else if (storageNames.length > 0) {
          fd.append('mode', 'storage')
          fd.append('storageFiles', JSON.stringify(storageNames))
          if (user?.id) fd.append('userId', String(user.id))
        }
      } else if (images.length > 0) {
        // 兼容：旧 free 模式直接上传的 images
        fd.append('mode', 'free')
        images.forEach(img => fd.append('media', img))
      } else if (Object.keys(selectedImages).length > 0) {
        // 兼容：旧 smart 模式的 selectedImages
        fd.append('mode', 'smart')
        fd.append('imageUrls', JSON.stringify(Object.values(selectedImages).map(v => v.url)))
      } else if (storageFiles.length > 0) {
        // 兼容：旧 storage 模式
        fd.append('mode', 'storage')
        fd.append('storageFiles', JSON.stringify(storageFiles.map(f => ({ name: f.name }))))
        if (user?.id) fd.append('userId', String(user.id))
      } else {
        fd.append('mode', mode)
      }

      const r = await fetch('/api/video/auto-compile', { method: 'POST', body: fd })
      const d = await r.json()
      if (!d.success) { showToast('失败: ' + (d.error || d.message || ''), 'error'); setProcessing(false); return }

      const taskId = d.data.taskId
      setProgress(30)

      while (true) {
        await new Promise(r => setTimeout(r, 1500))
        const q = await fetch('/api/video/auto-compile?taskId=' + taskId)
        const qd = await q.json()
        if (!qd.success) break
        const t = qd.data
        setProgress(t.progress || 30)
        if (t.status === 'queued') { setProgress(5); continue }
        if (t.status === 'completed') { setVideoUrl(t.videoUrl); setProgress(100); showToast('✅ 成功', 'success'); break }
        if (t.status === 'failed') { showToast('失败: ' + (t.error || '合成失败'), 'error'); break }
      }
    } catch (e: any) { showToast('异常: ' + e.message, 'error') }
    setProcessing(false)
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <p className="text-label mb-2">AI 工具 / AUTO COMPILE</p>
          <h1 className="text-mono-lg text-white">一键成片</h1>
          <p className="text-gray-400 text-sm mt-1">输入文案，自动合成配音字幕视频</p>
        </div>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode('free')} className={`px-4 py-1.5 rounded-lg text-xs ${mode==='free'?'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30':'bg-white/5 text-gray-400 border border-white/10'}`}>🆓 免费模式</button>
          <button onClick={() => setMode('smart')} className={`px-4 py-1.5 rounded-lg text-xs ${mode==='smart'?'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30':'bg-white/5 text-gray-400 border border-white/10'}`}>🤖 智能模式</button>

          {/* 智能成片开关 */}
          <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <span className="text-[10px] text-purple-300">✨ 智能增强</span>
            <button onClick={()=>{setSmartMode(!smartMode); if(!smartMode) fetchCostEstimate()}} className={`relative w-9 h-5 rounded-full transition-colors ${smartMode?'bg-purple-500':'bg-white/15'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${smartMode?'left-[18px]':'left-0.5'}`} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ═══ 左侧栏：设置面板 ═══ */}
          <div className="space-y-4">
            <div className="card-glass p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400">文案</label>
                {mode === 'smart' && (
                  <button onClick={() => setGenOpen(!genOpen)} className="text-[10px] px-2 py-1 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded hover:bg-purple-500/30 transition">✨ AI 导演</button>
                )}
                {mode === 'free' && <span className="text-[9px] text-gray-600">手动输入文案，右侧添加素材</span>}
              </div>

              {/* AI生成内嵌面板（仅智能模式） */}
              {genOpen && mode === 'smart' && (
                <div className="mt-3 p-3 bg-purple-500/5 border border-purple-500/20 rounded-lg space-y-2">
                  <textarea
                    className="input-dark w-full text-sm h-20 resize-none"
                    placeholder="输入描述文字（100-200字），AI将自动生成文案+配图关键词..."
                    value={genInput}
                    onChange={e => { const v = e.target.value; if (v.length <= 200) setGenInput(v) }}
                    maxLength={200}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-gray-500">{genInput.length}/200 字</span>
                    <div className="flex gap-2">
                      <button onClick={() => { setGenOpen(false); setGenInput('') }} className="text-[10px] px-2 py-1 text-gray-400 hover:text-white border border-white/10 rounded">取消</button>
                      <button
                        onClick={async () => {
                          if (!genInput.trim() || genInput.trim().length < 5) { showToast('请至少输入5个字描述', 'error'); return }
                          setGenLoading(true)
                          try {
                            const r = await fetch('/api/generate-script', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ description: genInput.trim(), duration })
                            })
                            const d = await r.json()
                            if (d.success) {
                              setText(d.data.script)
                              setAiKeywords(d.data.lines.map((l: any) => l.keyword))
                              const dir = d.data.director
                              if (dir?.title?.text) { setTitleText(dir.title.text); setTitleOn(true) }
                              if (dir?.sticker?.text) { setStickerText(dir.sticker.text); setStickerOn(true); if (dir.sticker.position) setStickerPos(dir.sticker.position) }
                              if (dir?.filter) setColorFilter(dir.filter)
                              if (dir?.voiceRecommend) setVoice(dir.voiceRecommend)
                              if (d.data.cost) setCostEstimate(prev => ({ ...prev, aiCost: d.data.cost }))
                              // 立即搜图，直接传关键词，不依赖state异步更新
                              const firstKeyword = d.data.lines[0]?.keyword || d.data.script.split('\n').filter(Boolean)[0] || ''
                              if (firstKeyword) { setSearchQuery(firstKeyword); handleAutoSearch(firstKeyword) }
                              setGenOpen(false); setGenInput('')
                              showToast(`✅ 已生成 ${d.data.lines.length} 条文案+导演方案${d.data.cost ? ' | 费用¥'+d.data.cost.estimatedCNY.toFixed(4) : ''}`, 'success')
                            } else {
                              showToast(d.error || '生成失败', 'error')
                            }
                          } catch { showToast('网络错误', 'error') }
                          finally { setGenLoading(false) }
                        }}
                        disabled={genLoading || !genInput.trim() || genInput.trim().length < 5}
                        className="text-[10px] px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
                      >
                        {genLoading ? '⏳ AI导演中...' : '🎬 AI一键生成'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <textarea className="input-dark w-full text-sm h-36 resize-none" placeholder={
                mode==='free' ? '每行对应一个素材（如：第一张图对应这行文案）'
                : '每行动态搜图 / 或用上方AI生成'
              } value={text} onChange={e => setText(e.target.value)} />
              <p className="text-[10px] text-gray-500 mt-1">文案约 {text.replace(/\s/g,'').length} 字，预计配音 ~{Math.round(text.replace(/\s/g,'').length * 0.3)} 秒</p>
            </div>

            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 block">配音</label>
              <select className="input-dark w-full text-sm" value={voice} onChange={e => setVoice(e.target.value)}>
                <option value="zh_female_vv_uranus_bigtts">女声</option>
                <option value="zh_female_vv_aurora_bigtts">温柔女声</option>
                <option value="zh_male_fengge_bigtts">稳重男声</option>
                <option value="zh_male_xiaoming_bigtts">阳光男声</option>
              </select>
            </div>

            <div className="card-glass p-4 grid grid-cols-2 gap-2">
              <div><label className="text-[10px] text-gray-400 mb-1 block">画面比例</label><select className="input-dark w-full text-xs" value={ratio} onChange={e=>setRatio(e.target.value)}><option value="16:9">横屏 16:9</option><option value="9:16">竖屏 9:16</option><option value="1:1">方形 1:1</option><option value="4:3">4:3</option></select></div>
              <div><label className="text-[10px] text-gray-400 mb-1 block">分辨率</label><select className="input-dark w-full text-xs" value={resolution} onChange={e=>setResolution(e.target.value)}><option value="1080p">1080p</option><option value="720p">720p</option></select></div>
              <div><label className="text-[10px] text-gray-400 mb-1 block">字幕大小</label><select className="input-dark w-full text-xs" value={subtitleSize} onChange={e=>setSubtitleSize(Number(e.target.value))}><option value={28}>小</option><option value={36}>中</option><option value={44}>大</option></select></div>
              <div><label className="text-[10px] text-gray-400 mb-1 block">字幕</label><button onClick={()=>setShowSubs(!showSubs)} className={`w-full py-2 text-xs rounded-lg ${showSubs?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-400 border border-white/10"}`}>{showSubs?"ON":"OFF"}</button></div>
              <div><label className="text-[10px] text-gray-400 mb-1 block">视频时长</label><select className="input-dark w-full text-xs" value={duration} onChange={e=>setDuration(Number(e.target.value))}><option value={0}>📝 文案结束(自动)</option><option value={15}>15秒</option><option value={30}>30秒</option><option value={45}>45秒</option><option value={60}>60秒</option></select></div>
              <div><label className="text-[10px] text-gray-400 mb-1 block">字幕时间戳</label>
                <div className="flex gap-1">
                  <button onClick={() => { setSubtitleMode('tts-sync'); setEditSubtitles([]) }} className={`flex-1 py-2 text-xs rounded-lg ${subtitleMode==='tts-sync'?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-400 border border-white/10"}`}>🎯 自动(TTS)</button>
                  <button onClick={() => { if(text.trim()){ setSubtitleMode('manual'); importFromText() }else{ showToast('请先输入文案','error') } }} className={`flex-1 py-2 text-xs rounded-lg ${subtitleMode==='manual'?"bg-purple-500/20 text-purple-400 border border-purple-500/30":"bg-white/5 text-gray-400 border border-white/10"}`}>✏️ 手动</button>
                </div>
              </div>
            </div>

            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 flex items-center gap-2">贴纸标签<button onClick={()=>setStickerOn(!stickerOn)} className={`px-2 py-0.5 text-[10px] rounded ${stickerOn?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-400 border border-white/10"}`}>{stickerOn?"ON":"OFF"}</button></label>
              {stickerOn&&<div className="flex gap-2"><input className="input-dark text-xs flex-1" placeholder="如：好可爱啊" value={stickerText} onChange={e=>setStickerText(e.target.value)} maxLength={12}/><select className="input-dark text-xs w-20" value={stickerPos} onChange={e=>setStickerPos(e.target.value)}><option value="tl">左上</option><option value="tr">右上</option><option value="bl">左下</option><option value="br">右下</option></select></div>}
            </div>
            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 flex items-center gap-2">片头标题<button onClick={()=>setTitleOn(!titleOn)} className={`px-2 py-0.5 text-[10px] rounded ${titleOn?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-400 border border-white/10"}`}>{titleOn?"ON":"OFF"}</button></label>
              {titleOn&&<input className="input-dark text-xs w-full" placeholder="默认文案第一句" value={titleText} onChange={e=>setTitleText(e.target.value)} maxLength={20}/>}
            </div>
            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 block">色调滤镜</label>
              <div className="flex gap-2">{["原色","暖色","冷色","黑白"].map((l,i)=><button key={i} onClick={()=>setColorFilter(colorFilter===["","warm","cool","bw"][i]?"":["","warm","cool","bw"][i])} className={`px-3 py-1.5 text-[10px] rounded-lg ${colorFilter===["","warm","cool","bw"][i]?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-400 border border-white/10"}`}>{l}</button>)}</div>
            </div>

            {/* ═══ 智能成片增强选项 ═══ */}
            {smartMode && (
              <div className="card-glass p-4 space-y-4 border-purple-500/30">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-purple-300 font-medium flex items-center gap-1">
                    ⚡ 智能增强效果
                  </label>
                  {costEstimate && (
                    <div className="flex items-center gap-2 text-[9px]">
                      {costEstimate.aiCost && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20">
                          AI导演: ¥{costEstimate.aiCost.estimatedCNY.toFixed(4)} ({costEstimate.aiCost.tokens}t)
                        </span>
                      )}
                      {costEstimate.estimatedCNY !== undefined && !costEstimate.aiCost && (
                        <span className="px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">
                          增强: ~¥{costEstimate.estimatedCNY.toFixed(4)}
                        </span>
                      )}
                      {costEstimate.aiCost && costEstimate.estimatedCNY !== undefined && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-bold">
                          总计: ¥{(costEstimate.aiCost.estimatedCNY + (costEstimate.estimatedCNY || 0)).toFixed(4)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 转场特效 */}
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block">转场特效</label>
                  <div className="flex gap-1 flex-wrap">
                    {[
                      {v:'none', l:'无'}, {v:'fade', l:'淡入淡出'}, {v:'slideleft', l:'左滑'}, {v:'slideright', l:'右滑'},
                      {v:'slideup', l:'上滑'}, {v:'slidedown', l:'下滑'},
                      {v:'wipeleft', l:'擦除←'}, {v:'wiperight', l:'→擦除'},
                      {v:'circleopen', l:'○展开'}, {v:'circleclose', l:'●收缩'}, {v:'dissolve', l:'溶解'},
                    ].map(t => (
                      <button key={t.v} onClick={() => setTransition(t.v)}
                        className={`px-2 py-1 text-[10px] rounded transition ${transition === t.v ? 'bg-purple-500/25 text-purple-300 border border-purple-500/40' : 'bg-white/5 text-gray-500 border border-white/5 hover:bg-white/10'}`}>
                        {t.l}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <label className="text-[9px] text-gray-600">转场时长:</label>
                    <input type="range" min="0.3" max="2" step="0.1" value={transitionDur} onChange={e=>setTransitionDur(parseFloat(e.target.value))} className="w-24 accent-purple-500" />
                    <span className="text-[10px] text-purple-400">{transitionDur.toFixed(1)}s</span>
                  </div>
                </div>

                {/* Ken Burns 效果（图片动画）*/}
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block">图片动态效果 (Ken Burns)</label>
                  <div className="flex gap-1 flex-wrap">
                    {[
                      {v:'none', l:'静态'}, {v:'zoomin', l:'🔍+ 放大'}, {v:'zoomout', l:'🔍- 缩小'},
                      {v:'panleft', l:'⬅ 左移'}, {v:'panright', l:'➡ 右移'}, {v:'panup', l:'⬆ 上移'},
                      {v:'pandown', l:'⬇ 下移'}, {v:'random', l:'🎲 随机'},
                    ].map(k => (
                      <button key={k.v} onClick={() => setKenBurns(k.v)}
                        className={`px-2 py-1 text-[10px] rounded transition ${kenBurns === k.v ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40' : 'bg-white/5 text-gray-500 border border-white/5 hover:bg-white/10'}`}>
                        {k.l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 动态字幕样式 */}
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block">字幕动效</label>
                  <div className="flex gap-1">
                    {[
                      {v:'normal', l:'普通(SRT)'}, {v:'highlight', l:'✨ 高亮'}, {v:'karaoke', l:'🎤 卡拉OK'}, {v:'typewriter', l:'⌨ 打字机'},
                    ].map(s => (
                      <button key={s.v} onClick={() => setSubtitleStyle(s.v)}
                        className={`px-2 py-1 text-[10px] rounded transition ${subtitleStyle === s.v ? 'bg-orange-500/25 text-orange-300 border border-orange-500/40' : 'bg-white/5 text-gray-500 border border-white/5 hover:bg-white/10'}`}>
                        {s.l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 透明贴纸上传 */}
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block">透明贴纸 (PNG/GIF, 支持8个)</label>
                  <input ref={(el: HTMLInputElement | null) => { /* store ref */ }} type="file" accept="image/png,image/gif" multiple className="hidden" onChange={handleStickerFiles} />
                  <button onClick={() => (document.querySelector('input[type="file"][accept*="png"]') as HTMLElement)?.click()} className="w-full py-1.5 border border-dashed border-purple-500/30 rounded-lg text-purple-400/70 text-xs hover:border-purple-500/50 hover:text-purple-400 transition">
                    + 上传透明贴纸
                  </button>
                  {stickerFiles.length > 0 && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {stickerFiles.map((f, i) => (
                        <div key={i} className="relative group">
                          <img src={URL.createObjectURL(f)} className="w-12 h-12 object-contain rounded bg-black/20 border border-white/10" />
                          <select value={stickerPosList[i]} onChange={e => {
                            const nl = [...stickerPosList]; nl[i] = e.target.value; setStickerPosList(nl)
                          }} className="absolute bottom-0 left-0 w-full h-5 text-[8px] bg-black/60 text-white border-0 rounded-b opacity-0 group-hover:opacity-100 transition cursor-pointer">
                            <option value="tl">左上</option><option value="tr">右上</option>
                            <option value="bl">左下</option><option value="br">右下</option><option value="center">居中</option>
                          </select>
                          <button onClick={() => removeSticker(i)} className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-[8px]">&times;</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 block">背景音乐（可选）</label>
              <div className="space-y-1.5 mb-3">
                <p className="text-[9px] text-gray-600">🆓 Pixabay 免版税音乐 · 点击试听选择</p>
                <div className="grid grid-cols-1 gap-1 max-h-60 overflow-y-auto">
                  {(musicList.length > 0 ? musicList : [
                    { name: '轻松愉快 - Uplifting', url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3' },
                    { name: '温馨柔和 - Soft', url: 'https://cdn.pixabay.com/download/audio/2022/10/25/audio_946bc7ebc8.mp3' },
                    { name: '电子节奏 - Electronic', url: 'https://cdn.pixabay.com/download/audio/2022/02/22/audio_d171c86b8d.mp3' },
                    { name: '电影感 - Cinematic', url: 'https://cdn.pixabay.com/download/audio/2022/08/02/audio_884fe92c6b.mp3' },
                  ]).map(item => (
                    <div key={item.url} className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (bgmPlaying === item.url) { setBgmPlaying(null); return }
                          setBgmPlaying(item.url)
                          setTimeout(() => setBgmPlaying(null), 5000)
                        }}
                        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/10 text-gray-400 hover:text-white hover:bg-white/20 transition text-[10px]"
                        title={bgmPlaying === item.url ? '停止' : '试听5秒'}
                      >
                        {bgmPlaying === item.url ? '■' : '▶'}
                      </button>
                      {bgmPlaying === item.url && (
                        <audio autoPlay src={item.url} onEnded={() => setBgmPlaying(null)} onError={() => setBgmPlaying(null)} />
                      )}
                      <button
                        key={item.url}
                        onClick={() => {
                          if (bgm?.url === item.url && !bgm?.custom) { setBgm(null); return }
                          setBgm({ name: item.name, url: item.url }); setBgmFile(null)
                          showToast('已选择：' + item.name, 'success')
                        }}
                        className={`flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] transition text-left ${
                          bgm?.url === item.url && !bgm?.custom
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-transparent'
                        }`}
                      >
                        <span className="shrink-0">🎵</span>
                        <span className="truncate flex-1">{item.name}</span>
                        {bgm?.url === item.url && !bgm?.custom && <span className="text-purple-400 shrink-0">✓</span>}
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-[8px] text-gray-600">⚠️ 来源 Pixabay 免版税音乐 | 如加载失败请上传本地音乐</p>
              </div>

              <input ref={bgmRef} type="file" accept="audio/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { setBgmFile(f); setBgm({name: f.name, url: '', custom: true}) }}} />
              <button onClick={() => bgmRef.current?.click()} className="w-full py-2 border border-dashed border-white/20 text-gray-400 rounded-xl hover:border-emerald-500/50 hover:text-emerald-400 text-xs transition">{bgm?.custom ? '🎵 ' + bgm.name : '+ 上传本地音乐'}</button>
              {bgm && <button onClick={() => { setBgm(null); setBgmFile(null) }} className="text-[10px] text-red-400 mt-1 block">移除当前音乐</button>}
            </div>

            <button onClick={handleSubmit} disabled={processing} className="w-full py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50 text-sm font-bold transition">{processing ? `⏳ ${progress}%` : '🎬 一键合成'}</button>
            {processing && <div className="h-1.5 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{width:progress+'%'}}/></div>}
          </div>

          {/* ═══ 右侧栏：素材区（搜图/上传/仓库 + 统一列表 + 预览） ═══ */}
          <div className="card-glass p-4 h-fit sticky top-4 space-y-4">
            {/* ── 素材来源工具栏（所有模式共用）── */}
            <div>
              <label className="text-xs text-gray-400 mb-2 block">
                素材来源 {materialList.length > 0 && <span className="text-emerald-400 ml-2">✅ 已选 {materialList.length} 张</span>}
              </label>

              {/* 提示词 chips */}
              {aiKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {aiKeywords.map((kw, i) => (
                    <button key={i} onClick={() => { setSearchQuery(kw); handleAutoSearch(kw) }}
                      className={`text-[10px] px-2 py-1 rounded-full border transition ${
                        searchQuery === kw ? 'bg-blue-500/30 text-blue-300 border-blue-500/50' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                      }`}
                      title={`用「${kw}」搜图`}
                    >🏷️ {kw.slice(0, 12)}{kw.length > 12 ? '...' : ''}</button>
                  ))}
                </div>
              )}

              {/* 搜索框 */}
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAutoSearch()}
                placeholder="输入关键词搜索配图..."
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:border-blue-500/50 outline-none mb-2"
              />

              {/* 操作按钮行：搜图 | 上传 | 仓库 | 全选 | 清空 */}
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => handleAutoSearch()} disabled={searching}
                  className="py-2 px-3 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl hover:bg-blue-500/30 text-[10px] transition disabled:opacity-50"
                >{searching ? `搜索中 ${progress}%` : '🔍 搜索配图'}</button>

                <input ref={localFileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleLocalUpload} />
                <button onClick={() => localFileRef.current?.click()}
                  className="py-2 px-3 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl hover:bg-emerald-500/30 text-[10px] transition"
                >+ 本地上传</button>

                <button onClick={openStorageDlg}
                  className="py-2 px-3 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-xl hover:bg-purple-500/30 text-[10px] transition"
                >📦 仓库素材</button>

                {materialList.length > 0 && (
                  <>
                    <button onClick={() => setSelectedImages({})} className="py-2 px-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl hover:bg-red-500/20 text-[10px] transition">✕ 清空</button>
                  </>
                )}
              </div>

              {/* 搜索结果预览（点击多选，追加到素材列表） */}
              {Object.keys(searchResults).length > 0 && (
                <div className="max-h-[25vh] overflow-y-auto pr-1 mt-2 space-y-2 border-t border-white/5 pt-2">
                  {Object.entries(searchResults).map(([idx, imgs]) => {
                    // 多选用法：checkedImages 记录已选的 url 集合
                    const checkedUrls = new Set(checkedImages.map(v => v.url))
                    const selectedCount = checkedImages.length
                    return (
                      <div key={idx}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[9px] text-gray-500">🔍 {searchQuery || '搜索结果'}</p>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => {
                                // 全选当前组
                                const all = imgs.filter(i => !checkedUrls.has(i.url)).map(i => ({ url: i.url, title: i.title }))
                                if (all.length > 0 && materialList.length + selectedCount + all.length <= 20) {
                                  setCheckedImages(prev => [...prev, ...all])
                                }
                              }}
                              disabled={materialList.length + selectedCount >= 20}
                              className="text-[9px] px-1.5 py-0.5 bg-blue-500/15 text-blue-300 rounded border border-blue-500/25 hover:bg-blue-500/25 disabled:opacity-30 transition"
                            >全选</button>
                            <button
                              onClick={() => {
                                // 追加已选到素材列表
                                if (selectedCount === 0) return
                                const toAdd = checkedImages.filter(c => !materialList.some(m => m.url === c.url))
                                if (toAdd.length === 0) { showToast('所选图片已在素材列表中', 'success'); return }
                                if (materialList.length + toAdd.length > 20) { showToast(`最多20个素材，当前${materialList.length}个，要加${toAdd.length}张`, 'error'); return }
                                const newItems: MaterialItem[] = toAdd.map(v => ({
                                  id: genId(), url: v.url, thumb: v.url, title: v.title || '',
                                  source: 'search' as const
                                }))
                                setMaterialList(prev => [...prev, ...newItems])
                                setCheckedImages([])
                                showToast(`✅ 已追加 ${toAdd.length} 张到素材列表`, 'success')
                              }}
                              className="text-[9px] px-1.5 py-0.5 bg-emerald-500/15 text-emerald-300 rounded border border-emerald-500/25 hover:bg-emerald-500/25 transition"
                            >+ 追加 ({selectedCount})</button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {imgs.map((img, j) => {
                            const isChecked = checkedUrls.has(img.url)
                            return (
                              <div key={j}
                                className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition ${
                                  isChecked ? 'border-emerald-400 ring-1 ring-emerald-400/50' : 'border-transparent hover:border-white/40'
                                }`}
                                onClick={() => {
                                  if (isChecked) {
                                    setCheckedImages(prev => prev.filter(v => v.url !== img.url))
                                  } else {
                                    if (materialList.length + checkedImages.length >= 20) { showToast('素材已达上限20张', 'error'); return }
                                    setCheckedImages(prev => [...prev, { url: img.url, title: img.title }])
                                  }
                                }}
                              >
                                <img src={img.thumb || img.url} className="w-16 h-16 object-cover" onError={(e) => {(e.target as HTMLImageElement).src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22><rect fill=%22%23111%22 width=64 height=64/><text x=32 y=34 fill=%22%23666%22 font-size=8 text-anchor=middle>✗</text></svg>'}} />
                                {isChecked && (
                                  <div className="absolute top-0 left-0 w-full h-full bg-emerald-500/20 flex items-center justify-center">
                                    <span className="bg-emerald-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shadow-lg">✓</span>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── 统一素材列表（可拖拽排序，所有来源合并显示）── */}
            {materialList.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-400">已选素材 <span className="text-emerald-300">({materialList.length})</span> <span className="text-[8px] text-gray-600 ml-1">↔ 可拖拽调顺序</span></label>
                </div>
                <div className="grid grid-cols-4 gap-1.5 max-h-[35vh] overflow-y-auto pr-1">
                  {materialList.map((m, idx) => (
                    <div key={m.id || idx}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={handleDragOver}
                      onDrop={() => handleDrop(idx)}
                      className={`relative cursor-grab active:cursor-grabbing rounded-lg overflow-hidden group ${
                        dragIdx === idx ? 'ring-2 ring-blue-400 opacity-50 scale-95 transition' : 'hover:ring-1 hover:ring-white/40'
                      }`}
                    >
                      <img src={m.thumb || m.url} className="w-full aspect-square object-cover" onError={(e) => {(e.target as HTMLImageElement).src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22><rect fill=%22%23222%22 width=64 height=64/><text x=32 y=34 fill=%22%23666%22 font-size=8 text-anchor=middle>?</text></svg>'}} />
                      {/* 来源标签 */}
                      <span className={`absolute top-0 left-0 text-[7px] px-1 py-0.5 rounded-br ${
                        m.source === 'search' ? 'bg-blue-500/70 text-white' :
                        m.source === 'storage' ? 'bg-purple-500/70 text-white' :
                        'bg-emerald-500/70 text-white'
                      }`}>{m.source === 'search' ? '搜' : m.source === 'storage' ? '仓' : '本'}</span>
                      {/* 序号 */}
                      <span className="absolute top-0 right-0 bg-black/60 text-[8px] text-white px-1">{idx + 1}</span>
                      {/* 删除按钮 */}
                      <button onClick={(e) => { e.stopPropagation(); setMaterialList(prev => prev.filter((_, i) => i !== idx)) }}
                        className="absolute bottom-0 left-0 right-0 bg-red-500/80 text-white text-[8px] py-0.5 opacity-0 group-hover:opacity-100 transition"
                      >删除</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 视频预览区 ── */}
            <div>
              <label className="text-xs text-gray-400 mb-2 block">预览</label>
              {videoUrl ? (
                <div>
                  <video src={videoUrl} controls className="w-full rounded-xl" />
                  <div className="flex gap-2 mt-3">
                    <a href={videoUrl} download className="flex-1 block text-center py-2 bg-white/5 text-gray-400 border border-white/10 rounded-lg hover:bg-white/10 text-xs">⬇ 下载</a>
                    <button onClick={()=>saveToStorage(videoUrl)} className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 text-xs">📦 保存到仓库</button>
                    {user?.role !== 'end-user' && <button onClick={()=>{fetch('/api/clients').then(r=>r.json()).then(d=>{if(d.success){setClients(d.data);setShowPushDlg(true)}}).catch(()=>showToast('获取客户列表失败','error'))}} className="flex-1 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 text-xs">📤 推送到账号</button>}
                  </div>
                </div>
              ) : <div className="aspect-video bg-white/5 rounded-xl flex items-center justify-center text-gray-600 text-xs">{processing?'⏳ 合成中...':'预览区'}</div>}
            </div>
          </div>

          {/* ═══ 手动字幕编辑器（独立区域，跨两列放在网格底部，不在sticky内） ═══ */}
          {showSubEditor && subtitleMode === 'manual' && (
            <div className="card-glass p-4 mt-4 col-span-1 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs text-gray-400">✏️ 字幕时间戳编辑 <span className="text-purple-400 ml-1">({editSubtitles.length} 条)</span></label>
                <div className="flex gap-2">
                  <button onClick={importFromText} className="text-[10px] px-2 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/30 transition">🔄 从文案重新导入</button>
                  <button onClick={() => {
                    const total = duration || 30
                    setEditSubtitles(prev => [...prev, { start: prev.length > 0 ? prev[prev.length - 1].end + 0.5 : 0, end: prev.length > 0 ? prev[prev.length - 1].end + 3 : 3, text: '新字幕文本' }])
                  }} className="text-[10px] px-2 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/30 transition">+ 添加</button>
                </div>
              </div>

              {editSubtitles.length === 0 && (
                <p className="text-[11px] text-gray-600 py-6 text-center">点击"从文案重新导入"或"+ 添加"来创建时间戳</p>
              )}

              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                {editSubtitles.map((sub, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-black/20 rounded-lg p-2 group">
                    <span className="text-[9px] text-gray-500 w-5 shrink-0 text-center">#{idx+1}</span>
                    <input type="number" step="0.1" min="0" value={sub.start} onChange={e => {
                      const v = parseFloat(e.target.value) || 0; setEditSubtitles(prev => prev.map((s, i) => i === idx ? {...s, start: Math.max(0, v)} : s))
                    }} className="w-16 bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[10px] text-right text-gray-300 focus:border-purple-500/50 outline-none" />
                    <span className="text-[9px] text-gray-600 shrink-0">→</span>
                    <input type="number" step="0.1" min="0" value={sub.end} onChange={e => {
                      const v = parseFloat(e.target.value) || 0; setEditSubtitles(prev => prev.map((s, i) => i === idx ? {...s, end: Math.max(v, s.start + 0.3)} : s))
                    }} className="w-16 bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[10px] text-right text-gray-300 focus:border-purple-500/50 outline-none" />
                    <span className="text-[8px] text-gray-600 shrink-0">秒</span>
                    <input type="text" value={sub.text} onChange={e => {
                      setEditSubtitles(prev => prev.map((s, i) => i === idx ? {...s, text: e.target.value} : s))
                    }} className="flex-1 min-w-0 bg-black/30 border border-white/10 rounded px-2 py-1 text-[11px] text-gray-200 focus:border-purple-500/50 outline-none truncate" placeholder="字幕文字..." />
                    <button
                      onClick={() => setEditSubtitles(prev => prev.filter((_, i) => i !== idx))}
                      className="shrink-0 w-6 h-6 flex items-center justify-center bg-red-500/10 text-red-400 rounded opacity-0 group-hover:opacity-100 transition hover:bg-red-500/20"
                    >×</button>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-3 text-[9px] text-gray-600">
                <span>总时长: {(duration || 30)}秒</span>
                {editSubtitles.length > 0 && (
                  <span>覆盖: {editSubtitles[editSubtitles.length - 1].end.toFixed(1)}s / {(duration||30)}s</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 仓库文件选择弹窗 */}
      {showStorageDlg && <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowStorageDlg(false)}>
        <div className="card-glass p-6 rounded-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white">📦 选择仓库素材</h3>
            <button onClick={() => setShowStorageDlg(false)} className="text-gray-400 hover:text-white text-sm">&times;</button>
          </div>
          {storageLoading ? (
            <div className="flex-1 flex items-center justify-center py-8">
              <span className="text-gray-400 text-xs">加载中...</span>
            </div>
          ) : storageList.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-8">
              <p className="text-gray-500 text-xs">仓库为空，请先上传文件</p>
            </div>
          ) : (
            <>
              <p className="text-[10px] text-gray-500 mb-3">已选 {storageFiles.length}/20 个（点击选择/取消）</p>
              <div className="flex-1 overflow-y-auto max-h-[50vh]">
                <div className="grid grid-cols-4 gap-2">
                  {storageList.map((f: any) => {
                    const isSelected = storageFiles.some(sf => sf.name === f.name)
                    return (
                      <div
                        key={f.name}
                        onClick={() => toggleStorageFile(f)}
                        className={`cursor-pointer relative rounded-lg overflow-hidden border-2 transition ${isSelected ? 'border-emerald-400' : 'border-transparent hover:border-white/30'}`}
                      >
                        {f.isVideo ? (
                          f.thumbUrl ? (
                            <img src={f.thumbUrl} alt={f.name} className="w-full aspect-square object-cover" />
                          ) : (
                            <div className="w-full aspect-square bg-white/10 flex items-center justify-center text-2xl">🎬</div>
                          )
                        ) : (
                          <img
                            src={`/api/storage/file?userId=${user?.id}&name=${encodeURIComponent(f.name)}`}
                            alt={f.name}
                            className="w-full aspect-square object-cover"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        )}
                        {isSelected && (
                          <div className="absolute top-1 right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center text-white text-[10px]">✓</div>
                        )}
                        <p className="text-[9px] text-gray-400 truncate px-1 pb-1">{f.name}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
          <div className="flex gap-2 mt-4 pt-3 border-t border-white/10">
            <button onClick={() => setShowStorageDlg(false)} className="flex-1 py-2 bg-white/5 text-gray-400 rounded-lg text-xs hover:bg-white/10 transition">取消</button>
            <button
              onClick={() => { if (storageFiles.length > 0) addStorageToMaterials(storageFiles); setShowStorageDlg(false) }}
              disabled={storageFiles.length === 0}
              className={`flex-1 py-2 rounded-lg text-xs transition ${storageFiles.length > 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30' : 'bg-white/5 text-gray-500 cursor-not-allowed'}`}
            >
              确认选择 ({storageFiles.length})
            </button>
          </div>
        </div>
      </div>}

      {showPushDlg && <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={()=>setShowPushDlg(false)}>
        <div className="card-glass p-6 rounded-xl max-w-md w-full mx-4" onClick={e=>e.stopPropagation()}>
          <h3 className="text-sm font-bold text-white mb-4">选择终端客户</h3>
          {clients.length===0 ? <p className="text-xs text-gray-500 py-4">暂无终端客户</p> : (
            <div className="max-h-60 overflow-y-auto space-y-2 mb-4">
              {clients.map(cl => (
                <button key={cl.id} onClick={()=>setPushClient(cl)} className={`w-full text-left p-3 rounded-lg border text-xs transition ${pushClient?.id===cl.id?"bg-emerald-500/20 border-emerald-500/30 text-emerald-400":"bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"}`}>{cl.name||cl.username}<span className="text-gray-500 ml-2">(#{cl.id})</span></button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={()=>{setShowPushDlg(false);setPushClient(null)}} className="flex-1 py-2 bg-white/5 text-gray-400 rounded-lg text-xs">取消</button>
            <button disabled={!pushClient||pushLoading} onClick={async()=>{if(!pushClient)return;setPushLoading(true);try{const r=await fetch('/api/video/push-to-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:videoUrl.split('id=')[1]||videoUrl,endUserId:pushClient.id,remark:pushClient.name||pushClient.username})});const d=await r.json();if(d.success)showToast(`已推送 ${d.data.pushed}/${d.data.total} 台设备`,'success');else showToast(d.message||'推送失败','error')}catch(e:any){showToast('推送失败: '+e.message,'error')}setShowPushDlg(false);setPushClient(null);setPushLoading(false)}} className={`flex-1 py-2 rounded-lg text-xs ${pushClient?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-500"}`}>{pushLoading?'推送中...':'确认推送'}</button>
          </div>
        </div>
      </div>}
    </div>
  )
}
