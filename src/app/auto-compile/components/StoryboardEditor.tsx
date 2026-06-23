'use client'
import { useState } from 'react'
import { showToast } from '@/components/Toast'

interface Shot {
  id: string; mediaUrl: string; mediaThumb: string; mediaType: string
  subtitle: string; duration: number
  stickers: Array<{ src: string; position: string }>
}
type SearchResultMap = Record<number, Array<{ url: string; thumb: string; title: string; type?: string }>>

interface Props {
  text: string; setText: (v: string) => void
  genInput: string; setGenInput: (v: string) => void
  genOpen: boolean; setGenOpen: (v: boolean) => void
  genLoading: boolean; setGenLoading: (v: boolean) => void
  aiKeywords: string[]
  // 搜图
  searchQuery: string; setSearchQuery: (v: string) => void
  searching: boolean
  handleAutoSearch: (q?: string) => void
  searchResults: SearchResultMap; setSearchResults: (v: SearchResultMap) => void
  checkedImages: Array<{ url: string; title: string; type?: string }>; setCheckedImages: (v: any) => void
  materialList: any[]; setMaterialList: (v: any) => void
  // 合成
  voice: string; setVoice: (v: string) => void
  duration: number; setDuration: (v: number) => void
  subtitleSize: number; setSubtitleSize: (v: number) => void
  colorFilter: string; setColorFilter: (v: string) => void
  kenBurns: string; setKenBurns: (v: string) => void
  transition: string; setTransition: (v: string) => void
  transitionDur: number; setTransitionDur: (v: number) => void
  subtitleStyle: string; setSubtitleStyle: (v: string) => void
  bgm: any; setBgm: (v: any) => void; bgmFile: File | null; setBgmFile: (v: any) => void
  musicList: any[]; bgmPlaying: string; setBgmPlaying: (v: string) => void
  processing: boolean; setProcessing: (v: boolean) => void
  progress: number; setProgress: (v: number) => void; videoUrl: string; setVideoUrl: (v: string) => void
}

const genId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2, 10)

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

  const [shots, setShots] = useState<Shot[]>([])
  const [activeShot, setActiveShot] = useState<string | null>(null)
  const [showMediaPanel, setShowMediaPanel] = useState(false)

  // AI 生成 → 转为分镜
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
        const newShots: Shot[] = lines.map((line: string) => ({
          id: genId(),
          mediaUrl: '', mediaThumb: '', mediaType: 'image',
          subtitle: line, duration: durPerShot,
          stickers: []
        }))
        setShots(newShots)
        showToast(`已生成 ${newShots.length} 个分镜`, 'success')
        setGenInput('')
      } else {
        showToast(d.error || '生成失败', 'error')
      }
    } catch (e: any) {
      showToast('生成失败: ' + e.message, 'error')
    }
    setGenLoading(false)
  }

  // 选图放入指定分镜
  const addMediaToShot = (shotId: string, mediaUrl: string, mediaThumb: string, mediaType: string) => {
    setShots(prev => prev.map(s =>
      s.id === shotId ? { ...s, mediaUrl, mediaThumb, mediaType } : s
    ))
    showToast('已添加素材到分镜', 'success')
  }

  return (
    <div className="space-y-4">
      {/* 生成按钮 */}
      <div className="flex gap-2 items-center">
        <button onClick={handleAIGenerate} disabled={genLoading || genInput.length < 5}
          className="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm disabled:opacity-40">
          {genLoading ? '⏳ AI导演中...' : '🎬 AI导演 — 生成分镜'}
        </button>
        {shots.length > 0 && <span className="text-xs text-gray-500">{shots.length} 个分镜</span>}
      </div>

      {/* 分镜卡片 */}
      {shots.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          {shots.map((shot, idx) => (
            <div key={shot.id}
              onClick={() => setActiveShot(activeShot === shot.id ? null : shot.id)}
              className={`relative rounded-xl p-2 cursor-pointer border-2 transition ${activeShot === shot.id ? 'border-orange-400 bg-orange-500/10' : 'border-white/10 bg-white/5 hover:border-white/30'}`}
            >
              <div className="aspect-[9/16] bg-black/30 rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                {shot.mediaThumb ? (
                  <img src={shot.mediaThumb} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-gray-600 text-2xl">📷</span>
                )}
              </div>
              <p className="text-[9px] text-gray-400 line-clamp-2 mb-1">{shot.subtitle}</p>
              <div className="flex items-center justify-between text-[8px]">
                <span className="text-gray-600">{shot.duration}s</span>
                <span className="text-gray-600">#{idx + 1}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 编辑面板 */}
      {activeShot && (() => {
        const shot = shots.find(s => s.id === activeShot)
        if (!shot) return null
        return (
          <div className="card-glass p-4 border border-orange-500/30">
            <h4 className="text-xs text-orange-400 mb-3">✏️ 编辑分镜 #{shots.findIndex(s => s.id === activeShot) + 1}</h4>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="text-gray-500 text-[10px] block mb-1">字幕文案</label>
                <input className="input-dark w-full text-xs" value={shot.subtitle}
                  onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, subtitle: e.target.value } : s))} />
              </div>
              <div>
                <label className="text-gray-500 text-[10px] block mb-1">时长 (秒)</label>
                <input type="number" className="input-dark w-full text-xs" value={shot.duration}
                  onChange={e => setShots(prev => prev.map(s => s.id === activeShot ? { ...s, duration: Number(e.target.value) || 3 } : s))}
                  min={1} max={30} />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setShowMediaPanel(!showMediaPanel)}
                className="px-3 py-1.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs">
                🖼 {showMediaPanel ? '收起素材' : '添加素材'}
              </button>
              <button onClick={() => setActiveShot(null)}
                className="px-3 py-1.5 bg-white/10 text-gray-400 rounded text-xs">关闭</button>
            </div>

            {/* 搜图素材面板 */}
            {showMediaPanel && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <div className="flex gap-1.5 mb-2">
                  <input className="input-dark text-xs flex-1" placeholder="搜索图片/视频..."
                    value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAutoSearch() }} />
                  <button onClick={() => handleAutoSearch()} disabled={searching}
                    className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">{searching ? '...' : '搜索'}</button>
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {Object.values(searchResults).flat().slice(0, 8).map((img: any, j: number) => (
                    <div key={j} className="shrink-0 cursor-pointer rounded overflow-hidden border border-white/10 hover:border-blue-400"
                      onClick={() => addMediaToShot(activeShot, img.url, img.thumb, img.type || 'image')}>
                      <img src={img.thumb || img.url} className="w-16 h-16 object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* 空状态 */}
      {shots.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">点击 AI导演 生成分镜脚本</p>
          <p className="text-gray-600 text-xs mt-1">每条文案自动转为独立分镜，可分别配图编辑</p>
        </div>
      )}
    </div>
  )
}
