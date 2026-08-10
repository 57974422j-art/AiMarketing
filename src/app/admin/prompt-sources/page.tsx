'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface PromptSource {
  id: number; name: string; url: string; homepage?: string | null
  enabled: boolean; intervalMin: number; lastSyncAt?: string | null
  lastStatus: string; lastError?: string | null; itemCount: number; builtIn: boolean
}

const INTERVAL_OPTIONS = [
  { v: 0, label: '手动（不自动）' },
  { v: 30, label: '每 30 分钟' },
  { v: 60, label: '每 1 小时' },
  { v: 360, label: '每 6 小时' },
  { v: 1440, label: '每天' },
]

export default function PromptSourcesPage() {
  const router = useRouter()
  const [list, setList] = useState<PromptSource[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [refreshingId, setRefreshingId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', url: '', homepage: '', intervalMin: 30 })

  const load = useCallback(() => {
    fetch('/api/admin/prompt-sources', { credentials: 'include' })
      .then(r => r.json()).then(d => setList(Array.isArray(d?.data?.list) ? d.data.list : []))
      .catch(() => setList([])).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: any) => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/prompt-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), credentials: 'include' })
      const d = await r.json()
      if (!d.success) alert(d.message || '操作失败')
      return d
    } finally { setBusy(false) }
  }

  const toggleEnabled = async (s: PromptSource) => {
    await post({ action: 'update', id: s.id, enabled: !s.enabled })
    load()
  }
  const changeInterval = async (s: PromptSource, v: number) => {
    await post({ action: 'update', id: s.id, intervalMin: v })
    load()
  }
  const refreshOne = async (s: PromptSource) => {
    setRefreshingId(s.id)
    try { await post({ action: 'refresh', id: s.id }) } finally { setRefreshingId(null) }
    load()
  }
  const migrateCovers = async () => {
    if (!confirm('将未转存的封面图下载并存储到我们 OSS（后台执行，约几分钟）？')) return
    setBusy(true)
    try {
      const r = await fetch('/api/admin/prompt-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'migrate-covers' }), credentials: 'include' })
      const d = await r.json()
      alert(d.message || '已开始')
    } finally { setBusy(false) }
  }
  const refreshAll = async () => {
    setBusy(true)
    try { await post({ action: 'sync-all' }) } finally { setBusy(false) }
    load()
  }
  const saveForm = async () => {
    const r = await post(editId ? { action: 'update', id: editId, name: form.name, url: form.url, homepage: form.homepage, intervalMin: form.intervalMin }
      : { action: 'add', name: form.name, url: form.url, homepage: form.homepage, intervalMin: form.intervalMin })
    if (r?.success) { setShowAdd(false); setEditId(null); setForm({ name: '', url: '', homepage: '', intervalMin: 30 }); load() }
  }
  const remove = async (s: PromptSource) => {
    if (!confirm(`删除源「${s.name}」？（已同步的提示词保留在库中）`)) return
    await post({ action: 'delete', id: s.id })
    load()
  }
  const startEdit = (s: PromptSource) => {
    setEditId(s.id); setForm({ name: s.name, url: s.url, homepage: s.homepage || '', intervalMin: s.intervalMin }); setShowAdd(true)
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white">
      <header className="border-b border-white/10 bg-[#0a0e17]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3 flex-wrap">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-white text-sm">← 返回</button>
          <h1 className="text-lg font-semibold">📚 提示词源管理</h1>
          <span className="text-xs text-gray-500">开源提示词仓库 · 定时自动拉取入库 · 与 canvas.best 同源</span>
          <div className="flex-1" />
          <button onClick={refreshAll} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs hover:bg-violet-500/30 disabled:opacity-50">
            {busy ? '同步中…' : '🔄 全部同步'}
          </button>
          <button onClick={migrateCovers} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs hover:bg-amber-500/25 disabled:opacity-50">
            ⬇️ 补转封面到 OSS
          </button>
          <button onClick={() => { setEditId(null); setForm({ name: '', url: '', homepage: '', intervalMin: 30 }); setShowAdd(true) }}
            className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs hover:bg-emerald-600">＋ 添加源</button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="text-[11px] text-gray-500 mb-4">
          💡 每个源可独立设置「自动拉取间隔」（0 = 手动）。服务端每 5 分钟检查一次，到点自动拉取（需服务端进程常驻）。同步进同一个 PromptTemplate 库，用 sourceKey 去重。
        </div>

        {loading ? <div className="text-gray-500 text-center py-16">加载中…</div> : (
          <div className="grid md:grid-cols-2 gap-3">
            {list.map(s => (
              <div key={s.id} className={`rounded-xl border p-4 transition-all ${s.lastStatus === 'error' ? 'border-red-500/40 bg-red-500/[0.04]' : 'border-white/10 bg-white/[0.04]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm truncate">{s.name}</span>
                    {s.builtIn && <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] bg-violet-500/20 text-violet-300 border border-violet-500/30">内置</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${s.lastStatus === 'success' ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : s.lastStatus === 'error' ? 'border-red-500/40 text-red-300 bg-red-500/10' : 'border-gray-500/40 text-gray-400 bg-gray-500/10'}`}>
                      {s.lastStatus === 'success' ? '✅ 正常' : s.lastStatus === 'error' ? '❌ 异常' : '○ 未同步'}
                    </span>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={s.enabled} onChange={() => toggleEnabled(s)} className="accent-violet-500 w-3.5 h-3.5" />
                      <span className="text-[10px] text-gray-500">启用</span>
                    </label>
                  </div>
                </div>

                <div className="mt-2 text-[11px] text-gray-500 flex items-center gap-3 flex-wrap">
                  <span className="text-violet-300 font-mono">{s.itemCount} 条</span>
                  {s.lastSyncAt && <span>上次成功 {new Date(s.lastSyncAt).toLocaleString('zh-CN')}</span>}
                  {s.homepage && <a href={s.homepage} target="_blank" rel="noreferrer" className="text-cyan-400/70 hover:text-cyan-300">主页 ↗</a>}
                </div>
                {s.lastError && <div className="mt-1 text-[10px] text-red-400">{s.lastError}</div>}
                <div className="mt-1 text-[10px] text-gray-600 truncate" title={s.url}>{s.url}</div>

                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <select value={s.intervalMin} onChange={e => changeInterval(s, parseInt(e.target.value) || 0)}
                    className="bg-white/5 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white">
                    {INTERVAL_OPTIONS.map(o => <option key={o.v} value={o.v} className="bg-gray-900">{o.label}</option>)}
                  </select>
                  <button onClick={() => refreshOne(s)} disabled={refreshingId === s.id}
                    className="px-2 py-1 rounded bg-white/10 text-[10px] text-gray-300 hover:bg-white/20 disabled:opacity-40">
                    {refreshingId === s.id ? '刷新中…' : '🔁 刷新'}
                  </button>
                  <button onClick={() => router.push(`/admin/prompt-templates?source=${encodeURIComponent(s.name)}`)}
                    className="px-2 py-1 rounded bg-white/10 text-[10px] text-gray-300 hover:bg-white/20">👁 查看内容</button>
                  <div className="flex-1" />
                  <button onClick={() => startEdit(s)} className="px-2 py-1 rounded bg-white/10 text-[10px] text-gray-300 hover:bg-white/20">✏️</button>
                  {!s.builtIn && <button onClick={() => remove(s)} className="px-2 py-1 rounded bg-red-500/20 text-[10px] text-red-300 hover:bg-red-500/30">🗑</button>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 添加/编辑抽屉 */}
        {showAdd && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center" onClick={() => setShowAdd(false)}>
            <div className="w-[460px] max-w-[92vw] rounded-2xl border border-white/15 bg-[#11131c] p-5" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold mb-4">{editId ? '✏️ 编辑源' : '＋ 添加提示词源'}</h3>
              <label className="block text-[10px] text-gray-400 mb-1">名称</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs mb-3 outline-none focus:border-violet-400/50" placeholder="如：My Prompt Source" />
              <label className="block text-[10px] text-gray-400 mb-1">JSON 地址（拉取源）</label>
              <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono mb-3 outline-none focus:border-violet-400/50" placeholder="https://cdn.jsdelivr.net/gh/.../source.json" />
              <label className="block text-[10px] text-gray-400 mb-1">主页（可选）</label>
              <input value={form.homepage} onChange={e => setForm({ ...form, homepage: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs mb-3 outline-none focus:border-violet-400/50" placeholder="https://..." />
              <label className="block text-[10px] text-gray-400 mb-1">自动拉取间隔</label>
              <select value={form.intervalMin} onChange={e => setForm({ ...form, intervalMin: parseInt(e.target.value) || 0 })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs mb-4">
                {INTERVAL_OPTIONS.map(o => <option key={o.v} value={o.v} className="bg-gray-900">{o.label}</option>)}
              </select>
              <div className="flex gap-2">
                <button onClick={() => setShowAdd(false)} className="flex-1 rounded-lg bg-white/[0.06] py-2 text-xs text-gray-400 hover:bg-white/10">取消</button>
                <button onClick={saveForm} disabled={busy} className="flex-1 rounded-lg bg-violet-500/20 py-2 text-xs text-violet-300 hover:bg-violet-500/30 disabled:opacity-40">
                  {busy ? '处理中…' : editId ? '保存' : '添加并立即同步'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
