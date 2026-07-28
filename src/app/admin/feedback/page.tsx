'use client'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface FbUser { username: string | null; email: string | null }
interface Fb {
  id: number
  userId: number
  type: string
  content: string
  status: string
  reply: string | null
  createdAt: string
  user: FbUser
  imageUrls: string[]
}

const STATUS_LIST = ['待处理', '处理中', '已解决', '已关闭']
const STATUS_CLS: Record<string, string> = {
  '待处理': 'text-amber-400', '处理中': 'text-blue-400', '已解决': 'text-emerald-400', '已关闭': 'text-gray-500',
}

export default function AdminFeedbackPage() {
  const { user, loading: authLoading } = useAuth()
  const [authorized, setAuthorized] = useState(false)
  const [list, setList] = useState<Fb[]>([])
  const [summary, setSummary] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<Fb | null>(null)
  const [replyDraft, setReplyDraft] = useState('')

  useEffect(() => { if (!authLoading) setAuthorized(user?.role === 'admin') }, [authLoading, user])

  const load = useCallback(() => {
    if (!authorized) return
    setLoading(true)
    const params = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) })
    fetch(`/api/admin/feedback?${params.toString()}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.success) { setList(d.data.list); setTotal(d.data.total); setSummary(d.data.summary || {}) }
        else showToast(d.message, 'error')
      })
      .catch(() => showToast('加载失败', 'error'))
      .finally(() => setLoading(false))
  }, [authorized, status, page, pageSize])

  useEffect(() => { load() }, [load])

  const update = async (id: number, patch: { status?: string; reply?: string }) => {
    try {
      const r = await fetch('/api/admin/feedback', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      })
      const d = await r.json()
      if (d.success) { showToast('已更新', 'success'); setDetail(null); load() }
      else showToast(d.message, 'error')
    } catch { showToast('更新失败', 'error') }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  if (!authorized) return <div className="min-h-screen bg-gray-950 p-8 text-gray-400 text-sm">需要管理员权限</div>

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <p className="text-label mb-1">管理中心 / 问题反馈</p>
          <h1 className="text-mono-lg text-white">📮 用户反馈</h1>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {[{ key: 'all', label: '全部' }, ...STATUS_LIST.map(s => ({ key: s, label: s }))].map(t => (
            <button key={t.key} onClick={() => { setStatus(t.key); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-xs ${status === t.key ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-gray-400'}`}>
              {t.label} <span className="opacity-60">{summary[t.key] || 0}</span>
            </button>
          ))}
        </div>

        <div className="card-glass p-4">
          {loading ? <p className="text-gray-500 text-xs">加载中...</p> : list.length === 0 ? <p className="text-gray-500 text-xs">暂无反馈</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-2">#</th>
                  <th className="text-left">用户</th>
                  <th className="text-left">类型</th>
                  <th className="text-left">内容</th>
                  <th className="text-center">图片</th>
                  <th className="text-center">状态</th>
                  <th className="text-left">时间</th>
                  <th className="text-center">操作</th>
                </tr></thead>
                <tbody>
                  {list.map(fb => (
                    <tr key={fb.id} className="border-b border-white/5 text-gray-300 hover:bg-white/5">
                      <td className="py-2 font-mono text-[11px]">{fb.id}</td>
                      <td>{fb.user?.username || fb.user?.email || fb.userId}</td>
                      <td>{fb.type}</td>
                      <td className="max-w-[260px] truncate text-gray-400" title={fb.content}>{fb.content}</td>
                      <td className="text-center">{fb.imageUrls.length > 0 ? `${fb.imageUrls.length}张` : '—'}</td>
                      <td className="text-center"><span className={STATUS_CLS[fb.status] || 'text-gray-400'}>{fb.status}</span></td>
                      <td className="text-gray-500 whitespace-nowrap">{new Date(fb.createdAt).toLocaleString('zh-CN')}</td>
                      <td className="text-center">
                        <button onClick={() => { setDetail(fb); setReplyDraft(fb.reply || '') }} className="text-blue-400 hover:text-blue-300">处理</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {total > 0 && (
            <div className="flex items-center justify-between mt-4 text-xs text-gray-400">
              <span>共 {total} 条</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="px-3 py-1 rounded bg-white/5 disabled:opacity-40">上一页</button>
                <span className="px-2 py-1">{page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="px-3 py-1 rounded bg-white/5 disabled:opacity-40">下一页</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setDetail(null)}>
          <div className="card-glass max-w-lg w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">反馈 #{detail.id} · {detail.type}</h3>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <p className="text-gray-500 text-[11px] mb-1">
              {detail.user?.username || detail.user?.email} · {new Date(detail.createdAt).toLocaleString('zh-CN')}
            </p>
            <p className="text-gray-200 text-xs whitespace-pre-wrap mb-3">{detail.content}</p>
            {detail.imageUrls.length > 0 && (
              <div className="flex gap-2 mb-3 flex-wrap">
                {detail.imageUrls.map((u, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-24 h-24 object-cover rounded border border-white/10" /></a>
                ))}
              </div>
            )}
            <p className="text-gray-500 text-[11px] mb-1">回复</p>
            <textarea value={replyDraft} onChange={e => setReplyDraft(e.target.value)} rows={3}
              className="input-dark w-full text-xs p-2 rounded resize-none mb-3" placeholder="输入官方回复..." />
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {STATUS_LIST.map(s => (
                  <button key={s} onClick={() => update(detail.id, { status: s, reply: replyDraft })}
                    className={`px-2 py-1 rounded text-[11px] ${detail.status === s ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                    {s}
                  </button>
                ))}
              </div>
              <button onClick={() => update(detail.id, { reply: replyDraft })}
                className="px-4 py-1.5 rounded bg-blue-600 text-white text-xs hover:bg-blue-500">保存回复</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
