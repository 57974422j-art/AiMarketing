'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { showToast } from '@/components/Toast'

export default function AutoCompilePage() {
  const [mode, setMode] = useState<'free' | 'smart'>('free')
  const [text, setText] = useState('')
  const [images, setImages] = useState<File[]>([])
  const [voice, setVoice] = useState('zh_female_vv_uranus_bigtts')
  const [ratio, setRatio] = useState('16:9')
  const [resolution, setResolution] = useState('1080p')
  const [subtitleSize, setSubtitleSize] = useState(36)
  const [bgm, setBgm] = useState<{name:string;url:string;custom?:boolean} | null>(null)
  const [bgmFile, setBgmFile] = useState<File | null>(null)
  const [musicList, setMusicList] = useState<Array<{name:string;url:string;duration:string;mood:string}>>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState('')

  useEffect(() => {
    fetch('/api/music-library').then(r=>r.json()).then(d => {
      if (d.success) setMusicList(d.data)
    }).catch(() => {})
  }, [])

  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<Record<number, Array<{url:string;thumb:string;title:string}>>>({})
  const [selectedImages, setSelectedImages] = useState<Record<number, {url:string;title:string}>>({})

  const fileRef = useRef<HTMLInputElement>(null)
  const bgmRef = useRef<HTMLInputElement>(null)

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
    setImages(prev => [...prev, ...files].slice(0, 20))
  }
  const removeFile = (i: number) => setImages(prev => prev.filter((_, idx) => idx !== i))

  const handleAutoSearch = useCallback(async () => {
    const lines = text.split('\n').filter(Boolean)
    if (lines.length === 0) { showToast('请先输入文案', 'error'); return }
    setSearching(true); setSearchResults({}); setSelectedImages({})
    for (let i = 0; i < lines.length; i++) {
      try {
        const r = await fetch('/api/search-images?q=' + encodeURIComponent(lines[i].slice(0, 20)) + '&count=6')
        const d = await r.json()
        if (d.success && d.data.length > 0) {
          setSearchResults(prev => ({ ...prev, [i]: d.data }))
          setSelectedImages(prev => ({ ...prev, [i]: { url: d.data[0].url, title: d.data[0].title } }))
        }
        setProgress(Math.round(((i + 1) / lines.length) * 100))
      } catch {}
    }
    setSearching(false); setProgress(0)
    showToast('✅ 素材搜索完成', 'success')
  }, [text])

  const handleSubmit = async () => {
    if (!text.trim()) { showToast('请输入文案', 'error'); return }
    if (mode === 'free' && images.length === 0) { showToast('请上传素材', 'error'); return }
    if (mode === 'smart' && Object.keys(selectedImages).length === 0) { showToast('请先搜索素材', 'error'); return }

    setProcessing(true); setProgress(10); setVideoUrl('')
    try {
      setProgress(20)
      const fd = new FormData()
      fd.append('text', text); fd.append('voice', voice)
      fd.append('ratio', ratio); fd.append('resolution', resolution); fd.append('subtitleSize', String(subtitleSize))
      if (bgmFile) fd.append('bgm', bgmFile)
      else if (bgm?.url) fd.append('bgmUrl', bgm.url)
      if (mode === 'free') images.forEach(img => fd.append('media', img))
      else fd.append('imageUrls', JSON.stringify(Object.values(selectedImages).map(v => v.url)))

      setProgress(40)
      const r = await fetch('/api/video/auto-compile', { method: 'POST', body: fd })
      const d = await r.json()
      if (d.success) { setVideoUrl(d.data.videoUrl); setProgress(100); showToast('✅ 成功', 'success') }
      else showToast('失败: ' + (d.error || d.message || ''), 'error')
    } catch (e: any) { showToast('异常: ' + e.message, 'error') }
    setProcessing(false)
  }

  const Sel = ({children,...p}:any)=><select {...p} className="input-dark w-full text-sm text-gray-200 bg-gray-800">{children}</select>

  return (
    <div className="min-h-screen bg-gray-950 p-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <p className="text-label mb-2">AI 工具 / AUTO COMPILE</p>
          <h1 className="text-mono-lg text-white">一键成片</h1>
          <p className="text-gray-400 text-sm mt-1">输入文案，自动合成配音字幕视频</p>
        </div>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode('free')} className={`px-4 py-1.5 rounded-lg text-xs ${mode==='free'?'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30':'bg-white/5 text-gray-400 border border-white/10'}`}>
            🆓 免费模式
          </button>
          <button onClick={() => setMode('smart')} className={`px-4 py-1.5 rounded-lg text-xs ${mode==='smart'?'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30':'bg-white/5 text-gray-400 border border-white/10'}`}>
            🤖 智能模式
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 block">文案</label>
              <textarea className="input-dark w-full text-sm h-36 resize-none"
                placeholder={mode==='free'?'每行对应一个素材':'每行动态搜相关图片'}
                value={text} onChange={e => setText(e.target.value)} />
            </div>

            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 block">配音</label>
              <select className="input-dark w-full text-sm" value={voice} onChange={e => setVoice(e.target.value)}>
                <option value="zh_female_vv_uranus_bigtts">女声</option>
                <option value="zh_female_vv_aurora_bigtts">温柔女声</option>
                <option value="zh_male_fengge_bigtts">稳重男声</option>
                <option value="zh_male_xiaoming_bigtts">阳光男声</option>
              </select>
            </div>

            {/* 输出设置 */}
            <div className="card-glass p-4 grid grid-cols-3 gap-3">
              <div><label className="text-[10px] text-gray-400 mb-1 block">画面比例</label><select className="input-dark w-full text-xs" value={ratio} onChange={e=>setRatio(e.target.value)}><option value="16:9">横屏 16:9</option><option value="9:16">竖屏 9:16</option><option value="1:1">方形 1:1</option><option value="4:3">4:3</option></select></div>
              <div><label className="text-[10px] text-gray-400 mb-1 block">分辨率</label><select className="input-dark w-full text-xs" value={resolution} onChange={e=>setResolution(e.target.value)}><option value="1080p">1080p</option><option value="720p">720p</option></select></div>
              <div><label className="text-[10px] text-gray-400 mb-1 block">字幕大小</label><select className="input-dark w-full text-xs" value={subtitleSize} onChange={e=>setSubtitleSize(Number(e.target.value))}><option value={28}>小</option><option value={36}>中</option><option value={44}>大</option></select></div>
            </div>

            {mode === 'free' && (
              <div className="card-glass p-4">
                <label className="text-xs text-gray-400 mb-2 block">素材</label>
                <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFiles} />
                <button onClick={() => fileRef.current?.click()} className="w-full py-2 border border-dashed border-white/20 text-gray-400 rounded-xl hover:border-emerald-500/50 text-xs transition">+ 上传</button>
                {images.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{images.map((f,i)=>(<div key={i} className="relative">{f.type.startsWith('video/')?<video src={URL.createObjectURL(f)} className="w-14 h-14 object-cover rounded-lg"/>:<img src={URL.createObjectURL(f)} className="w-14 h-14 object-cover rounded-lg"/>}<button onClick={()=>removeFile(i)} className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-[8px]">&times;</button></div>))}</div>}
                <p className="text-[10px] text-gray-600 mt-1">{images.length} 个</p>
              </div>
            )}

            {mode === 'smart' && (
              <div className="card-glass p-4">
                <label className="text-xs text-gray-400 mb-2 block">自动搜图 {Object.keys(selectedImages).length > 0 && <span className="text-emerald-400 ml-2">✅ {Object.keys(selectedImages).length} 张</span>}</label>
                <button onClick={handleAutoSearch} disabled={searching||!text.trim()}
                  className="w-full py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl hover:bg-blue-500/30 text-xs transition disabled:opacity-50">
                  {searching ? `搜索中 ${progress}%` : '🔍 自动搜索配图'}
                </button>
                {Object.entries(searchResults).map(([idx, imgs]) => (
                  <div key={idx} className="mt-3">
                    <p className="text-[10px] text-gray-500 mb-1">{Number(idx)+1}. {text.split('\n').filter(Boolean)[Number(idx)]?.slice(0,15)}</p>
                    <div className="flex flex-wrap gap-1">
                      {imgs.map((img,j) => (
                        <div key={j} className="cursor-pointer" onClick={()=>setSelectedImages(p=>({...p,[Number(idx)]:{url:img.url,title:img.title}}))}>
                          <img src={img.thumb||img.url} className={`w-14 h-14 object-cover rounded-lg border-2 ${selectedImages[Number(idx)]?.url===img.url?'border-emerald-400':'border-transparent'}`} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="card-glass p-4">
              <label className="text-xs text-gray-400 mb-2 block">背景音乐</label>
              <select className="input-dark w-full text-sm mb-2 text-gray-200 bg-gray-800" value={bgm?.url||''} onChange={e => {
                if (!e.target.value) { setBgm(null); setBgmFile(null); return }
                const found = musicList.find(m => m.url === e.target.value)
                if (found) setBgm({name: found.name, url: found.url})
              }}>
                <option value="">无背景音乐</option>
                {musicList.map((m,i) => <option key={i} value={m.url}>🎵 {m.name} ({m.duration})</option>)}
              </select>
              <div className="flex items-center gap-2">
                <input ref={bgmRef} type="file" accept="audio/*" className="hidden" onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) { setBgmFile(f); setBgm({name: f.name, url: '', custom: true}) }
                }} />
                <button onClick={() => bgmRef.current?.click()} className="text-[10px] text-gray-400 hover:text-white transition px-2 py-1 border border-white/10 rounded">
                  📁 自定义上传
                </button>
                {bgm?.custom && <span className="text-[10px] text-emerald-400">{bgm.name}</span>}
                {bgm && <button onClick={() => { setBgm(null); setBgmFile(null) }} className="text-[10px] text-red-400 ml-auto">移除</button>}
              </div>
            </div>

            <button onClick={handleSubmit} disabled={processing}
              className="w-full py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50 text-sm font-bold transition">
              {processing ? `⏳ ${progress}%` : '🎬 一键合成'}
            </button>
            {processing && <div className="h-1.5 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{width:progress+'%'}}/></div>}
          </div>

          <div className="card-glass p-4 h-fit sticky top-4">
            <label className="text-xs text-gray-400 mb-2 block">预览</label>
            {videoUrl ? (<div><video src={videoUrl} controls className="w-full rounded-xl" /><a href={videoUrl} download className="block text-center mt-3 py-2 bg-white/5 text-gray-400 border border-white/10 rounded-lg hover:bg-white/10 text-xs">⬇ 下载</a></div>)
              : <div className="aspect-video bg-white/5 rounded-xl flex items-center justify-center text-gray-600 text-xs">{processing?'⏳ 合成中...':'预览区'}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
