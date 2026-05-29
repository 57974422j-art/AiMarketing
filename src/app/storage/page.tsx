'use client'
import { useState, useEffect, useRef } from 'react'
import { showToast } from '@/components/Toast'

interface FileInfo { name: string; size: number; mtime: string; isVideo?: boolean; thumbUrl?: string | null }
interface Quota { used: number; total: number }

export default function StoragePage() {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [quota, setQuota] = useState<Quota>({ used: 0, total: 500 * 1024 * 1024 })
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<number>(0)
  const [pushFile, setPushFile] = useState<string | null>(null)
  const [pushLoading, setPushLoading] = useState(false)
  const [showPushDlg, setShowPushDlg] = useState(false)
  const [clients, setClients] = useState<any[]>([])
  const [pushClient, setPushClient] = useState<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/storage/files')
      const d = await r.json()
      if (d.success) { setFiles(d.data.files); setQuota({ used: d.data.used, total: d.data.total }); setUserId(d.data.userId) }
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

  const doPush = async () => {
    if (!pushFile || !pushClient) return
    setPushLoading(true)
    try {
      const r = await fetch('/api/video/push-to-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: pushFile, endUserId: pushClient.id, remark: pushClient.name || pushClient.username }),
      })
      const d = await r.json()
      if (d.success) showToast(`已推送 ${d.data.pushed}/${d.data.total} 台设备`, 'success')
      else showToast(d.message || '推送失败', 'error')
    } catch { showToast('推送失败', 'error') }
    finally { setShowPushDlg(false); setPushFile(null); setPushClient(null); setPushLoading(false) }
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
                {/* 缩略图 */}
                <div className="aspect-video bg-white/5 rounded mb-1 overflow-hidden flex items-center justify-center">
                  {f.thumbUrl ? (
                    <img src={f.thumbUrl} alt={f.name} className="w-full h-full object-cover" />
                  ) : !f.isVideo && /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name) ? (
                    <img src={`/api/storage/file?userId=${userId}&name=${encodeURIComponent(f.name)}`} alt={f.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl">{f.isVideo ? '🎬' : '📄'}</span>
                  )}
                </div>
                <p className="text-[10px] text-gray-300 truncate cursor-pointer" onClick={()=>{window.open('/api/storage/file?userId='+userId+'&name='+encodeURIComponent(f.name),'_blank')}}>{f.name}</p>
                <p className="text-[9px] text-gray-500">{fmt(f.size)}</p>
                <div className="flex gap-1 mt-1">
                  {f.isVideo && (
                    <button onClick={async () => {
                      setPushFile(f.name)
                      const r = await fetch('/api/clients', { credentials: 'include' })
                      const d = await r.json()
                      if (d.success) { setClients(d.data); setShowPushDlg(true) }
                      else showToast('获取客户列表失败', 'error')
                    }} className="flex-1 text-[9px] py-1 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30">📤 推送</button>
                  )}
                  <button onClick={() => del(f.name)} className="w-6 h-6 bg-red-500/80 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition">×</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showPushDlg && <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={()=>{setShowPushDlg(false);setPushFile(null);setPushClient(null)}}>
          <div className="card-glass p-6 rounded-xl max-w-sm w-full mx-4" onClick={e=>e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-3">选择推送客户</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
              {clients.map((cl: any) => (
                <button key={cl.id} onClick={()=>setPushClient(cl)}
                  className={`w-full text-left p-3 rounded-lg border text-xs transition ${pushClient?.id===cl.id?"bg-emerald-500/20 border-emerald-500/30 text-emerald-400":"bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"}`}>
                  {cl.name||cl.username} <span className="text-gray-500 ml-1">(#{cl.id})</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={()=>{setShowPushDlg(false);setPushFile(null);setPushClient(null)}} className="flex-1 py-2 bg-white/5 text-gray-400 rounded-lg text-xs">取消</button>
              <button disabled={!pushClient||pushLoading} onClick={doPush}
                className={`flex-1 py-2 rounded-lg text-xs ${pushClient&&!pushLoading?"bg-emerald-500/20 text-emerald-400 border border-emerald-500/30":"bg-white/5 text-gray-500"}`}>
                {pushLoading?'推送中...':'确认推送'}
              </button>
            </div>
          </div>
        </div>}
      </div>
    </div>
  )
}
