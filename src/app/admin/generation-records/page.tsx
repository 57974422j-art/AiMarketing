'use client'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface RecUser { username: string | null; email: string | null }
interface GenRecord {
  id: number
  userId: number
  type: string
  provider: string
  model: string | null
  platformTaskId: string | null
  status: string
  costPoints: number
  prompt: string | null
  platformUrl: string | null
  storageUrl: string | null
  sourceUrl: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  user: RecUser
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '进行中', cls: 'text-amber-400' },
  processing: { label: '结算中', cls: 'text-blue-400' },
  succeeded: { label: '成功', cls: 'text-emerald-400' },
  failed: { label: '失败', cls: 'text-red-400' },
}
const TYPE_LABEL: Record<string, string> = {
  text2img: '文生图', text2video: '文生视频', digital_human: '数字人',
  voice_clone: '声音克隆', voice_tts: '声音合成', ai_chat: 'AI对话', analyze_video: '视频分析',
}
const fmtTime = (t: string | null) => (t ? new Date(t).toLocaleString('zh-CN') : '—')

export default function AdminGenerationRecordsPage() {
  const { user, loading: authLoading } = useAuth()
  const [authorized, setAuthorized] = useState(false)
  const [records, setRecords] = useState<GenRecord[]>([])
  const [summary, setSummary] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [missingOss, setMissingOss] = useState(false)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<GenRecord | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => { if (!authLoading) setAuthorized(user?.role === 'admin') }, [authLoading, user])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 400)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(() => {
    if (!authorized) return
    setLoading(true)
    const params = new URLSearchParams({
      status, type, q: debouncedQ, page: String(page), pageSize: String(pageSize),
      ...(missingOss ? { missingOss: '1' } : {}),
    })
    fetch(`/api/admin/generation-records?${params.toString()}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.success) { setRecords(d.data.records); setTotal(d.data.total); setSummary(d.data.summary || {}) }
        else showToast(d.message, 'error')
      })
      .catch(() => showToast('加载失败', 'error'))
      .finally(() => setLoading(false))
  }, [authorized, status, type, missingOss, debouncedQ, page, pageSize])

  useEffect(() => { load() }, [load])

  /** OSS 签名链接（24h 有效，客服可直接发给客户兜底） */
  const openOss = async (rec: GenRecord) => {
    if (!rec.storageUrl) return
    setBusyId(rec.id)
    try {
      const r = await fetch('/api/admin/generation-records', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sign', storageUrl: rec.storageUrl }),
      })
      const d = await r.json()
      if (d.success) window.open(d.url, '_blank')
      else showToast(d.message, 'error')
    } catch { showToast('获取链接失败', 'error') } finally { setBusyId(null) }
  }

  /** 补下载：成功但没转存 OSS 的记录 */
  const redownload = async (rec: GenRecord) => {
    setBusyId(rec.id)
    try {
      const r = await fetch('/api/admin/generation-records', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redownload', recordId: rec.id }),
      })
      const d = await r.json()
      if (d.success) { showToast('已补转存 OSS', 'success'); load() }
      else showToast(d.message, 'error')
    } catch { showToast('补下载失败', 'error') } finally { setBusyId(null) }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  if (!authorized) return <div className="min-h-screen bg-gray-950 p-8 text-gray-400 text-sm">需要管理员权限</div>

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <p className="text-label mb-1">管理中心 / 生成记录</p>
          <h1 className="text-mono-lg text-white">🎬 AI 生成记录总表</h1>
          <p className="text-gray-500 text-xs mt-1">每笔生成的平台任务 / 消耗 / OSS 落库地址，替代登服务器查日志；「成功未转存」是防投诉重点，可一键补下载。</p>
        </div>

        {/* 状态汇总 tabs */}
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            { key: 'all', label: '全部' },
            { key: 'pending', label: '进行中' },
            { key: 'succeeded', label: '成功' },
            { key: 'failed', label: '失败' },
          ].map(t => (
            <button key={t.key} onClick={() => { setStatus(t.key); setMissingOss(false); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-xs ${status === t.key && !missingOss ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-gray-400'}`}>
              {t.label} <span className="opacity-60">{summary[t.key] || 0}</span>
            </button>
          ))}
          <button onClick={() => { setMissingOss(m => !m); setStatus('all'); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-xs ${missingOss ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-white/5 text-gray-400'}`}>
            ⚠ 成功未转存OSS <span className="opacity-60">{summary.missingOss || 0}</span>
          </button>
        </div>

        {/* 筛选/搜索栏 */}
        <div className="flex flex-wrap gap-2 mb-4">
          <select value={type} onChange={e => { setType(e.target.value); setPage(1) }}
            className="input-dark text-xs px-2 py-1.5 rounded">
            <option value="all">全部类型</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="搜索 用户名 / 邮箱 / 任务ID / 提示词"
            className="input-dark text-xs px-3 py-1.5 rounded flex-1 min-w-[200px]" />
        </div>

        {/* 列表 */}
        <div className="card-glass p-4">
          {loading ? <p className="text-gray-500 text-xs">加载中...</p> : records.length === 0 ? <p className="text-gray-500 text-xs">暂无记录</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-2">#</th>
                  <th className="text-left">用户</th>
                  <th className="text-left">类型</th>
                  <th className="text-left">平台/模型</th>
                  <th className="text-left">提示词</th>
                  <th className="text-center">状态</th>
                  <th className="text-right">消耗(点)</th>
                  <th className="text-center">OSS</th>
                  <th className="text-left">时间</th>
                  <th className="text-center">操作</th>
                </tr></thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id} className="border-b border-white/5 text-gray-300 hover:bg-white/5">
                      <td className="py-2 font-mono text-[11px]">{r.id}</td>
                      <td>{r.user?.username || r.user?.email || r.userId}</td>
                      <td>{TYPE_LABEL[r.type] || r.type}</td>
                      <td className="text-gray-500">{r.provider}{r.model ? `/${r.model}` : ''}</td>
                      <td className="max-w-[200px] truncate text-gray-400" title={r.prompt || ''}>{r.prompt || '—'}</td>
                      <td className="text-center"><span className={STATUS_META[r.status]?.cls || 'text-gray-400'}>{STATUS_META[r.status]?.label || r.status}</span></td>
                      <td className="text-right font-mono">{r.status === 'succeeded' ? r.costPoints : r.status === 'failed' ? 0 : `(${r.costPoints})`}</td>
                      <td className="text-center">
                        {r.storageUrl ? <span className="text-emerald-400">✓</span>
                          : r.status === 'succeeded' ? <span className="text-red-400">✗</span>
                          : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="text-gray-500 whitespace-nowrap">{fmtTime(r.createdAt)}</td>
                      <td className="text-center whitespace-nowrap">
                        <button onClick={() => setDetail(r)} className="text-blue-400 hover:text-blue-300 mr-2">详情</button>
                        {r.storageUrl && (
                          <button disabled={busyId === r.id} onClick={() => openOss(r)} className="text-emerald-400 hover:text-emerald-300 mr-2 disabled:opacity-40">取件</button>
                        )}
                        {r.status === 'succeeded' && !r.storageUrl && r.platformUrl && (
                          <button disabled={busyId === r.id} onClick={() => redownload(r)} className="text-amber-400 hover:text-amber-300 disabled:opacity-40">补下载</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 分页 */}
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

      {/* 详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setDetail(null)}>
          <div className="card-glass max-w-lg w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">生成记录 #{detail.id}</h3>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <dl className="space-y-2 text-xs">
              {[
                ['用户', detail.user?.username || detail.user?.email || String(detail.userId)],
                ['类型', TYPE_LABEL[detail.type] || detail.type],
                ['平台/模型', `${detail.provider}${detail.model ? '/' + detail.model : ''}`],
                ['平台任务ID', detail.platformTaskId || '—'],
                ['状态', STATUS_META[detail.status]?.label || detail.status],
                ['消耗点数', String(detail.costPoints)],
                ['失败原因', detail.errorMessage || '—'],
                ['创建时间', fmtTime(detail.createdAt)],
                ['更新时间', fmtTime(detail.updatedAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-white/5 pb-1">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-gray-200 text-right max-w-[60%] break-all">{v}</dd>
                </div>
              ))}
            </dl>
            {detail.prompt && (
              <div className="mt-3">
                <p className="text-gray-500 text-[11px] mb-1">提示词</p>
                <pre className="text-[10px] text-gray-400 bg-black/30 rounded p-2 max-h-28 overflow-auto whitespace-pre-wrap break-all">{detail.prompt}</pre>
              </div>
            )}
            {detail.platformUrl && (
              <div className="mt-3">
                <p className="text-gray-500 text-[11px] mb-1">平台原始 URL（可能过期）</p>
                <a href={detail.platformUrl} target="_blank" rel="noreferrer" className="text-blue-400 text-[11px] break-all hover:underline">{detail.platformUrl}</a>
              </div>
            )}
            {detail.storageUrl && (
              <div className="mt-3">
                <p className="text-gray-500 text-[11px] mb-1">OSS 落库地址（点「取件」拿 24h 签名链接）</p>
                <p className="text-emerald-400 text-[11px] break-all font-mono">{detail.storageUrl}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
