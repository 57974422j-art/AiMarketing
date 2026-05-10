'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface SubmissionItem {
  id: number
  videoUrl: string
  caption: string
  targetPlatform: string
  status: string
  submitterId: number
  reviewerId: number | null
  submitter: { id: number; username: string; name: string | null }
  reviewer: { id: number; username: string; name: string | null } | null
  createdAt: string
}

export default function AdminContentSubmissionsPage() {
  const { user, loading: authLoading } = useAuth()
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<number | null>(null)
  const [filterStatus, setFilterStatus] = useState('')

  useEffect(() => {
    if (!authLoading && user) {
      loadSubmissions()
    } else if (!authLoading) {
      setLoading(false)
    }
  }, [authLoading, user])

  const loadSubmissions = async () => {
    try {
      const url = filterStatus ? `/api/content-submissions?status=${filterStatus}` : '/api/content-submissions'
      const res = await fetch(url, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setSubmissions(data.data || [])
      }
    } catch {
      console.error('加载素材列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleReview = async (id: number, status: '已通过' | '已拒绝') => {
    setProcessing(id)
    try {
      const res = await fetch(`/api/content-submissions/${id}/review`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        loadSubmissions()
        showToast(`素材已${status}`)
      } else {
        const d = await res.json()
        showToast(d.message || '操作失败', 'error')
      }
    } catch {
      showToast('操作失败', 'error')
    } finally {
      setProcessing(null)
    }
  }

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      '待审核': 'bg-yellow-500/20 text-yellow-400',
      '已通过': 'bg-emerald-500/20 text-emerald-400',
      '已拒绝': 'bg-red-500/20 text-red-400',
      '已发布': 'bg-blue-500/20 text-blue-400',
    }
    return map[s] || 'bg-gray-500/20 text-gray-400'
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-red-400 text-center">
          <p className="text-xl mb-2">请先登录</p>
        </div>
      </div>
    )
  }

  const canReview = user.role === 'admin' || user.role === 'editor'

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">管理后台 / ADMIN</p>
          <h1 className="text-mono-lg text-white">素材审核 / CONTENT REVIEW</h1>
          <p className="text-gray-400 text-sm mt-2">
            素材总数：<span className="text-emerald-400 font-bold">{submissions.length}</span>
          </p>
        </div>

        {canReview && (
          <div className="flex gap-2 mb-6">
            {['', '待审核', '已通过', '已拒绝', '已发布'].map((s) => (
              <button
                key={s}
                onClick={() => { setFilterStatus(s); setLoading(true) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                  filterStatus === s
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                }`}
              >
                {s || '全部'}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-400 py-12">加载中...</div>
        ) : submissions.length === 0 ? (
          <div className="card-glass p-12 text-center">
            <p className="text-gray-400">暂无素材</p>
          </div>
        ) : (
          <div className="space-y-4">
            {submissions.map((s) => (
              <div key={s.id} className="card-glass p-6">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1 min-w-0 mr-4">
                    <h3 className="text-white font-bold mb-1 truncate">{s.caption}</h3>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="bg-white/5 px-2 py-0.5 rounded">{s.targetPlatform}</span>
                      <span className={`px-2 py-0.5 rounded ${statusBadge(s.status)}`}>{s.status}</span>
                      <span className="text-gray-500">提交者: {s.submitter?.username || '未知'}</span>
                      {s.reviewer && <span className="text-gray-500">审核人: {s.reviewer.username}</span>}
                      <span className="text-gray-500">{new Date(s.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <a
                    href={s.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 text-xs underline shrink-0"
                  >
                    查看视频
                  </a>
                </div>

                {s.status === '待审核' && canReview && (
                  <div className="flex justify-end gap-3 mt-3">
                    <button
                      onClick={() => handleReview(s.id, '已拒绝')}
                      disabled={processing === s.id}
                      className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                    >
                      {processing === s.id ? '处理中...' : '拒绝'}
                    </button>
                    <button
                      onClick={() => handleReview(s.id, '已通过')}
                      disabled={processing === s.id}
                      className="px-4 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
                    >
                      {processing === s.id ? '处理中...' : '通过'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
