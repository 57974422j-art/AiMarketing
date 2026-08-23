'use client'
import TourGuide from '@/components/TourGuide'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import PromptLibraryDialog from '@/components/prompts/PromptLibraryDialog'
import { showToast } from '@/components/Toast'

interface PromptItem {
  id: number
  title: string
  category: string
  prompt: string
  previewUrl: string | null
}

const CATEGORIES = ['海报封面', '产品展示', '品牌宣传', '节日营销', '短视频封面', '场景', '数字人']

export default function ImageGeneratorPage() {
  const { user, loading: authLoading } = useAuth()
  const [templates, setTemplates] = useState<PromptItem[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [filterCat, setFilterCat] = useState('')
  const [prompt, setPrompt] = useState('')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [imageSize, setImageSize] = useState('1280*1280')
  const [usingModel, setUsingModel] = useState('')
  const [provider, setProvider] = useState<'auto' | 'dashscope' | 'qwen-image-3.0' | 'qwen-image-3.0-pro' | 'siliconflow'>('auto')
  const [referenceImage, setReferenceImage] = useState<File | null>(null)
  const [showFav, setShowFav] = useState(false)
  const [favItems, setFavItems] = useState<any[]>([])
  const [referencePreview, setReferencePreview] = useState('')
  const [lastPoints, setLastPoints] = useState<number | null>(null)
  // 生成历史（2026-08-10：查看提示词/复用）
  const [history, setHistory] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const r = await fetch('/api/generation-records?type=text2img&limit=24', { credentials: 'include' })
      const d = await r.json()
      setHistory(Array.isArray(d?.data?.list) ? d.data.list.filter((x: any) => x.storageUrl || x.platformUrl) : [])
    } catch { setHistory([]) }
    finally { setHistoryLoading(false) }
  }
  useEffect(() => { loadHistory() }, [])
  const reusePrompt = (rec: any) => {
    if (rec.prompt) setPrompt(rec.prompt)
    if (rec.model) { /* 保持当前 provider，模型名显示在历史里 */ }
    document.querySelector('.prompt-input-area')?.scrollIntoView({ behavior: 'smooth' })
  }
  const SIZE_OPTIONS = [
    { value: '1280*1280', label: '1:1 正方形' },
    { value: '1696*960', label: '16:9 横版' },
    { value: '960*1696', label: '9:16 竖版' },
    { value: '1472*1104', label: '4:3 横版' },
    { value: '1104*1472', label: '3:4 竖版' },
    { value: '1440*720', label: '2:1 横版' },
    { value: '720*1440', label: '1:2 竖版' },
    { value: '768*2700', label: '1:3.5 长竖版' },
  ]

  useEffect(() => {
    if (!authLoading) loadTemplates()
  }, [authLoading, filterCat])

  // 从素材库跳转过来时读取 URL 参数
  useEffect(() => {
    const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    if (sp?.get('prompt')) setPrompt(decodeURIComponent(sp.get('prompt')!))
    // 2026-08-15: 公共素材库「推生图」——media URL 下载转参考图
    const media = sp?.get('media')
    if (media) {
      fetch(media).then(r => r.blob()).then(b => {
        const f = new File([b], 'ref-' + Date.now() + '.jpg', { type: b.type || 'image/jpeg' })
        setReferenceImage(f); setReferencePreview(media)
      }).catch(() => {})
    }
  }, [])

  // 获取用户收藏
  useEffect(() => {
    fetch('/api/media-library?source=private', { credentials: 'include' }).then(r => r.json()).then(d => { if (d.data) setFavItems(d.data) }).catch(() => {})
  }, [])

  const loadTemplates = async () => {
    setTemplatesLoading(true)
    try {
      const url = filterCat ? `/api/prompt-templates?category=${encodeURIComponent(filterCat)}` : '/api/prompt-templates'
      const r = await fetch(url, { credentials: 'include' })
      if (r.ok) setTemplates((await r.json()).data || [])
    } catch {} finally { setTemplatesLoading(false) }
  }

  const applyTemplate = useCallback((t: PromptItem) => {
    setPrompt(t.prompt)
    setGeneratedUrl(null)
    setError('')
  }, [])

  const handleGenerate = async () => {
    if (!prompt.trim()) { showToast('请输入提示词', 'error'); return }
    setGenerating(true)
    setGeneratedUrl(null)
    setError('')
    setUsingModel('百炼通义万相...')
    try {
      const r = await fetch('/api/generate-image', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), size: imageSize, provider }),
      })
      const d = await r.json()
      if (d.success) {
        setGeneratedUrl(d.data.url)
        setUsingModel(d.data.model || '百炼通义万相')
        setLastPoints(typeof d.pointsSpent === 'number' ? d.pointsSpent : null)
        showToast('图片生成成功')
      } else {
        setError(d.message || '生成失败')
        setUsingModel('')
        showToast(d.message || '生成失败', 'error')
      }
    } catch {
      setError('网络错误')
      setUsingModel('')
      showToast('网络错误', 'error')
    } finally { setGenerating(false) }
  }

  const handleDownload = () => {
    if (!generatedUrl) return
    // 尝试直接下载（同域/OSS配置了CORS时可工作）
    const a = document.createElement('a')
    a.href = `/api/proxy-download?url=${encodeURIComponent(generatedUrl)}`
    a.download = `ai-image-${Date.now()}.png`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => document.body.removeChild(a), 2000)
  }

  if (authLoading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-gray-400"><span>加载中</span><span className="text-xs opacity-50 ml-1">/ LOADING</span></div>
    </div>
  )
  if (!user) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-red-400 text-center"><p className="text-xl mb-2"><span>请先登录</span><span className="text-xs opacity-50 ml-1">/ LOGIN REQUIRED</span></p></div>
    </div>
  )

  return (
    <>
    <PromptLibraryDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} onSelect={(t) => { setPrompt(t); setShowFav(false); setFilterCat(''); showToast('已填入提示词') }} />
    <div className="min-h-screen bg-gray-950">
        <TourGuide />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2"><span>创作工具</span><span className="text-xs opacity-50 ml-1">/ TOOLS</span></p>
          <h1 className="text-mono-lg text-white"><span>AI 生图</span><span className="text-sm opacity-50 ml-2">/ IMAGE GENERATOR</span></h1>
          <p className="text-gray-400 text-sm mt-2"><span>选模板或输提示词，AI 一键生成</span><span className="text-xs opacity-50 ml-1">/ Pick a template or enter your prompt</span></p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* 左侧模板列表 */}
          <div className="lg:col-span-2 space-y-4">
            <div className="card-glass p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-white font-bold text-sm"><span>提示词模板</span><span className="text-xs opacity-50 ml-1">/ PROMPT TEMPLATES</span></h2>
                  <button onClick={() => setLibraryOpen(true)} className="text-[10px] px-2 py-0.5 rounded-full border border-violet-400/40 text-violet-300 hover:bg-violet-500/15">📚 提示词库</button>
                </div>
                <button onClick={() => setShowFav(!showFav)}
                  className={`px-2 py-1 rounded text-xs ${showFav ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                  {showFav ? '📁 模板' : '⭐ 收藏'}
                </button>
              </div>
              {!showFav ? (<>
                <div className="flex gap-1 mb-3 flex-wrap">
                  <button onClick={() => setFilterCat('')}
                    className={`px-2 py-1 rounded text-xs ${!filterCat ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                    <span>全部</span><span className="text-[10px] opacity-50 ml-1">/ ALL</span>
                  </button>
                  {CATEGORIES.map(c => (
                    <button key={c} onClick={() => setFilterCat(c)}
                      className={`px-2 py-1 rounded text-xs ${filterCat === c ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                      {c}
                    </button>
                  ))}
                </div>
                <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                  {templatesLoading ? (
                    <div className="text-gray-500 text-xs text-center py-4"><span>加载中</span></div>
                  ) : templates.length === 0 ? (
                    <div className="text-gray-500 text-xs text-center py-4"><span>暂无模板</span></div>
                  ) : templates.map(t => (
                    <button key={t.id} onClick={() => applyTemplate(t)}
                      className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-emerald-500/30 transition-all">
                      <div className="text-white text-xs font-bold truncate">{t.title}</div>
                      <div className="text-gray-500 text-[10px] mt-0.5 truncate">{t.category}</div>
                      <div className="text-gray-600 text-[10px] mt-0.5 truncate">{t.prompt}</div>
                    </button>
                  ))}
                </div>
              </>) : (
                <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                  {favItems.length === 0 ? (
                    <div className="text-gray-500 text-xs text-center py-4">去素材库收藏素材后显示在这里</div>
                  ) : favItems.map((fav: any) => (
                    <button key={fav.id} onClick={() => { setPrompt(fav.prompt || fav.title); setShowFav(false) }}
                      className="w-full text-left p-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-500/30 transition-all">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded bg-black/40 flex-shrink-0 overflow-hidden">
                          {fav.ossUrl?.endsWith('.mp4')
                            ? <video src={fav.ossUrl} className="w-full h-full object-cover" />
                            : <img src={fav.ossUrl} alt="" className="w-full h-full object-cover" />
                          }
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-white text-xs font-medium truncate">{fav.title}</div>
                          <div className="text-gray-500 text-[10px] truncate">{fav.prompt || ''}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 中间编辑区 */}
          <div className="lg:col-span-2">
            <div className="card-glass p-4 h-full flex flex-col">
              <h2 className="text-white font-bold text-sm mb-3"><span>提示词编辑</span><span className="text-xs opacity-50 ml-1">/ EDIT PROMPT</span></h2>
              <textarea
                className="input-dark flex-1 min-h-[200px] resize-y mb-4"
                placeholder="输入图片描述提示词..."
                value={prompt}
                onChange={e => { setPrompt(e.target.value); setGeneratedUrl(null); setError('') }}
              />

              {/* 参考图片上传 */}
              <div className="mb-3">
                <span className="text-gray-500 text-xs block mb-1"><span>参考图片</span><span className="text-[10px] opacity-50 ml-1">/ REFERENCE</span><span className="text-[10px] text-gray-600 ml-2">可选</span></span>
                <div className="flex items-center gap-3">
                  <label className="cursor-pointer px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-gray-400 hover:bg-white/10 transition-colors">
                    选择图片
                    <input type="file" accept="image/*" className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) { setReferenceImage(f); setReferencePreview(URL.createObjectURL(f)) }
                      }}
                    />
                  </label>
                  {referencePreview && (
                    <div className="flex items-center gap-2">
                      <img src={referencePreview} alt="ref" className="w-10 h-10 rounded-lg object-cover border border-white/10" />
                      <button onClick={() => { setReferenceImage(null); setReferencePreview('') }}
                        className="text-xs text-red-400 hover:text-red-300">移除</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-3">
                <span className="text-gray-500 text-xs block mb-1"><span>尺寸</span><span className="text-[10px] opacity-50 ml-1">/ SIZE</span></span>
                <div className="flex gap-1 flex-wrap">
                  {SIZE_OPTIONS.map(opt => (
                    <button key={opt.value} type="button" onClick={() => setImageSize(opt.value)}
                      className={`px-2 py-1 rounded text-xs ${imageSize === opt.value ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 模型选择（仅 admin 可见） */}
              {user?.role === 'admin' && (
                <div className="mb-3">
                  <span className="text-gray-500 text-xs block mb-1">
                    <span>模型引擎</span><span className="text-[10px] opacity-50 ml-1">/ MODEL</span>
                    <span className="text-[10px] text-emerald-400 ml-2">管理员</span>
                  </span>
                  <div className="flex gap-1 flex-wrap">
                    {[
                      { value: 'auto' as const, label: '自动(Auto)', desc: 'Agnes→百炼→硅基' },
                      { value: 'qwen-image-3.0-pro' as const, label: '通义千问 3.0 Pro', desc: '推荐·文字最强' },
                      { value: 'qwen-image-3.0' as const, label: '通义千问 3.0', desc: '速度版' },
                      { value: 'dashscope' as const, label: '百炼 qwen-3.0-pro', desc: '直连百炼' },
                      { value: 'siliconflow' as const, label: '硅基 Z-Image', desc: '备选' },
                    ].map(opt => (
                      <button key={opt.value} type="button" onClick={() => setProvider(opt.value)}
                        className={`px-3 py-1.5 rounded text-xs ${provider === opt.value ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                        {opt.label}
                        <span className="text-[10px] ml-1 opacity-60">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
                className="btn-primary w-full disabled:opacity-50"
              >
                {generating ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>生成中</span><span className="text-xs opacity-50 ml-1">/ GENERATING</span>
                  </span>
                ) : <><span>✨ 生成图片</span><span className="text-xs opacity-50 ml-1">/ GENERATE</span></>}
              </button>
            </div>
          </div>

          {/* 右侧预览区 */}
          <div className="lg:col-span-1">
            <div className="card-glass p-4 h-full flex flex-col">
              <h2 className="text-white font-bold text-sm mb-3"><span>结果预览</span><span className="text-xs opacity-50 ml-1">/ PREVIEW</span></h2>
              {lastPoints != null && (
                <p className="text-[10px] text-amber-300/80 mb-2">🪙 本次 AI 消耗 {lastPoints} 点</p>
              )}
              <div className="flex-1 flex items-center justify-center min-h-[260px] bg-black/30 rounded-lg overflow-hidden">
                {generating ? (
                  <div className="text-center p-4">
                    <svg className="w-8 h-8 animate-spin text-emerald-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <p className="text-gray-400 text-xs"><span>AI 创作中</span><span className="text-[10px] opacity-50 ml-1">/ CREATING</span></p>
                    {usingModel && <p className="text-emerald-400 text-[10px] mt-1">{usingModel}</p>}
                  </div>
                ) : generatedUrl ? (
                  <div className="w-full h-full flex flex-col">
                    <img src={generatedUrl} alt="generated image" className="flex-1 w-full object-contain" />
                    {usingModel && <p className="text-gray-500 text-[10px] text-center mt-1"><span>模型</span><span className="opacity-50 ml-1">/ MODEL</span>: {usingModel}</p>}
                  </div>
                ) : error ? (
                  <div className="text-center p-4">
                    <p className="text-red-400 text-xs mb-1"><span>生成失败</span><span className="text-[10px] opacity-50 ml-1">/ FAILED</span></p>
                    <p className="text-gray-500 text-[10px] break-all">{error}</p>
                  </div>
                ) : (
                  <p className="text-gray-500 text-xs text-center px-2"><span>输入提示词并生成</span><span className="text-[10px] opacity-50 ml-1">/ ENTER PROMPT</span></p>
                )}
              </div>
              {generatedUrl && (
                <div className="flex gap-2 mt-3">
                  <button onClick={handleDownload} className="btn-primary flex-1">
                    <span>⬇ 下载图片</span><span className="text-xs opacity-50 ml-1">/ DOWNLOAD</span>
                  </button>
                  <button onClick={() => navigator.clipboard?.writeText(prompt)} className="px-3 py-2 rounded-lg bg-white/10 text-xs text-gray-200 hover:bg-white/20">
                    📋 复制本次提示词
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 🕘 我的生成历史（2026-08-10：查看提示词/复用） */}
        <div className="mt-8 border-t border-white/10 pt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">🕘 我的生成历史</h2>
            <span className="text-[10px] text-gray-500">最近 {history.length} 条 · 点「↻」可复用提示词</span>
          </div>
          {historyLoading ? <div className="text-gray-500 text-center py-8 text-xs">加载中…</div>
          : history.length === 0 ? <div className="text-gray-600 text-center py-8 text-xs">还没有生成记录</div>
          : <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {history.map(rec => (
              <div key={rec.id} className="rounded-xl border border-white/10 bg-white/[0.04] overflow-hidden hover:border-emerald-400/40 transition-all group">
                <div className="aspect-square bg-black/40 relative">
                  {(rec.storageUrl || rec.platformUrl) ? (
                    <img src={rec.storageUrl || rec.platformUrl} alt="" className="w-full h-full object-cover" loading="lazy"
                      onClick={() => (rec.storageUrl || rec.platformUrl) && window.open(rec.storageUrl || rec.platformUrl, '_blank')} />
                  ) : <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-600">无图</div>}
                  {rec.status === 'succeeded' && <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-emerald-500/80 text-[9px] text-black">✅</span>}
                  {rec.status === 'failed' && <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-red-500/80 text-[9px] text-black">❌</span>}
                </div>
                <div className="p-2">
                  <div className="text-[9px] text-gray-500 truncate" title={rec.prompt || ''}>{rec.prompt || '(无提示词记录)'}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[9px] text-cyan-400/70 truncate max-w-[60%]">{rec.model || rec.provider || ''}</span>
                    <div className="flex gap-1">
                      <button onClick={() => rec.prompt && navigator.clipboard?.writeText(rec.prompt)} title="复制提示词"
                        className="px-1.5 py-0.5 rounded bg-white/10 text-[9px] text-gray-300 hover:bg-white/20">📋</button>
                      <button onClick={() => rec.prompt && reusePrompt(rec)} title="用这个再生成"
                        className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-[9px] text-emerald-300 hover:bg-emerald-500/30">↻</button>
                    </div>
                  </div>
                  <div className="mt-0.5 text-[8px] text-gray-600">{new Date(rec.createdAt).toLocaleString('zh-CN')}</div>
                </div>
              </div>
            ))}
          </div>}
        </div>
      </div>
    </div>
    </>
  )
}
