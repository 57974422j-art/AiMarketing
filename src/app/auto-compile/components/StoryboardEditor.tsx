'use client'
import { useState, useCallback } from 'react'
import { showToast } from '@/components/Toast'

interface ShotItem {
  id: string; mediaUrl: string; mediaThumb: string; mediaType: string
  subtitle: string; duration: number
  titleOn: boolean; titleStyle: string; titleText: string
  stickerOn: boolean; stickerText: string; stickerPos: string
}
type SearchResultMap = Record<number, Array<{ url: string; thumb: string; title: string; type?: string }>>

interface Props {
  text: string; setText: (v: string) => void
  genInput: string; setGenInput: (v: string) => void
  genOpen: boolean; setGenOpen: (v: boolean) => void
  genLoading: boolean; setGenLoading: (v: boolean) => void
  aiKeywords: string[]
  searchQuery: string; setSearchQuery: (v: string) => void
  searching: boolean
  handleAutoSearch: (q?: string) => void
  searchResults: SearchResultMap; setSearchResults: (v: SearchResultMap) => void
  checkedImages: Array<{ url: string; title: string; type?: string }>; setCheckedImages: (v: any) => void
  materialList: any[]; setMaterialList: (v: any) => void
  voice: string; setVoice: (v: string) => void
  duration: number; setDuration: (v: number) => void
  subtitleSize: number; setSubtitleSize: (v: number) => void
  colorFilter: string; setColorFilter: (v: string) => void
  kenBurns: string; setKenBurns: (v: string) => void
  transition: string; setTransition: (v: string) => void
  transitionDur: number; setTransitionDur: (v: number) => void
  subtitleStyle: string; setSubtitleStyle: (v: string) => void
  bgm: any; setBgm: (v: any) => void; bgmFile: File | null; setBgmFile: (v: any) => void
  musicList: any[]; bgmPlaying: string | null; setBgmPlaying: (v: string | null) => void
  processing: boolean; setProcessing: (v: boolean) => void
  progress: number; setProgress: (v: number) => void; videoUrl: string; setVideoUrl: (v: string) => void
}

const genId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)

