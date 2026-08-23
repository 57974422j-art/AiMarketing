'use client'
import TourGuide from '@/components/TourGuide'

import { useState, useEffect } from 'react'
import { useLocale } from '@/i18n/context'
import { useAuth } from '@/app/providers'
import PromptLibraryDialog from '@/components/prompts/PromptLibraryDialog'

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
const longDurations = [10, 15, 20, 30, 45, 60]
const styles = ['电影感', '自然风光', '3D产品', '美食', '动画风', '广告感']
const MODELS = [
  { value: '', label: '自动(Auto)', desc: 'Doubao→wan2.7→happyhorse' },
  { value: 'doubao', label: 'Doubao-Seedance', desc: '火山引擎' },
  { value: 'wan2.7', label: '百炼 wan2.7', desc: '阿里云' },
  { value: 'h3-768p', label: 'MiniMax H3 768P', desc: '50点/秒 · 更便宜' },
  { value: 'h3-2k', label: 'MiniMax H3 2K', desc: '80点/秒 · 高清' },
  { value: 'happyhorse', label: '快乐小马', desc: '自动配音' },
]
// 2026-08-14: 模型联动配置（选模型自动切换控件）
const MODEL_CFG: Record<string, { res: string[]; durs: number[]; long: boolean; refVideo: boolean; rate: number }> = {
  '':      { res: ['480P', '720P', '1080P'], durs: [5, 10, 15], long: true, refVideo: true, rate: 100 },
  'wan2.7':{ res: ['480P', '720P', '1080P'], durs: [5, 10, 15], long: true, refVideo: true, rate: 100 },
  'h3-768p':{ res: ['768P'], durs: [4, 5, 10, 15], long: false, refVideo: false, rate: 50 },
  'h3-2k': { res: ['2K'], durs: [4, 5, 10, 15], long: false, refVideo: false, rate: 80 },
}

