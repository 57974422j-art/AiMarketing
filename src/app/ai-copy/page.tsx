'use client';
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'

interface CopyItem {
  id?: number
  title: string
  content: string
  platform: string
  tags: string[]
}

export default function AICopyPage() {
  const { user, loading: authLoading } = useAuth()
  const [keywords, setKeywords] = useState('')
  const [platform, setPlatform] = useState('douyin')
  const [style, setStyle] = useState('catchy')
  const [isGenerating, setIsGenerating] = useState(false)
  const [copyContent, setCopyContent] = useState<CopyItem[]>([])
  const [historyList, setHistoryList] = useState<any[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const platformNames: Record<string, string> = {
    douyin: '抖音',
    xiaohongshu: '小红书',
    kuaishou: '快手',
    weibo: '微博'
  }

  const styleNames: Record<string, string> = {
    catchy: '吸睛',
    professional: '专业',
    humorous: '幽默',
    emotional: '情感'
  }

  useEffect(() => {
    if (!authLoading && user) {
      loadHistory()
    }
  }, [authLoading, user])

  const loadHistory = async () => {
    try {
      const res = await fetch('/api/ai-copy', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setHistoryList(data)
      }
    } catch (error) {
      console.error('加载历史失败:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!keywords.trim()) return

    setIsGenerating(true)
    setCopyContent([])

    try {
      const res = await fetch('/api/ai-copy', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, platform, style })
      })

      const data = await res.json()

      if (data.success) {
        // API 返回的 copies 数组中已包含 title, content, tags 字段
        const parsedCopies = (data.copies || []).map((item: any) => ({
          id: item.id,
          title: item.title || '未命名文案',
          content: item.content || '',
          platform: item.platform || platform,
          tags: item.tags || [item.style || style]
        }))
        setCopyContent(parsedCopies)
        loadHistory()
      } else {
        alert(data.message || '生成失败')
      }
    } catch (error) {
      console.error('生成失败:', error)
      alert('生成失败，请重试')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    alert('已复制到剪贴板')
  }

  const handleDelete = async (taskId: number) => {
    if (!confirm('确定要删除这条文案吗？')) return

    try {
      const res = await fetch(`/api/ai-copy?id=${taskId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (res.ok) {
        setHistoryList(historyList.filter(item => item.id !== taskId))
        alert('删除成功')
      } else {
        alert('删除失败')
      }
    } catch (error) {
      console.error('删除失败:', error)
      alert('删除失败')
    }
  }

  const handleShareToLibrary = async (copy: CopyItem) => {
    if (!confirm('确定要将此文案分享到创意库吗？')) return

    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'copy',
          data: {
            title: copy.title,
            content: copy.content,
            platform: copy.platform,
            style: copy.tags?.[0] || style,
            tags: copy.tags
          }
        })
      })

      const data = await res.json()
      if (data.success) {
        alert('已提交到创意库，待审核后展示')
      } else {
        alert(data.message || '分享失败')
      }
    } catch (error) {
      console.error('分享失败:', error)
      alert('分享失败，请重试')
    }
  }

  const parseResultJson = (jsonStr: string | null): CopyItem[] => {
    if (!jsonStr) return []
    try {
      const parsed = JSON.parse(jsonStr)
      return parsed.copies || []
    } catch {
      return []
    }
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <p className="text-label mb-2">AI 工作区 / AI WORKSPACE</p>
            <h1 className="text-mono-lg text-white">文案生成 / COPY WRITER</h1>
          </div>
          {user && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="px-4 py-2 text-sm bg-white/5 border border-white/10 text-gray-300 rounded-lg hover:bg-white/10"
            >
              {showHistory ? '返回生成' : '查看历史'}
            </button>
          )}
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-label mb-2">
                <span>关键词</span>
                <span className="opacity-50 ml-1">KEYWORDS</span>
              </label>
              <input
                type="text"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="输入关键词... / Input keywords..."
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-label mb-2">
                  <span>平台</span>
                  <span className="opacity-50 ml-1">PLATFORM</span>
                </label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="douyin" className="bg-gray-900">抖音 / DOUYIN</option>
                  <option value="xiaohongshu" className="bg-gray-900">小红书 / XIAOHONGSHU</option>
                  <option value="kuaishou" className="bg-gray-900">快手 / KUAISHOU</option>
                  <option value="weibo" className="bg-gray-900">微博 / WEIBO</option>
                </select>
              </div>

              <div>
                <label className="block text-label mb-2">
                  <span>风格</span>
                  <span className="opacity-50 ml-1">STYLE</span>
                </label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="catchy" className="bg-gray-900">吸睛 / CATCHY</option>
                  <option value="professional" className="bg-gray-900">专业 / PROFESSIONAL</option>
                  <option value="humorous" className="bg-gray-900">幽默 / HUMOROUS</option>
                  <option value="emotional" className="bg-gray-900">情感 / EMOTIONAL</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={isGenerating}
              className="w-full py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {isGenerating ? (
                <span>生成中... / GENERATING...</span>
              ) : (
                <span>生成文案 / GENERATE COPY</span>
              )}
            </button>
          </form>

          {copyContent.length > 0 && (
            <div className="mt-8">
              <h2 className="text-label mb-4">
                <span>生成结果</span>
                <span className="opacity-50 ml-1">/ GENERATED COPY</span>
              </h2>
              <div className="space-y-4">
                {copyContent.map((copy, index) => (
                  <div key={index} className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-5">
                    {/* 标题 - 加粗放大 */}
                    <h3 className="text-lg font-bold text-white mb-3 leading-tight">
                      {copy.title}
                    </h3>
                    {/* 正文 - 正常显示 */}
                    <p className="text-gray-300 text-sm leading-relaxed mb-3">
                      {copy.content}
                    </p>
                    {/* 标签 */}
                    <div className="flex justify-between items-center">
                      <div className="flex gap-1 flex-wrap">
                        {(copy.tags || []).map((tag, i) => (
                          <span key={i} className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">
                            #{tag}
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleShareToLibrary(copy)}
                          className="text-sm px-3 py-1 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors"
                        >
                          分享到创意库
                        </button>
                        <button
                          onClick={() => handleCopy(copy.content)}
                          className="text-sm text-emerald-400 hover:text-emerald-300"
                        >
                          复制
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {showHistory && historyList.length > 0 && (
          <div className="mt-8">
            <h2 className="text-label mb-4">
              <span>历史记录</span>
              <span className="opacity-50 ml-1">/ HISTORY</span>
            </h2>
            <div className="space-y-4">
              {historyList.map((item) => {
                const copies = parseResultJson(item.resultJson)
                return (
                  <div key={item.id} className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-4">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <span className="text-gray-400 text-sm">
                          {platformNames[item.platform] || item.platform} · {styleNames[item.style] || item.style}
                        </span>
                        <span className="text-gray-600 ml-2 text-sm">{item.keywords}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="text-red-400 hover:text-red-300 p-1"
                          title="删除"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {copies.map((copy, index) => (
                        <div key={index} className="bg-white/5 rounded-lg p-3">
                          <div className="flex justify-between items-start">
                            <p className="text-gray-300 text-sm">{copy.content}</p>
                            <button
                              onClick={() => handleCopy(copy.content)}
                              className="text-emerald-400 hover:text-emerald-300 text-xs ml-2 shrink-0"
                            >
                              复制
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