export default function StoryboardEditor(props: Props) {
  const {
    text, setText, genInput, setGenInput, genOpen, setGenOpen, genLoading, setGenLoading,
    aiKeywords, searchQuery, setSearchQuery, searching, handleAutoSearch,
    searchResults, setSearchResults, checkedImages, setCheckedImages, materialList, setMaterialList,
    voice, setVoice, duration, setDuration, subtitleSize, setSubtitleSize,
    colorFilter, setColorFilter, kenBurns, setKenBurns, transition, setTransition,
    transitionDur, setTransitionDur, subtitleStyle, setSubtitleStyle,
    bgm, setBgm, bgmFile, setBgmFile, musicList, bgmPlaying, setBgmPlaying,
    processing, setProcessing, progress, setProgress, videoUrl, setVideoUrl,
  } = props

  const [shots, setShots] = useState<ShotItem[]>([])
  const [activeShot, setActiveShot] = useState<string | null>(null)
  const [showMediaPanel, setShowMediaPanel] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  // AI 生成分镜
  const handleAIGenerate = async () => {
    if (!genInput.trim() || genInput.length < 5) { showToast('请至少输入5个字', 'error'); return }
    setGenLoading(true)
    try {
      const r = await fetch('/api/generate-script', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: genInput.trim(), duration })
      })
      const d = await r.json()
      if (d.success) {
        setText(d.data.script)
        const lines = (d.data.script || '').split('\n').filter((l: string) => l.trim())
        const durPerShot = Math.max(3, Math.round((duration || 15) / lines.length))
        setShots(lines.map((line: string) => ({
          id: genId(), mediaUrl: '', mediaThumb: '', mediaType: 'image',
          subtitle: line, duration: durPerShot,
          titleOn: false, titleStyle: 'popin', titleText: '',
          stickerOn: false, stickerText: '', stickerPos: 'br',
        })))
        showToast(`已生成 ${lines.length} 个分镜`, 'success')
        setGenInput('')
      } else { showToast(d.error || '生成失败', 'error') }
    } catch (e: any) { showToast('生成失败: ' + e.message, 'error') }
    setGenLoading(false)
  }

  // 添加素材到分镜
  const addMediaToShot = (shotId: string, mediaUrl: string, mediaThumb: string, mediaType: string) => {
    setShots(prev => prev.map(s =>
      s.id === shotId ? { ...s, mediaUrl, mediaThumb, mediaType } : s
    ))
    showToast('已添加素材到分镜', 'success')
  }

  // 拖拽排序
  const handleDragStart = (idx: number) => setDragIdx(idx)
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }
  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return
    setShots(prev => {
      const next = [...prev]
      const [item] = next.splice(dragIdx, 1)
      next.splice(targetIdx, 0, item)
      return next
    })
    setDragIdx(null)
  }

  // 合成提交
  const handleSynthesize = useCallback(async () => {
    if (shots.length === 0) { showToast('请先生成分镜', 'error'); return }
    const hasMedia = shots.some(s => s.mediaUrl)
    if (!hasMedia) { showToast('请至少为一个分镜添加素材', 'error'); return }

    setProcessing(true); setProgress(10)
    try {
      const fd = new FormData()
      fd.append('text', shots.map(s => s.subtitle).join('\n'))
      fd.append('mode', 'smart'); fd.append('voice', voice)
      fd.append('duration', String(shots.reduce((a, s) => a + s.duration, 0)))
      fd.append('ratio', '9:16'); fd.append('resolution', '1080')
      fd.append('subtitleSize', String(subtitleSize)); fd.append('showSubs', 'true')
      fd.append('subtitleMode', 'tts-sync'); fd.append('colorFilter', colorFilter)
      fd.append('smartMode', 'true')
      fd.append('transition', transition); fd.append('transitionDur', String(transitionDur))
      fd.append('kenBurns', kenBurns); fd.append('subtitleStyle', subtitleStyle)

      const urls = shots.filter(s => s.mediaUrl).map(s => s.mediaUrl)
      fd.append('imageUrls', JSON.stringify(urls))

      if (bgm?.url) fd.append('bgmUrl', bgm.url)
      if (bgmFile) fd.append('bgm', bgmFile)

      setProgress(20)
      const r = await fetch('/api/video/auto-compile', { method: 'POST', body: fd })
      const d = await r.json()
      if (!d.success) { showToast(d.message || '失败', 'error'); setProcessing(false); return }

      const taskId = d.data.taskId
      while (true) {
        await new Promise(r => setTimeout(r, 1500))
        const q = await fetch('/api/video/auto-compile?taskId=' + taskId)
        const qd = await q.json()
        if (!qd.success) break
        setProgress(qd.data.progress || 30)
        if (qd.data.status === 'completed') { setVideoUrl(qd.data.videoUrl); setProgress(100); showToast('✅ 合成成功', 'success'); break }
        if (qd.data.status === 'failed') { showToast(qd.data.error || '合成失败', 'error'); break }
      }
    } catch (e: any) { showToast('失败: ' + e.message, 'error') }
    setProcessing(false)
  }, [shots, voice, colorFilter, transition, transitionDur, kenBurns, subtitleStyle, subtitleSize, bgm, bgmFile, setProcessing, setProgress, setVideoUrl])

  return (
    <div className="space-y-4">
      {/* AI导演 */}
      <div className="card-glass p-4">
        <label className="text-xs text-gray-400 mb-2 block">🎬 AI导演 — 输入主题描述</label>
        <textarea className="input-dark w-full text-sm h-24 resize-none"
          placeholder="输入描述文字（20-200字）..."
          value={genInput} maxLength={200}
          onChange={e => { if (e.target.value.length <= 200) setGenInput(e.target.value) }} />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-gray-500">{genInput.length}/200 字</span>
          <button onClick={handleAIGenerate} disabled={genLoading || genInput.length < 5}
            className="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm disabled:opacity-40">
            {genLoading ? '⏳ 生成中...' : '🎬 生成分镜'}
          </button>
        </div>
      </div>

      {/* 分镜卡片（拖拽排序） */}
      {shots.length > 0 && (
        <div className="card-glass p-4">
          <label className="text-xs text-gray-400 mb-3 block">📋 分镜时间线 ({shots.length} 帧) <span className="text-[9px] text-gray-600 ml-1">↔ 可拖拽排序</span></label>
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {shots.map((shot, idx) => (
              <div key={shot.id} draggable
                onDragStart={() => handleDragStart(idx)} onDragOver={handleDragOver} onDrop={() => handleDrop(idx)}
                onClick={() => { setActiveShot(activeShot === shot.id ? null : shot.id); setShowMediaPanel(false) }}
                className={`relative rounded-lg p-2 cursor-pointer border-2 transition hover:border-white/40 ${
                  activeShot === shot.id ? 'border-orange-400 bg-orange-500/10' :
                  dragIdx === idx ? 'ring-2 ring-blue-400 opacity-50' :
                  'border-white/10 bg-white/5'
                }`}
              >
                <div className="aspect-[9/16] bg-black/30 rounded mb-1.5 flex items-center justify-center overflow-hidden">
                  {shot.mediaThumb ? (
                    <img src={shot.mediaThumb} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-gray-600 text-xl">📷</span>
                  )}
                </div>
                <p className="text-[8px] text-gray-400 line-clamp-2 leading-tight">{shot.subtitle}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[7px] text-gray-600">{shot.duration}s</span>
                  <span className="text-[7px] text-gray-600">#{idx + 1}</span>
                </div>
                {shot.stickerOn && <span className="absolute top-1 left-1 text-[8px]">🏷</span>}
                {shot.titleOn && <span className="absolute top-1 right-1 text-[8px]">T</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 编辑面板 */}
      {activeShot && (() => {
        const shot = shots.find(s => s.id === activeShot)
        if (!shot) return null
        const idx = shots.findIndex(s => s.id === activeShot)

        return (
          <div className="card-glass p-4 border border-orange-500/30">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs text-orange-400">✏️ 编辑分镜 #{idx + 1}</h4>
              <button onClick={() => setActiveShot(null)} className="text-gray-500 text-xs hover:text-white">✕ 关闭</button>
            </div>

            {/* 基础参数 */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3 text-xs">
              <div>
                <label className="text-gray-500 text-[9px] block mb-0.5">时长 (秒)</label>
                <input type="number" className="input-dark w-full" value={shot.duration}
                  onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, duration: Math.max(1, Number(e.target.value) || 1) } : s))} min={1} max={30} />
              </div>
              <div>
                <label className="text-gray-500 text-[9px] block mb-0.5">字幕文本</label>
                <input className="input-dark w-full" value={shot.subtitle.substring(0, 30)}
                  onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, subtitle: e.target.value } : s))} />
              </div>
              <div>
                <label className="text-gray-500 text-[9px] block mb-0.5">滤镜</label>
                <select className="input-dark w-full" value={colorFilter}
                  onChange={e => setColorFilter(e.target.value)}>
                  <option value="">原色</option><option value="warm">暖色</option><option value="cool">冷色</option><option value="bw">黑白</option>
                </select>
              </div>
            </div>

            {/* 标题 */}
            <div className="border-t border-white/10 pt-2 mb-2">
              <label className="text-[9px] text-gray-500 flex items-center gap-1 mb-1">
                片头标题
                <button onClick={() => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, titleOn: !s.titleOn } : s))}
                  className={`text-[8px] px-1.5 py-0.5 rounded ${shot.titleOn ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-gray-500'}`}>
                  {shot.titleOn ? 'ON' : 'OFF'}
                </button>
              </label>
              {shot.titleOn && (
                <div className="flex gap-2 flex-wrap">
                  <input className="input-dark text-xs flex-1 min-w-[120px]" placeholder="标题文字(10字内)"
                    value={shot.titleText} maxLength={10}
                    onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, titleText: e.target.value } : s))} />
                  <select className="input-dark text-xs w-20" value={shot.titleStyle}
                    onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, titleStyle: e.target.value } : s))}>
                    <option value="popin">弹入</option><option value="fade">淡入</option><option value="outline">描边</option>
                    <option value="glow">发光</option><option value="gradient">渐变</option><option value="scalePulse">缩放</option>
                    <option value="shake">抖动</option>
                  </select>
                </div>
              )}
            </div>

            {/* 贴纸标签 */}
            <div className="border-t border-white/10 pt-2 mb-2">
              <label className="text-[9px] text-gray-500 flex items-center gap-1 mb-1">
                贴纸标签
                <button onClick={() => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, stickerOn: !s.stickerOn } : s))}
                  className={`text-[8px] px-1.5 py-0.5 rounded ${shot.stickerOn ? 'bg-pink-500/20 text-pink-400' : 'bg-white/5 text-gray-500'}`}>
                  {shot.stickerOn ? 'ON' : 'OFF'}
                </button>
              </label>
              {shot.stickerOn && (
                <div className="flex gap-2">
                  <input className="input-dark text-xs flex-1" placeholder="如：好可爱啊" maxLength={8}
                    value={shot.stickerText}
                    onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, stickerText: e.target.value } : s))} />
                  <select className="input-dark text-xs w-18" value={shot.stickerPos}
                    onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, stickerPos: e.target.value } : s))}>
                    <option value="tl">左上</option><option value="tr">右上</option>
                    <option value="bl">左下</option><option value="br">右下</option>
                  </select>
                </div>
              )}
            </div>

            {/* 搜图素材 */}
            <button onClick={() => setShowMediaPanel(!showMediaPanel)}
              className="w-full py-1.5 border border-dashed border-blue-500/30 rounded text-blue-400 text-xs hover:border-blue-500/50 transition">
              🖼 {showMediaPanel ? '收起素材面板' : '添加图片/视频'}
            </button>
            {showMediaPanel && (
              <div className="mt-2 pt-2 border-t border-white/10">
                <div className="flex gap-1.5 mb-2">
                  <input className="input-dark text-xs flex-1" placeholder="搜索..."
                    value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAutoSearch() }} />
                  <button onClick={() => handleAutoSearch()} disabled={searching}
                    className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">{searching ? '··' : '搜索'}</button>
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {Object.values(searchResults).flat().slice(0, 8).map((img: any, j: number) => (
                    <div key={j} className="shrink-0 cursor-pointer rounded overflow-hidden border border-white/10 hover:border-blue-400"
                      onClick={() => addMediaToShot(activeShot, img.url, img.thumb, img.type || 'image')}>
                      <img src={img.thumb} className="w-16 h-16 object-cover" />
                      {img.type === 'video' && <span className="absolute text-[7px]">🎬</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* 空状态 & 合成按钮 */}
      {shots.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">输入主题 → AI导演 → 生成分镜</p>
          <p className="text-gray-600 text-xs mt-1">每条文案自动转为独立分镜卡片</p>
        </div>
      )}

      {shots.length > 0 && (
        <button onClick={handleSynthesize} disabled={processing}
          className="w-full py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50 text-sm font-bold transition">
          {processing ? `⏳ 合成中 ${progress}%` : `🎬 一键合成 (${shots.length} 个分镜)`}
        </button>
      )}

      {/* BGM */}
      <div className="card-glass p-3">
        <label className="text-[10px] text-gray-500 block mb-1">背景音乐</label>
        <div className="flex gap-1.5 overflow-x-auto">
          {musicList.slice(0, 6).map((item: any) => (
            <button key={item.url} onClick={() => {
              if (bgm?.url === item.url && !bgm?.custom) { setBgm(null); return }
              setBgm({ name: item.name, url: item.url }); setBgmFile(null)
            }}
              className={`shrink-0 px-2 py-1 text-[10px] rounded border ${bgm?.url === item.url && !bgm?.custom ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>
              {bgm?.url === item.url && !bgm?.custom ? '✓ ' : ''}{item.name.split('-')[0]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
