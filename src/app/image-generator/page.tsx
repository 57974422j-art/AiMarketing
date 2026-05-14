'use client'
import { useState, useEffect, useCallback } from 'react'
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

export default function ImageGeneratorPage() {
  const { user, loading: authLoading } = useAuth()
  const [templates, setTemplates] = useState<PromptItem[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [filterCat, setFilterCat] = useState('')
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [imageSize, setImageSize] = useState('1280*1280')
  const [usingModel, setUsingModel] = useState('')
  const [provider, setProvider] = useState<'auto' | 'dashscope' | 'siliconflow'>('auto')
  const [referenceImage, setReferenceImage] = useState<File | null>(null)
  const [showFav, setShowFav] = useState(false)
  const [favItems, setFavItems] = useState<any[]>([])
  const [referencePreview, setReferencePreview] = useState('')
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
    <div className="min-h-screen bg-gray-950">
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
                <h2 className="text-white font-bold text-sm"><span>提示词模板</span><span className="text-xs opacity-50 ml-1">/ PROMPT TEMPLATES</span></h2>
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
                      { value: 'auto' as const, label: '自动(Auto)', desc: '百炼→硅基' },
                      { value: 'dashscope' as const, label: '百炼 wan2.6-t2i', desc: '推荐' },
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
                <button onClick={handleDownload} className="btn-primary w-full mt-3">
                  <span>⬇ 下载图片</span><span className="text-xs opacity-50 ml-1">/ DOWNLOAD</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
