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
  const [duration, setDuration] = useState(30)
  const [showSubs, setShowSubs] = useState(true)
  const [stickerText, setStickerText] = useState('')
  const [stickerPos, setStickerPos] = useState('tl')
  const [stickerOn, setStickerOn] = useState(false)
  const [titleText, setTitleText] = useState('')
  const [titleOn, setTitleOn] = useState(false)
  const [colorFilter, setColorFilter] = useState('')
  const [subtitleSize, setSubtitleSize] = useState(36)
  const [bgm, setBgm] = useState<{name:string;url:string;custom?:boolean} | null>(null)
  const [bgmFile, setBgmFile] = useState<File | null>(null)
  const [musicList, setMusicList] = useState<Array<{name:string;url:string;duration:string;mood:string}>>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [genIndustry, setGenIndustry] = useState('')
  const [genLoading, setGenLoading] = useState(false)

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
    const MAX_FILES = 20; const MAX_SIZE = 100 * 1024 * 1024
    const newFiles = Array.from(e.target.files || [])
    const allFiles = [...images, ...newFiles]
    if (allFiles.length > MAX_FILES) { showToast("素材最多20个，当前共" + allFiles.length + "个", "error"); return }
    const totalSize = allFiles.reduce((s, f) => s + f.size, 0)
    if (totalSize > MAX_SIZE) { showToast("素材超过100MB，请压缩后再试", "error"); return }
    const files = Array.from(e.target.files || [])
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
      fd.append('duration', String(duration))
      fd.append('ratio', ratio); fd.append('resolution', resolution); fd.append('subtitleSize', String(subtitleSize))
      fd.append('showSubs', String(showSubs))
      if (stickerOn) { fd.append('stickerText', stickerText); fd.append('stickerPos', stickerPos) }
      if (titleOn) fd.append('titleText', titleText)
      fd.append('colorFilter', colorFilter)
      if (bgmFile) fd.append('bgm', bgmFile)
      else if (bgm?.url) fd.append('bgmUrl', bgm.url)
      if (mode === 'free') images.forEach(img => fd.append('media', img))
      else fd.append('imageUrls', JSON.stringify(Object.values(selectedImages).map(v => v.url)))

      // 提交任务 - 立即返回 taskId
      const r = await fetch('/api/video/auto-compile', { method: 'POST', body: fd })
      const d = await r.json()
      if (!d.success) { showToast('失败: ' + (d.error || d.message || ''), 'error'); setProcessing(false); return }

      const taskId = d.data.taskId
      setProgress(30)

      // 轮询任务进度（不阻塞服务器）
      while (true) {
        await new Promise(r => setTimeout(r, 1500))
        const q = await fetch('/api/video/auto-compile?taskId=' + taskId)
        const qd = await q.json()
        if (!qd.success) break
        const t = qd.data
        setProgress(t.progress || 30)
        if (t.status === 'completed') { setVideoUrl(t.videoUrl); setProgress(100); showToast('✅ 成功', 'success'); break }
        if (t.status === 'failed') { showToast('失败: ' + (t.error || '合成失败'), 'error'); break }
      }
    } catch (e: any) { showToast('异常: ' + e.message, 'error') }
    setProcessing(false)
  }


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
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400">文案</label>
                <button onClick={()=>{const inp=prompt('请输入行业描述（如：餐饮、旅游）');if(!inp||!inp.trim())return;fetch('/api/generate-script',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({industry:inp.trim(),style:'',duration:duration})}).then(r=>r.json()).then(r=>{if(r.success)setText(r.data.script);else showToast(r.error||'生成失败','error')})}} className="text-[10px] px-2 py-1 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded hover:bg-purple-500/30 transition">
                  ✨ AI 生成
                </button>
              </div>
              <textarea className="input-dark w-full text-sm h-36 resize-none"
                placeholder={mode==='free'?'每行对应一个素材':'每行动态搜相关图片'}
                value={text} onChange={e => setText(e.target.value)} />
              <p className="text-[10px] text-gray-500 mt-1">文案约 {text.replace(/\s/g,'').length} 字，预计配音 ~{Math.round(text.replace(/\s/g,'').length * 0.3)} 秒</p>
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
            
            <div className="card-glass p-4 grid grid-cols-2 gap-2">
            <div><label className="text-[10px] text-gray-400 mb-1 block">画面比例</label><select className="input-dark w-full text-xs" value={ratio} onChange={e=>setRatio(e.target.value)}><option value="16:9">横屏 16:9</option><option value="9:16">竖屏 9:16</option><option value="1:1">方形 1:1</option><option value="4:3">4:3</option></select></div>
            <div><label className="text-[10px] text-gray-400 mb-1 block">分辨率</label><select className="input-dark w-full text-xs" value={resolution} onChange={e=>setResolution(e.target.value)}><option value="1080p">1080p</option><option value="720p">720p</option></select></div>
            <div><label className="text-[10px] text-gray-400 mb-1 block">字幕大小</label><select className="input-dark w-full text-xs" value={subtitleSize} onChange={e=>setSubtitleSize(Number(e.target.value))}><option value={28}>小</option><option value={36}>中</option><option value={44}>大</option></select></div>
            <div><label className="text-[10px] text-gray-400 mb-1 block">字幕</label><button onClick={()=>setShowSubs(!showSubs)} className={`w-full py-2 text-xs rounded-lg ${showSubs?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-400 border border-white/10"}`}>{showSubs?"ON":"OFF"}</button></div>
              <div><label className="text-[10px] text-gray-400 mb-1 block">视频时长</label><select className="input-dark w-full text-xs" value={duration} onChange={e=>setDuration(Number(e.target.value))}><option value={15}>15秒</option><option value={30}>30秒</option><option value={45}>45秒</option><option value={60}>60秒</option></select></div>
            </div>

            <div className="card-glass p-4">
