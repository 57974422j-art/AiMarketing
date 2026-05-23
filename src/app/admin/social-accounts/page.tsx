'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface DeviceItem { id: number; name: string; status: string; apiPort?: number }
interface AccountItem {
  id: number; platform: string; accountName: string; mobile: string; password: string
  accountId: string; status: string; bindType: string; deviceId: number | null; remark: string
  user: { id: number; username: string; name: string | null; parentId: number | null; parent: { id: number; username: string; name: string | null } | null }
  device: { id: number; name: string } | null; createdAt: string
}

const PLATFORM_ICON: Record<string, string> = {
  douyin: '🎵', kuaishou: '📹', xiaohongshu: '📕', shipinhao: '💚', weibo: '📢', bilibili: '📺',
}
const PLATFORM_LABEL: Record<string, string> = {
  douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书', shipinhao: '视频号', weibo: '微博', bilibili: 'B站',
}

const STATUS_COLOR: Record<string, string> = {
  '未绑定': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  '已绑定': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  '登录异常': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  '已封禁': 'bg-red-500/20 text-red-400 border-red-500/30',
}

export default function SocialAccountsPage() {
  const { user, loading: authLoading } = useAuth()
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [devices, setDevices] = useState<DeviceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // 绑定弹窗
  const [bindId, setBindId] = useState<number | null>(null)
  const [bindDeviceId, setBindDeviceId] = useState('')
  const [binding, setBinding] = useState(false)

  // 展开状态: Set<`editor_${id}`|`user_${id}`>
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') load()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const load = useCallback(async () => {
    try {
      const [aRes, dRes] = await Promise.all([
        fetch('/api/accounts', { credentials: 'include' }),
        user?.role !== 'end-user' ? fetch('/api/devices', { credentials: 'include' }) : Promise.resolve(null),
      ])
      if (aRes.ok) { const d = await aRes.json(); setAccounts(d.data || []) }
      if (dRes?.ok) { const d = await dRes.json(); setDevices((d.data || []).filter((dev: any) => dev.type === 'q1')) }
    } catch {} finally { setLoading(false) }
  }, [user])

  const handleBind = async () => {
    if (!bindId || !bindDeviceId) { showToast('请选择设备', 'error'); return }
    setBinding(true)
    try {
      const r = await fetch('/api/accounts', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: bindId, deviceId: parseInt(bindDeviceId) }) })
      if (r.ok) { showToast('绑定成功', 'success'); setBindId(null); setBindDeviceId(''); load() }
      else { const d = await r.json(); showToast(d.message || '失败', 'error') }
    } catch { showToast('绑定失败', 'error') } finally { setBinding(false) }
  }

  const toggle = (key: string) => {
    setExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  // 搜索过滤
  const filtered = useMemo(() => {
    if (!search.trim()) return accounts
    const s = search.toLowerCase()
    return accounts.filter(a =>
      a.accountName.toLowerCase().includes(s) ||
      a.user?.username?.toLowerCase().includes(s) ||
      a.platform.toLowerCase().includes(s) ||
      a.mobile.includes(s)
    )
  }, [accounts, search])

  // admin: 按 editor → user 分组
  const adminGroups = useMemo(() => {
    const map: Record<string, AccountItem[]> = {}
    filtered.forEach(a => {
      const editorKey = a.user?.parent?.username || '未归属'
      if (!map[editorKey]) map[editorKey] = []
      map[editorKey].push(a)
    })
    return Object.entries(map).sort(([a], [b]) => a === '未归属' ? 1 : b === '未归属' ? -1 : a.localeCompare(b))
  }, [filtered])

  // editor: 按 user 分组
  const userGroups = useMemo(() => {
    const map: Record<string, AccountItem[]> = {}
    filtered.forEach(a => {
      const key = a.user?.username || '未知'
      if (!map[key]) map[key] = []
      map[key].push(a)
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  if (authLoading || loading) return <Loading />
  if (!user || user.role === 'end-user') return <NoAccess />

  const isAdmin = user.role === 'admin'
  const statusCount = (items: AccountItem[], s: string) => items.filter(a => a.status === s).length

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <p className="text-label mb-2">管理后台 / ACCOUNTS</p>
          <h1 className="text-mono-lg text-white">{isAdmin ? '账号总览 / ALL ACCOUNTS' : '社交账号 / SOCIAL ACCOUNTS'}</h1>
          <p className="text-gray-400 text-sm mt-1">{accounts.length} 个账号 · {accounts.filter(a => a.status === '已绑定').length} 已绑定</p>
          {/* 搜索 */}
          <input className="input-dark mt-3 w-full max-w-md text-sm" placeholder="🔍 搜索账号名/用户名/手机号..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* 绑定弹窗 */}
        {bindId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setBindId(null)}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold mb-1">绑定设备</h3>
              <p className="text-xs text-gray-500 mb-4">选择要绑定的 Q1 设备容器</p>
              <select className="input-dark w-full mb-4" value={bindDeviceId} onChange={e => setBindDeviceId(e.target.value)}>
                <option value="">选择设备...</option>
                {devices.filter(d => d.status === 'online').map(d => <option key={d.id} value={d.id} className="bg-gray-900">{d.name} (端口{d.apiPort})</option>)}
              </select>
              <div className="flex gap-3">
                <button onClick={() => setBindId(null)} className="flex-1 py-2 border border-white/10 text-gray-400 rounded-lg hover:bg-white/10 text-sm">取消</button>
                <button onClick={handleBind} disabled={binding || !bindDeviceId} className="flex-1 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 text-sm">{binding ? '绑定中...' : '确认绑定'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Admin 视图：Editor → 用户 → 平台 ── */}
        {isAdmin ? (
          <div className="space-y-3">
            {adminGroups.map(([editorName, editorAccounts]) => (
              <div key={editorName} className="card-glass overflow-hidden">
                {/* Editor 级 */}
                <button onClick={() => toggle(`editor_${editorName}`)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">👤</span>
                    <span className="text-white font-semibold">{editorName}</span>
                    <span className="text-xs text-gray-500">
                      {editorAccounts.length} 个记录 · {statusCount(editorAccounts, '已绑定')} 已绑定 · {statusCount(editorAccounts, '未绑定')} 待绑
                    </span>
                  </div>
                  <span className={`text-gray-500 transition text-xs ${expanded.has(`editor_${editorName}`) ? 'rotate-180' : ''}`}>▼</span>
                </button>
                {/* 用户级 */}
                {expanded.has(`editor_${editorName}`) && (
                  <div className="border-t border-white/5 px-5 pb-4 pt-2 space-y-1">
                    {Object.entries(
                      editorAccounts.reduce<Record<string, AccountItem[]>>((acc, a) => {
                        const key = a.user?.username || '未知'
                        if (!acc[key]) acc[key] = []
                        acc[key].push(a)
                        return acc
                      }, {})
                    ).map(([userName, userAccounts]) => (
                      <div key={userName}>
                        <button onClick={() => toggle(`user_${editorName}_${userName}`)}
                          className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg transition">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-gray-400">└─</span>
                            <span className="text-gray-300">{userName}</span>
                            <span className="text-[10px] text-gray-500">
                              · {userAccounts.length} 平台 · {statusCount(userAccounts, '已绑定')} 已绑
                            </span>
                          </div>
                          <span className={`text-gray-600 text-[10px] transition ${expanded.has(`user_${editorName}_${userName}`) ? 'rotate-180' : ''}`}>▾</span>
                        </button>
                        {/* 平台级 */}
                        {expanded.has(`user_${editorName}_${userName}`) && (
                          <div className="ml-8 mt-1 space-y-1">
                            {userAccounts.map(a => (
                              <div key={a.id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg text-xs">
                                <div className="flex items-center gap-2">
                                  <span>{PLATFORM_ICON[a.platform] || '📱'}</span>
                                  <span className="text-white">{PLATFORM_LABEL[a.platform] || a.platform}</span>
                                  <span className="text-gray-400">· {a.accountName}</span>
                                  {a.mobile && <span className="text-gray-600">📱{a.mobile}</span>}
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] border ${STATUS_COLOR[a.status] || 'bg-gray-500/20 text-gray-500'}`}>{a.status}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {a.device && <span className="text-gray-600">{a.device.name}</span>}
                                  {a.status !== '已绑定' && (
                                    <button onClick={() => { setBindId(a.id); setBindDeviceId('') }}
                                      className="text-[10px] px-2 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/30">+ 绑</button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {adminGroups.length === 0 && <div className="card-glass p-8 text-center text-gray-500">暂无数据</div>}
          </div>
        ) : (
          /* ── Editor 视图：用户 → 平台 ── */
          <div className="space-y-3">
            {/* 待绑定区域置顶 */}
            {filtered.some(a => a.status !== '已绑定') && (
              <div className="card-glass p-4">
                <h3 className="text-yellow-400 text-xs font-medium mb-2 flex items-center gap-2">⏳ 待绑定</h3>
                <div className="space-y-1">
                  {filtered.filter(a => a.status !== '已绑定').map(a => (
                    <PlatformRow key={a.id} account={a} devices={devices} onBind={() => { setBindId(a.id); setBindDeviceId('') }} />
                  ))}
                </div>
              </div>
            )}
            {/* 已绑定按用户分组折叠 */}
            <div className="space-y-1">
              {userGroups.map(([userName, userAccounts]) => {
                const boundItems = userAccounts.filter(a => a.status === '已绑定')
                if (boundItems.length === 0) return null
                return (
                  <div key={userName} className="card-glass overflow-hidden">
                    <button onClick={() => toggle(`editor_${userName}`)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/5 transition">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">👤</span>
                        <span className="text-white text-sm font-medium">{userName}</span>
                        <span className="text-[10px] text-gray-500">· {boundItems.length} 平台</span>
                      </div>
                      <span className={`text-gray-500 text-xs transition ${expanded.has(`editor_${userName}`) ? 'rotate-180' : ''}`}>▼</span>
                    </button>
                    {expanded.has(`editor_${userName}`) && (
                      <div className="border-t border-white/5 px-5 pb-3 pt-1 space-y-1">
                        {boundItems.map(a => <PlatformRow key={a.id} account={a} devices={devices} onBind={() => { setBindId(a.id); setBindDeviceId('') }} />)}
                      </div>
                    )}
                  </div>
                )
              })}
              {userGroups.length === 0 && <div className="card-glass p-6 text-center text-gray-500 text-sm">暂无已绑定账号</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// 单行平台显示组件
function PlatformRow({ account, devices, onBind }: { account: AccountItem; devices: DeviceItem[]; onBind: () => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg text-xs">
      <div className="flex items-center gap-2">
        <span>{PLATFORM_ICON[account.platform] || '📱'}</span>
        <span className="text-white">{PLATFORM_LABEL[account.platform] || account.platform}</span>
        <span className="text-gray-400">· {account.accountName}</span>
        {account.mobile && <span className="text-gray-600">📱{account.mobile}</span>}
        <span className={`px-1.5 py-0.5 rounded text-[10px] border ${STATUS_COLOR[account.status] || 'bg-gray-500/20 text-gray-500'}`}>{account.status}</span>
        {account.device && <span className="text-gray-600">({account.device.name})</span>}
      </div>
      <div className="flex items-center gap-2">
        {account.device && (
          <button onClick={() => window.open(`http://120.55.43.195:${devices.find(d => d.id === account.device?.id)?.apiPort || ''}/snap`, '_blank')}
            className="text-[10px] px-2 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/30"
            title="查看 Q1 容器屏幕截图">
            🖥️ 远程
          </button>
        )}
        {account.status !== '已绑定' && (
          <button onClick={onBind} className="text-[10px] px-2 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/30">+ 绑定</button>
        )}
      </div>
    </div>
  )
}

function Loading() { return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" /></div> }
function NoAccess() { return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-red-400">无权限</p></div> }
