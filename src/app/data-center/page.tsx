'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

interface DashboardData {
  overview: {
    totalVideos: number
    totalComments: number
    totalLeads: number
    totalUsers: number
    totalTrending: number
    totalTasks: number
  }
  tasks: {
    list: Array<{
      id: number; name: string; status: string; platform: string
      createdAt: string
      _count: { leads: number; crawledVideos: number }
    }>
    stats: { total: number; pending: number; running: number; completed: number }
  }
  platformDistribution: Array<{ platform: string; count: number }>
  leadStatus: Array<{ status: string; count: number }>
  dailyTrend: Array<{ date: string; count: number }>
  topVideos: Array<{
    id: number; title: string; authorName: string
    likeCount: number; commentCount: number
    platform: string; coverUrl?: string | null
  }>
}

const navItems = [
  { href: '/data-center', label: '仪表盘', en: 'OVERVIEW', icon: '📊' },
  { href: '/data-center/videos', label: '视频库', en: 'VIDEOS', icon: '🎬' },
  { href: '/data-center/comments', label: '评论池', en: 'COMMENTS', icon: '💬' },
  { href: '/data-center/leads', label: '线索看板', en: 'LEADS', icon: '🎯' },
  { href: '/data-center/users', label: '用户画像', en: 'USERS', icon: '👤' },
  { href: '/data-center/trending', label: '热榜追踪', en: 'TRENDING', icon: '🔥' },
]

