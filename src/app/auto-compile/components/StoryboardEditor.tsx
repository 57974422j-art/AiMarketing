'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import { showToast } from '@/components/Toast'

interface ShotItem {
  id: string; mediaUrl: string; mediaThumb: string; mediaType: string
  mediaBlob: Blob | null
  subtitle: string; duration: number
  titleOn: boolean; titleStyle: string; titleText: string
  titlePosX: number; titlePosY: number
  stickerOn: boolean; stickerText: string; stickerPosX: number; stickerPosY: number
}
type SearchResultMap = Record<number, Array<{ url: string; thumb: string; title: string; type?: string }>>

interface Props {
  text: string; setText: (v: string) => void
  genInput: string; setGenInput: (v: string) => void
  genOpen: boolean; setGenOpen: (v: boolean) => void
  genLoading: boolean; setGenLoading: (v: boolean) => void
  aiKeywords: string[]
  // 仓库
  showStorageDlg: boolean; setShowStorageDlg: (v: boolean) => void
  storageFiles: any[]; setStorageFiles: (v: any) => void
  storageList: any[]; storageLoading: boolean; loadStorageFiles: () => void
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
    showStorageDlg, setShowStorageDlg, storageFiles, setStorageFiles,
    storageList, storageLoading, loadStorageFiles,
  } = props

  const [shots, setShots] = useState<ShotItem[]>([])
  const [activeShot, setActiveShot] = useState<string | null>(null)
  const [showMediaPanel, setShowMediaPanel] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [draggingSticker, setDraggingSticker] = useState<string | null>(null)
  const [localKeywords, setLocalKeywords] = useState<string[]>([])
  const dragTypeRef = useRef<string | null>(null) // 'sticker' | 'title'
  const prevStorageCount = useRef(0)

  // 仓库文件选中后自动加入当前分镜
  useEffect(() => {
    if (storageFiles.length > prevStorageCount.current && activeShot) {
      const newFiles = storageFiles.slice(prevStorageCount.current)
      newFiles.forEach((f: any) => {
        const url = `/api/storage/serve?file=${encodeURIComponent(f.name)}`
        addMediaToShot(activeShot, url, f.thumbUrl || url, f.isVideo ? 'video' : 'image')
      })
      showToast(`已添加 ${newFiles.length} 个仓库文件`, 'success')
    }
    prevStorageCount.current = storageFiles.length
  }, [storageFiles.length])

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
        const keywords: string[] = d.data.lines.map((l: any) => l.keyword)
        setLocalKeywords(keywords)
        const lines = (d.data.script || '').split('\n').filter((l: string) => l.trim())
        const durPerShot = Math.max(3, Math.round((duration || 15) / lines.length))
        setShots(lines.map((line: string) => ({
          id: genId(), mediaUrl: '', mediaThumb: '', mediaType: 'image', mediaBlob: null,
          subtitle: line, duration: durPerShot,
          titleOn: false, titleStyle: 'popin', titleText: '', titlePosX: 50, titlePosY: 10,
          stickerOn: false, stickerText: '', stickerPosX: 85, stickerPosY: 85,
        })))
        showToast(`已生成 ${lines.length} 个分镜`, 'success')
        setGenInput('')
      } else { showToast(d.error || '生成失败', 'error') }
    } catch (e: any) { showToast('生成失败: ' + e.message, 'error') }
    setGenLoading(false)
  }

  // 添加素材到分镜（选中即下载，避免合成时 Pixabay 限流失效）
  const addMediaToShot = async (shotId: string, mediaUrl: string, mediaThumb: string, mediaType: string) => {
    // 先更新缩略图即时反馈
    setShots(prev => prev.map(s =>
      s.id === shotId ? { ...s, mediaUrl, mediaThumb, mediaType } : s
    ))
    showToast('下载中...', 'success')
    try {
      const res = await fetch(mediaUrl)
      const blob = await res.blob()
      setShots(prev => prev.map(s =>
        s.id === shotId ? { ...s, mediaBlob: blob } : s
      ))
      showToast('素材已就绪', 'success')
    } catch {
      showToast('下载失败，合成时可能缺此素材', 'error')
    }
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
      fd.append('mode', 'free'); fd.append('voice', voice)
      fd.append('duration', String(duration || shots.reduce((a, s) => a + s.duration, 0)))
      fd.append('ratio', '9:16'); fd.append('resolution', '1080')
      fd.append('subtitleSize', String(subtitleSize)); fd.append('showSubs', 'true')
      fd.append('subtitleMode', 'tts-sync'); fd.append('colorFilter', colorFilter)
      // 分镜走普通模式合成（concat 拼接，更稳定）
      fd.append('smartMode', 'false')
      fd.append('transition', 'none'); fd.append('kenBurns', 'none'); fd.append('subtitleStyle', 'normal')
      // 标题和贴纸（取第一个开启的分镜作为全局）
      const titleShot = shots.find(s => s.titleOn && s.titleText)
      if (titleShot) {
        fd.append('titleText', titleShot.titleText)
        fd.append('titleStyle', titleShot.titleStyle)
        fd.append('titlePos', 'center'); fd.append('titleTiming', 'intro')
      }
      const stickerShot = shots.find(s => s.stickerOn && s.stickerText)
      if (stickerShot) {
        fd.append('stickerText', stickerShot.stickerText)
        const posMap: Record<string, string> = { 'br': 'br', 'tr': 'tr', 'bl': 'bl', 'tl': 'tl' }
        fd.append('stickerPos', stickerShot.stickerPosX > 50 ? (stickerShot.stickerPosY > 50 ? 'br' : 'tr') : (stickerShot.stickerPosY > 50 ? 'bl' : 'tl'))
      }

      // 用预下载的 blob 文件提交（不走 URL 下载）
      let blobIdx = 0
      let noBlobCount = 0
      for (const shot of shots) {
        if (shot.mediaBlob) {
          const ext = shot.mediaType === 'video' ? 'mp4' : 'jpg'
          fd.append('media', new File([shot.mediaBlob], `shot${blobIdx}.${ext}`, { type: shot.mediaBlob.type }))
          blobIdx++
        } else {
          noBlobCount++
        }
      }
      console.log(`[分镜合成] 共${shots.length}个分镜 blob就绪=${blobIdx} 缺失=${noBlobCount}`)
      if (noBlobCount > 0) {
        showToast(`⚠ ${noBlobCount} 个分镜未配图，将被跳过`, 'error')
      }
      if (blobIdx === 0) {
        // 没有预下载的，回退到 URL 方式
        const urls = shots.filter(s => s.mediaUrl).map(s => s.mediaUrl)
        if (urls.length > 0) { fd.append('imageUrls', JSON.stringify(urls)); fd.append('mode', 'smart') }
      }
      fd.append('debugBlobCount', String(blobIdx)) // 后端诊断用

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

      {/* ═══ 合成参数 ═══ */}
      {shots.length > 0 && (
        <div className="card-glass p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div>
            <label className="text-gray-500 text-[9px] block mb-0.5">配音</label>
            <select className="input-dark w-full text-[10px]" value={voice} onChange={e => setVoice(e.target.value)}>
              <option value="zh_female_vv_uranus_bigtts">女声</option>
              <option value="zh_female_vv_aurora_bigtts">温柔女声</option>
              <option value="zh_male_fengge_bigtts">稳重男声</option>
              <option value="zh_male_xiaoming_bigtts">阳光男声</option>
            </select>
          </div>
          <div>
            <label className="text-gray-500 text-[9px] block mb-0.5">字幕</label>
            <select className="input-dark w-full text-[10px]" value={subtitleSize} onChange={e => setSubtitleSize(Number(e.target.value))}>
              <option value={28}>小号</option><option value={36}>中号</option><option value={44}>大号</option>
            </select>
          </div>
          <div>
            <label className="text-gray-500 text-[9px] block mb-0.5">字幕动效</label>
            <select className="input-dark w-full text-[10px]" value={subtitleStyle} onChange={e => setSubtitleStyle(e.target.value)}>
              <option value="normal">普通(SRT)</option><option value="highlight">高亮</option>
              <option value="karaoke">卡拉OK</option><option value="typewriter">打字机</option>
            </select>
          </div>
          <div>
            <label className="text-gray-500 text-[9px] block mb-0.5">转场</label>
            <select className="input-dark w-full text-[10px]" value={transition} onChange={e => setTransition(e.target.value)}>
              <option value="fade">淡入淡出</option><option value="slideleft">左滑</option><option value="slideright">右滑</option>
              <option value="wipeleft">擦除</option><option value="dissolve">溶解</option>
            </select>
          </div>
          <div>
            <label className="text-gray-500 text-[9px] block mb-0.5">Ken Burns</label>
            <select className="input-dark w-full text-[10px]" value={kenBurns} onChange={e => setKenBurns(e.target.value)}>
              <option value="zoomin">放大</option><option value="zoomout">缩小</option>
              <option value="panleft">左移</option><option value="panright">右移</option><option value="random">随机</option><option value="none">静态</option>
            </select>
          </div>
          <div>
            <label className="text-gray-500 text-[9px] block mb-0.5">时长</label>
            <input type="number" className="input-dark w-full text-[10px]" value={duration || shots.reduce((a,s)=>a+s.duration,0)}
              onChange={e => setDuration(Number(e.target.value) || 0)} min={5} max={120} />
          </div>
          <div>
            <label className="text-gray-500 text-[9px] block mb-0.5">转场秒数</label>
            <input type="number" step={0.1} className="input-dark w-full text-[10px]" value={transitionDur}
              onChange={e => setTransitionDur(Number(e.target.value) || 0.3)} min={0.3} max={2} />
          </div>
          <div>
            <label className="text-gray-500 text-[9px] block mb-0.5">色调</label>
            <select className="input-dark w-full text-[10px]" value={colorFilter} onChange={e => setColorFilter(e.target.value)}>
              <option value="">原色</option><option value="warm">暖色</option><option value="cool">冷色</option><option value="bw">黑白</option>
            </select>
          </div>
          <div>
            <label className="text-gray-500 text-[9px] block mb-0.5">比例</label>
            <select className="input-dark w-full text-[10px]" value="9:16" onChange={()=>{}}>
              <option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option>
            </select>
          </div>
        </div>
      )}

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
                <div className="aspect-[9/16] bg-black/30 rounded mb-1.5 flex items-center justify-center overflow-hidden relative"
                  onMouseMove={e => {
                    if (!dragTypeRef.current) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100)
                    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100)
                    const cx = Math.min(95, Math.max(5, x)), cy = Math.min(95, Math.max(5, y))
                    if (dragTypeRef.current === 'sticker') {
                      setShots(prev => prev.map(s => s.id === shot.id ? { ...s, stickerPosX: cx, stickerPosY: cy, stickerOn: true } : s))
                    } else if (dragTypeRef.current === 'title') {
                      setShots(prev => prev.map(s => s.id === shot.id ? { ...s, titlePosX: cx, titlePosY: cy, titleOn: true } : s))
                    }
                  }}
                  onMouseUp={() => { dragTypeRef.current = null }}
                  onMouseLeave={() => { dragTypeRef.current = null }}
                >
                  {shot.mediaThumb ? (
                    <img src={shot.mediaThumb} className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <span className="text-gray-600 text-xl">📷</span>
                  )}
                  {/* 标题位置点（可拖动）*/}
                  {shot.titleOn && (
                    <div className="absolute cursor-grab active:cursor-grabbing z-10 select-none"
                      style={{ left: `${shot.titlePosX}%`, top: `${shot.titlePosY}%`, transform: 'translate(-50%,-50%)' }}
                      onMouseDown={e => { e.stopPropagation(); dragTypeRef.current = 'title' }}>
                      <span className="text-[8px] bg-yellow-500/80 text-white px-1 py-0.5 rounded whitespace-nowrap">
                        📝{shot.titleText || '标题'}
                      </span>
                    </div>
                  )}
                  {/* 贴纸位置点（可拖动）*/}
                  {shot.stickerOn && (
                    <div className="absolute cursor-grab active:cursor-grabbing z-10 select-none"
                      style={{ left: `${shot.stickerPosX}%`, top: `${shot.stickerPosY}%`, transform: 'translate(-50%,-50%)' }}
                      onMouseDown={e => { e.stopPropagation(); dragTypeRef.current = 'sticker' }}>
                      <span className="text-[8px] bg-pink-500/80 text-white px-1 py-0.5 rounded whitespace-nowrap">
                        🏷{shot.stickerText || '贴纸'}
                      </span>
                    </div>
                  )}
                  {(!shot.stickerOn && !shot.titleOn) && (
                    <p className="absolute bottom-0.5 right-1 text-[6px] text-white/40">开启贴纸/标题后可拖放</p>
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
                <div className="space-y-1.5">
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
                  <div className="flex gap-1">
                    <span className="text-[9px] text-gray-600 w-10">X:</span>
                    <input type="range" min={5} max={95} value={shot.titlePosX}
                      onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, titlePosX: Number(e.target.value) } : s))}
                      className="w-full accent-yellow-500 h-1" />
                    <span className="text-[9px] text-yellow-400 w-8">{shot.titlePosX}%</span>
                  </div>
                  <div className="flex gap-1">
                    <span className="text-[9px] text-gray-600 w-10">Y:</span>
                    <input type="range" min={5} max={95} value={shot.titlePosY}
                      onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, titlePosY: Number(e.target.value) } : s))}
                      className="w-full accent-yellow-500 h-1" />
                    <span className="text-[9px] text-yellow-400 w-8">{shot.titlePosY}%</span>
                  </div>
                  <p className="text-[7px] text-gray-600">或在分镜预览图上直接拖动 📝标题</p>
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
                <div>
                  <div className="flex gap-2 mb-1">
                    <input className="input-dark text-xs flex-1" placeholder="如：好可爱啊" maxLength={8}
                      value={shot.stickerText}
                      onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, stickerText: e.target.value } : s))} />
                  </div>
                  <div className="flex gap-1">
                    <span className="text-[9px] text-gray-600 w-10">X:</span>
                    <input type="range" min={5} max={95} value={shot.stickerPosX}
                      onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, stickerPosX: Number(e.target.value) } : s))}
                      className="w-full accent-pink-500 h-1" />
                    <span className="text-[9px] text-pink-400 w-8">{shot.stickerPosX}%</span>
                  </div>
                  <div className="flex gap-1">
                    <span className="text-[9px] text-gray-600 w-10">Y:</span>
                    <input type="range" min={5} max={95} value={shot.stickerPosY}
                      onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, stickerPosY: Number(e.target.value) } : s))}
                      className="w-full accent-pink-500 h-1" />
                    <span className="text-[9px] text-pink-400 w-8">{shot.stickerPosY}%</span>
                  </div>
                  <p className="text-[7px] text-gray-600 mt-0.5">或在分镜预览图上直接拖放定位</p>
                </div>
              )}
            </div>

            {/* 素材来源：搜图 + 仓库 + GIPHY + 上传 */}
            <div className="border-t border-white/10 pt-2 mb-2">
              <label className="text-[9px] text-gray-500 block mb-1">📦 素材来源</label>
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => {
                  const autoKw = localKeywords[idx] || aiKeywords[idx] || ''
                  if (autoKw) { setSearchQuery(autoKw); handleAutoSearch(autoKw) }
                  setShowMediaPanel(!showMediaPanel)
                }}
                  className="px-2 py-1 bg-blue-500/15 text-blue-400 border border-blue-500/25 rounded text-[10px] hover:bg-blue-500/25">
                  🖼 {showMediaPanel ? '收起搜图' : 'AI搜图'}
                </button>
                <button onClick={() => { loadStorageFiles(); setShowStorageDlg(true) }}
                  className="px-2 py-1 bg-purple-500/15 text-purple-400 border border-purple-500/25 rounded text-[10px] hover:bg-purple-500/25">
                  📦 仓库
                </button>
                <button onClick={() => document.getElementById('sb_upload')?.click()}
                  className="px-2 py-1 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 rounded text-[10px] hover:bg-emerald-500/25">
                  📤 本地上传
                </button>
                <input id="sb_upload" type="file" accept="image/*,video/*" multiple className="hidden"
                  onChange={e => {
                    const files = Array.from(e.target.files || [])
                    files.forEach(f => {
                      const url = URL.createObjectURL(f)
                      const isVideo = f.type.startsWith('video/')
                      addMediaToShot(activeShot, url, url, isVideo ? 'video' : 'image')
                    })
                    if (files.length > 0) showToast(`已添加 ${files.length} 个文件到当前分镜`, 'success')
                  }} />
              </div>
            </div>

            {/* 搜图素材面板 */}
            <button onClick={() => {
              const autoKw = localKeywords[idx] || aiKeywords[idx] || ''
              if (autoKw) { setSearchQuery(autoKw); handleAutoSearch(autoKw) }
              setShowMediaPanel(!showMediaPanel)
            }}
              className="w-full py-1.5 border border-dashed border-blue-500/30 rounded text-blue-400 text-xs hover:border-blue-500/50 transition hidden">
              {showMediaPanel ? '收起' : '搜图'}
            </button>
            {showMediaPanel && (
              <div className="mt-2 pt-2 border-t border-white/10">
                <div className="flex items-center gap-1.5 mb-2">
                  <p className="text-[9px] text-blue-400 font-mono">🔍 {(localKeywords[idx] || aiKeywords[idx] || '未生成AI关键词')}</p>
                  <input className="input-dark text-xs flex-1" placeholder="换词搜索（可选）..."
                    value={searchQuery}
                    onFocus={e => e.target.select()}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAutoSearch() }} />
                  <button onClick={() => handleAutoSearch()} disabled={searching}
                    className="shrink-0 px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">{searching ? '··' : '重新搜'}</button>
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {Object.values(searchResults).flat().filter((img:any) => img.type !== 'video').slice(0, 8).map((img: any, j: number) => (
                    <div key={j} className="shrink-0 cursor-pointer rounded overflow-hidden border border-white/10 hover:border-blue-400"
                      onClick={() => addMediaToShot(activeShot, img.url, img.thumb, 'image')}>
                      <img src={img.thumb} className="w-16 h-16 object-cover" />
                    </div>
                  ))}
                  {Object.values(searchResults).flat().filter((img:any) => img.type !== 'video').length === 0 && !searching && (
                    <p className="text-[9px] text-gray-500 py-2">点击上方"重新搜"加载图片</p>
                  )}
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

      {/* 视频预览 */}
      {videoUrl && (
        <div className="card-glass p-3">
          <label className="text-xs text-emerald-400 mb-2 block">✅ 视频预览</label>
          <video controls className="w-full rounded-lg" src={videoUrl} />
          <div className="flex gap-2 mt-2">
            <a href={videoUrl} download className="flex-1 text-center py-1.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs hover:bg-blue-500/30">
              ⬇ 下载
            </a>
            <button onClick={() => {
              navigator.clipboard.writeText(window.location.origin + videoUrl)
              showToast('链接已复制', 'success')
            }} className="flex-1 py-1.5 bg-white/10 text-gray-400 rounded text-xs hover:bg-white/20">
              📋 复制链接
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
