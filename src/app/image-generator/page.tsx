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

  useEffect(() => {
    if (!authLoading) loadTemplates()
  }, [authLoading, filterCat])

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
    try {
      const r = await fetch('/api/generate-image', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      })
      const d = await r.json()
      if (d.success) {
        setGeneratedUrl(d.data.url)
        showToast('图片生成成功')
      } else {
        setError(d.message || '生成失败')
        showToast(d.message || '生成失败', 'error')
      }
    } catch {
      setError('网络错误')
      showToast('网络错误', 'error')
    } finally { setGenerating(false) }
  }

  const handleDownload = async () => {
    if (!generatedUrl) return
    try {
      const r = await fetch(generatedUrl)
      const blob = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `ai-image-${Date.now()}.png`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch { showToast('下载失败', 'error') }
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
          <div className="lg:col-span-2">
            <div className="card-glass p-4">
              <h2 className="text-white font-bold text-sm mb-3"><span>提示词模板</span><span className="text-xs opacity-50 ml-1">/ PROMPT TEMPLATES</span></h2>
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
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {templatesLoading ? (
                  <div className="text-gray-500 text-xs text-center py-4"><span>加载中</span><span className="text-[10px] opacity-50 ml-1">/ LOADING</span></div>
                ) : templates.length === 0 ? (
                  <div className="text-gray-500 text-xs text-center py-4"><span>暂无模板</span><span className="text-[10px] opacity-50 ml-1">/ EMPTY</span></div>
                ) : templates.map(t => (
                  <button key={t.id} onClick={() => applyTemplate(t)}
                    className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-emerald-500/30 transition-all">
                    <div className="text-white text-xs font-bold truncate">{t.title}</div>
                    <div className="text-gray-500 text-[10px] mt-0.5 truncate">{t.category}</div>
                    <div className="text-gray-600 text-[10px] mt-0.5 truncate">{t.prompt}</div>
                  </button>
                ))}
              </div>
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
                  </div>
                ) : generatedUrl ? (
                  <img src={generatedUrl} alt="generated image" className="w-full h-full object-contain" />
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
