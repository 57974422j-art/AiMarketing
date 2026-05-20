'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface SocialAccountItem {
  id: number
  platform: string
  username: string
  status: string
  deviceId: number | null
  device: { id: number; name: string } | null
  user: { id: number; username: string; name: string | null }
  createdAt: string
}

export default function AdminSocialAccountsPage() {
  const { user, loading: authLoading } = useAuth()
  const [accounts, setAccounts] = useState<SocialAccountItem[]>([])
  const [pending, setPending] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showBind, setShowBind] = useState(false)
  const [binding, setBinding] = useState(false)
  const [platform, setPlatform] = useState('抖音')
  const [accUsername, setAccUsername] = useState('')
  const [accPassword, setAccPassword] = useState('')
  const [deviceId, setDeviceId] = useState('')

  const platforms = ['抖音', '快手', '小红书', '视频号', '微博', 'B站']

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') {
      loadAccounts()
    } else if (!authLoading) {
      setLoading(false)
    }
  }, [authLoading, user])

  const loadAccounts = async () => {
    try {
      const [sRes, aRes] = await Promise.all([
        fetch('/api/social-accounts', { credentials: 'include' }),
        fetch('/api/accounts', { credentials: 'include' }),
      ])
      if (sRes.ok) { const d = await sRes.json(); setAccounts(d.data || []) }
      if (aRes.ok) {
        let d = await aRes.json()
        if (!Array.isArray(d)) d = d.data || []
        // 只显示未绑定设备的登记（避免重复）
        const boundAccountIds = new Set((d as any[]).filter((a: any) => a.isBound).map((a: any) => a.id))
        setPending((d as any[]).filter((a: any) => !boundAccountIds.has(a.id)))
      }
    } catch {
      console.error('加载账号列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleBind = async () => {
    if (!accUsername.trim() || !accPassword.trim()) { showToast('请填写账号名称和密码', 'error'); return }
    setBinding(true)
    try {
      const res = await fetch('/api/social-accounts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          username: accUsername,
          password: accPassword,
          deviceId: deviceId ? parseInt(deviceId, 10) : null,
        }),
      })
      if (res.ok) {
        setShowBind(false)
        setAccUsername('')
        setAccPassword('')
        setDeviceId('')
        loadAccounts()
        showToast('账号绑定成功')
      } else {
        const d = await res.json()
        showToast(d.message || '绑定失败', 'error')
      }
    } catch {
      showToast('绑定失败', 'error')
    } finally {
      setBinding(false)
    }
  }

  const statusColor = (s: string) => {
    switch (s) {
      case '已绑定': return 'text-emerald-400'
      case '未绑定': return 'text-gray-400'
      case '已封禁': return 'text-red-400'
      default: return 'text-gray-400'
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </div>
    )
  }

  if (!user || user.role === 'end-user') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-red-400 text-center">
          <p className="text-xl mb-2">无权限访问</p>
          <p className="text-gray-500">仅管理员和二级客户可访问</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">管理后台 / ADMIN</p>
            <h1 className="text-mono-lg text-white">社交账号管理 / SOCIAL ACCOUNTS</h1>
            <p className="text-gray-400 text-sm mt-2">
              账号总数：<span className="text-emerald-400 font-bold">{accounts.length}</span>
            </p>
          </div>
          <button onClick={() => setShowBind(!showBind)} className="btn-primary">
            {showBind ? '取消' : '+ 绑定账号'}
          </button>
        </div>

        {showBind && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4">绑定社交账号</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-gray-500 text-xs block mb-1">平台</label>
                <select
                  className="input-dark"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                >
                  {platforms.map((p) => (
                    <option key={p} value={p} className="bg-gray-900">{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">设备ID（可选）</label>
                <input
                  className="input-dark"
                  type="number"
                  placeholder="关联设备ID"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                />
              </div>
              <input
                className="input-dark"
                placeholder="账号名称 *"
                value={accUsername}
                onChange={(e) => setAccUsername(e.target.value)}
              />
              <input
                className="input-dark"
                type="password"
                placeholder="密码 *"
                value={accPassword}
                onChange={(e) => setAccPassword(e.target.value)}
              />
            </div>
            <button onClick={handleBind} className="btn-primary" disabled={!accUsername.trim() || !accPassword.trim() || binding}>
              {binding ? '绑定中...' : '确认绑定'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-400 py-12">加载中...</div>
        ) : (
          <>
          {/* 待处理登记 */}
          {pending.length > 0 && (
            <div className="mb-6">
              <h3 className="text-yellow-400 text-sm font-medium mb-3 flex items-center gap-2">
                <span>⏳</span> 待处理登记 / PENDING
                <span className="text-xs text-gray-500 font-normal">（{pending.length} 条）</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {pending.map((p: any) => {
                  const platformIcon: Record<string, string> = { douyin: '🎵', kuaishou: '📹', xiaohongshu: '📕', shipinhao: '💚', weibo: '📢', bilibili: '📺' }
                  return (
                    <div key={p.id} className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span>{platformIcon[p.platform] || '📱'}</span>
                        <span className="text-white font-medium text-sm">{p.accountName}</span>
                        <span className="text-xs text-gray-500 ml-auto">{p.platform}</span>
                      </div>
                      <div className="text-[10px] text-gray-500 space-y-0.5 mb-3">
                        {p.mobile && <p>📱 {p.mobile}</p>}
                        {p.accountId && <p className="truncate">🔗 {p.accountId}</p>}
                        {p.remark && <p>📝 {p.remark}</p>}
                      </div>
                      <button onClick={() => { setPlatform(p.platform === 'douyin' ? '抖音' : p.platform === 'kuaishou' ? '快手' : p.platform === 'xiaohongshu' ? '小红书' : '抖音'); setAccUsername(p.accountName); setShowBind(true) }}
                        className="w-full text-xs py-1.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/30 transition">
                        📋 处理此账号
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 已绑定账号 */}
          <h3 className={`text-white text-sm font-medium mb-3 flex items-center gap-2 ${pending.length > 0 ? '' : 'mt-0'}`}>
            <span>✅</span> 已绑定账号 / BOUND
            <span className="text-xs text-gray-500 font-normal">（{accounts.length} 个）</span>
          </h3>
          {accounts.length === 0 ? (
            <div className="card-glass p-12 text-center">
              <p className="text-gray-400">暂无已绑定的社交账号</p>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-gray-500 text-mono-sm">
                  <th className="pb-3 pr-4">ID</th>
                  <th className="pb-3 pr-4">平台</th>
                  <th className="pb-3 pr-4">账号</th>
                  <th className="pb-3 pr-4">状态</th>
                  <th className="pb-3 pr-4">关联设备</th>
                  <th className="pb-3 pr-4">所属用户</th>
                  <th className="pb-3 pr-4">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-3 pr-4 text-gray-400">{a.id}</td>
                    <td className="py-3 pr-4">
                      <span className="bg-white/5 px-2 py-0.5 rounded text-xs">{a.platform}</span>
                    </td>
                    <td className="py-3 pr-4 text-white font-medium">{a.username}</td>
                    <td className={`py-3 pr-4 font-medium ${statusColor(a.status)}`}>{a.status}</td>
                    <td className="py-3 pr-4 text-gray-400">{a.device?.name || '-'}</td>
                    <td className="py-3 pr-4 text-gray-400">{a.user?.username || '-'}</td>
                    <td className="py-3 pr-4 text-gray-500 text-xs">{new Date(a.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </>
      )}
      </div>
    </div>
  )
}
