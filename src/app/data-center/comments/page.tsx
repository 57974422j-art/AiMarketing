'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface CommentItem {
  id: number
  videoId: number
  commentId: string
  content: string
  authorName: string | null
  authorAvatar: string | null
  likeCount: number
  createdAt: string | null
  replyTo: string | null
  isAuthorReply: boolean
  intentScore: number | null
  leadId: number | null
  crawledAt: string
  video?: {
    id: number; title: string; platform: string
    authorName: string | null; coverUrl: string | null
  }
}

export default function CommentsPage() {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [hasLead, setHasLead] = useState('')
  const [sort, setSort] = useState('crawledAt')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // 从 URL 参数读取 videoId（视频库跳转过来时）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const vid = params.get('videoId')
    if (vid) {
      // 如果有 videoId，直接用这个筛选条件加载
      fetchComments(parseInt(vid))
    } else {
      fetchComments()
    }
  }, [])

  const fetchComments = useCallback(async (fixedVideoId?: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), size: '30' })
      if (keyword && !fixedVideoId) params.set('keyword', keyword)
      if (hasLead && !fixedVideoId) params.set('hasLead', hasLead)
      if (!fixedVideoId) params.set('sort', sort)
      if (fixedVideoId) params.set('videoId', String(fixedVideoId))

      const res = await fetch(`/api/data-center/comments?${params}`, { credentials: 'include' })
      const json = await res.json()
      if (json.success) {
        setComments(json.data.list)
        setTotalPages(json.data.pagination.totalPages)
        setTotal(json.data.pagination.total)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [keyword, hasLead, sort, page])

  // 当筛选/分页变化时重新请求（非首次加载）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fixedVid = params.get('videoId')
    if (!fixedVid) {
      fetchComments()
    }
  }, [fetchComments])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchComments()
  }

  // 高亮关键词
  const highlightText = (text: string, kw: string): React.ReactNode => {
    if (!kw) return text
    const parts = text.split(new RegExp(`(${kw})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === kw.toLowerCase()
        ? <span key={i} className="bg-yellow-500/40 text-yellow-200">{part}</span>
        : <span key={i}>{part}</span>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 页头 */}
        <div className="mb-6">
          <p className="text-label mb-2">数据管理中心 / DATA CENTER</p>
          <h1 className="text-mono-lg text-white">评论池 / COMMENT POOL</h1>
        </div>

        {/* 面包屑 */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <Link href="/data-center" className="px-3 py-1.5 bg-white/5 text-gray-400 rounded-xl hover:bg-white/10 font-mono text-sm">← 返回仪表盘</Link>
          <Link href="/data-center/videos" className="px-3 py-1.5 bg-white/5 text-gray-400 rounded-xl hover:bg-white/10 font-mono text-sm">视频库</Link>
        </div>

        {/* 工具栏 */}
        <form onSubmit={handleSearch} className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4 mb-6 flex flex-wrap gap-3 items-center">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索评论内容..."
            className="flex-1 min-w-[240px] bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
          />
          <button type="submit" className="px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-mono text-sm">SEARCH</button>

          <select
            value={hasLead}
            onChange={(e) => { setHasLead(e.target.value); setPage(1) }}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
          >
            <option value="" className="bg-gray-900">全部评论</option>
            <option value="true" className="bg-gray-900">仅含线索</option>
          </select>

          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value); setPage(1) }}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50 font-mono text-sm"
          >
            <option value="crawledAt" className="bg-gray-900">采集时间 ↓</option>
            <option value="likeCount" className="bg-gray-900">点赞数 ↓</option>
            <option value="intentScore" className="bg-gray-900">意向度 ↓</option>
            <option value="createdAt" className="bg-gray-900">评论时间 ↓</option>
          </select>
        </form>

        {/* 统计 */}
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-gray-400 font-mono">
            共 <span className="text-white">{total.toLocaleString()}</span> 条评论
            {comments.filter(c => c.leadId).length > 0 &&
              ` · 含线索 <span className="text-emerald-400">${comments.filter(c => c.leadId).length}</span> 条`
            }
          </span>
        </div>

        {/* 评论列表 */}
        {loading ? (
          <div className="text-center py-24"><p className="text-gray-500 font-mono animate-pulse">LOADING...</p></div>
        ) : comments.length === 0 ? (
          <div className="text-center py-24 bg-white/5 rounded-2xl border border-white/10">
            <p className="text-gray-500 font-mono text-lg mb-2">NO COMMENTS FOUND</p>
            <p className="text-gray-600 font-mono text-sm">请先执行采集任务获取评论数据</p>
          </div>
        ) : (
          <div className="space-y-3">
            {comments.map(c => (
              <div key={c.id} className={`bg-white/5 backdrop-blur-sm rounded-2xl border p-4 hover:bg-white/[0.07] transition-colors ${c.leadId ? 'border-l-2 border-l-emerald-400' : 'border-white/10'}`}>
                {/* 关联视频信息 */}
                {c.video && (
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/5">
                    <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded font-mono">{c.video.platform}</span>
                    <Link href={`/data-center/videos?videoId=${c.video.id}`} className="text-sm text-cyan-400 hover:text-cyan-300 font-mono truncate max-w-md" title={c.video.title}>
                      📹 {c.video.title}
                    </Link>
                  </div>
                )}

                <div className="flex gap-3">
                  {/* 头像 */}
                  <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-gray-800 flex items-center justify-center text-xs">
                    {c.authorAvatar ? (
                      <img src={c.authorAvatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span>👤</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* 作者 + 时间 */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm text-white font-medium font-mono">{c.authorName || '匿名用户'}</span>
                      {c.isAuthorReply && (
                        <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 text-[10px] rounded font-mono">作者回复</span>
                      )}
                      <span className="text-xs text-gray-600 ml-auto font-mono">
                        {(c.createdAt ? new Date(c.createdAt) : new Date(c.crawledAt)).toLocaleString('zh-CN')}
                      </span>
                    </div>

                    {/* 评论正文 */}
                    <p className="text-sm text-gray-300 font-mono break-words leading-relaxed">
                      {highlightText(c.content, keyword)}
                    </p>

                    {/* 底部标签栏 */}
                    <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/5 text-xs font-mono">
                      <span className="text-red-400">❤️ {c.likeCount}</span>
                      {c.intentScore != null && (
                        <span className={`px-1.5 py-0.5 rounded ${
                          c.intentScore >= 0.7 ? 'bg-green-500/20 text-green-400' :
                          c.intentScore >= 0.4 ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          意向度: {c.intentScore.toFixed(2)}
                        </span>
                      )}
                      {c.leadId && (
                        <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">已提取线索 #{c.leadId}</span>
                      )}
                      {c.replyTo && <span className="text-gray-600">回复 @{c.replyTo}</span>}
                    </div>
                  </div>
                </div>
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
