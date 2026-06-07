'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface LeadItem {
  id: number
  platform: string
  sourceType: string
  rawContent: string
  contactInfo: string | null
  intentScore: number
  status: string
  tags: string | null
  createdAt: string
  updatedAt: string
  task?: { id: number; name: string } | null
  owner?: { id: number; name: string | null; username: string } | null
  assignee?: { id: number; name: string | null; username: string } | null
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  new:         { label: '新线索',     color: 'bg-blue-500/20 text-blue-400' },
  contacted:   { label: '已联系',     color: 'bg-yellow-500/20 text-yellow-400' },
  qualified:   { label: '已确认',     color: 'bg-emerald-500/20 text-emerald-400' },
  converted:   { label: '已转化',     color: 'bg-green-500/20 text-green-400' },
  lost:        { label: '已流失',     color: 'bg-red-500/20 text-red-400' },
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<LeadItem[]>([])
  const [stats, setStats] = useState<Array<{ status: string; count: number }>>([])
  const [loading, setLoading] = useState(true)

  const [status, setStatus] = useState('')
  const [platform, setPlatform] = useState('')
  const [keyword, setKeyword] = useState('')
  const [minScore, setMinScore] = useState('')
  const [sort, setSort] = useState('createdAt')

  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), size: '25' })
      if (status) params.set('status', status)
      if (platform) params.set('platform', platform)
      if (keyword) params.set('keyword', keyword)
      if (minScore) params.set('minScore', minScore)
      if (sort) params.set('sort', sort)

      const res = await fetch(`/api/data-center/leads?${params}`, { credentials: 'include' })
      const json = await res.json()
      if (json.success) {
        setLeads(json.data.list)
        setTotalPages(json.data.pagination.totalPages)
        setTotal(json.data.pagination.total)
        if (json.data.stats) setStats(json.data.stats)
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [status, platform, keyword, minScore, sort, page])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <p className="text-label mb-2">数据管理中心 / DATA CENTER</p>
          <h1 className="text-mono-lg text-white">线索看板 / LEAD BOARD</h1>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          <Link href="/data-center" className="px-3 py-1.5 bg-white/5 text-gray-400 rounded-xl hover:bg-white/10 font-mono text-sm">← 返回仪表盘</Link>
          <Link href="/lead-collector" className="px-3 py-1.5 bg-white/5 text-gray-400 rounded-xl hover:bg-white/10 font-mono text-sm">采集任务</Link>
        </div>

        {/* ===== 状态漏斗概览 */}
        {stats.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
              const count = stats.find(s => s.status === key)?.count || 0
              return (
                <button key={key} onClick={() => { setStatus(status === key ? '' : key); setPage(1) }}
                  className={`rounded-2xl border p-4 transition-all ${status === key ? 'ring-2 ring-emerald-400 bg-white/[0.08]' : 'border-white/10 bg-white/5 hover:border-white/20'}`}
                >
                  <p className={`text-xs font-mono mb-1 ${cfg.color.split(' ')[0]?.replace('/20', '/30')} ${cfg.color.split(' ')[1]} ${cfg.color.split(' ')[2]}`}>
                    {cfg.label}
                  </p>
                  <p className="text-2xl font-bold font-mono text-white">{count}</p>
                </button>
              )
            })}
            {/* 总计卡片 */}
            <button onClick={() => { setStatus(''); setPage(1) }}
              className={`rounded-2xl border p-4 transition-all ${!status ? 'ring-2 ring-cyan-400 bg-white/[0.08]' : 'border-white/10 bg-white/5 hover:border-white/20'}`}
            >
              <p className="text-xs font-mono text-gray-400 mb-1">总计 TOTAL</p>
              <p className="text-2xl font-bold font-mono text-cyan-400">{total}</p>
            </button>
          </div>
        )}

        {/* 工具栏 */}
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); fetchLeads() }}
          className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4 mb-6 flex flex-wrap gap-3 items-center"
        >
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索内容..."
            className="flex-1 min-w-[200px] bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono text-sm" />
          <button type="submit" className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-mono text-sm">SEARCH</button>

          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none">
            <option value="" className="bg-gray-900">全部状态</option>
            {Object.entries(STATUS_CONFIG).map(([k, c]) => <option key={k} value={k} className="bg-gray-900">{c.label}</option>)}
          </select>

          <select value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1) }}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none">
            <option value="" className="bg-gray-900">全部平台</option>
            <option value="抖音" className="bg-gray-900">抖音</option>
            <option value="小红书" className="bg-gray-900">小红书</option>
            <option value="B站" className="bg-gray-900">B站</option>
            <option value="快手" className="bg-gray-900">快手</option>
            <option value="微博" className="bg-gray-900">微博</option>
          </select>

          <input type="number" value={minScore} onChange={(e) => setMinScore(e.target.value)} placeholder="最低意向度"
            step="0.1" min="0" max="1"
            className="w-32 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono text-sm" />

          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1) }}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none">
            <option value="createdAt" className="bg-gray-900">创建时间 ↓</option>
            <option value="intentScore" className="bg-gray-900">意向度 ↓</option>
            <option value="updatedAt" className="bg-gray-900">更新时间 ↓</option>
          </select>
        </form>

        {/* 线索列表 */}
        {loading ? (
          <div className="text-center py-24"><p className="text-gray-500 font-mono animate-pulse">LOADING...</p></div>
        ) : leads.length === 0 ? (
          <div className="text-center py-24 bg-white/5 rounded-2xl border border-white/10">
            <p className="text-gray-500 font-mono text-lg mb-2">NO LEADS FOUND</p>
            <Link href="/lead-collector" className="mt-4 inline-block px-4 py-2 bg-emerald-500 text-white rounded-xl font-mono text-sm">去采集 →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {leads.map(l => {
              const sc = STATUS_CONFIG[l.status]
              return (
                <div key={l.id} className="bg-white/5 backdrop-blur-sm rounded-2xl border-l-4 border-l-emerald-400 border-t border-r border-b border-white/10 p-4 hover:bg-white/[0.07] transition-colors">
                  <div className="flex items-start gap-4">
                    {/* 左侧状态条 + 信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 text-xs rounded-full font-mono ${sc?.color}`}>{l.status.toUpperCase()}</span>
                        <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded font-mono">{l.platform}</span>
                        <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded font-mono">{l.sourceType}</span>
                        {l.task && (
                          <span className="text-xs text-gray-500 font-mono">来自: {l.task.name}</span>
                        )}
                      </div>

                      <p className="text-sm text-gray-300 font-mono line-clamp-2 mb-2">{l.rawContent}</p>

                      {/* 底部标签栏 */}
                      <div className="flex items-center gap-3 flex-wrap text-xs font-mono mt-2 pt-2 border-t border-white/5">
                        <span className={l.intentScore >= 0.7 ? 'text-green-400' : l.intentScore >= 0.4 ? 'text-yellow-400' : 'text-gray-400'}>
                          意向度: {l.intentScore.toFixed(2)}
                        </span>
                        {l.contactInfo && (
                          <span className="px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 rounded">📞 {l.contactInfo}</span>
                        )}
                        {l.tags && l.tags.trim() && (
                          <span className="text-gray-500">{String(l.tags).split(',').slice(0, 3).map(t => `#${t}`).join(' ')}</span>
                        )}
                        <span className="ml-auto text-gray-600">{new Date(l.createdAt).toLocaleString('zh-CN')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 分页 */}
        {!loading && totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:bg-white/10 disabled:opacity-30 font-mono text-sm">‹ PREV</button>
            <span className="px-4 py-1.5 bg-white/5 rounded-xl text-gray-300 font-mono text-sm">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:bg-white/10 disabled:opacity-30 font-mono text-sm">NEXT ›</button>
          </div>
        )}
      </div>
    </div>
  )
}
