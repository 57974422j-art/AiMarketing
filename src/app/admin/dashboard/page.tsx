'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'

interface DashboardData {
  todayPublished: number; followerGrowth: number; successRate: number; onlineRate: number
  totalTasks: number; totalAccounts: number; totalDevices: number
}

export default function AdminDashboardPage() {
  const { user, loading: authLoading } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadDashboard()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadDashboard = async () => {
    try { const r = await fetch('/api/admin/dashboard', { credentials: 'include' }); if (r.ok) setData((await r.json()).data) }
    catch {} finally { setLoading(false) }
  }

  if (authLoading || loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400">无权限</div></div>

  const cards = [
    { label: '今日发布', value: data?.todayPublished ?? 0, icon: '📤', color: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30' },
    { label: '粉丝增长（7天）', value: (data?.followerGrowth ?? 0) > 0 ? `+${data?.followerGrowth}` : '0', icon: '📈', color: 'from-blue-500/20 to-blue-500/5 border-blue-500/30' },
    { label: '任务成功率', value: `${data?.successRate ?? 0}%`, icon: '✅', color: 'from-purple-500/20 to-purple-500/5 border-purple-500/30' },
    { label: '设备在线率', value: `${data?.onlineRate ?? 0}%`, icon: '🖥️', color: 'from-amber-500/20 to-amber-500/5 border-amber-500/30' },
  ]
  const extras = [
    { label: '总任务数', value: data?.totalTasks ?? 0 },
    { label: '已绑定账号', value: data?.totalAccounts ?? 0 },
    { label: '总设备数', value: data?.totalDevices ?? 0 },
  ]

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">管理后台 / ADMIN</p>
          <h1 className="text-mono-lg text-white">数据统计 / DASHBOARD</h1>
          <p className="text-gray-400 text-sm mt-2">实时数据概览</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {cards.map(c => (
            <div key={c.label} className={`card-glass p-5 border bg-gradient-to-br ${c.color}`}>
              <div className="text-2xl mb-2">{c.icon}</div>
              <div className="text-2xl md:text-3xl font-bold text-white">{c.value}</div>
              <div className="text-xs text-gray-400 mt-1">{c.label}</div>
            </div>
          ))}
        </div>

        <div className="card-glass p-6">
          <h2 className="text-white font-bold mb-4">其他统计</h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            {extras.map(e => (
              <div key={e.label}>
                <div className="text-2xl font-bold text-emerald-400">{e.value}</div>
                <div className="text-xs text-gray-500 mt-1">{e.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
