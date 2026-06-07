'use client'

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

type CloningMode = 'fast' | 'pro'
type PageStep = 'upload' | 'training' | 'generation'

const MODE_LABELS: Record<CloningMode, { label: string; desc: string; time: string }> = {
  fast: { label: '极速版', desc: '快速生成数字人形象', time: '约 3 分钟' },
  pro: { label: '精品版', desc: '高质量数字人形象克隆', time: '约 24 小时' },
}

const PRESET_BG_COLORS = [
  { name: '纯白', value: '#ffffff' },
  { name: '浅灰', value: '#f0f0f0' },
  { name: '商务蓝', value: '#1e3a5f' },
  { name: '墨绿', value: '#1a3c34' },
  { name: '深空', value: '#0d1117' },
  { name: '暖橙', value: '#d47b3a' },
]

export default function DigitalHumanPage() {
  const { user, loading: authLoading } = useAuth()
  const [step, setStep] = useState<PageStep>('upload')
  const [mode, setMode] = useState<CloningMode>('fast')
  const [modeTooltip, setModeTooltip] = useState(false)

  // 上传
  const videoRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [videoPreview, setVideoPreview] = useState<string>('')
  const [uploading, setUploading] = useState(false)

  // 训练
  const [taskId, setTaskId] = useState<string>('')
  const [trainProgress, setTrainProgress] = useState(0)
  const [trainStatus, setTrainStatus] = useState('')
  const [trainText, setTrainText] = useState('')
  const [avatarId, setAvatarId] = useState<string>('')

  // 口播生成
  const [script, setScript] = useState('')
  const [bgType, setBgType] = useState<'preset' | 'custom'>('preset')
  const [selectedBgColor, setSelectedBgColor] = useState(PRESET_BG_COLORS[0].value)
  const [customBg, setCustomBg] = useState<File | null>(null)
  const [customBgPreview, setCustomBgPreview] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState(0)
  const [genTaskId, setGenTaskId] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [genError, setGenError] = useState('')
  const [savingToStorage, setSavingToStorage] = useState(false)

  // 场景库
  const [sceneLib, setSceneLib] = useState<Array<{ id: number; title: string; prompt: string; previewUrl: string | null; category: string }>>([])
  const [sceneLibLoading, setSceneLibLoading] = useState(true)
  useEffect(() => {
    setSceneLibLoading(true)
    fetch('/api/prompt-templates?category=场景', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.data) setSceneLib(d.data) })
      .catch(() => {})
      .finally(() => setSceneLibLoading(false))
  }, [])

  // 视频文件选取
  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) { showToast('请上传视频文件', 'error'); return }
    if (file.size > 200 * 1024 * 1024) { showToast('视频不能超过 200MB', 'error'); return }
    setVideoFile(file)
    setVideoPreview(URL.createObjectURL(file))
  }

  const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAudioFile(file)
  }

  // 提交训练
  const handleSubmitTraining = async () => {
    if (!videoFile) { showToast('请上传真人视频', 'error'); return }
    setUploading(true)
    setTrainStatus('正在上传素材至 OSS...')
    setTrainText('上传中...')
    try {
      const fd = new FormData()
      fd.append('video', videoFile)
      if (audioFile) fd.append('audio', audioFile)
      fd.append('mode', mode)

      const res = await fetch('/api/digital-human', { method: 'POST', body: fd, credentials: 'include' })
      const data = await res.json()
      if (!data.success) { showToast(data.message || '提交失败', 'error'); setUploading(false); return }

      setTaskId(data.taskId)
      setStep('training')
      setTrainProgress(0)
      setTrainStatus('任务已提交，等待处理...')
      setTrainText('排队中')
      setUploading(false)
    } catch (e: any) {
      showToast(e.message || '提交失败', 'error')
      setUploading(false)
    }
  }

  // 轮询训练进度
  useEffect(() => {
    if (step !== 'training' || !taskId) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/digital-human', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'query', taskId }),
        })
        const data = await res.json()
        if (!data.success) return

        const status = data.status || ''
        const progress = data.progress ?? 0

        setTrainProgress(progress)
        setTrainStatus(status)
        setTrainText(getStatusText(status, progress, mode))

        if (status === 'SUCCEEDED' && data.avatarUrl) {
          clearInterval(interval)
          setAvatarId(data.avatarUrl)
          setStep('generation')
          showToast('形象克隆完成！', 'success')
        }
        if (status === 'FAILED') {
          clearInterval(interval)
          showToast('训练失败，请重试', 'error')
          setStep('upload')
        }
      } catch { /* ignore */ }
    }, mode === 'fast' ? 3000 : 15000)

    return () => clearInterval(interval)
  }, [step, taskId, mode])

  function getStatusText(status: string, p: number, m: CloningMode): string {
    if (!status || status === 'PENDING') return '排队中'
    if (status === 'RUNNING') {
      if (p < 20) return '分析视频素材中...'
      if (p < 50) return '训练形象模型中...'
      if (p < 80) return '优化细节中...'
      return '即将完成...'
    }
    if (status === 'SUCCEEDED') return '训练完成 ✓'
    if (status === 'FAILED') return '训练失败 ✗'
    return status
  }

  // 生成口播视频
  const handleGenerateVideo = async () => {
    if (!script.trim()) { showToast('请输入口播文案', 'error'); return }
    setGenerating(true)
    setGenProgress(0)
    setGenError('')
    setVideoUrl('')

    const bgUrl = bgType === 'custom' && customBgPreview ? customBgPreview : selectedBgColor

    try {
      const res = await fetch('/api/digital-human', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          avatarId,
          text: script.trim(),
          background: bgType === 'preset' ? undefined : bgUrl,
        }),
      })
      const data = await res.json()
      if (!data.success) { showToast(data.message || '生成失败', 'error'); setGenerating(false); return }

      setGenTaskId(data.taskId)
      pollVideoResult(data.taskId)
    } catch (e: any) {
      setGenError(e.message || '生成失败')
      setGenerating(false)
    }
  }

  const pollVideoResult = async (tid: string) => {
    let attempts = 0
    const maxAttempts = 300
    const interval = setInterval(async () => {
      attempts++
      setGenProgress(Math.min(95, Math.floor(attempts / 3)))
      try {
        const res = await fetch('/api/digital-human', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'query', taskId: tid }),
        })
        const data = await res.json()
        if (data.status === 'SUCCEEDED' && data.avatarUrl) {
          clearInterval(interval)
          setVideoUrl(data.avatarUrl)
          setGenProgress(100)
          setGenerating(false)
          showToast('口播视频生成完成！', 'success')
        }
        if (data.status === 'FAILED') {
          clearInterval(interval)
          setGenError('生成失败')
          setGenerating(false)
        }
      } catch { /* ignore */ }
      if (attempts >= maxAttempts) {
        clearInterval(interval)
        setGenError('生成超时')
        setGenerating(false)
      }
    }, 2000)
  }

  const handleDownload = () => {
    if (videoUrl) {
      const a = document.createElement('a')
      a.href = videoUrl
      a.download = `digital_human_${Date.now()}.mp4`
      a.click()
    }
  }

  // 存入素材仓库
  const handleSaveToStorage = async () => {
    if (!videoUrl || savingToStorage) return
    setSavingToStorage(true)
    showToast('正在存入素材库...')
    try {
      const res = await fetch('/api/storage/save-digital-human', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl, title: `口播视频_${Date.now()}` }),
      })
      const d = await res.json()
      if (d.success) {
        showToast(`✅ ${d.message}`, 'success')
      } else {
        showToast(`❌ ${d.message}`, 'error')
      }
    } catch (e: any) {
      showToast('❌ 存储失败', 'error')
    } finally {
      setSavingToStorage(false)
    }
  }

  const handleReset = () => {
    setStep('upload')
    setTaskId('')
    setAvatarId('')
    setVideoUrl('')
    setVideoFile(null)
    setAudioFile(null)
    setVideoPreview('')
    setScript('')
    setGenTaskId('')
    setGenError('')
    setTrainProgress(0)
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 font-mono text-sm">加载中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs tracking-[0.2em] text-gray-500 mb-1 font-mono">AI 工作区 / AI WORKSPACE</p>
          <h1 className="text-mono-lg text-white">数字人形象克隆 / DIGITAL HUMAN</h1>
          <p className="text-sm text-gray-500 mt-1 font-mono">
            上传真人视频，克隆专属数字人形象，一键生成口播视频
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* ===== 模式选择 ===== */}
            {step === 'upload' && (
              <div className="card-glass p-6">
                <h2 className="text-label mb-4">选择克隆模式 / MODE</h2>
                <div className="grid grid-cols-2 gap-4">
                  {(['fast', 'pro'] as CloningMode[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                        mode === m
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-white/10 hover:border-white/20 bg-white/5'
                      }`}
                    >
                      <div className="text-sm font-bold text-white font-mono">{MODE_LABELS[m].label}</div>
                      <div className="text-xs text-gray-400 mt-1">{MODE_LABELS[m].desc}</div>
                      <div className="text-xs text-emerald-400 mt-1 font-mono">{MODE_LABELS[m].time}</div>
                      {m === 'fast' && (
                        <span className="absolute -top-2 -right-2 px-2 py-0.5 bg-emerald-500 text-white text-[10px] font-bold rounded-full">
                          推荐
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ===== 上传区 ===== */}
            {step === 'upload' && (
              <div className="card-glass p-6">
                <h2 className="text-label mb-4">素材上传 / UPLOAD</h2>

                <div className="space-y-4">
                  {/* 视频上传 */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-2 font-mono">
                      真人视频 <span className="text-red-400">*</span>
                      <span className="text-gray-600 ml-2">（建议 30-120 秒，正面露脸）</span>
                    </label>
                    <input ref={videoRef} type="file" accept="video/*" onChange={handleVideoChange} className="hidden" />
                    <div
                      onClick={() => videoRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                        videoPreview ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-white/10 hover:border-white/20'
                      }`}
                    >
                      {videoPreview ? (
                        <div>
                          <video src={videoPreview} className="mx-auto max-h-40 rounded-lg" controls />
                          <p className="text-xs text-gray-400 mt-2 font-mono">{videoFile?.name} ({(videoFile!.size / 1024 / 1024).toFixed(1)}MB)</p>
                          <p className="text-xs text-emerald-400 mt-1 font-mono">点击重新选择</p>
                        </div>
                      ) : (
                        <div>
                          <div className="text-3xl mb-2">🎬</div>
                          <p className="text-sm text-gray-400 font-mono">点击上传真人视频</p>
                          <p className="text-xs text-gray-600 mt-1">MP4 / MOV / AVI · 最大 200MB</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 音频上传（可选） */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-2 font-mono">
                      录音音频 <span className="text-gray-600">（可选，用于声音克隆）</span>
                    </label>
                    <input ref={audioRef} type="file" accept="audio/*" onChange={handleAudioChange} className="hidden" />
                    <div
                      onClick={() => audioRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                        audioFile ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-white/10 hover:border-white/20'
                      }`}
                    >
                      {audioFile ? (
                        <div>
                          <p className="text-xs text-gray-300 font-mono">{audioFile.name}</p>
                          <p className="text-xs text-emerald-400 mt-1 font-mono">点击重新选择</p>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-lg">🎤</span>
                          <span className="text-sm text-gray-400 font-mono">可选 - 上传录音用于声音克隆</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleSubmitTraining}
                    disabled={uploading || !videoFile}
                    className="btn-primary w-full py-3 font-mono text-base disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploading ? '上传中...' : `开始 ${MODE_LABELS[mode].label} 训练`}
                  </button>
                </div>
              </div>
            )}

            {/* ===== 训练进度 ===== */}
            {step === 'training' && (
              <div className="card-glass p-6">
                <h2 className="text-label mb-4">训练进度 / TRAINING</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-sm text-white font-mono">
                        {MODE_LABELS[mode].label}训练中
                      </span>
                    </div>
                    <span className="text-lg font-bold text-emerald-400 font-mono">{trainProgress}%</span>
                  </div>

                  <div className="w-full bg-white/10 rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-700"
                      style={{ width: `${Math.min(100, trainProgress)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-500 font-mono">
                    <span>任务状态: {trainStatus}</span>
                    <span>{trainText}</span>
                  </div>

                  <div className="text-xs text-gray-600 font-mono">
                    {mode === 'fast'
                      ? '极速版预计 3 分钟左右完成'
                      : '精品版预计 24 小时内完成，请勿关闭页面'}
                  </div>

                  {trainProgress > 0 && (
                    <div className="flex items-center gap-1 text-xs text-gray-600 font-mono">
                      <div className="flex gap-0.5">
                        {[...Array(5)].map((_, i) => (
                          <div
                            key={i}
                            className={`w-2 h-2 rounded-full transition-all duration-500 ${
                              trainProgress > i * 20 ? 'bg-emerald-500' : 'bg-gray-700'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===== 口播视频生成 ===== */}
            {step === 'generation' && (
              <>
                <div className="card-glass p-6">
                  <h2 className="text-label mb-4">口播文案 / SCRIPT</h2>
                  <textarea
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    placeholder="输入口播文案..."
                    className="input-dark font-mono text-sm"
                    rows={5}
                  />
                  <div className="text-xs text-gray-600 mt-1 font-mono">
                    约 {Math.max(10, Math.ceil(script.length / 5))} 秒 / {script.length} 字
                  </div>
                </div>

                {/* 背景选择 */}
                <div className="card-glass p-6">
                  <h2 className="text-label mb-4">背景设置 / BACKGROUND</h2>

                  <div className="flex gap-4 mb-4">
                    <button
                      onClick={() => setBgType('preset')}
                      className={`px-4 py-2 rounded-lg text-xs font-mono transition-colors ${
                        bgType === 'preset' ? 'bg-emerald-500 text-white' : 'bg-white/5 text-gray-400 border border-white/10'
                      }`}
                    >
                      纯色背景
                    </button>
                    <button
                      onClick={() => setBgType('custom')}
                      className={`px-4 py-2 rounded-lg text-xs font-mono transition-colors ${
                        bgType === 'custom' ? 'bg-emerald-500 text-white' : 'bg-white/5 text-gray-400 border border-white/10'
                      }`}
                    >
                      自定义图片
                    </button>
                  </div>

                  {bgType === 'preset' ? (
                    <div className="grid grid-cols-6 gap-3">
                      {PRESET_BG_COLORS.map(c => (
                        <button
                          key={c.value}
                          onClick={() => setSelectedBgColor(c.value)}
                          className={`w-full aspect-square rounded-xl border-2 transition-all ${
                            selectedBgColor === c.value ? 'border-emerald-500 scale-105' : 'border-white/10'
                          }`}
                          style={{ backgroundColor: c.value }}
                        >
                          <span className="text-[10px] text-gray-400 block text-center mt-1">{c.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) { setCustomBg(f); setCustomBgPreview(URL.createObjectURL(f)) }
                        }}
                        className="hidden"
                        id="bg-upload"
                      />
                      <label
                        htmlFor="bg-upload"
                        className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                          customBgPreview ? 'border-emerald-500/50' : 'border-white/10 hover:border-white/20'
                        }`}
                      >
                        {customBgPreview ? (
                          <div>
                            <img src={customBgPreview} alt="背景" className="mx-auto max-h-24 rounded-lg" />
                            <p className="text-xs text-gray-400 mt-1 font-mono">{customBg?.name}</p>
                          </div>
                        ) : (
                          <div>
                            <span className="text-2xl">🖼️</span>
                            <p className="text-xs text-gray-400 mt-1 font-mono">点击上传背景图片</p>
                          </div>
                        )}
                      </label>
                    </div>
                  )}
                </div>

                {/* 生成按钮 */}
                <button
                  onClick={handleGenerateVideo}
                  disabled={generating || !script.trim()}
                  className="btn-primary w-full py-3 font-mono text-base disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating ? '生成中...' : '生成口播视频'}
                </button>

                {/* 生成进度 */}
                {generating && (
                  <div className="card-glass p-6">
                    <h3 className="text-label mb-3">生成进度 / PROGRESS</h3>
                    <div className="w-full bg-white/10 rounded-full h-3">
                      <div className="bg-gradient-to-r from-emerald-500 to-cyan-400 h-3 rounded-full transition-all duration-500" style={{ width: `${genProgress}%` }} />
                    </div>
                    <p className="text-xs text-gray-500 mt-2 font-mono">{genProgress}%</p>
                  </div>
                )}

                {genError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                    <p className="text-sm text-red-400 font-mono">生成失败: {genError}</p>
                  </div>
                )}

                {/* 结果预览 */}
                {videoUrl && (
                  <div className="card-glass p-6">
                    <h2 className="text-label mb-4">生成结果 / RESULT</h2>
                    <video src={videoUrl} controls className="w-full rounded-xl max-h-[500px]" />
                    <div className="flex gap-3 mt-4">
                      <button
                        onClick={handleDownload}
                        className="btn-primary flex-1 font-mono text-sm"
                      >
                        下载视频
                      </button>
                      <button
                        onClick={handleSaveToStorage}
                        disabled={savingToStorage}
                        className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-mono text-sm disabled:opacity-50 transition-colors"
                      >
                        {savingToStorage ? '存入中...' : '📦 存入素材库'}
                      </button>
                      <button
                        onClick={handleReset}
                        className="btn-secondary font-mono text-sm"
                      >
                        继续制作
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ===== 右侧信息面板 ===== */}
          <div className="space-y-6">
            <div className="card-glass p-6">
              <h3 className="text-label mb-4">克隆说明 / GUIDE</h3>
              <div className="space-y-3 text-xs text-gray-500 font-mono leading-relaxed">
                <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
                  <p className="text-blue-400 font-medium mb-1">📹 视频要求</p>
                  <p>正面露脸 · 自然光线 · 30-120秒</p>
                  <p className="text-gray-600">避免遮挡面部 / 大幅度运动</p>
                </div>
                <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                  <p className="text-emerald-400 font-medium mb-1">⚡ 极速版</p>
                  <p>快速生成 · 约3分钟</p>
                  <p className="text-gray-600">适合快速测试效果</p>
                </div>
                <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20">
                  <p className="text-purple-400 font-medium mb-1">✨ 精品版</p>
                  <p>高质量克隆 · 约24小时</p>
                  <p className="text-gray-600">适合正式商用场景</p>
                </div>
                <div className="p-3 bg-orange-500/10 rounded-xl border border-orange-500/20">
                  <p className="text-orange-400 font-medium mb-1">🔊 声音克隆</p>
                  <p>上传录音可克隆声音</p>
                  <p className="text-gray-600">可选，不传则用默认音色</p>
                </div>
              </div>
            </div>

            {/* ===== 直播场景库 ===== */}
            <div className="card-glass p-6">
              <h3 className="text-label mb-4">直播场景 / SCENE LIBRARY</h3>
              {sceneLibLoading ? (
                <p className="text-gray-500 text-xs font-mono text-center py-6">加载场景库...</p>
              ) : sceneLib.length === 0 ? (
                <p className="text-gray-500 text-xs font-mono">暂无场景素材，请在后台 /admin/prompt-templates 添加</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1">
                  {sceneLib.map(s => (
                    <button
                      key={s.id}
                      onClick={() => {
                        if (s.previewUrl) {
                          setBgType('custom')
                          setCustomBgPreview(s.previewUrl)
                          setCustomBg(null as any)
                          showToast(`已选场景: ${s.title}`, 'success')
                        }
                      }}
                      className="relative group rounded-xl overflow-hidden aspect-video bg-black/40 hover:ring-1 hover:ring-emerald-500/50 transition-all"
                    >
                      {s.previewUrl ? (
                        s.previewUrl.endsWith('.mp4')
                          ? <video src={s.previewUrl} className="w-full h-full object-cover" muted />
                          : <img src={s.previewUrl} alt={s.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-white/5">
                          <span className="text-lg">🏞️</span>
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
                        <p className="text-[10px] text-white font-medium truncate">{s.title}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {sceneLib.length > 0 && (
                <p className="text-[10px] text-gray-600 mt-2 font-mono text-center">点击场景 → 自动设为口播背景 · 共 {sceneLib.length} 个</p>
              )}
            </div>

            {/* 训练状态摘要 */}
            {step === 'training' && taskId && (
              <div className="card-glass p-4">
                <h4 className="text-label mb-2">任务信息</h4>
                <div className="text-[10px] text-gray-600 font-mono break-all">
                  <p>ID: {taskId}</p>
                  <p>模式: {MODE_LABELS[mode].label}</p>
                  <p>状态: {trainStatus}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
