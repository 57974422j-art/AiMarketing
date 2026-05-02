'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'

interface CopyTemplateItem {
  id: number
  title: string
  content: string
  platform: string
  style: string | null
  tags: string | null
  status: string
  userId: number | null
  createdAt: string
  user?: {
    username: string
  }
}

export default function AdminReviewPage() {
  const { user, loading: authLoading } = useAuth()
  const [pendingTemplates, setPendingTemplates] = useState<CopyTemplateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<number | null>(null)

  useEffect(() => {
    if (!authLoading && user?.role === 'admin') {
      loadPendingTemplates()
    }
  }, [authLoading, user])

  const loadPendingTemplates = async () => {
    try {
      const res = await fetch('/api/templates?status=pending', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setPendingTemplates(data)
      }
    } catch (error) {
      console.error('加载待审核模板失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (id: number) => {
    setProcessing(id)
    try {
      const res = await fetch(`/api/templates/${id}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' })
      })
      
      if (res.ok) {
        setPendingTemplates(pendingTemplates.filter(t => t.id !== id))
        alert('已通过审核')
      } else {
        const data = await res.json()
        alert(data.message || '操作失败')
      }
    } catch (error) {
      console.error('审核失败:', error)
      alert('操作失败')
    } finally {
      setProcessing(null)
    }
  }

  const handleReject = async (id: number) => {
    if (!confirm('确定要拒绝此模板吗？')) return
    
    setProcessing(id)
    try {
      const res = await fetch(`/api/templates/${id}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' })
      })
      
      if (res.ok) {
        setPendingTemplates(pendingTemplates.filter(t => t.id !== id))
        alert('已拒绝')
      } else {
        const data = await res.json()
        alert(data.message || '操作失败')
      }
    } catch (error) {
      console.error('审核失败:', error)
      alert('操作失败')
    } finally {
      setProcessing(null)
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </div>
    )
  }

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-red-400 text-center">
          <p className="text-xl mb-2">无权限访问</p>
          <p className="text-gray-500">仅管理员可访问此页面</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">管理后台 / ADMIN</p>
          <h1 className="text-mono-lg text-white">模板审核管理 / REVIEW MANAGEMENT</h1>
          <p className="text-gray-400 text-sm mt-2">
            待审核模板数量：<span className="text-emerald-400 font-bold">{pendingTemplates.length}</span>
          </p>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-12">加载中...</div>
        ) : pendingTemplates.length === 0 ? (
          <div className="bg-white/5 rounded-2xl border border-white/10 p-12 text-center">
            <div className="text-4xl mb-4">✓</div>
            <p className="text-gray-400">暂无待审核的模板</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingTemplates.map((template) => (
              <div key={template.id} className="bg-white/5 rounded-2xl border border-white/10 p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">{template.title}</h3>
                    <div className="flex gap-2 text-xs text-gray-500">
                      <span className="bg-white/5 px-2 py-1 rounded">
                        平台: {template.platform}
                      </span>
                      {template.style && (
                        <span className="bg-white/5 px-2 py-1 rounded">
                          风格: {template.style}
                        </span>
                      )}
                      <span className="bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded">
                        待审核
                      </span>
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    {template.user && (
                      <p>作者: {template.user.username}</p>
                    )}
                    <p>{new Date(template.createdAt).toLocaleString()}</p>
                  </div>
                </div>

                {/* 预览内容 */}
                <div className="bg-black/30 rounded-lg p-4 mb-4">
                  <p className="text-gray-300 text-sm leading-relaxed">
                    {template.content}
                  </p>
                  {template.tags && (
                    <div className="flex gap-1 mt-3 flex-wrap">
                      {template.tags.split(',').map((tag, i) => (
                        <span key={i} className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">
                          #{tag.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => handleReject(template.id)}
                    disabled={processing === template.id}
                    className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                  >
                    {processing === template.id ? '处理中...' : '拒绝'}
                  </button>
                  <button
                    onClick={() => handleApprove(template.id)}
                    disabled={processing === template.id}
                    className="px-4 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
                  >
                    {processing === template.id ? '处理中...' : '通过'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