export default function DataCenterPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showQuickCollect, setShowQuickCollect] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [collectResult, setCollectResult] = useState<string | null>(null)
  const [collectError, setCollectError] = useState<string | null>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  // 快捷采集表单状态
  const [taskName, setTaskName] = useState('')
  const [platform, setPlatform] = useState('抖音')
  const [keywordsInput, setKeywordsInput] = useState('')
  const [maxResults, setMaxResults] = useState(20)

  const refreshData = useCallback(() => {
    fetch('/api/data-center', { credentials: 'include' })
      .then(r => r.json())
      .then(res => {
        if (res.success) setData(res.data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refreshData()
  }, [refreshData])

  // 自动轮询：有任务在运行时每5秒刷新
  useEffect(() => {
    if (data?.tasks?.stats?.running && data.tasks.stats.running > 0) {
      pollRef.current = setInterval(refreshData, 5000)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [data?.tasks?.stats?.running, refreshData])

  // 执行快捷采集
  const handleQuickCollect = async () => {
    if (!taskName.trim()) { setCollectError('请输入任务名称'); return }
    if (!keywordsInput.trim()) { setCollectError('请输入至少一个关键词'); return }

    const keywords = keywordsInput.split(/[,，\n]/).map(k => k.trim()).filter(Boolean)
    setCollecting(true)
    setCollectResult(null)
    setCollectError(null)

    try {
      // Step 1: 创建任务
      const createRes = await fetch('/api/lead-collector', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-task',
          data: { name: taskName, platform, keywords, schedule: 'manual', status: 'active' }
        })
      })
      const createData = await createRes.json()
      if (!createData.success) throw new Error(createData.message || '创建任务失败')

      // Step 2: 立即执行
      const runRes = await fetch('/api/lead-collector', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run-task',
          data: { taskId: createData.data.id, platform: platform === '抖音' ? 'douyin' : platform, maxResults }
        })
      })
      const runData = await runRes.json()

      if (runData.success) {
        const stats = runData.data
        setCollectResult(
          `采集完成！获取 ${stats.videos || 0} 个视频、${stats.comments || 0} 条评论、` +
          `提取 ${stats.leads || 0} 条线索（耗时 ${stats.elapsed || '?'}s）`
        )
        setShowQuickCollect(false)
        refreshData()
      } else {
        throw new Error(runData.message || '采集执行失败')
      }
    } catch (err: any) {
      setCollectError(err.message || '采集失败')
    } finally {
      setCollecting(false)
    }
  }

  const statusColor: Record<string, string> = {
    new: 'bg-blue-500/20 text-blue-400',
    contacted: 'bg-yellow-500/20 text-yellow-400',
    qualified: 'bg-emerald-500/20 text-emerald-400',
    converted: 'bg-green-500/20 text-green-400',
    lost: 'bg-red-500/20 text-red-400',
  }

  const taskStatusColor: Record<string, string> = {
    pending: 'bg-gray-500/20 text-gray-400',
    running: 'bg-emerald-500/20 text-emerald-400 animate-pulse',
    completed: 'bg-purple-500/20 text-purple-400',
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 页头 */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <p className="text-label mb-2">数据管理中心 / DATA CENTER</p>
            <h1 className="text-mono-lg text-white">综合数据面板 / DASHBOARD</h1>
            {data?.tasks?.stats?.running ? (
              <span className="inline-flex items-center gap-2 mt-2 px-3 py-1 bg-emerald-500/15 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm font-mono">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                {data.tasks.stats.running} 个任务正在采集中...（自动刷新中）
              </span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowQuickCollect(!showQuickCollect)}
              className={`px-4 py-2 rounded-xl font-mono text-sm transition-colors ${
                showQuickCollect
                  ? 'bg-gray-600 text-white'
                  : 'bg-emerald-500 text-white hover:bg-emerald-600'
              }`}
            >
              {showQuickCollect ? '✕ 关闭' : '🚀 快捷采集'}
            </button>
            <Link
              href="/lead-collector"
              className="px-4 py-2 bg-white/10 text-gray-300 rounded-xl hover:bg-white/20 font-mono text-sm border border-white/10"
            >
              高级任务 →
            </Link>
          </div>
        </div>

        {/* ===== 快捷采集面板 ===== */}
        {showQuickCollect && (
          <div className="mb-8 p-6 bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 border border-emerald-500/20 rounded-2xl">
            <h3 className="text-base font-semibold text-white font-mono mb-4 flex items-center gap-2">
              🚀 快捷采集任务 / QUICK COLLECT
              <span className="text-xs text-gray-500 font-normal">创建并立即执行</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              {/* 任务名称 */}
              <div className="lg:col-span-2">
                <label className="block text-xs text-gray-400 font-mono mb-1">任务名称 *</label>
                <input
                  type="text"
                  value={taskName}
                  onChange={e => setTaskName(e.target.value)}
                  placeholder='如：美业引流-日常采集'
                  className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white text-sm font-mono placeholder:text-gray-600 focus:border-emerald-500/50 outline-none"
                />
              </div>

              {/* 平台选择 */}
              <div>
                <label className="block text-xs text-gray-400 font-mono mb-1">目标平台</label>
                <select
                  value={platform}
                  onChange={e => setPlatform(e.target.value)}
                  className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white text-sm font-mono focus:border-emerald-500/50 outline-none"
                >
                  <option value="抖音">抖音 Douyin</option>
                  <option value="小红书">小红书 RED</option>
                  <option value="快手">快手 Kuaishou</option>
                  <option value="B站">哔哩哔哩 Bilibili</option>
                </select>
              </div>

              {/* 每关键词结果数 */}
              <div>
                <label className="block text-xs text-gray-400 font-mono mb-1">每词视频数</label>
                <select
                  value={maxResults}
                  onChange={e => setMaxResults(Number(e.target.value))}
                  className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white text-sm font-mono focus:border-emerald-500/50 outline-none"
                >
                  <option value={10}>10 个视频</option>
                  <option value={20}>20 个视频 (推荐)</option>
                  <option value={50}>50 个视频</option>
                </select>
              </div>
            </div>

            {/* 关键词输入 */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 font-mono mb-1">采集关键词 * （每行一个，或用逗号分隔）</label>
              <textarea
                value={keywordsInput}
                onChange={e => setKeywordsInput(e.target.value)}
                placeholder={'美业引流\n美容院推广\n减肥瘦身\n同城探店'}
                rows={3}
                className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white text-sm font-mono placeholder:text-gray-600 focus:border-emerald-500/50 outline-none resize-y"
              />
              {keywordsInput.trim() && (
                <p className="mt-1 text-xs text-gray-500 font-mono">
                  已输入 {keywordsInput.split(/[,，\n]/).map(k => k.trim()).filter(Boolean).length} 个关键词
                </p>
              )}
            </div>

            {/* 错误提示 */}
            {collectError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-mono">
                ✕ {collectError}
              </div>
            )}

            {/* 成功结果 */}
            {collectResult && (
              <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm font-mono">
                ✅ {collectResult}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex items-center justify-between">
              <button
                onClick={handleQuickCollect}
                disabled={collecting}
                className={`px-6 py-2.5 rounded-xl font-mono text-sm transition-colors ${
                  collecting
                    ? 'bg-gray-700 text-gray-400 cursor-wait'
                    : 'bg-emerald-500 text-white hover:bg-emerald-600'
                }`}
              >
                {collecting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                    正在执行采集...
                  </span>
                ) : (
                  '🚀 创建并立即采集'
                )}
              </button>
              <p className="text-[11px] text-gray-600 font-mono">
                提示：首次使用需在 管理中心→设置 中配置 MediaCrawler 并扫码登录
                <Link href="/admin/settings" className="text-cyan-500 hover:text-cyan-400 ml-1">去配置 →</Link>
              </p>
            </div>
          </div>
        )}

        {/* 导航 Tab */}
        <div className="flex gap-2 mb-8 flex-wrap">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-4 py-2 rounded-xl font-medium font-mono transition-colors ${
                item.href === '/data-center'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10'
              }`}
            >
              <span>{item.label}</span>
              <span className="text-xs opacity-50 ml-1">{item.en}</span>
            </Link>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-24">
            <p className="text-gray-500 font-mono animate-pulse">LOADING...</p>
          </div>
        ) : !data ? (
          <div className="text-center py-24">
            <p className="text-red-400 font-mono">加载失败，请刷新重试</p>
          </div>
        ) : (
          <>
            {/* ========== 核心指标卡片 ========== */}
            <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
              {[
                { label: '视频总数', value: data.overview.totalVideos, color: 'text-blue-400', sub: 'VIDEOS' },
                { label: '评论总数', value: data.overview.totalComments, color: 'text-purple-400', sub: 'COMMENTS' },
                { label: '线索总数', value: data.overview.totalLeads, color: 'text-emerald-400', sub: 'LEADS' },
                { label: '用户画像', value: data.overview.totalUsers, color: 'text-cyan-400', sub: 'USERS' },
                { label: '热门话题', value: data.overview.totalTrending, color: 'text-orange-400', sub: 'TRENDING' },
                { label: '采集任务', value: data.overview.totalTasks, color: 'text-pink-400', sub: 'TASKS' },
              ].map(card => (
                <div key={card.label} className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5 hover:border-white/20 transition-colors">
                  <p className="text-xs text-gray-500 font-mono mb-1">{card.sub}</p>
                  <p className={`text-3xl font-bold font-mono ${card.color}`}>{card.value.toLocaleString()}</p>
                  <p className="text-sm text-gray-400 mt-1">{card.label}</p>
                </div>
              ))}
            </section>

            {/* ========== 两列布局 ========== */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* 左：平台分布 + 线索状态 */}
              <div className="space-y-6">
                {/* 平台视频分布 */}
                <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                  <h3 className="text-base font-semibold text-white font-mono mb-4">
                    平台分布 / PLATFORM
                  </h3>
                  {data.platformDistribution.length > 0 ? (
                    <div className="space-y-3">
                      {data.platformDistribution.map(p => {
                        const maxCount = Math.max(...data.platformDistribution.map(d => d.count), 1)
                        const pct = Math.round((p.count / maxCount) * 100)
                        return (
                          <div key={p.platform} className="flex items-center gap-3">
                            <span className="w-14 text-sm text-gray-400 font-mono shrink-0">{p.platform}</span>
                            <div className="flex-1 h-6 bg-white/5 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-16 text-right text-sm text-white font-mono">{p.count.toLocaleString()}</span>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-gray-500 font-mono text-center py-6">暂无数据（请先执行采集任务）</p>
                  )}
                </div>

                {/* 线索状态分布 */}
                <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                  <h3 className="text-base font-semibold text-white font-mono mb-4">
                    线索状态 / LEAD STATUS
                  </h3>
                  {data.leadStatus.length > 0 ? (
                    <div className="flex flex-wrap gap-3">
                      {data.leadStatus.map(s => (
                        <div key={s.status} className={`px-4 py-2 rounded-xl ${statusColor[s.status] || 'bg-white/10 text-gray-300'} font-mono`}>
                          <span className="text-lg font-bold mr-2">{s.count}</span>
                          <span>{s.status.toUpperCase()}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 font-mono text-center py-6">暂无线索数据</p>
                  )}
                </div>
              </div>

              {/* 右：每日趋势 + Top 视频 */}
              <div className="space-y-6">
                {/* 近7天趋势 */}
                <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                  <h3 className="text-base font-semibold text-white font-mono mb-4">
                    近7天线索趋势 / 7-DAY TREND
                  </h3>
                  {data.dailyTrend.length > 0 ? (
                    <div className="flex items-end gap-1.5 h-32">
                      {(() => {
                        const maxVal = Math.max(...data.dailyTrend.map(d => d.count), 1)
                        return data.dailyTrend.map((d, i) => {
                          const h = maxVal > 0 ? Math.max((d.count / maxVal) * 100, d.count > 0 ? 4 : 0) : 0
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                              <span className="text-xs text-gray-500 font-mono">{d.count || ''}</span>
                              <div
                                className="w-full bg-gradient-to-t from-emerald-500 to-cyan-400 rounded-t transition-all duration-500 min-h-[4px]"
                                style={{ height: `${h}%` }}
                              />
                              <span className="text-[10px] text-gray-600 font-mono mt-1">
                                {d.date.slice(5)}
                              </span>
                            </div>
                          )
                        })
                      })()}
                    </div>
                  ) : (
                    <p className="text-gray-500 font-mono text-center py-12">近7天无新增线索</p>
                  )}
                </div>

                {/* 热门视频 Top 5 */}
                <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                  <h3 className="text-base font-semibold text-white font-mono mb-4">
                    热门视频 TOP 5 / HOT VIDEOS
                  </h3>
                  {data.topVideos.length > 0 ? (
                    <div className="space-y-3">
                      {data.topVideos.map((v, i) => (
                        <div key={v.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-mono ${
                            i < 3 ? 'bg-orange-500/30 text-orange-400' : 'bg-white/10 text-gray-500'
                          }`}>
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white font-mono truncate" title={v.title}>
                              {v.title}
                            </p>
                            <p className="text-xs text-gray-500 font-mono">
                              {v.authorName || '-'} · {v.platform}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-red-400 font-mono">❤️ {v.likeCount}</span>
                            <span className="text-xs text-gray-500 font-mono">💬 {v.commentCount}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 font-mono text-center py-8">暂无视频数据</p>
                  )}
                </div>
              </div>
            </div>

            {/* ========== 底部：最近采集任务 ========== */}
            <section className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-white font-mono">
                  最近采集任务 / RECENT TASKS
                </h3>
                <Link href="/lead-collector" className="text-sm text-emerald-400 hover:text-emerald-300 font-mono">
                  查看全部 →
                </Link>
              </div>

              {data.tasks.list.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono">
                    <thead>
                      <tr className="border-b border-white/10 text-xs text-gray-500">
                        <th className="py-2 px-3">ID</th>
                        <th className="py-2 px-3">任务名称</th>
                        <th className="py-2 px-3">平台</th>
                        <th className="py-2 px-3">状态</th>
                        <th className="py-2 px-3 text-center">视频</th>
                        <th className="py-2 px-3 text-center">线索</th>
                        <th className="py-2 px-3">创建时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.tasks.list.map(t => (
                        <tr key={t.id} className="hover:bg-white/5 transition-colors">
                          <td className="py-3 px-3 text-sm text-gray-400">#{t.id}</td>
                          <td className="py-3 px-3 text-sm text-white font-medium">{t.name}</td>
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded">
                              {t.platform}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 text-xs rounded-full font-mono ${taskStatusColor[t.status] || ''}`}>
                              {(t.status as string).toUpperCase()}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center text-sm text-blue-400">{t._count.crawledVideos}</td>
                          <td className="py-3 px-3 text-center text-sm text-emerald-400">{t._count.leads}</td>
                          <td className="py-3 px-3 text-xs text-gray-500">
                            {new Date(t.createdAt).toLocaleDateString('zh-CN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500 font-mono mb-3">NO TASKS YET</p>
                  <Link href="/lead-collector" className="text-sm text-emerald-400 hover:text-emerald-300 font-mono">
                    去创建第一个采集任务 →
                  </Link>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