<label className="text-xs text-gray-400 mb-2 flex items-center gap-2">贴纸标签<button onClick={()=>setStickerOn(!stickerOn)} className={`px-2 py-0.5 text-[10px] rounded ${stickerOn?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-400 border border-white/10"}`}>{stickerOn?"ON":"OFF"}</button></label>
{stickerOn&&<div className="flex gap-2"><input className="input-dark text-xs flex-1" placeholder="如：好可爱啊" value={stickerText} onChange={e=>setStickerText(e.target.value)} maxLength={12}/><select className="input-dark text-xs w-20" value={stickerPos} onChange={e=>setStickerPos(e.target.value)}><option value="tl">左上</option><option value="tr">右上</option><option value="bl">左下</option><option value="br">右下</option></select></div>}
</div>
<div className="card-glass p-4">
<label className="text-xs text-gray-400 mb-2 flex items-center gap-2">片头标题<button onClick={()=>setTitleOn(!titleOn)} className={`px-2 py-0.5 text-[10px] rounded ${titleOn?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-400 border border-white/10"}`}>{titleOn?"ON":"OFF"}</button></label>
{titleOn&&<input className="input-dark text-xs w-full" placeholder="默认文案第一句" value={titleText} onChange={e=>setTitleText(e.target.value)} maxLength={20}/>}
</div>
<div className="card-glass p-4">
<label className="text-xs text-gray-400 mb-2 block">色调滤镜</label>
<div className="flex gap-2">{["原色","暖色","冷色","黑白"].map((l,i)=><button key={i} onClick={()=>setColorFilter(colorFilter===["","warm","cool","bw"][i]?"":["","warm","cool","bw"][i])} className={`px-3 py-1.5 text-[10px] rounded-lg ${colorFilter===["","warm","cool","bw"][i]?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-400 border border-white/10"}`}>{l}</button>)}</div>
</div>{mode === 'free' && (
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
              <label className="text-xs text-gray-400 mb-2 block">背景音乐（可选，未上传则无BGM）</label>
              <input ref={bgmRef} type="file" accept="audio/*" className="hidden" onChange={e => {
                const f = e.target.files?.[0]
                if (f) { setBgmFile(f); setBgm({name: f.name, url: '', custom: true}) }
              }} />
              <button onClick={() => bgmRef.current?.click()} className="w-full py-2 border border-dashed border-white/20 text-gray-400 rounded-xl hover:border-emerald-500/50 hover:text-emerald-400 text-xs transition">
                {bgm?.custom ? '🎵 ' + bgm.name : '+ 上传背景音乐'}
              </button>
              {bgm && <button onClick={() => { setBgm(null); setBgmFile(null) }} className="text-[10px] text-red-400 mt-1">移除</button>}
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
