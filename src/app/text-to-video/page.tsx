'use client'

import { useState, useEffect } from 'react'

const RATIO_OPTIONS = [
  { value: '16:9', label: '横屏 16:9' },
  { value: '9:16', label: '竖屏 9:16' },
  { value: '1:1', label: '方形 1:1' },
]
const DURATION_OPTIONS = [5, 10, 15]
const RES_OPTIONS = ['720P', '1080P']

export default function TextToVideoPage() {
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('16:9')
  const [duration, setDuration] = useState(5)
  const [resolution, setResolution] = useState('720P')
  const [generating, setGenerating] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t) } }, [toast])

  const handleGenerate = async () => {
    if (!prompt.trim()) { setToast('请输入视频描述'); return }
    setGenerating(true); setTaskId(''); setVideoUrl(''); setError(''); setStatusMsg('提交中...')
    try {
      const r = await fetch('/api/video/text-to-video', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), aspectRatio: ratio, duration, resolution }),
      })
      const d = await r.json()
      if (!d.success) { setError(d.message || '提交失败'); setGenerating(false); return }
      if (d.videoUrl) { setVideoUrl(d.videoUrl); setStatusMsg('✅ 生成完成'); setGenerating(false); return }

      setTaskId(d.taskId)
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 3000))
        setStatusMsg(`⏳ 生成中 (${Math.min(95, (i + 1) * 3)}%)`)
        const q = await fetch(`/api/video/text-to-video?taskId=${d.taskId}`, { credentials: 'include' })
        const qd = await q.json()
        if (qd.videoUrl) { setVideoUrl(qd.videoUrl); setStatusMsg('✅ 生成完成'); setGenerating(false); return }
        if (qd.status === 'FAILED') { setError('视频生成失败'); setGenerating(false); return }
      }
      setError('生成超时，请稍后重试')
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

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <p className="text-xs tracking-[0.2em] text-gray-500 mb-1 font-mono">AI 工作区 / AI WORKSPACE</p>
          <h1 className="text-2xl font-bold text-white font-mono">文生视频 / TEXT TO VIDEO</h1>
          <p className="text-sm text-gray-500 mt-1 font-mono">输入描述，AI 自动生成短视频（Doubao-Seedance / wan2.7 / happyhorse）</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* 提示词 */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-xs tracking-[0.2em] text-gray-400 mb-4 font-mono">视频描述 / PROMPT</h2>
              <textarea value={prompt} onChange={e => { setPrompt(e.target.value); setVideoUrl('') }}
                placeholder="描述你想生成的视频内容，如：一只橘猫在花园里追蝴蝶，阳光明媚，慢动作"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono text-sm min-h-[120px] resize-y" rows={4} />
            </div>

            {/* 参数设置 */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h2 className="text-xs tracking-[0.2em] text-gray-400 mb-4 font-mono">参数设置 / SETTINGS</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-2 font-mono">画面比例</label>
                  <div className="flex gap-2 flex-wrap">
                    {RATIO_OPTIONS.map(r => (
                      <button key={r.value} type="button" onClick={() => setRatio(r.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs ${ratio === r.value ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-2 font-mono">时长</label>
                  <div className="flex gap-2 flex-wrap">
                    {DURATION_OPTIONS.map(d => (
                      <button key={d} type="button" onClick={() => setDuration(d)}
                        className={`px-3 py-1.5 rounded-lg text-xs ${duration === d ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                        {d}秒
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-2 font-mono">分辨率</label>
                  <div className="flex gap-2 flex-wrap">
                    {RES_OPTIONS.map(r => (
                      <button key={r} type="button" onClick={() => setResolution(r)}
                        className={`px-3 py-1.5 rounded-lg text-xs ${resolution === r ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
                <p className="text-sm text-red-400 font-mono">❌ {error}</p>
              </div>
            )}

            {/* 生成进度 */}
            {taskId && !videoUrl && (
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-300 font-mono">{statusMsg}</span>
                  <span className="text-xs text-gray-500">任务: {taskId.substring(0, 8)}...</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-3">
                  <div className="bg-gradient-to-r from-emerald-500 to-cyan-400 h-3 rounded-full transition-all duration-500" style={{ width: `${Math.min(95, parseInt(statusMsg.match(/\d+/)?.[0] || '0'))}%` }} />
                </div>
              </div>
            )}

            {/* 结果 */}
            {videoUrl && (
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <h2 className="text-xs tracking-[0.2em] text-gray-400 mb-4 font-mono">生成结果 / RESULT</h2>
                <video src={videoUrl} controls className="w-full rounded-xl max-h-[500px]" />
                <p className="text-xs text-gray-500 mt-2 font-mono">链接 24 小时内有效，可右键下载保存</p>
              </div>
            )}
          </div>

          {/* 右侧面板 */}
          <div className="space-y-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <h3 className="text-xs tracking-[0.2em] text-gray-400 mb-3 font-mono">模型说明 / MODELS</h3>
              <div className="space-y-2 text-xs text-gray-500 font-mono">
                <div className="p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/20">
                  <p className="text-blue-400 font-medium mb-0.5">1. Doubao-Seedance 2.0</p>
                  <p>火山引擎 · 15s · 720P/1080P · 支持自定义音频</p>
                </div>
                <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                  <p className="text-emerald-400 font-medium mb-0.5">2. wan2.7-t2v</p>
                  <p>阿里百炼 · 15s · 720P/1080P · 30fps</p>
                </div>
                <div className="p-2.5 bg-purple-500/10 rounded-xl border border-purple-500/20">
                  <p className="text-purple-400 font-medium mb-0.5">3. happyhorse-1.0-t2v</p>
                  <p>阿里百炼 · 15s · 720P · 自动配音（兜底）</p>
                </div>
              </div>
            </div>

            {!generating && !videoUrl && (
              <button onClick={handleGenerate} disabled={!prompt.trim()}
                className="w-full px-4 py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white rounded-xl hover:opacity-90 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-all font-mono">
                ✨ 生成视频
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
