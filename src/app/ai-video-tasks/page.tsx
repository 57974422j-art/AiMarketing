('use client')

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/app/providers'

interface Shot {
  shot: number; desc: string; prompt: string; duration: number; camera: string
  status: 'pending' | 'generating' | 'done' | 'failed'; videoUrl?: string | null; error?: string | null
}
interface Task {
  id: number; title: string; topic: string; status: string; doneShots: number; totalShots: number
  costPoints: number; videoUrl?: string | null; duration: number; ratio: string; createdAt: string; userId: number
}
interface TaskDetail extends Task { shots: Shot[]; style?: string | null; error?: string | null }

const STATUS_ICON: Record<string, string> = { pending: '⏳', generating: '🔄', done: '✅', failed: '❌' }
const STATUS_TEXT: Record<string, string> = { pending: '排队', generating: '生成中', done: '完成', failed: '失败' }
const STATUS_CLS: Record<string, string> = {
  pending: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  generating: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
  done: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  failed: 'bg-red-500/15 text-red-300 border-red-500/40',
}

export default function AiVideoTasksPage() {
  const router = useRouter()
  const sp = useSearchParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const activeId = parseInt(sp.get('id') || '0') || null
  const [list, setList] = useState<Task[]>([])
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ shot: number; prompt: string; desc: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const loadList = useCallback(() => {
    fetch('/api/agent/storyboard?list=1', { credentials: 'include' })
      .then(r => r.json()).then(d => setList(Array.isArray(d?.data?.list) ? d.data.list : []))
      .catch(() => setList([])).finally(() => setLoading(false))
  }, [])

  const loadDetail = useCallback(() => {
    if (!activeId) return
    fetch(`/api/agent/storyboard?id=${activeId}`, { credentials: 'include' })
      .then(r => r.json()).then(d => setDetail(d?.data || null)).catch(() => setDetail(null))
  }, [activeId])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => {
    if (activeId) { loadDetail(); const t = setInterval(loadDetail, 4000); return () => clearInterval(t) }
  }, [activeId, loadDetail])

  const retryShot = async (shot: number) => {
    setBusy(true)
    try {
      await fetch('/api/agent/storyboard/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeId, shot }), credentials: 'include' })
      setTimeout(loadDetail, 1500)
    } finally { setBusy(false) }
  }

  const saveShot = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await fetch('/api/agent/storyboard', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeId, shot: editing.shot, prompt: editing.prompt, desc: editing.desc }), credentials: 'include' })
      setEditing(null)
      setTimeout(loadDetail, 1500)
    } finally { setBusy(false) }
  }

  const totalPct = detail && detail.totalShots > 0 ? Math.round((detail.doneShots / detail.totalShots) * 100) : 0

  // 列表视图（无 activeId）
  if (!activeId) {
    return (
      <div className="min-h-screen bg-[#0a0e17] text-white">
        <header className="border-b border-white/10 bg-[#0a0e17]/80 backdrop-blur sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3 flex-wrap">
            <button onClick={() => router.back()} className="text-gray-400 hover:text-white text-sm">← 返回</button>
            <h1 className="text-lg font-semibold">🎬 AI 分镜成片任务</h1>
            <span className="text-xs text-gray-500">{isAdmin ? '管理员视图（全部用户）' : '我的任务'} · 对话里说「帮我做个30秒视频」即可创建</span>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">
          {loading ? <div className="text-gray-500 text-center py-16">加载中…</div>
            : list.length === 0 ? <div className="text-gray-500 text-center py-16">还没有分镜任务 —— 去对话里说「帮我做个 30 秒的视频」</div>
            : <div className="grid md:grid-cols-2 gap-3">
              {list.map(t => {
                const pct = t.totalShots > 0 ? Math.round((t.doneShots / t.totalShots) * 100) : 0
                return (
                  <div key={t.id} onClick={() => router.push(`/ai-video-tasks?id=${t.id}`)}
                    className="cursor-pointer rounded-xl border border-white/10 bg-white/[0.04] p-4 hover:border-emerald-400/40 hover:bg-white/[0.07] transition-all">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm truncate">{t.title}</div>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] border ${t.status === 'done' ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : t.status === 'failed' ? 'border-red-500/40 text-red-300 bg-red-500/10' : 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10'}`}>
                        {t.status === 'done' ? '✅ 完成' : t.status === 'failed' ? '❌ 失败' : t.status === 'generating' ? '🔄 生成中' : '⏳ 排队'}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500">{t.duration}秒 · {t.ratio} · {t.costPoints}点</div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${t.status === 'done' ? 'bg-emerald-400' : t.status === 'failed' ? 'bg-red-400' : 'bg-cyan-400'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-400">{t.doneShots}/{t.totalShots}</span>
                    </div>
                    <div className="mt-2 text-[10px] text-gray-600">{new Date(t.createdAt).toLocaleString('zh-CN')}</div>
                  </div>
                )
              })}
            </div>}
        </main>
      </div>
    )
  }

  // 详情视图：分镜节点链
  return (
    <div className="min-h-screen bg-[#0a0e17] text-white">
      <header className="border-b border-white/10 bg-[#0a0e17]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3 flex-wrap">
          <button onClick={() => router.push('/ai-video-tasks')} className="text-gray-400 hover:text-white text-sm">← 任务列表</button>
          <h1 className="text-lg font-semibold">🎬 分镜任务 #{activeId}</h1>
          {detail && <span className={`text-xs px-2 py-0.5 rounded-full border ${detail.status === 'done' ? 'border-emerald-500/40 text-emerald-300' : detail.status === 'failed' ? 'border-red-500/40 text-red-300' : 'border-cyan-500/40 text-cyan-300'}`}>
            {detail.status === 'done' ? '✅ 已完成' : detail.status === 'failed' ? '❌ 有失败镜' : '🔄 生成中'}
          </span>}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {!detail ? <div className="text-gray-500 text-center py-16">加载中…</div> : (
          <>
            {/* 任务头 */}
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 mb-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="font-medium">{detail.title}</div>
                  <div className="text-[11px] text-gray-500 mt-1">{detail.duration}秒 · {detail.ratio} · 预估 {detail.costPoints}点（约¥{(detail.costPoints / 100).toFixed(1)}）</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-40 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className={`h-full rounded-full ${detail.status === 'done' ? 'bg-emerald-400' : detail.status === 'failed' ? 'bg-red-400' : 'bg-cyan-400'}`} style={{ width: `${totalPct}%` }} />
                  </div>
                  <span className="text-xs text-gray-400">{detail.doneShots}/{detail.totalShots} 镜完成</span>
                </div>
              </div>
              {detail.error && <div className="mt-2 text-[11px] text-red-400">{detail.error}</div>}
            </div>

            {/* 成品 */}
            {detail.videoUrl && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3 mb-5">
                <div className="text-xs text-emerald-300 mb-2">🎉 成品已生成（全部镜完成自动拼接）</div>
                <video src={detail.videoUrl} controls className="w-full rounded-lg max-h-[420px] bg-black" />
              </div>
            )}

            {/* 节点链：横向滚动 */}
            <div className="flex gap-3 overflow-x-auto pb-4 items-stretch">
              {detail.shots.map((s, i) => (
                <div key={s.shot} className="flex items-center gap-3 shrink-0">
                  <div className={`w-[190px] rounded-xl border overflow-hidden bg-white/[0.04] transition-all ${s.status === 'failed' ? 'border-red-500/50 ring-2 ring-red-500/20' : s.status === 'done' ? 'border-emerald-500/40' : 'border-white/10'}`}>
                    <div className="aspect-video bg-black/40 flex items-center justify-center relative">
                      {s.videoUrl ? (
                        <video src={s.videoUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl opacity-40">{STATUS_ICON[s.status]}</span>
                      )}
                      {s.status === 'generating' && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><span className="text-2xl animate-spin">⏳</span></div>}
                      {s.status === 'failed' && <div className="absolute inset-0 bg-red-950/40 flex items-center justify-center"><span className="text-[10px] text-red-300 px-2 text-center">{s.error || '生成失败'}</span></div>}
                    </div>
                    <div className="p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">镜 {s.shot}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] border ${STATUS_CLS[s.status] || ''}`}>{STATUS_ICON[s.status]} {STATUS_TEXT[s.status]}</span>
                      </div>
                      {s.camera && <div className="mt-1 text-[9px] text-cyan-400/80">🎥 {s.camera}</div>}
                      <div className="mt-1 text-[10px] text-gray-400 line-clamp-2">{s.desc}</div>
                      <div className="mt-1 text-[9px] text-gray-600 line-clamp-3 font-mono">{s.prompt}</div>
                      <div className="mt-2 flex gap-1.5">
                        {s.videoUrl && <a href={s.videoUrl} target="_blank" rel="noreferrer" className="flex-1 text-center px-1.5 py-1 rounded bg-white/10 text-[10px] text-white hover:bg-white/20">▶️ 预览</a>}
                        {s.status === 'failed' && <button onClick={() => retryShot(s.shot)} disabled={busy} className="flex-1 px-1.5 py-1 rounded bg-amber-500/20 text-amber-300 text-[10px] hover:bg-amber-500/30 disabled:opacity-40">🔁 重试</button>}
                        <button onClick={() => setEditing({ shot: s.shot, prompt: s.prompt, desc: s.desc })} className="px-1.5 py-1 rounded bg-white/10 text-[10px] text-gray-300 hover:bg-white/20">✏️ 改</button>
                      </div>
                    </div>
                  </div>
                  {i < detail.shots.length - 1 && <div className="text-gray-600 text-lg shrink-0">→</div>}
                </div>
              ))}
            </div>

            {/* 编辑抽屉 */}
            {editing && (
              <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center" onClick={() => setEditing(null)}>
                <div className="w-[440px] max-w-[92vw] rounded-2xl border border-white/15 bg-[#11131c] p-5" onClick={e => e.stopPropagation()}>
                  <h3 className="text-sm font-semibold mb-3">✏️ 编辑分镜 {editing.shot}（保存后自动重新生成该镜）</h3>
                  <label className="block text-[10px] text-gray-400 mb-1">画面描述（中文）</label>
                  <input value={editing.desc} onChange={e => setEditing({ ...editing, desc: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs mb-3 outline-none focus:border-emerald-400/50" />
                  <label className="block text-[10px] text-gray-400 mb-1">英文 Prompt</label>
                  <textarea value={editing.prompt} onChange={e => setEditing({ ...editing, prompt: e.target.value })} rows={5}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-mono outline-none focus:border-emerald-400/50" />
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => setEditing(null)} className="flex-1 rounded-lg bg-white/[0.06] py-2 text-xs text-gray-400 hover:bg-white/10">取消</button>
                    <button onClick={saveShot} disabled={busy} className="flex-1 rounded-lg bg-emerald-500/20 py-2 text-xs text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40">保存并重新生成</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