export default function TextToVideoPage() {
  const { t } = useLocale()
  const { user } = useAuth()
  const [templates, setTemplates] = useState<VideoTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  // 2026-08-23: 引导演示自动填（tour-step=4：预填脚本，不真执行）
  useEffect(() => {
    const ts = parseInt(sessionStorage.getItem('tour-step') || '0')
    if (ts === 4) { setTitle('AI 产品宣传片'); setPrompt('清晨的城市天际线，镜头缓慢上升，阳光穿透云层，电影感运镜') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [duration, setDuration] = useState(5)
  const [style, setStyle] = useState('电影感')
  const [resolution, setResolution] = useState('720P')
  const [ratio, setRatio] = useState('16:9')
  const [model, setModel] = useState('')
  // 生成历史（2026-08-10：查看提示词/复用）
  const [videoHistory, setVideoHistory] = useState<any[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const loadVideoHistory = async () => {
    setHistLoading(true)
    try {
      const r = await fetch('/api/generation-records?type=text2video&limit=16', { credentials: 'include' })
      const d = await r.json()
      setVideoHistory(Array.isArray(d?.data?.list) ? d.data.list.filter((x: any) => x.storageUrl || x.platformUrl) : [])
    } catch { setVideoHistory([]) }
    finally { setHistLoading(false) }
  }
  useEffect(() => { loadVideoHistory() }, [])
  const [longVideo, setLongVideo] = useState(false)
const [genMode, setGenMode] = useState<'text' | 'image' | 'clone'>('text')
const [refImage, setRefImage] = useState<File | null>(null)
const [refPreview, setRefPreview] = useState('')
const [refVideoUrl, setRefVideoUrl] = useState('')
const [refImageUrl, setRefImageUrl] = useState('')
const [segmentPrompts, setSegmentPrompts] = useState<string[]>([])
const [editSegments, setEditSegments] = useState(false)
const [generating, setGenerating] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [progress, setProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
const [manualMode, setManualMode] = useState(false)
const [segmentVideos, setSegmentVideos] = useState<string[]>([])
const [generatingSegment, setGeneratingSegment] = useState(-1)
const [previewUrl, setPreviewUrl] = useState('')
const [segDuration, setSegDuration] = useState(5)
const [splitting, setSplitting] = useState(false)
const [favorites, setFavorites] = useState<any[]>([])
const [sceneLib, setSceneLib] = useState<any[]>([])
const [lastPoints, setLastPoints] = useState<number | null>(null)

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t) } }, [toast])

  // 读取 URL 参数（从素材库「克隆视频」/「使用到文生视频」带入）
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const p = sp.get('prompt'); if (p) setPrompt(p)
      const ref = sp.get('refUrl'); if (ref) { setRefImageUrl(ref); setGenMode('image') }
      const rv = sp.get('refVideo'); if (rv) { setRefVideoUrl(rv); setGenMode('clone') }
    } catch {}
  }, [])
  useEffect(() => { fetchTemplates() }, [])
  // 从素材库跳转过来时读取 URL 参数
  useEffect(() => {
    const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    if (sp?.get('prompt')) setPrompt(decodeURIComponent(sp.get('prompt')!))
  }, [])
  // sessionStorage 持久化：生成好的分段视频切换页面不丢失
  useEffect(() => { const saved = sessionStorage.getItem('segVideos'); if (saved) setSegmentVideos(JSON.parse(saved)) }, [])
  useEffect(() => { if (segmentVideos.length > 0) sessionStorage.setItem('segVideos', JSON.stringify(segmentVideos)) }, [segmentVideos])
  // 获取用户收藏和场景库
  useEffect(() => {
    if (!user) return
    fetch('/api/media-library?source=private', { credentials: 'include' }).then(r => r.json()).then(d => { if (d.data) setFavorites(d.data) }).catch(() => {})
    fetch('/api/media-library?source=private&category=场景', { credentials: 'include' }).then(r => r.json()).then(d => { if (d.data) setSceneLib(d.data) }).catch(() => {})
  }, [user])

  const fetchTemplates = async () => {
    try {
      const r = await fetch('/api/templates/video')
      if (r.ok) setTemplates((await r.json()).data || [])
    } catch {} finally { setLoading(false) }
  }

  const allDurations = longVideo ? longDurations : (MODEL_CFG[model]?.durs || durations)

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
        body.segmentDuration = segDuration
      }
      if (refImage) {
        const buf = await refImage.arrayBuffer()
        body.refImage = Buffer.from(buf).toString('base64')
      } else if (genMode === 'image' && refImageUrl) {
        body.refImageUrl = refImageUrl
      }
      if (genMode === 'clone' && refVideoUrl) {
        body.refVideo = refVideoUrl
      }

      const r = await fetch('/api/video/text-to-video', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (typeof d.pointsSpent === 'number') setLastPoints(d.pointsSpent)
      if (!d.success) { setError(d.message || '提交失败'); setGenerating(false); return }
      if (d.videoUrl) { setVideoUrl(d.videoUrl); setProgress(100); setGenerating(false); return }

      setTaskId(d.taskId)
      const maxAttempts = longVideo ? 120 : 60
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 15000))
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
    <>
    <PromptLibraryDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} onSelect={(t) => { setPrompt(t); setVideoUrl('') }} />
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-label">{t.textToVideo.promptRequired}</label>
                    <button onClick={() => setLibraryOpen(true)} className="text-[10px] px-2 py-0.5 rounded-full border border-violet-400/40 text-violet-300 hover:bg-violet-500/15">📚 提示词库</button>
                  </div>
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
                            const segCount = Math.ceil(d / segDuration)
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
                      {(MODEL_CFG[model]?.res || ['480P', '720P', '1080P']).map(r => (
                        <button key={r} type="button" onClick={() => setResolution(r)}
                          className={`px-2 py-1.5 rounded text-xs ${resolution === r ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 长视频开关 */}
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10">
                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={longVideo} disabled={!MODEL_CFG[model]?.long} onChange={e => { 
                        const v = e.target.checked
                        setLongVideo(v)
                        setManualMode(false)
                        setSegmentVideos([])
                        setPreviewUrl('')
                        const d = v ? 20 : 5
                        setDuration(d)
                        if (v) {
                            const segCount = Math.ceil(d / segDuration)
                            setSegmentPrompts(Array(segCount).fill(prompt))
                            setEditSegments(false)
                        }
                      }} className="sr-only peer" />
                      <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:bg-emerald-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                    </label>
                    <div>
                      <span className="text-sm text-gray-300 font-mono">长视频模式</span>
                      <p className="text-[10px] text-gray-600">按「每段时长」切分多段分别生成后自动合成{MODEL_CFG[model]?.long ? '' : '（当前模型仅支持单段 ≤15s）'}</p>
                    </div>
                  </div>
                  {longVideo && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setManualMode(false); setSegmentVideos([]) }}
                        className={`text-xs px-3 py-1.5 rounded ${!manualMode ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>
                        自动合成
                      </button>
                      <button type="button" onClick={() => { setManualMode(true); setSegmentVideos([]) }}
                        className={`text-xs px-3 py-1.5 rounded ${manualMode ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>
                        手动预览
                      </button>
                    </div>
                  )}
                </div>

                {/* 分段时长（长视频） */}
                {longVideo && (
                  <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
                    <label className="text-label text-sm">每段时长</label>
                    <div className="flex gap-1">
                      {[5, 10, 15].map(s => (
                        <button key={s} type="button" onClick={() => {
                          setSegDuration(s)
                          const segCount = Math.ceil(duration / s)
                          setSegmentPrompts(Array(segCount).fill(prompt))
                        }}
                          className={`px-2 py-1 rounded text-xs ${segDuration === s ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>
                          {s}s
                        </button>
                      ))}
                    </div>
                    <span className="text-[10px] text-gray-500">{Math.ceil(duration / segDuration)}段</span>
                  </div>
                )}

                {/* 分段提示词（长视频） */}
                {longVideo && (
                  <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-label text-sm">分段提示词 / SEGMENT PROMPTS</label>
                      <div className="flex gap-2">
                        <button type="button" disabled={splitting} onClick={async () => {
                          if (splitting) return
                          if (!prompt.trim()) { setToast('请先在视频描述中输入完整内容'); return }
                          setSplitting(true)
                          const segCount = Math.ceil(duration / segDuration)
                          setEditSegments(true)
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
                          finally { setSplitting(false) }
                        }}
                          className={`text-xs px-2 py-1 rounded ${splitting ? 'bg-white/5 text-gray-500 cursor-not-allowed' : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30'}`}>
                          {splitting ? '拆解中...' : 'AI 智能拆分'}
                        </button>
                        <button type="button" onClick={() => { 
                          const newVal = !editSegments
                          setEditSegments(newVal)
                          if (newVal && segmentPrompts.length === 0) {
                          const segCount = Math.ceil(duration / segDuration)
                          setSegmentPrompts(Array(segCount).fill(prompt))
                          }
                        }}
                          className={`text-xs px-2 py-1 rounded ${editSegments ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>
                          {editSegments ? '收起' : '手动编辑'}
                        </button>
                      </div>
                    </div>
                    {editSegments && segmentPrompts.map((sp, idx) => {
                      const isLast = idx === segmentPrompts.length - 1
                      const segDur = isLast && duration ? duration - idx * segDuration : segDuration
                      return (
                      <div key={idx} className="mb-2">
        <TourGuide />
                        <label className="block text-[10px] text-gray-500 mb-1 font-mono">
                          片段 {idx + 1}/{segmentPrompts.length} ({segDur || segDuration}s)
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

                {/* 手动模式：逐段生成 + 预览 */}
                {longVideo && manualMode && segmentPrompts.length > 0 && (
                  <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-label text-sm">分段生成 / SEGMENT GENERATION</label>
                      {segmentVideos.length === segmentPrompts.length ? (
                        <button type="button" onClick={async () => {
                          setGenerating(true); setError('')
                          try {
                            const r = await fetch('/api/video/text-to-video', {
                              method: 'POST', credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ prompt: segmentPrompts.join(' '), duration, resolution, aspectRatio: ratio, longVideo: true, segmentPrompts, segmentDuration: segDuration, model: model || 'happyhorse' }),
                            })
                            const d = await r.json()
                            if (typeof d.pointsSpent === 'number') setLastPoints(d.pointsSpent)
                            if (d.videoUrl) { setVideoUrl(d.videoUrl); setProgress(100); setGenerating(false) }
                            else { setError('合成失败'); setGenerating(false) }
                          } catch { setError('合成失败'); setGenerating(false) }
                        }}
                          className="text-xs px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30">
                          🎬 合成完整视频
                        </button>
                      ) : (
                        <button type="button" disabled={generatingSegment >= 0} onClick={async () => {
                          const segCount = segmentPrompts.length
                          const segDur = Math.ceil(duration / segCount)
                          const vids: string[] = []
                          for (let i = 0; i < segCount; i++) {
                            setGeneratingSegment(i)
                            setError(`正在生成第 ${i + 1}/${segCount} 段...`)
                            try {
                              const r = await fetch('/api/video/generate-segment', {
                                method: 'POST', credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ prompt: segmentPrompts[i], duration: segDur, resolution, aspectRatio: ratio, model: model || 'happyhorse', segmentDuration: segDuration }),
                              })
                              const d = await r.json()
                              if (d.videoUrl) { vids.push(d.videoUrl); setSegmentVideos([...vids]) }
                              else if (d.taskId) {
                                // 异步轮询
                                for (let j = 0; j < 60; j++) {
                                  await new Promise(r => setTimeout(r, 3000))
                                  setError(`第 ${i + 1}/${segCount} 段生成中...`)
                                  const q = await fetch(`/api/video/text-to-video?taskId=${d.taskId}`, { credentials: 'include' })
                                  const qd = await q.json()
                                  if (qd.videoUrl) { vids.push(qd.videoUrl); setSegmentVideos([...vids]); break }
                                  if (qd.status === 'FAILED') throw new Error('生成失败')
                                }
                              }
                            } catch { setError(`第 ${i + 1} 段生成失败`); setGeneratingSegment(-1); return }
                          }
                          setError('')
                          setGeneratingSegment(-1)
                        }}
                          className={`text-xs px-3 py-1.5 rounded ${generatingSegment >= 0 ? 'bg-white/5 text-gray-500' : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30'}`}>
                          {generatingSegment >= 0 ? `生成中 (${generatingSegment + 1}/${segmentPrompts.length})` : '▶ 逐段生成'}
                        </button>
                      )}
                    </div>

                    {/* 预览窗格 — 横排 */}
                    {segmentVideos.length > 0 && (
                      <div className="flex gap-3 overflow-x-auto pb-2">
                        {segmentVideos.map((sv, idx) => (
                          <div key={idx} className="flex-shrink-0 w-48">
                            <div className="text-[10px] text-gray-500 mb-1 font-mono text-center">片段 {idx + 1}</div>
                            <video src={sv} className="w-48 h-28 rounded-lg object-cover cursor-pointer border border-white/10 hover:border-emerald-500/50 transition-colors"
                              onDoubleClick={() => setPreviewUrl(sv)} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 全屏预览 */}
                {previewUrl && (
                  <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={() => setPreviewUrl('')}>
                    <video src={previewUrl} controls autoPlay className="max-w-[90vw] max-h-[90vh] rounded-xl"
                      onClick={e => e.stopPropagation()} />
                  </div>
                )}

                {/* 模式切换：文生 / 图生 / 克隆 */}
                <div className="flex gap-2 mb-1">
                  {(['text', 'image', 'clone'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setGenMode(m)}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${genMode === m ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>
                      {m === 'text' ? '文生视频' : m === 'image' ? '图生视频' : '克隆视频'}
                    </button>
                  ))}
                </div>

                {genMode === 'clone' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">克隆视频：以参考视频的风格 / 画面为参考，生成一段新视频。请描述新视频的内容。</p>
                    <div className="flex items-center gap-2">
                      <input value={refVideoUrl} onChange={e => setRefVideoUrl(e.target.value)} disabled={!MODEL_CFG[model]?.refVideo} placeholder="粘贴参考视频链接（也可点击素材库「克隆视频」按钮带入）"
                        className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-emerald-500/50" />
                    </div>
                    {refVideoUrl && (
                      <video src={refVideoUrl} className="w-32 h-20 rounded-lg object-cover border border-white/10" controls />
                    )}
                  </div>
                ) : genMode === 'image' ? (
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
                      {refImageUrl && !refPreview && (
                        <div className="flex items-center gap-2">
                          <img src={refImageUrl} alt="ref" className="w-10 h-10 rounded-lg object-cover border border-white/10" />
                          <span className="text-xs text-gray-500">参考图</span>
                          <button onClick={() => setRefImageUrl('')} className="text-xs text-red-400 hover:text-red-300">移除</button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* 模型选择（admin 可见） */}
                {user?.role === 'admin' && (
                  <div>
                    <label className="block text-label mb-1">
                      视频模型 / MODEL
                      <span className="text-[10px] text-emerald-400 ml-2">管理员</span>
                      <span className="text-[10px] text-cyan-400 ml-2">≈ {duration * (MODEL_CFG[model]?.rate || 100)} 点（{(MODEL_CFG[model]?.rate || 100)}点/秒 × {duration}秒）</span>
                    </label>
                    <div className="flex gap-1 flex-wrap">
                      {MODELS.map(m => (
                        <button key={m.value} type="button" onClick={() => { setModel(m.value); const cfg = MODEL_CFG[m.value] || MODEL_CFG['']; setResolution(cfg.res[0] || '720P'); setDuration(cfg.durs[0] || 5); if (!cfg.long) setLongVideo(false) }}
                          className={`px-3 py-1.5 rounded text-xs ${model === m.value ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                          {m.label}
                          <span className="text-[10px] ml-1 opacity-60">{m.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 错误 */}
                {typeof error === 'string' && error.trim().length > 0 && (error.startsWith('第 ') || error.startsWith('正在') || error.startsWith('等待'))
                  ? <div className="p-3 bg-cyan-500/10 rounded-xl border border-cyan-500/20 text-sm text-cyan-400 font-mono">{error}</div>
                  : typeof error === 'string' && error.trim().length > 0 && <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 text-sm text-red-400 font-mono">❌ {error}</div>
                }

                {/* 本次消耗 */}
                {lastPoints != null && (
                  <p className="text-[10px] text-amber-300/80 mt-2">🪙 本次 AI 消耗 {lastPoints} 点</p>
                )}

                {/* 等待中（长视频提交后、拿到taskId前） */}
                {generating && !taskId && !videoUrl && (
                  <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full" />
                      <div>
                        <p className="text-sm text-gray-300 font-mono">长视频生成中...（约 10-15 分钟）</p>
                        <p className="text-xs text-gray-500 mt-1">请勿关闭页面，各段分别生成后自动拼接</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 进度（拿到taskId后的轮询阶段） */}
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
                    <p className="text-xs text-gray-500 mt-2 font-mono">链接 24 小时内有效</p>
                    <div className="flex gap-2 mt-3">
                      <button onClick={async () => {
                        const now = new Date()
                        const dateStr = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0')
                        const r = await fetch('/api/media-library?source=private', { credentials: 'include' })
                        const d = await r.json()
                        const list = Array.isArray(d?.data) ? d.data : []
                        const todayItems = list.filter((m: any) => m.title && String(m.title).startsWith(dateStr))
                        const num = String(todayItems.length + 1).padStart(2, '0')
                        const title = dateStr + '-' + num
                        await fetch('/api/media-library', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ossUrl: videoUrl, title, prompt, category: 'AI生成', source: 'private', orientation: ratio === '16:9' ? 'landscape' : ratio === '9:16' ? 'portrait' : 'unknown' }) })
                        setToast(`已保存到媒体库: ${title}`)
                      }} className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 text-xs">
                        💾 保存到媒体库
                      </button>
                    </div>
                  </div>
                )}

                <button onClick={handleGenerate}
                  disabled={generating || !prompt.trim()}
                  className="w-full px-4 py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white rounded-xl hover:opacity-90 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-all">
                  {generating ? `${t.textToVideo.generating} ${progress}%` : `✨ 生成视频${longVideo ? ' (长视频)' : ''}`}
                </button>
              </div>
            </div>

            {/* 我的收藏 */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">我的收藏 / MY FAVORITES</h2>
              <div className="space-y-2">
                {favorites.length === 0 ? <p className="text-gray-500 text-xs">去素材库收藏素材后显示在这里</p>
                : favorites.slice(0, 6).map((fav: any) => (
                  <button key={fav.id} onClick={() => setPrompt(fav.prompt || fav.title)}
                    className="w-full text-left p-2.5 bg-white/5 rounded-xl hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded bg-black/40 flex-shrink-0 overflow-hidden">
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
                {favorites.length > 6 && <p className="text-[10px] text-gray-500 text-center mt-1">+{favorites.length - 6} 更多</p>}
              </div>
            </div>
          </div>

          {/* 右侧 */}
          <div className="space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-label mb-4">场景库 / SCENE LIBRARY</h2>
              <div className="space-y-2">
                {sceneLib.length === 0 ? <p className="text-gray-500 text-xs">收藏场景素材后显示在这里</p>
                : sceneLib.slice(0, 6).map((s: any) => (
                  <button key={s.id} onClick={() => setPrompt(s.prompt || s.title)}
                    className="w-full text-left p-2.5 bg-white/5 rounded-xl hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded bg-black/40 flex-shrink-0 overflow-hidden">
                        {s.ossUrl?.endsWith('.mp4')
                          ? <video src={s.ossUrl} className="w-full h-full object-cover" />
                          : <img src={s.ossUrl} alt="" className="w-full h-full object-cover" />
                        }
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-white text-xs font-medium truncate">{s.title}</div>
                        <div className="text-gray-500 text-[10px] truncate">{s.prompt || ''}</div>
                      </div>
                    </div>
                  </button>
                ))}
                {sceneLib.length > 6 && <p className="text-[10px] text-gray-500 text-center mt-1">+{sceneLib.length - 6} 更多</p>}
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

        {/* 🕘 我的生成历史（2026-08-10） */}
        <div className="mt-10 border-t border-white/10 pt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">🕘 我的视频生成历史</h2>
            <span className="text-[10px] text-gray-500">最近 {videoHistory.length} 条 · 点「↻」复用提示词</span>
          </div>
          {histLoading ? <div className="text-gray-500 text-center py-8 text-xs">加载中…</div>
          : videoHistory.length === 0 ? <div className="text-gray-600 text-center py-8 text-xs">还没有生成记录</div>
          : <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {videoHistory.map(rec => (
              <div key={rec.id} className="rounded-xl border border-white/10 bg-white/[0.04] overflow-hidden hover:border-emerald-400/40 transition-all">
                <div className="aspect-video bg-black/40">
                  {(rec.storageUrl || rec.platformUrl) ? (
                    <video src={rec.storageUrl || rec.platformUrl} muted playsInline preload="metadata" className="w-full h-full object-cover"
                      onClick={() => (rec.storageUrl || rec.platformUrl) && window.open(rec.storageUrl || rec.platformUrl, '_blank')} />
                  ) : <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-600">无视频</div>}
                </div>
                <div className="p-2">
                  <div className="text-[9px] text-gray-500 truncate" title={rec.prompt || ''}>{rec.prompt || '(无提示词记录)'}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[9px] text-cyan-400/70 truncate max-w-[60%]">{rec.model || rec.provider || ''}</span>
                    <div className="flex gap-1">
                      <button onClick={() => rec.prompt && navigator.clipboard?.writeText(rec.prompt)} title="复制提示词"
                        className="px-1.5 py-0.5 rounded bg-white/10 text-[9px] text-gray-300 hover:bg-white/20">📋</button>
                      <button onClick={() => { if (rec.prompt) setPrompt(rec.prompt); if (rec.model) setModel(rec.model); window.scrollTo({ top: 0, behavior: 'smooth' }) }} title="用这个再生成"
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
    </div>
    </>
  )
}
