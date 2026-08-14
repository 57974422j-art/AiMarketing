'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/app/providers'

interface MusicItem {
  id: number
  title: string
  ossUrl: string
  prompt: string
  source: string
  createdAt: string
}

export default function MusicLibraryPage() {
  const { user } = useAuth()
  const [prompt, setPrompt] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [genMsg, setGenMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [mine, setMine] = useState<MusicItem[]>([])
  const [pub, setPub] = useState<MusicItem[]>([])
  const [playing, setPlaying] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/music/library', { credentials: 'include' })
      const d = await r.json()
      if (d.success) { setMine(d.data.mine || []); setPub(d.data.public || []) }
    } catch {}
  }, [])
  useEffect(() => { load() }, [load])

  const gen = async () => {
    const p = prompt.trim()
    if (!p) { setGenMsg({ type: 'error', text: '请输入音乐风格描述' }); return }
    setGenBusy(true); setGenMsg({ type: 'success', text: 'AI 生成中（约 30-90 秒）…' })
    try {
      const r = await fetch('/api/music/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p }),
      })
      const d = await r.json()
      if (d.success) {
        setGenMsg({ type: 'success', text: '✅ 生成成功，已存入音乐库' })
        setPrompt('')
        load()
      } else {
        setGenMsg({ type: 'error', text: d.message || '生成失败' })
      }
    } catch { setGenMsg({ type: 'error', text: '生成失败（网络/服务异常）' }) }
    finally { setGenBusy(false) }
  }

  const togglePlay = (item: MusicItem) => {
    if (playing === item.id) { audioRef.current?.pause(); audioRef.current = null; setPlaying(null); return }
    audioRef.current?.pause()
    const a = new Audio(item.ossUrl)
    a.onended = () => { setPlaying(null); audioRef.current = null }
    a.play().catch(() => {})
    audioRef.current = a
    setPlaying(item.id)
  }

  const togglePublic = async (item: MusicItem) => {
    const next = item.source !== 'public'
    await fetch('/api/music/library', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, isPublic: next }),
    })
    load()
  }

  const del = async (item: MusicItem) => {
    if (!confirm(`删除音乐「${item.prompt || item.title}」？`)) return
    await fetch(`/api/music/library?id=${item.id}`, { method: 'DELETE', credentials: 'include' })
    load()
  }

  const ItemRow = ({ item, isPublicRow = false }: { item: MusicItem; isPublicRow?: boolean }) => (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 flex items-center gap-3">
      <button onClick={() => togglePlay(item)} className="shrink-0 w-10 h-10 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 text-sm">
        {playing === item.id ? '⏸' : '▶'}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-200 truncate">{item.prompt || '未命名音乐'}</p>
        <p className="text-[10px] text-gray-500 font-mono truncate mt-0.5">{item.title}</p>
        <p className="text-[10px] text-gray-600 mt-0.5">{new Date(item.createdAt).toLocaleString('zh-CN')}</p>
      </div>
      {!isPublicRow && user?.role === 'admin' && (
        <button onClick={() => togglePublic(item)} className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20">
          {item.source === 'public' ? '🔓 取消公开' : '🌐 设为公开'}
        </button>
      )}
      {!isPublicRow && (
        <button onClick={() => del(item)} className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20">删除</button>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0a0f1c] text-white p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-mono tracking-[0.2em]">🎵 音乐库 / MUSIC LIBRARY</h1>
            <p className="text-xs text-gray-500 mt-1">Minimax AI 生成背景音乐 · 试听 / 设公开 / 一键成片选用</p>
          </div>
        </div>

        {/* 生成区 */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 mb-6">
          <div className="flex gap-2">
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="AI 生成背景乐：如 欢快的电子音乐 / 舒缓钢琴 / 电影感史诗"
              className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 outline-none focus:border-cyan-500/40" />
            <button onClick={gen} disabled={genBusy}
              className="px-4 py-2 rounded-lg text-sm bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-50 disabled:cursor-wait">
              {genBusy ? '生成中…' : '🎼 AI 生成'}
            </button>
          </div>
          {genMsg && <p className={`mt-2 text-xs ${genMsg.type === 'success' ? 'text-emerald-400' : 'text-amber-400'}`}>{genMsg.text}</p>}
        </div>

        {/* 我的音乐 */}
        <h2 className="text-xs text-gray-400 font-mono mb-2">我的音乐（{mine.length}）</h2>
        <div className="space-y-2 mb-8">
          {mine.length === 0 && <p className="text-xs text-gray-600">还没有生成音乐——输入描述点「AI 生成」</p>}
          {mine.map((it) => <ItemRow key={it.id} item={it} />)}
        </div>

        {/* 公共音乐库（一键成片 BGM） */}
        <h2 className="text-xs text-gray-400 font-mono mb-2">公共音乐库（一键成片 BGM · {pub.length}）</h2>
        <div className="space-y-2">
          {pub.length === 0 && <p className="text-xs text-gray-600">暂无公共音乐——admin 生成后点「设为公开」即可供一键成片选用</p>}
          {pub.map((it) => <ItemRow key={it.id} item={it} isPublicRow />)}
        </div>
      </div>
    </div>
  )
}
