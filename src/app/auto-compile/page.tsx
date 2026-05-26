'use client'
import { useState, useRef } from 'react'
import { showToast } from '@/components/Toast'

export default function AutoCompilePage() {
  const [mode, setMode] = useState<'free' | 'smart'>('free')
  const [text, setText] = useState('')
  const [images, setImages] = useState<File[]>([])
  const [voice, setVoice] = useState('zh_female_vv_uranus_bigtts')
  const [bgm, setBgm] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const bgmRef = useRef<HTMLInputElement>(null)

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
    setImages(prev => [...prev, ...files].slice(0, 20))
  }

  const removeFile = (i: number) => setImages(prev => prev.filter((_, idx) => idx !== i))

  const handleSubmit = async () => {
    if (!text.trim()) { showToast('请输入文案', 'error'); return }
    if (images.length === 0) { showToast('请上传至少一张图片或视频', 'error'); return }

    setProcessing(true); setProgress(10); setVideoUrl('')

    try {
      setProgress(20)
      const fd = new FormData()
      fd.append('text', text)
      fd.append('voice', voice)
      if (bgm) fd.append('bgm', bgm)
      images.forEach(img => fd.append('media', img))

      setProgress(40)
      const r = await fetch('/api/video/auto-compile', { method: 'POST', body: fd })
      const d = await r.json()

      if (d.success) {
        setVideoUrl(d.data.videoUrl)
        setProgress(100)
        showToast('✅ 视频生成成功', 'success')
      } else {
        showToast('失败: ' + (d.error || d.message || ''), 'error')
      }
    } catch (e: any) {
      showToast('异常: ' + e.message, 'error')
    }
    setProcessing(false)
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <p className="text-label mb-2">AI 工具 / AUTO COMPILE</p>
          <h1 className="text-mono-lg text-white">一键成片</h1>
          <p className="text-gray-400 text-sm mt-1">输入文案、上传素材，自动合成配音字幕视频</p>
        </div>

        {/* 模式切换 */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode('free')} className={`px-4 py-1.5 rounded-lg text-xs ${mode === 'free' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>
            🆓 免费模式（本地上传）
          </button>
          <button onClick={() => setMode('smart')} disabled className={`px-4 py-1.5 rounded-lg text-xs ${mode === 'smart' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>
            🤖 智能模式（自动搜素材）即将上线
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 左侧 */}
          <div className="space-y-4">
            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 block">文案内容（每行对应一个素材）</label>
              <textarea className="input-dark w-full text-sm h-36 resize-none"
                placeholder="第一行：对应第一张素材的画面说明&#10;第二行：对应第二张......" value={text} onChange={e => setText(e.target.value)} />
            </div>

            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 block">配音音色</label>
              <select className="input-dark w-full text-sm" value={voice} onChange={e => setVoice(e.target.value)}>
                <option value="zh_female_vv_uranus_bigtts">女声 - 优雅</option>
                <option value="zh_female_vv_aurora_bigtts">女声 - 温柔</option>
                <option value="zh_male_fengge_bigtts">男声 - 稳重</option>
                <option value="zh_male_xiaoming_bigtts">男声 - 阳光</option>
              </select>
            </div>

            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 block">素材（图片+视频，最多20个）</label>
              <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFiles} />
              <button onClick={() => fileRef.current?.click()}
                className="w-full py-2 border border-dashed border-white/20 text-gray-400 rounded-xl hover:border-emerald-500/50 hover:text-emerald-400 text-xs transition">
                + 上传素材
              </button>
              {images.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {images.map((f, i) => (
                    <div key={i} className="relative">
                      {f.type.startsWith('video/') ? (
                        <video src={URL.createObjectURL(f)} className="w-14 h-14 object-cover rounded-lg" />
                      ) : (
                        <img src={URL.createObjectURL(f)} className="w-14 h-14 object-cover rounded-lg" />
                      )}
                      <button onClick={() => removeFile(i)} className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-[8px]">&times;</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-gray-600 mt-1">{images.length} 个已选</p>
            </div>

            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 block">背景音乐（可选）</label>
              <input ref={bgmRef} type="file" accept="audio/*" className="hidden" onChange={e => setBgm(e.target.files?.[0] || null)} />
              <button onClick={() => bgmRef.current?.click()}
                className="w-full py-2 border border-dashed border-white/20 text-gray-400 rounded-xl hover:border-emerald-500/50 hover:text-emerald-400 text-xs transition">
                {bgm ? '🎵 ' + bgm.name : '+ 选择背景音乐'}
              </button>
              {bgm && <button onClick={() => setBgm(null)} className="text-[10px] text-red-400 mt-1">移除</button>}
            </div>

            <button onClick={handleSubmit} disabled={processing}
              className="w-full py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50 text-sm font-bold transition">
              {processing ? `⏳ 生成中 ${progress}%...` : '🎬 一键合成'}
            </button>

            {processing && (
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: progress + '%' }} />
              </div>
            )}
          </div>

          {/* 右侧：预览 */}
          <div className="card-glass p-4 h-fit sticky top-4">
            <label className="text-xs text-gray-400 mb-2 block">预览 / PREVIEW</label>
            {videoUrl ? (
              <div>
                <video src={videoUrl} controls className="w-full rounded-xl" />
                <a href={videoUrl} download
                  className="block text-center mt-3 py-2 bg-white/5 text-gray-400 border border-white/10 rounded-lg hover:bg-white/10 text-xs">
                  ⬇ 下载视频
                </a>
                <button onClick={() => window.open('/video-edit?input=' + encodeURIComponent(videoUrl), '_blank')}
                  className="block text-center mt-2 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/20 text-xs w-full">
                  🔧 到剪辑页精修
                </button>
              </div>
            ) : (
              <div className="aspect-video bg-white/5 rounded-xl flex items-center justify-center text-gray-600 text-xs">
                {processing ? '⏳ 正在合成...' : '生成后将在此预览'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
