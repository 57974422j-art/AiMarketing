'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface VideoItem {
  id: number
  taskId: number | null
  platform: string
  videoId: string
  title: string
  description: string | null
  coverUrl: string | null
  videoUrl: string | null
  authorName: string | null
  authorAvatar: string | null
  likeCount: number
  commentCount: number
  shareCount: number
  collectCount: number
  playCount: number | null
  publishedAt: string | null
  crawledAt: string
  task?: { id: number; name: string } | null
  commentsCount: number
}

interface FilterData {
  platforms: string[]
}

export default function VideosPage() {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [filters, setFilters] = useState<FilterData>({ platforms: [] })
  const [loading, setLoading] = useState(true)
  // 筛选状态
  const [keyword, setKeyword] = useState('')
  const [platform, setPlatform] = useState('')
  const [sort, setSort] = useState('crawledAt')
  // 分页
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  // 视图模式
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const fetchVideos = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        size: '20',
      })
      if (keyword) params.set('keyword', keyword)
      if (platform) params.set('platform', platform)
      if (sort) params.set('sort', sort)

      const res = await fetch(`/api/data-center/videos?${params}`, { credentials: 'include' })
      const json = await res.json()
      if (json.success) {
        setVideos(json.data.list)
        setTotalPages(json.data.pagination.totalPages)
        setTotal(json.data.pagination.total)
        if (json.data.filters?.platforms) {
          setFilters(f => ({ ...f, platforms: json.data.filters.platforms }))
        }
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [keyword, platform, sort, page])

  useEffect(() => {
    fetchVideos()
  }, [fetchVideos])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchVideos()
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 页头 */}
        <div className="mb-6">
          <p className="text-label mb-2">数据管理中心 / DATA CENTER</p>
          <h1 className="text-mono-lg text-white">视频库 / VIDEO LIBRARY</h1>
        </div>

        {/* 面包屑导航 */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <Link href="/data-center" className="px-3 py-1.5 bg-white/5 text-gray-400 rounded-xl hover:bg-white/10 font-mono text-sm">
            ← 返回仪表盘
          </Link>
        </div>

        {/* ========== 工具栏：搜索 + 筛选 + 排序 + 视图切换 ========== */}
        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4 mb-6">
          <form onSubmit={handleSearch} className="flex flex-wrap gap-3 items-center">
            {/* 搜索框 */}
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索标题..."
              className="flex-1 min-w-[200px] bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
            />
            <button type="submit" className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-mono text-sm">
              SEARCH
            </button>

            {/* 平台筛选 */}
            <select
              value={platform}
              onChange={(e) => { setPlatform(e.target.value); setPage(1) }}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
            >
              <option value="" className="bg-gray-900">全部平台</option>
              {filters.platforms.map(p => (
                <option key={p} value={p} className="bg-gray-900">{p}</option>
              ))}
            </select>

            {/* 排序 */}
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value); setPage(1) }}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
            >
              <option value="crawledAt" className="bg-gray-900">采集时间 ↓</option>
              <option value="likeCount" className="bg-gray-900">点赞数 ↓</option>
              <option value="commentCount" className="bg-gray-900">评论数 ↓</option>
              <option value="playCount" className="bg-gray-900">播放量 ↓</option>
            </select>

            {/* 视图切换 */}
            <div className="flex rounded-xl overflow-hidden border border-white/10 ml-auto">
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-2 text-xs font-mono ${viewMode === 'grid' ? 'bg-emerald-500 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
              >GRID</button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-2 text-xs font-mono ${viewMode === 'list' ? 'bg-emerald-500 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
              >LIST</button>
            </div>
          </form>
        </div>

        {/* 结果统计 */}
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-gray-400 font-mono">
            共 <span className="text-white">{total.toLocaleString()}</span> 条结果
          </span>
        </div>

        {/* ========== 视频列表/网格 ========== */}
        {loading ? (
          <div className="text-center py-24">
            <p className="text-gray-500 font-mono animate-pulse">LOADING...</p>
          </div>
        ) : videos.length === 0 ? (
          <div className="text-center py-24 bg-white/5 rounded-2xl border border-white/10">
            <p className="text-gray-500 font-mono text-lg mb-2">NO VIDEOS FOUND</p>
            <p className="text-gray-600 font-mono text-sm">请先执行采集任务获取视频数据</p>
            <Link href="/lead-collector" className="mt-4 inline-block px-4 py-2 bg-emerald-500 text-white rounded-xl font-mono text-sm">
              去采集 →
            </Link>
          </div>
        ) : viewMode === 'grid' ? (
          /* ====== 网格视图 ====== */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {videos.map(v => (
              <div key={v.id} className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden hover:border-white/20 transition-all group">
                {/* 封面图 */}
                <div className="relative aspect-video bg-gray-800">
                  {v.coverUrl ? (
                    <img src={v.coverUrl} alt={v.title} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600 text-3xl">🎬</div>
                  )}
                  {/* 平台标签 */}
                  <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur-sm text-xs text-white rounded font-mono">
                    {v.platform}
                  </span>
                  {/* 播放量角标 */}
                  {v.playCount && (
                    <span className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/60 backdrop-blur-sm text-xs text-white rounded font-mono">
                      ▶ {v.playCount >= 10000 ? `${(v.playCount / 10000).toFixed(1)}万` : v.playCount}
                    </span>
                  )}
                </div>

                {/* 信息区 */}
                <div className="p-3">
                  <h3 className="text-sm font-medium text-white font-mono line-clamp-2 mb-2 group-hover:text-emerald-300 transition-colors" title={v.title}>
                    {v.title || '(无标题)'}
                  </h3>
                  <p className="text-xs text-gray-500 font-mono truncate mb-2">{v.authorName || '未知作者'}</p>

                  {/* 数据指标行 */}
                  <div className="flex items-center gap-3 text-xs text-gray-400 font-mono">
                    <span className="flex items-center gap-1">
                      ❤️ <span className="text-red-400">{v.likeCount}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      💬 <span>{v.commentCount}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      🔁 <span>{v.shareCount}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      ⭐ <span>{v.collectCount}</span>
                    </span>
                    <span className="ml-auto text-[11px] text-gray-600">
                      {new Date(v.crawledAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>

                  {/* 评论入口 */}
                  {v.commentsCount > 0 && (
                    <Link
                      href={`/data-center/comments?videoId=${v.id}`}
                      className="block mt-2 pt-2 border-t border-white/5 text-xs text-cyan-400 hover:text-cyan-300 font-mono"
                    >
                      查看 {v.commentsCount} 条评论 →
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ====== 列表视图 ====== */
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
            <table className="w-full text-left font-mono">
              <thead>
                <tr className="border-b border-white/10 text-xs text-gray-500">
                  <th className="py-3 px-4">封面</th>
                  <th className="py-3 px-4">标题 / 作者</th>
                  <th className="py-3 px-4">平台</th>
                  <th className="py-3 px-4 text-right">点赞</th>
                  <th className="py-3 px-4 text-right">评论</th>
                  <th className="py-3 px-4 text-right">播放</th>
                  <th className="py-3 px-4">采集时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {videos.map(v => (
                  <tr key={v.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4">
                      <div className="w-16 h-10 rounded-lg overflow-hidden bg-gray-800 shrink-0">
                        {v.coverUrl ? (
                          <img src={v.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">🎬</div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-sm text-white max-w-md truncate" title={v.title}>{v.title || '(无标题)'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{v.authorName || '-'}</p>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded">{v.platform}</span>
                    </td>
                    <td className="py-3 px-4 text-right text-red-400 text-sm">{v.likeCount}</td>
                    <td className="py-3 px-4 text-right text-sm">
                      <Link href={`/data-center/comments?videoId=${v.id}`} className="hover:text-cyan-400 transition-colors">
                        {v.commentCount}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-right text-sm text-gray-300">{v.playCount || '-'}</td>
                    <td className="py-3 px-4 text-xs text-gray-500">{new Date(v.crawledAt).toLocaleDateString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ========== 分页 ========== */}
        {!loading && totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:bg-white/10 disabled:opacity-30 font-mono text-sm"
            >
              ‹ PREV
            </button>
            <span className="px-4 py-1.5 bg-white/5 rounded-xl text-gray-300 font-mono text-sm">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:bg-white/10 disabled:opacity-30 font-mono text-sm"
            >
              NEXT ›
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
