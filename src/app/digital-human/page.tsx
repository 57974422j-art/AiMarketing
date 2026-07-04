'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface PresetAvatar { id: string; name: string; imageUrl: string }

export default function DigitalHumanPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'preset' | 'custom'>('preset')
  const [presets, setPresets] = useState<PresetAvatar[]>([])
  const [selectedPreset, setSelectedPreset] = useState('')
  const [text, setText] = useState('')
  const [customImage, setCustomImage] = useState<File | null>(null)
  const [customPreview, setCustomPreview] = useState('')
  const [customAudio, setCustomAudio] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [pollStatus, setPollStatus] = useState('')
  const [resultUrl, setResultUrl] = useState('')

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

  const generate = async () => {
    if (!text.trim()) { showToast('请输入口播文案', 'error'); return }
    // 文案长度校验（中文约3字/秒，3分钟=540字上限）
    if (text.length > 540) { showToast(`文案过长：${text.length}字，最多540字（约3分钟）`, 'error'); return }
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
        if (d.success) { setTaskId(d.taskId); setPollStatus('排队中...'); showToast('已提交', 'success') }
        else showToast(d.message, 'error')
      } else {
        if (!customImage) { showToast('请上传人物照片', 'error'); setLoading(false); return }
        if (!customAudio) { showToast('请上传配音音频', 'error'); setLoading(false); return }
        const fd = new FormData()
        fd.append('image', customImage)
        fd.append('audio', customAudio)
        const r = await fetch('/api/digital-human', { method: 'POST', body: fd, credentials: 'include' })
        const d = await r.json()
        if (d.success) { setTaskId(d.taskId); setPollStatus('排队中...'); showToast('已提交', 'success') }
        else showToast(d.message, 'error')
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
          <div className="card-glass p-5 mb-4">
            <h3 className="text-xs text-gray-400 mb-3">上传素材</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] text-gray-500 mb-1.5">人物照片（正面半身照）</p>
                <label className="block border-2 border-dashed border-white/10 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400/30 transition">
                  {customPreview ? (
                    <img src={customPreview} className="max-h-32 mx-auto rounded-lg" alt="preview" />
                  ) : (
                    <p className="text-xs text-gray-500">点击上传照片</p>
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
                <p className="text-[9px] text-gray-600 mt-1">支持 jpg/png/bmp/webp，≤10MB，正面半身照效果最佳</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 mb-1.5">配音音频（mp3/wav）</p>
                <label className="block border-2 border-dashed border-white/10 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400/30 transition">
                  {customAudio ? (
                    <p className="text-xs text-emerald-400">✅ {customAudio.name}（{(customAudio.size / 1024 / 1024).toFixed(1)}MB）</p>
                  ) : (
                    <p className="text-xs text-gray-500">点击上传音频</p>
                  )}
                  <input type="file" accept="audio/mpeg,audio/wav,audio/mp3" className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      if (f.size > 15 * 1024 * 1024) { showToast('音频不能超过15MB（约3分钟）', 'error'); return }
                      setCustomAudio(f)
                    }} />
                </label>
                <p className="text-[9px] text-gray-600 mt-1">mp3/wav，≤15MB，最长3分钟</p>
              </div>
            </div>
          </div>
        )}

        {/* 文案 */}
        <div className="card-glass p-5 mb-4">
          <h3 className="text-xs text-gray-400 mb-3">口播文案</h3>
          <textarea value={text} onChange={e => setText(e.target.value)}
            placeholder="输入数字人要说的内容..."
            rows={4}
            className="input-dark w-full rounded-xl px-4 py-3 text-sm resize-none" />
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-gray-600">约 {Math.round(text.length / 3)} 秒 · 上限540字（≈3分钟）</span>
            <span className={`text-[9px] font-mono ${text.length > 500 ? 'text-yellow-400' : text.length > 540 ? 'text-red-400' : 'text-gray-600'}`}>{text.length}/540</span>
          </div>
        </div>

        {/* 生成按钮 */}
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
