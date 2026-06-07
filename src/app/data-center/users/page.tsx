'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface UserProfile {
  id: number
  uid: string
  platform: string
  nickname: string
  avatar: string | null
  bio: string | null
  followerCount: number
  followingCount: number
  likeCount: number
  videoCount: number
  isVerified: boolean
  verifyType: string | null
  location: string | null
  firstCrawledAt: string
  lastCrawledAt: string
}

function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [summary, setSummary] = useState({ totalUsers: 0, verifiedUsers: 0, verifiedRate: '0' })
  const [filters, setFilters] = useState<{ platforms: Array<{ platform: string; count: number }> }>({ platforms: [] })
  const [loading, setLoading] = useState(true)

  const [keyword, setKeyword] = useState('')
  const [platform, setPlatform] = useState('')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [sortBy, setSortBy] = useState('followerCount')

  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        size: '24',
        sortBy,
      })
      if (keyword) params.set('keyword', keyword)
      if (platform) params.set('platform', platform)
      if (verifiedOnly) params.set('verifiedOnly', 'true')

      const res = await fetch(`/api/data-center/users?${params}`, { credentials: 'include' })
      const json = await res.json()
      if (json.success) {
        setUsers(json.data.list)
        setTotalPages(json.data.pagination.totalPages)
        setTotal(json.data.pagination.total)
        setSummary(json.data.summary)
        if (json.data.filters?.platforms) setFilters(f => ({ ...f, platforms: json.data.filters.platforms }))
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [keyword, platform, verifiedOnly, sortBy, page])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <p className="text-label mb-2">数据管理中心 / DATA CENTER</p>
          <h1 className="text-mono-lg text-white">用户画像库 / USER PROFILES</h1>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          <Link href="/data-center" className="px-3 py-1.5 bg-white/5 text-gray-400 rounded-xl hover:bg-white/10 font-mono text-sm">← 返回仪表盘</Link>
        </div>

        {/* 统计概览 */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
            <p className="text-xs text-gray-500 font-mono">总用户数 / TOTAL</p>
            <p className="text-2xl font-bold font-mono text-cyan-400 mt-1">{summary.totalUsers.toLocaleString()}</p>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
            <p className="text-xs text-gray-500 font-mono">认证用户 / VERIFIED</p>
            <p className="text-2xl font-bold font-mono text-orange-400 mt-1">{summary.verifiedUsers.toLocaleString()}</p>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
            <p className="text-xs text-gray-500 font-mono">认证比例 / RATE</p>
            <p className="text-2xl font-bold font-mono text-purple-400 mt-1">{summary.verifiedRate}%</p>
          </div>
        </div>

        {/* 工具栏 */}
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); fetchUsers() }}
          className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4 mb-6 flex flex-wrap gap-3 items-center"
        >
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索昵称..."
            className="flex-1 min-w-[180px] bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono text-sm" />
          <button type="submit" className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-mono text-sm">SEARCH</button>

          <select value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1) }}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none">
            <option value="" className="bg-gray-900">全部平台</option>
            {filters.platforms.map(p => (
              <option key={p.platform} value={p.platform} className="bg-gray-900">{p.platform}</option>
            ))}
          </select>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={verifiedOnly}
              onChange={(e) => { setVerifiedOnly(e.target.checked); setPage(1) }}
              className="w-4 h-4 rounded accent-emerald-500" />
            <span className="text-xs text-gray-400 font-mono">仅认证用户</span>
          </label>

          <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1) }}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none ml-auto">
            <option value="followerCount" className="bg-gray-900">粉丝数 ↓</option>
            <option value="likeCount" className="bg-gray-900">获赞数 ↓</option>
            <option value="videoCount" className="bg-gray-900">作品数 ↓</option>
            <option value="lastCrawledAt" className="bg-gray-900">最近更新 ↓</option>
          </select>
        </form>

        {/* 用户网格 */}
        {loading ? (
          <div className="text-center py-24"><p className="text-gray-500 font-mono animate-pulse">LOADING...</p></div>
        ) : users.length === 0 ? (
          <div className="text-center py-24 bg-white/5 rounded-2xl border border-white/10">
            <p className="text-gray-500 font-mono text-lg mb-2">NO USERS FOUND</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {users.map(u => (
              <div key={u.id} className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4 hover:border-white/20 transition-all group">
                {/* 头部：头像 + 昵称 */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 bg-gray-800">
                    {u.avatar ? (
                      <img src={u.avatar} alt={u.nickname} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xl">👤</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-white font-mono truncate">{u.nickname}</p>
                      {u.isVerified && <span className="text-orange-400 text-xs shrink-0">✓</span>}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 text-[10px] rounded font-mono">{u.platform}</span>
                      {u.verifyType && <span className="text-[10px] text-orange-400/70 font-mono">{u.verifyType}</span>}
                    </div>
                  </div>
                </div>

                {/* 简介 */}
                {u.bio && (
                  <p className="text-xs text-gray-400 font-mono line-clamp-2 mb-3 leading-relaxed">{u.bio}</p>
                )}

                {/* 数据指标 */}
                <div className="grid grid-cols-4 gap-2 text-center border-t border-white/5 pt-3">
                  <div><p className="text-base font-bold font-mono text-pink-400">{formatCount(u.followerCount)}</p><p className="text-[10px] text-gray-600 font-mono">粉丝</p></div>
                  <div><p className="text-base font-bold font-mono text-blue-400">{formatCount(u.followingCount)}</p><p className="text-[10px] text-gray-600 font-mono">关注</p></div>
                  <div><p className="text-base font-bold font-mono text-red-400">{formatCount(u.likeCount)}</p><p className="text-[10px] text-gray-600 font-mono">获赞</p></div>
                  <div><p className="text-base font-bold font-mono text-emerald-400">{formatCount(u.videoCount)}</p><p className="text-[10px] text-gray-600 font-mono">作品</p></div>
                </div>

                {/* 底部信息 */}
                {(u.location || u.lastCrawledAt) && (
                  <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-gray-600 font-mono">
                    {u.location && <span>📍 {u.location}</span>}
                    <span>更新: {new Date(u.lastCrawledAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                )}
              </div>
            ))}
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
