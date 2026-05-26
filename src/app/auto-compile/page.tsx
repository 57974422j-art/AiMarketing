'use client'
import { useState, useRef } from 'react'
import { showToast } from '@/components/Toast'

export default function AutoCompilePage() {
  const [text, setText] = useState('')
  const [images, setImages] = useState<File[]>([])
  const [voice, setVoice] = useState('zh_female_vv_uranus_bigtts')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    setImages(prev => [...prev, ...files].slice(0, 20))
  }

  const removeImage = (i: number) => {
    setImages(prev => prev.filter((_, idx) => idx !== i))
  }

  const handleSubmit = async () => {
    if (!text.trim()) { showToast('请输入文案', 'error'); return }
    if (images.length === 0) { showToast('请上传至少一张图片', 'error'); return }

    setProcessing(true); setProgress(10); setVideoUrl('')

    try {
      setProgress(30)
      const fd = new FormData()
      fd.append('text', text)
      fd.append('voice', voice)
      images.forEach(img => fd.append('images', img))

      setProgress(50)
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
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <p className="text-label mb-2">AI 工具 / AUTO COMPILE</p>
          <h1 className="text-mono-lg text-white">一键成片</h1>
          <p className="text-gray-400 text-sm mt-1">输入文案、上传图片，自动合成配音视频</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 左侧：配置 */}
          <div className="space-y-4">
            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 block">文案内容</label>
              <textarea className="input-dark w-full text-sm h-36 resize-none"
                placeholder="输入视频文案，每段话一行，将按顺序对应到每张图片..."
                value={text} onChange={e => setText(e.target.value)} />
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
              <label className="text-xs text-gray-400 mb-2 block">图片素材（支持 jpg/png，最多 20 张）</label>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImages} />
              <button onClick={() => fileRef.current?.click()}
                className="w-full py-2 border border-dashed border-white/20 text-gray-400 rounded-xl hover:border-emerald-500/50 hover:text-emerald-400 text-xs transition">
                + 选择图片
              </button>
              {images.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {images.map((f, i) => (
                    <div key={i} className="relative">
                      <img src={URL.createObjectURL(f)} className="w-14 h-14 object-cover rounded-lg" />
                      <button onClick={() => removeImage(i)} className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-[8px]">&times;</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-gray-600 mt-1">{images.length} 张已选</p>
            </div>

            <button onClick={handleSubmit} disabled={processing}
              className="w-full py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50 text-sm font-bold transition">
              {processing ? `⏳ 生成中 ${progress}%...` : '🎬 一键生成'}
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
              <video src={videoUrl} controls className="w-full rounded-xl" />
            ) : (
              <div className="aspect-video bg-white/5 rounded-xl flex items-center justify-center text-gray-600 text-xs">
                {processing ? '⏳ 正在合成...' : '生成后将在此预览'}
              </div>
            )}
            {videoUrl && (
              <a href={videoUrl} download
                className="block text-center mt-3 py-2 bg-white/5 text-gray-400 border border-white/10 rounded-lg hover:bg-white/10 text-xs">
                ⬇ 下载视频
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
