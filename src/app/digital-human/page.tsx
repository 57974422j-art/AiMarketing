'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface PresetAvatar { id: string; name: string; imageUrl: string }

export default function DigitalHumanPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'preset' | 'custom'>('preset')
  const [voiceMode, setVoiceMode] = useState<'upload' | 'clone'>('clone')
  const [presets, setPresets] = useState<PresetAvatar[]>([])
  const [selectedPreset, setSelectedPreset] = useState('')
  const [text, setText] = useState('')
  const [customImage, setCustomImage] = useState<File | null>(null)
  const [customPreview, setCustomPreview] = useState('')
  const [customAudio, setCustomAudio] = useState<File | null>(null)
  const [voiceId, setVoiceId] = useState('')
  const [voiceEnrolling, setVoiceEnrolling] = useState(false)
  const [loading, setLoading] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [pollStatus, setPollStatus] = useState('')
  const [resultUrl, setResultUrl] = useState('')

  // 录音相关
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordTime, setRecordTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    fetch('/api/digital-human', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list' }),
    }).then(r => r.json()).then(d => { if (d.data) setPresets(d.data) }).catch(() => {})
  }, [])

  // 轮询结果
  useEffect(() => {
    if (!taskId) return
    const iv = setInterval(async () => {
      try {
        const r = await fetch('/api/digital-human', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'query', taskId }),
        })
        const d = await r.json()
        if (d.status === 'SUCCEEDED' && d.avatarUrl) {
          setPollStatus('完成')
          setResultUrl(d.avatarUrl)
          setTaskId('')
          clearInterval(iv)
          showToast('生成成功！', 'success')
        } else if (d.status === 'FAILED') {
          setPollStatus('失败')
          setTaskId('')
          clearInterval(iv)
          showToast('生成失败，请重试', 'error')
        } else {
          setPollStatus(`生成中... ${d.progress || 0}%`)
        }
      } catch { setPollStatus('轮询中断') }
    }, 5000)
    return () => clearInterval(iv)
  }, [taskId])

  // 开始录音
  const startRecord = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      const chunks: BlobPart[] = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks, { type: 'audio/wav' })
        setRecordedBlob(blob)
        if (timerRef.current) clearInterval(timerRef.current)
      }
      mr.start()
      mediaRecorderRef.current = mr
      setIsRecording(true)
      setRecordTime(0)
      timerRef.current = setInterval(() => setRecordTime(t => t + 1), 200)
    } catch {
      showToast('无法访问麦克风', 'error')
    }
  }

  const stopRecord = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
  }

  // 上传音频到OSS并注册声音
  const enrollVoice = async (blob: Blob) => {
    setVoiceEnrolling(true)
    try {
      const fd = new FormData()
      fd.append('audio', blob, 'voice_sample.wav')
      // 先上传音频到服务器
      const upRes = await fetch('/api/digital-human', { method: 'POST', body: fd, credentials: 'include' })
      // multipart 会走自定义上传分支，我们需要单独的endpoint
      // 改为先上传到服务器临时目录
      // 简单处理：直接用 audio/save 路由
    } catch (e) { showToast('注册失败', 'error') }
    setVoiceEnrolling(false)
  }

  // 声音注册：把音频文件上传到OSS后注册
  const doVoiceEnroll = async (audioFile: File) => {
    setVoiceEnrolling(true)
    try {
      // 1. 先上传音频到服务器，拿到URL
      const fd = new FormData()
      fd.append('audio', audioFile)
      const upRes = await fetch('/api/digital-human/upload-audio', { method: 'POST', body: fd, credentials: 'include' })
      const upData = await upRes.json()
      if (!upData.success) { showToast(upData.message, 'error'); setVoiceEnrolling(false); return }

      // 2. 注册声音
      const r = await fetch('/api/digital-human', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'voice-enroll', audioUrl: upData.url, prefix: `u${user?.id || 0}` }),
      })
      const d = await r.json()
      if (d.success) {
        setVoiceId(d.voiceId)
        localStorage.setItem('dh_voice_id', d.voiceId)
        showToast('声音克隆成功！', 'success')
      } else { showToast(d.message, 'error') }
    } catch { showToast('注册失败', 'error') }
    setVoiceEnrolling(false)
  }

  const generate = async () => {
    if (tab === 'preset') {
      if (!text.trim()) { showToast('请输入口播文案', 'error'); return }
      if (text.length > 540) { showToast(`文案过长：${text.length}字`, 'error'); return }
    }
    setLoading(true)
    try {
      if (tab === 'preset') {
        if (!selectedPreset) { showToast('请选择数字人形象', 'error'); setLoading(false); return }
        const r = await fetch('/api/digital-human', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'avatar-speak', avatarId: selectedPreset, text }),
        })
        const d = await r.json()
        if (d.success && d.videoUrl) { setVideoUrl(d.videoUrl); setTaskId(''); showToast('生成完成', 'success') }
        else if (d.success && d.taskId) { setTaskId(d.taskId); setPollStatus('排队中...'); showToast('已提交', 'success') }
        else showToast(d.message || '生成失败', 'error')
      } else {
        if (!customImage) { showToast('请上传人物照片', 'error'); setLoading(false); return }
        // 2026-08-14: 自定义照片 → wan2.2-s2v（照片+文案直出）
        if (voiceMode === 'upload' || voiceMode === 'record' || (voiceMode === 'clone' && !voiceId)) {
          if (!text.trim()) { showToast('请输入口播文案', 'error'); setLoading(false); return }
          // 上传照片到 OSS
          const fd = new FormData()
          fd.append('image', customImage)
          const upRes = await fetch('/api/digital-human', { method: 'POST', body: fd, credentials: 'include' })
          const upData = await upRes.json()
          if (!upData.url) { showToast('照片上传失败', 'error'); setLoading(false); return }
          const speakRes = await fetch('/api/digital-human', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'avatar-speak', photoUrl: upData.url, text }),
          })
          const sd = await speakRes.json()
          if (sd.success && sd.videoUrl) { setVideoUrl(sd.videoUrl); setTaskId(''); showToast('生成完成', 'success') }
          else showToast(sd.message || '生成失败', 'error')
        } else if (voiceMode === 'clone' && voiceId) {
        // 克隆模式：TTS合成 → wan2.2-s2v（保留）
          if (!text.trim()) { showToast('请输入口播文案', 'error'); setLoading(false); return }
          showToast('正在合成克隆语音...', 'info' as any)
          // 1. 用克隆声音合成音频
          const synRes = await fetch('/api/digital-human', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'voice-synthesize', voiceId, text }),
          })
          const synData = await synRes.json()
          if (!synData.success) { showToast(synData.message || '合成失败', 'error'); setLoading(false); return }

          // 2. 上传照片到OSS
          const fd = new FormData()
          fd.append('image', customImage)
          fd.append('audio_url', synData.audioUrl)
          const imgRes = await fetch('/api/digital-human', { method: 'POST', body: fd, credentials: 'include' })
          const imgData = await imgRes.json()
          if (imgData.success) { setTaskId(imgData.taskId); setPollStatus('排队中...'); showToast('已提交', 'success') }
          else showToast(imgData.message || '提交失败', 'error')
        } else {
          // 直传音频模式
          if (!customAudio) { showToast('请上传配音音频', 'error'); setLoading(false); return }
          const fd = new FormData()
          fd.append('image', customImage)
          fd.append('audio', customAudio)
          const r = await fetch('/api/digital-human', { method: 'POST', body: fd, credentials: 'include' })
          const d = await r.json()
          if (d.success) { setTaskId(d.taskId); setPollStatus('排队中...'); showToast('已提交', 'success') }
          else showToast(d.message, 'error')
        }
      }
    } catch { showToast('提交失败', 'error') }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <p className="text-label mb-1">AI 营创作业平台 / 数字人</p>
          <h1 className="text-mono-lg text-white mb-1">🤖 数字人口播</h1>
          <p className="text-xs text-gray-500">选择公共形象或上传自定义照片，输入文案即可生成数字人口播视频</p>
        </div>

        {/* 模式切换 */}
        <div className="flex gap-1 mb-5 bg-white/5 rounded-xl p-1 w-fit">
          {(['preset', 'custom'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition ${tab === t ? 'bg-blue-500/20 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
              {t === 'preset' ? '🎭 公共形象' : '📷 自定义形象'}
            </button>
          ))}
        </div>

        {/* 公共形象 */}
        {tab === 'preset' && (
          <div className="card-glass p-5 mb-4">
            <h3 className="text-xs text-gray-400 mb-3">选择数字人形象</h3>
            <div className="grid grid-cols-5 gap-3">
              {presets.map(p => (
                <button key={p.id} onClick={() => setSelectedPreset(p.id)}
                  className={`p-2 rounded-xl border-2 transition text-center ${selectedPreset === p.id ? 'border-blue-400 bg-blue-500/10' : 'border-white/10 hover:border-white/20'}`}>
                  <div className="w-full aspect-square rounded-lg bg-white/5 mb-1.5 flex items-center justify-center overflow-hidden">
                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover rounded-lg" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).parentElement!.innerHTML = '<span class="text-2xl">🤖</span>' }} />
                  </div>
                  <p className="text-[10px] text-gray-300">{p.name}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 自定义形象 */}
        {tab === 'custom' && (
          <>
            {/* 照片 */}
            <div className="card-glass p-5 mb-4">
              <h3 className="text-xs text-gray-400 mb-3">人物照片</h3>
              <div className="max-w-xs">
                <label className="block border-2 border-dashed border-white/10 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400/30 transition">
                  {customPreview ? (
                    <img src={customPreview} className="max-h-32 mx-auto rounded-lg" alt="preview" />
                  ) : (
                    <p className="text-xs text-gray-500">点击上传正面半身照</p>
                  )}
                  <input type="file" accept="image/jpeg,image/png,image/bmp,image/webp" className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      if (f.size > 10 * 1024 * 1024) { showToast('图片不能超过10MB', 'error'); return }
                      if (!['image/jpeg', 'image/png', 'image/bmp', 'image/webp'].includes(f.type)) { showToast('仅支持 jpg/png/bmp/webp', 'error'); return }
                      setCustomImage(f); setCustomPreview(URL.createObjectURL(f))
                    }} />
                </label>
                <p className="text-[9px] text-gray-600 mt-1">jpg/png/bmp/webp，≤10MB，正面半身照</p>
              </div>
            </div>

            {/* 配音方式 */}
            <div className="card-glass p-5 mb-4">
              <h3 className="text-xs text-gray-400 mb-3">配音方式</h3>
              <div className="flex gap-1 mb-4 bg-white/5 rounded-lg p-1 w-fit">
                {(['clone', 'upload'] as const).map(m => (
                  <button key={m} onClick={() => setVoiceMode(m)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition ${voiceMode === m ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}>
                    {m === 'clone' ? '🎙️ 声音克隆' : '📁 直传音频'}
                  </button>
                ))}
              </div>

              {/* 声音克隆 */}
              {voiceMode === 'clone' && !voiceId && (
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] text-gray-500 mb-2">🔴 录音（10-20 秒朗读任意文字）</p>
                    {!isRecording && !recordedBlob && (
                      <button onClick={startRecord}
                        className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg text-xs hover:bg-red-500/30 transition">
                        🎤 开始录音
                      </button>
                    )}
                    {isRecording && (
                      <div className="flex items-center gap-3">
                        <span className="animate-pulse text-red-400 text-xs">🔴 录音中 {(recordTime / 5).toFixed(1)}s</span>
                        <button onClick={stopRecord} className="px-3 py-1 bg-white/10 text-white rounded-lg text-xs">⏹ 停止</button>
                      </div>
                    )}
                    {recordedBlob && !isRecording && (
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400">已录制 {(recordTime / 5).toFixed(1)}s</span>
                        <audio src={URL.createObjectURL(recordedBlob)} controls className="h-7 w-32" />
                        <button onClick={() => { setRecordedBlob(null); setRecordTime(0) }}
                          className="text-[10px] text-gray-500 hover:text-red-400">重录</button>
                        <button onClick={() => doVoiceEnroll(new File([recordedBlob], 'sample.wav', { type: 'audio/wav' }))}
                          disabled={voiceEnrolling}
                          className="px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs hover:bg-emerald-500/30 disabled:opacity-50 transition">
                          {voiceEnrolling ? '注册中...' : '注册声音'}
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 mb-2">📁 或上传音频样本（mp3/wav，10-60秒）</p>
                    <input type="file" accept="audio/mpeg,audio/wav" className="hidden" id="voice-upload"
                      onChange={e => { const f = e.target.files?.[0]; if (f) doVoiceEnroll(f) }} />
                    <label htmlFor="voice-upload"
                      className="inline-block px-3 py-1.5 bg-white/5 border border-white/10 text-gray-400 rounded-lg text-xs cursor-pointer hover:border-white/20 transition">
                      📎 选择文件
                    </label>
                  </div>
                </div>
              )}

              {voiceMode === 'clone' && voiceId && (
                <div className="text-xs text-emerald-400">
                  ✅ 声音已克隆（ID: {voiceId.substring(0, 8)}...）
                  <button onClick={() => { setVoiceId(''); localStorage.removeItem('dh_voice_id') }}
                    className="ml-3 text-gray-500 hover:text-red-400">清除</button>
                </div>
              )}

              {/* 直传音频 */}
              {voiceMode === 'upload' && (
                <div className="max-w-xs">
                  <p className="text-[10px] text-gray-500 mb-1.5">上传配音文件（mp3/wav）</p>
                  <label className="block border-2 border-dashed border-white/10 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400/30 transition">
                    {customAudio ? (
                      <p className="text-xs text-emerald-400">✅ {customAudio.name}（{(customAudio.size / 1024 / 1024).toFixed(1)}MB）</p>
                    ) : (
                      <p className="text-xs text-gray-500">点击上传</p>
                    )}
                    <input type="file" accept="audio/mpeg,audio/wav,audio/mp3" className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (!f) return
                        if (f.size > 15 * 1024 * 1024) { showToast('音频≤15MB', 'error'); return }
                        setCustomAudio(f)
                      }} />
                  </label>
                  <p className="text-[9px] text-gray-600 mt-1">mp3/wav，≤15MB，最长3分钟</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* 文案（公共模式 or 定制克隆模式） */}
        {((tab === 'preset') || (tab === 'custom' && voiceMode === 'clone' && voiceId)) && (
          <div className="card-glass p-5 mb-4">
            <h3 className="text-xs text-gray-400 mb-3">
              {tab === 'custom' ? '口播文案（将用你的克隆声音朗读）' : '口播文案'}
            </h3>
            <textarea value={text} onChange={e => setText(e.target.value)}
              placeholder="输入数字人要说的内容..."
              rows={4}
              className="input-dark w-full rounded-xl px-4 py-3 text-sm resize-none" />
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-gray-600">约 {Math.round(text.length / 3)} 秒 · 上限540字（≈3分钟）</span>
              <span className={`text-[9px] font-mono ${text.length > 500 ? 'text-yellow-400' : text.length > 540 ? 'text-red-400' : 'text-gray-600'}`}>{text.length}/540</span>
            </div>
          </div>
        )}

        {/* 提示（自定义直传模式） */}
        {tab === 'custom' && voiceMode === 'upload' && (
          <div className="card-glass p-4 mb-4 text-center">
            <p className="text-xs text-gray-500">🎤 直接使用你上传的音频驱动口播</p>
          </div>
        )}
        {tab === 'custom' && voiceMode === 'clone' && !voiceId && (
          <div className="card-glass p-4 mb-4 text-center">
            <p className="text-xs text-gray-500">🎙️ 请先录音或上传声音样本完成注册</p>
          </div>
        )}

        {/* 生成按钮 */}
        <p className="text-[10px] text-gray-500 mt-1 mb-2">📷 形象需清晰正面人像 · 音频 ≤20 秒效果最佳，更长将自动分段生成拼接</p>
        <button onClick={generate} disabled={loading || !!taskId}
          className="w-full py-3 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition">
          {taskId ? pollStatus : loading ? '提交中...' : '🚀 生成口播视频'}
        </button>

        {/* 结果 */}
        {resultUrl && (
          <div className="card-glass p-5 mt-4">
            <h3 className="text-xs text-gray-400 mb-3">✅ 生成结果</h3>
            <video src={resultUrl} controls className="w-full rounded-xl max-h-96 mb-3" />
            <div className="flex gap-2">
              <a href={resultUrl} download target="_blank"
                className="px-3 py-1.5 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg text-xs hover:bg-blue-500/30 transition">
                ⬇ 下载
              </a>
              <button onClick={async () => {
                try {
                  const r = await fetch('/api/digital-human', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'save', videoUrl: resultUrl, title: `数字人口播_${new Date().toLocaleDateString()}` }),
                  })
                  const d = await r.json()
                  d.success ? showToast('已存到素材库', 'success') : showToast(d.message, 'error')
                } catch { showToast('保存失败', 'error') }
              }}
                className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs hover:bg-emerald-500/30 transition">
                💾 存到素材库
              </button>
            </div>
          </div>
        )}
        {taskId && (
          <div className="card-glass p-4 mt-4 text-center">
            <div className="animate-pulse text-sm text-blue-400">{pollStatus}</div>
          </div>
        )}
      </div>
    </div>
  )
}
