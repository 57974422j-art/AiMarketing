'use client'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface DeviceItem { id: number; name: string; status: string; apiPort?: number }
interface AccountItem {
  id: number; platform: string; accountName: string; mobile: string; password: string
  accountId: string; status: string; bindType: string; deviceId: number | null; remark: string
  user: { id: number; username: string; name: string | null }
  device: { id: number; name: string } | null; createdAt: string
}

const PLATFORM_ICON: Record<string, string> = {
  douyin: '🎵', kuaishou: '📹', xiaohongshu: '📕', shipinhao: '💚', weibo: '📢', bilibili: '📺',
}

const STATUS_COLOR: Record<string, string> = {
  '未绑定': 'bg-gray-500/20 text-gray-400',
  '已绑定': 'bg-emerald-500/20 text-emerald-400',
  '登录异常': 'bg-yellow-500/20 text-yellow-400',
  '已封禁': 'bg-red-500/20 text-red-400',
}

export default function SocialAccountsPage() {
  const { user, loading: authLoading } = useAuth()
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [devices, setDevices] = useState<DeviceItem[]>([])
  const [loading, setLoading] = useState(true)

  // 绑定弹窗
  const [bindId, setBindId] = useState<number | null>(null)
  const [bindDeviceId, setBindDeviceId] = useState('')
  const [binding, setBinding] = useState(false)

  // 管理员折叠
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

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

  if (authLoading || loading) return <Loading />
  if (!user || user.role === 'end-user') return <NoAccess />

  const isAdmin = user.role === 'admin'

  // admin 按用户名分组
  const grouped = isAdmin
    ? accounts.reduce<Record<string, AccountItem[]>>((acc, a) => {
        const key = a.user?.username || '未知'
        if (!acc[key]) acc[key] = []
        acc[key].push(a)
        return acc
      }, {})
    : { '': accounts }

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <p className="text-label mb-2">管理后台 / ACCOUNTS</p>
          <h1 className="text-mono-lg text-white">{isAdmin ? '账号总览 / ALL ACCOUNTS' : '社交账号 / SOCIAL ACCOUNTS'}</h1>
          <p className="text-gray-400 text-sm mt-1">
            {isAdmin ? `共 ${accounts.length} 条登记，${accounts.filter(a => a.status === '已绑定').length} 个已绑定` : '为终端账号绑定设备'}
          </p>
        </div>

        {/* 绑定弹窗 */}
        {bindId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setBindId(null)}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold mb-1">绑定设备</h3>
              <p className="text-xs text-gray-500 mb-4">选择要绑定的 Q1 设备容器</p>
              <select className="input-dark w-full mb-4" value={bindDeviceId} onChange={e => setBindDeviceId(e.target.value)}>
                <option value="">选择设备...</option>
                {devices.map(d => <option key={d.id} value={d.id} className="bg-gray-900">{d.name} (端口{d.apiPort})</option>)}
              </select>
              <div className="flex gap-3">
                <button onClick={() => setBindId(null)} className="flex-1 py-2 border border-white/10 text-gray-400 rounded-lg hover:bg-white/10 text-sm">取消</button>
                <button onClick={handleBind} disabled={binding || !bindDeviceId} className="flex-1 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 text-sm">{binding ? '绑定中...' : '确认绑定'}</button>
              </div>
            </div>
          </div>
        )}

        {/* 列表 */}
        {!isAdmin ? (
          <EditorAccounts accounts={accounts} devices={devices} onBind={(id) => { setBindId(id); setBindDeviceId('') }} />
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([username, items]) => {
              const bound = items.filter(a => a.status === '已绑定').length
              const expanded = expandedGroups.has(username)
              return (
                <div key={username} className="card-glass">
                  <button onClick={() => toggleGroup(username)}
                    className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">👤</span>
                      <span className="text-white font-medium">{username}</span>
                      <span className="text-xs text-gray-500">（{items.length} 个账号，{bound} 已绑定）</span>
                    </div>
                    <span className={`text-gray-500 transition ${expanded ? 'rotate-180' : ''}`}>▼</span>
                  </button>
                  {expanded && <div className="px-4 pb-4 border-t border-white/5 pt-3">
                    <AccountTable accounts={items} devices={devices} onBind={(id) => { setBindId(id); setBindDeviceId('') }} isAdmin />
                  </div>}
                </div>
              )
            })}
            {accounts.length === 0 && <div className="card-glass p-8 text-center text-gray-500">暂无登记数据</div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── editor 视图 ──
function EditorAccounts({ accounts, devices, onBind }: { accounts: AccountItem[]; devices: DeviceItem[]; onBind: (id: number) => void }) {
  return (
    <div>
      {/* 待绑定 */}
      {accounts.filter(a => a.status !== '已绑定').length > 0 && (
        <div className="mb-6">
          <h3 className="text-yellow-400 text-sm font-medium mb-3 flex items-center gap-2">⏳ 待绑定 / PENDING</h3>
          <AccountTable accounts={accounts.filter(a => a.status !== '已绑定')} devices={devices} onBind={onBind} />
        </div>
      )}
      {/* 已绑定 */}
      <div>
        <h3 className="text-white text-sm font-medium mb-3 flex items-center gap-2">✅ 已绑定 / BOUND</h3>
        {accounts.filter(a => a.status === '已绑定').length === 0
          ? <div className="card-glass p-6 text-center text-gray-500 text-sm">暂无已绑定的账号</div>
          : <AccountTable accounts={accounts.filter(a => a.status === '已绑定')} devices={devices} onBind={onBind} />
        }
      </div>
    </div>
  )
}

// ── 账号表格 ──
function AccountTable({ accounts, devices, onBind, isAdmin }: { accounts: AccountItem[]; devices: DeviceItem[]; onBind: (id: number) => void; isAdmin?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead><tr className="border-b border-white/10 text-gray-500 text-mono-sm text-[11px]">
          <th className="pb-2 pr-3">平台</th>
          <th className="pb-2 pr-3">账户名</th>
          <th className="pb-2 pr-3">手机/密码</th>
          <th className="pb-2 pr-3">状态</th>
          {!isAdmin && <th className="pb-2 pr-3">绑定设备</th>}
          <th className="pb-2 pr-3">操作</th>
        </tr></thead>
        <tbody>
          {accounts.map(a => (
            <tr key={a.id} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-2 pr-3">
                <span className="flex items-center gap-1.5">
                  <span>{PLATFORM_ICON[a.platform] || '📱'}</span>
                  <span className="text-white text-xs">{a.platform}</span>
                </span>
              </td>
              <td className="py-2 pr-3">
                <span className="text-white text-xs">{a.accountName}</span>
                <span className="text-[10px] text-gray-500 ml-1">({a.user?.username || '-'})</span>
              </td>
              <td className="py-2 pr-3">
                <div className="text-[10px] text-gray-500 space-y-0.5">
                  {a.mobile && <p>📱 {a.mobile}</p>}
                  {a.password && <p>🔑 ****{a.password.slice(-3)}</p>}
                  {a.remark && <p className="italic">📝 {a.remark}</p>}
                </div>
              </td>
              <td className="py-2 pr-3">
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_COLOR[a.status] || 'bg-gray-500/20 text-gray-500'}`}>{a.status}</span>
              </td>
              {!isAdmin && (
                <td className="py-2 pr-3 text-xs text-gray-400">{a.device?.name || '-'}</td>
              )}
              <td className="py-2 pr-3">
                {a.status !== '已绑定' ? (
                  <button onClick={() => onBind(a.id)} className="text-[10px] px-2 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/30">
                    + 绑定
                  </button>
                ) : (
                  <span className="text-[10px] text-gray-600">已绑定</span>
                )}
              </td>
            </tr>
          ))}
          {accounts.length === 0 && <tr><td colSpan={6} className="text-center py-4 text-xs text-gray-600">暂无数据</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function Loading() { return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" /></div> }
function NoAccess() { return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-red-400">无权限</p></div> }
