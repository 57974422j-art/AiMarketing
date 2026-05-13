'use client'

import { useState, useEffect } from 'react'
import { useLocale } from '@/i18n/context'
import { useAuth } from '@/app/providers'

interface VideoTemplate {
  id: number
  title: string
  description?: string
  prompt: string
  duration: number
  style: string
  thumbnail?: string
  videoUrl?: string
  isActive: boolean
  createdAt: string
}

const durations = [5, 10, 15]
const longDurations = [20, 30, 45, 60]
const styles = ['电影感', '自然风光', '3D产品', '美食', '动画风', '广告感']
const MODELS = [
  { value: '', label: '自动(Auto)', desc: 'Doubao→wan2.7→happyhorse' },
  { value: 'doubao', label: 'Doubao-Seedance', desc: '火山引擎' },
  { value: 'wan2.7', label: '百炼 wan2.7', desc: '阿里云' },
  { value: 'happyhorse', label: '快乐小马', desc: '自动配音' },
]

export default function TextToVideoPage() {
  const { t } = useLocale()
  const { user } = useAuth()
  const [templates, setTemplates] = useState<VideoTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(5)
  const [style, setStyle] = useState('电影感')
  const [resolution, setResolution] = useState('720P')
  const [ratio, setRatio] = useState('16:9')
  const [model, setModel] = useState('')
  const [longVideo, setLongVideo] = useState(false)
const [refImage, setRefImage] = useState<File | null>(null)
const [refPreview, setRefPreview] = useState('')
const [segmentPrompts, setSegmentPrompts] = useState<string[]>([])
const [editSegments, setEditSegments] = useState(false)
const [generating, setGenerating] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [progress, setProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t) } }, [toast])
  useEffect(() => { fetchTemplates() }, [])

  const fetchTemplates = async () => {
    try {
      const r = await fetch('/api/templates/video')
      if (r.ok) setTemplates((await r.json()).data || [])
    } catch {} finally { setLoading(false) }
  }

  const allDurations = longVideo ? longDurations : durations

  const handleGenerate = async () => {
    const effectivePrompts = longVideo && editSegments && segmentPrompts.length > 0
      ? segmentPrompts
      : longVideo && segmentPrompts.length > 0
        ? segmentPrompts
        : null
    const needPrompt = !longVideo || (!effectivePrompts && !prompt.trim())
    if (needPrompt) {
      if (!prompt.trim()) { setToast('请输入视频描述'); return }
    }
    if (longVideo && effectivePrompts && effectivePrompts.some(p => !p.trim())) {
      setToast('请填写所有分段提示词'); return
    }
    setGenerating(true); setTaskId(''); setVideoUrl(''); setError(''); setProgress(0)
    try {
      const body: Record<string, unknown> = {
        prompt: (title ? title + '：' : '') + prompt.trim(),
        aspectRatio: ratio, duration, resolution, longVideo,
      }
      if (model) body.model = model
      if (longVideo && segmentPrompts.length > 0) {
        body.segmentPrompts = segmentPrompts
      }
      if (refImage) {
        const buf = await refImage.arrayBuffer()
        body.refImage = Buffer.from(buf).toString('base64')
      }

      const r = await fetch('/api/video/text-to-video', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!d.success) { setError(d.message || '提交失败'); setGenerating(false); return }
      if (d.videoUrl) { setVideoUrl(d.videoUrl); setProgress(100); setGenerating(false); return }

      setTaskId(d.taskId)
      const interval = longVideo ? 15000 : 15000
      const maxAttempts = longVideo ? 120 : 60
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, interval))
        setProgress(Math.min(95, Math.round((i + 1) / maxAttempts * 100)))
        const q = await fetch(`/api/video/text-to-video?taskId=${d.taskId}`, { credentials: 'include' })
        const qd = await q.json()
        if (qd.videoUrl) { setVideoUrl(qd.videoUrl); setProgress(100); setGenerating(false); return }
        if (qd.status === 'FAILED') { setError('视频生成失败'); setGenerating(false); return }
      }
      setError('生成超时')
    } catch { setError('请求失败') }
    finally { setGenerating(false) }
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 border border-gray-700 text-white px-4 py-3 rounded-xl shadow-2xl font-mono text-sm">
          {toast}
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">AI 工作区 / AI WORKSPACE</p>
          <h1 className="text-mono-lg text-white">{t.textToVideo.title} / TEXT-TO-VIDEO</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">{t.textToVideo.createNew}</h2>

              <div className="space-y-4">
                {/* 标题（恢复） */}
                <div>
                  <label className="block text-label mb-1">视频标题 / TITLE (OPTIONAL)</label>
                  <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                    placeholder="VIDEO TITLE..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50" />
                </div>

                {/* 提示词 */}
                <div>
                  <label className="block text-label mb-1">{t.textToVideo.promptRequired}</label>
                  <textarea value={prompt} onChange={e => { setPrompt(e.target.value); setVideoUrl('') }}
                    placeholder={t.textToVideo.describeVideo}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                    rows={4} />
                </div>

                {/* 参数行：全部改为统一按钮样式 */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-label mb-1">{t.textToVideo.duration}</label>
                    <div className="flex gap-1 flex-wrap">
                      {allDurations.map(d => (
                        <button key={d} type="button" onClick={() => { 
                          setDuration(d)
                          if (longVideo) {
                            const segCount = Math.ceil(d / 15)
                            setSegmentPrompts(Array(segCount).fill(prompt))
                          }
                        }}
                          className={`px-2 py-1.5 rounded text-xs ${duration === d ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                          {d}{t.textToVideo.seconds}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-label mb-1">{t.textToVideo.style}</label>
                    <select value={style} onChange={e => setStyle(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-emerald-500/50">
                      {styles.map(s => <option key={s} value={s} className="bg-gray-900">{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-label mb-1">画面比例</label>
                    <div className="flex gap-1 flex-wrap">
                      {['16:9', '9:16', '1:1'].map(r => (
                        <button key={r} type="button" onClick={() => setRatio(r)}
                          className={`px-2 py-1.5 rounded text-xs ${ratio === r ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-label mb-1">分辨率</label>
                    <div className="flex gap-1 flex-wrap">
                      {['720P', '1080P'].map(r => (
                        <button key={r} type="button" onClick={() => setResolution(r)}
                          className={`px-2 py-1.5 rounded text-xs ${resolution === r ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 长视频开关 */}
                <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={longVideo} onChange={e => { 
                      const v = e.target.checked
                      setLongVideo(v)
                      const d = v ? 20 : 5
                      setDuration(d)
                      if (v) {
                        const segCount = Math.ceil(d / 15)
                        setSegmentPrompts(Array(segCount).fill(prompt))
                        setEditSegments(false)
                      }
                    }} className="sr-only peer" />
                    <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:bg-emerald-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                  </label>
                  <div>
                    <span className="text-sm text-gray-300 font-mono">自动拼接长视频（最长 60 秒）</span>
                    <p className="text-[10px] text-gray-600">{'>'}15s 自动拆分多段，用尾帧保证连贯</p>
                  </div>
                </div>

                {/* 分段提示词（长视频） */}
                {longVideo && (
                  <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-label text-sm">分段提示词 / SEGMENT PROMPTS</label>
                      <div className="flex gap-2">
                        <button type="button" onClick={async () => {
                          if (!prompt.trim()) { setToast('请先在视频描述中输入完整内容'); return }
                          const segCount = Math.ceil(duration / 15)
                          setEditSegments(true)
                          setProgress(0)
                          try {
                            const r = await fetch('/api/video/split-prompt', {
                              method: 'POST', credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ prompt: prompt.trim(), segments: segCount }),
                            })
                            const d = await r.json()
                            if (d.success && d.data) {
                              setSegmentPrompts(d.data)
                              setToast('AI 智能拆分完成')
                            } else { setToast('拆分失败，已使用默认分段') }
                          } catch { setToast('拆分失败') }
                        }}
                          className="text-xs px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30">
                          AI 智能拆分
                        </button>
                        <button type="button" onClick={() => { 
                          const newVal = !editSegments
                          setEditSegments(newVal)
                          if (newVal && segmentPrompts.length === 0) {
                            const segCount = Math.ceil(duration / 15)
                            setSegmentPrompts(Array(segCount).fill(prompt))
                          }
                        }}
                          className={`text-xs px-2 py-1 rounded ${editSegments ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>
                          {editSegments ? '收起' : '手动编辑'}
                        </button>
                      </div>
                    </div>
                    {editSegments && segmentPrompts.map((sp, idx) => {
                      const basePerSeg = 15
                      const isLast = idx === segmentPrompts.length - 1
                      const segDur = isLast && duration ? duration - idx * basePerSeg : basePerSeg
                      return (
                      <div key={idx} className="mb-2">
                        <label className="block text-[10px] text-gray-500 mb-1 font-mono">
                          片段 {idx + 1}/{segmentPrompts.length} ({segDur || basePerSeg}s)
                        </label>
                        <textarea value={sp} onChange={e => {
                          const copy = [...segmentPrompts]
                          copy[idx] = e.target.value
                          setSegmentPrompts(copy)
                        }}
                          placeholder={`第 ${idx + 1} 段视频描述...`}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
                          rows={2} />
                      </div>
                      )
                    })}
                    {!editSegments && (
                      <p className="text-[11px] text-gray-500">所有段使用同一提示词，点击「自定义」可单独编辑每段</p>
                    )}
                  </div>
                )}

                {/* 参考图上传 */}
                <div>
                  <label className="block text-label mb-1">参考图片 / REF IMAGE (OPTIONAL)</label>
                  <div className="flex items-center gap-3">
                    <label className="cursor-pointer px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-gray-400 hover:bg-white/10 transition-colors">
                      选择图片
                      <input type="file" accept="image/*" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) { setRefImage(f); setRefPreview(URL.createObjectURL(f)) } }} />
                    </label>
                    {refPreview && (
                      <div className="flex items-center gap-2">
                        <img src={refPreview} alt="ref" className="w-10 h-10 rounded-lg object-cover border border-white/10" />
                        <button onClick={() => { setRefImage(null); setRefPreview('') }} className="text-xs text-red-400 hover:text-red-300">移除</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 模型选择（admin 可见） */}
                {user?.role === 'admin' && (
                  <div>
                    <label className="block text-label mb-1">
                      视频模型 / MODEL
                      <span className="text-[10px] text-emerald-400 ml-2">管理员</span>
                    </label>
                    <div className="flex gap-1 flex-wrap">
                      {MODELS.map(m => (
                        <button key={m.value} type="button" onClick={() => setModel(m.value)}
                          className={`px-3 py-1.5 rounded text-xs ${model === m.value ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                          {m.label}
                          <span className="text-[10px] ml-1 opacity-60">{m.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 错误 */}
                {error && (
                  <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 text-sm text-red-400 font-mono">
                    ❌ {error}
                  </div>
                )}

                {/* 进度 */}
                {taskId && !videoUrl && (
                  <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                    <h3 className="text-label mb-4">{t.textToVideo.generatingProgress}</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm text-gray-400">
                        <span>⏳ {t.textToVideo.generating}...</span>
                        <span className="font-mono">{progress}%</span>
                      </div>
                      <div className="w-full bg-white/10 rounded-full h-3">
                        <div className="bg-gradient-to-r from-emerald-500 to-cyan-400 h-3 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="text-xs text-gray-500 font-mono">
                        {progress < 30 && '🎬 ' + t.textToVideo.analyzingPrompt}
                        {progress >= 30 && progress < 60 && '🎞️ ' + t.textToVideo.renderingFrames}
                        {progress >= 60 && progress < 90 && '💡 ' + t.textToVideo.processingLight}
                        {progress >= 90 && '🔊 ' + t.textToVideo.synthesizingAudio}
                      </div>
                    </div>
                  </div>
                )}

                {/* 结果 */}
                {videoUrl && (
                  <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                    <h2 className="text-label mb-4">生成结果 / RESULT</h2>
                    <video src={videoUrl} controls className="w-full rounded-xl max-h-[500px]" />
                    <p className="text-xs text-gray-500 mt-2 font-mono">链接 24 小时内有效，可右键下载保存</p>
                  </div>
                )}

                <button onClick={handleGenerate}
                  disabled={generating || !prompt.trim()}
                  className="w-full px-4 py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white rounded-xl hover:opacity-90 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-all">
                  {generating ? `${t.textToVideo.generating} ${progress}%` : `✨ 生成视频${longVideo ? ' (长视频)' : ''}`}
                </button>
              </div>
            </div>

            {/* 提示词技巧 */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">{t.textToVideo.promptTips}</h2>
              <div className="space-y-3 text-sm text-gray-400">
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">1.</span>
                  <span>{t.textToVideo.describeScene}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">2.</span>
                  <span>{t.textToVideo.specifyCamera}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">3.</span>
                  <span>{t.textToVideo.describeMotion}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">4.</span>
                  <span>{t.textToVideo.specifyStyle}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 右侧 */}
          <div className="space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">{t.textToVideo.sceneSuggestions}</h2>
              <div className="space-y-3">
                {[
                  { title: t.textToVideo.citySkyline, desc: t.textToVideo.citySkylineDesc },
                  { title: t.textToVideo.productDisplay, desc: t.textToVideo.productDisplayDesc },
                  { title: t.textToVideo.natureScenery, desc: t.textToVideo.natureSceneryDesc },
                  { title: t.textToVideo.foodCloseUp, desc: t.textToVideo.foodCloseUpDesc }
                ].map((item, idx) => (
                  <button key={idx} onClick={() => setPrompt(item.desc)}
                    className="w-full text-left p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors">
                    <div className="font-medium text-white text-sm">{item.title}</div>
                    <div className="text-xs text-gray-500 mt-1">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 rounded-2xl border border-emerald-500/20 p-6 text-white">
              <h3 className="font-semibold mb-2">{t.textToVideo.useCases}</h3>
              <ul className="text-sm space-y-2 text-gray-300">
                <li>• {t.textToVideo.socialMedia}</li>
                <li>• {t.textToVideo.ecommerce}</li>
                <li>• {t.textToVideo.brandPromotion}</li>
                <li>• {t.textToVideo.educational}</li>
                <li>• {t.textToVideo.personalIp}</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 底部模板库 */}
        <div className="mt-8">
          <h2 className="text-label mb-4">{t.textToVideo.historyRecords}</h2>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10">
              <div className="text-4xl mb-4">📽️</div>
              <p className="text-gray-400 font-mono text-center">暂无模板</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {templates.map(template => (
                <div key={template.id} className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
                  <div className="relative">
                    <img src={template.thumbnail || 'https://images.unsplash.com/photo-1536240478700-b869ad10e128?w=400&h=225&fit=crop'}
                      alt={template.title} className="w-full h-40 object-cover" />
                    <span className="absolute top-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-mono rounded">{template.duration}S</span>
                    <span className="absolute bottom-2 left-2 px-2 py-1 bg-emerald-500 text-white text-xs rounded">{template.style}</span>
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-white mb-1 truncate font-mono text-sm">{template.title}</h3>
                    <p className="text-xs text-gray-500 mb-2 line-clamp-2">{template.description || template.prompt}</p>
                    <div className="flex items-center justify-end">
                      <button onClick={() => { setPrompt(template.prompt); setStyle(template.style); setDuration(Math.min(15, Math.max(5, template.duration))) }}
                        className="text-xs px-3 py-1.5 bg-emerald-500 text-white rounded hover:bg-emerald-600">使用模板</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
