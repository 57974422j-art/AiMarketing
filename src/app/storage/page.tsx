'use client'
import { useState, useEffect, useRef } from 'react'
import { showToast } from '@/components/Toast'

interface FileInfo { name: string; size: number; mtime: string }
interface Quota { used: number; total: number }

export default function StoragePage() {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [quota, setQuota] = useState<Quota>({ used: 0, total: 500 * 1024 * 1024 })
  const [loading, setLoading] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/storage/files')
      const d = await r.json()
      if (d.success) { setFiles(d.data.files); setQuota({ used: d.data.used, total: d.data.total }) }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const upload = async () => {
    const f = fileRef.current?.files?.[0]
    if (!f) return
    if (quota.used + f.size > quota.total) { showToast('空间不足', 'error'); return }
    const fd = new FormData(); fd.append('file', f)
    try {
      const r = await fetch('/api/storage/files', { method: 'POST', body: fd })
      const d = await r.json()
      if (d.success) { showToast('上传成功', 'success'); load() }
      else showToast(d.message || '上传失败', 'error')
    } catch { showToast('上传失败', 'error') }
  }

  const del = async (name: string) => {
    try {
      const r = await fetch('/api/storage/delete', { method: 'DELETE', body: JSON.stringify({ name }), headers: { 'Content-Type': 'application/json' } })
      const d = await r.json()
      if (d.success) { showToast('已删除', 'success'); load() }
    } catch {}
  }

  const pct = Math.round(quota.used / quota.total * 100)
  const fmt = (b: number) => (b / 1024 / 1024).toFixed(1) + 'MB'

  return (
    <div className="min-h-screen bg-gray-950 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">素材仓库</h1>
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={upload} />
          <button onClick={() => fileRef.current?.click()} className="px-4 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs hover:bg-emerald-500/30">+ 上传</button>
        </div>

        {/* Quota bar */}
        <div className="card-glass p-3 mb-4">
          <div className="flex justify-between text-[10px] text-gray-400 mb-1">
            <span>存储空间</span>
            <span>{fmt(quota.used)} / {fmt(quota.total)} ({pct}%)</span>
          </div>
          <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500/60 rounded-full transition-all" style={{ width: Math.min(pct, 100) + '%' }} />
          </div>
          {pct >= 90 && <p className="text-[10px] text-red-400 mt-1">空间即将用满，请清理或联系管理员</p>}
        </div>

        {loading ? <p className="text-gray-400 text-xs">加载中...</p> : files.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-10">暂无文件，上传你的第一个素材吧</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {files.map(f => (
              <div key={f.name} className="card-glass p-2 rounded-lg relative group">
                <div className="aspect-video bg-white/5 rounded mb-1 flex items-center justify-center text-gray-600 text-[10px]">
                  {f.name.endsWith('.mp4') ? '🎬' : '🖼️'}
                </div>
                <p className="text-[10px] text-gray-300 truncate cursor-pointer" onClick={()=>{const u="/api/storage/file?name="+encodeURIComponent(f.name);window.open(u,'_blank')}}>{f.name}</p>
                <p className="text-[9px] text-gray-500">{fmt(f.size)}</p>
                <button onClick={() => del(f.name)} className="absolute top-1 right-1 w-5 h-5 bg-red-500/80 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
