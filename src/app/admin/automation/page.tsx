'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface DeviceItem { id: number; name: string; status: string; apiPort?: number; type?: string }
interface AccountItem {
  id: number; platform: string; accountName: string; status: string; deviceId: number | null
  device?: { id: number; name: string } | null; user?: { username: string } | null
}

interface ExecStep { action: string; success: boolean; message: string }
interface ExecRecord {
  id: number; deviceName: string; username: string; platform: string
  results: ExecStep[]; time: string
}

const PLATFORM_ICON: Record<string, string> = { douyin: '🎵', kuaishou: '📹', xiaohongshu: '📕', shipinhao: '💚', weibo: '📢', bilibili: '📺' }
const PLATFORM_LABEL: Record<string, string> = { douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书', shipinhao: '视频号', weibo: '微博', bilibili: 'B站' }

export default function AutomationExecPage() {
  const { user, loading: authLoading } = useAuth()
  const [devices, setDevices] = useState<DeviceItem[]>([])
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState(false)
  const [records, setRecords] = useState<ExecRecord[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadAll()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadAll = async () => {
    try {
      const [dRes, aRes] = await Promise.all([
        fetch('/api/devices', { credentials: 'include' }),
        fetch('/api/accounts', { credentials: 'include' }),
      ])
      if (dRes.ok) setDevices(((await dRes.json()).data || []).filter((d: any) => d.type === 'q1'))
      if (aRes.ok) { const d = await aRes.json(); setAccounts(d.data || []) }
    } catch {} finally { setLoading(false) }
  }

  const toggle = (id: number) => {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const execute = async () => {
    const selectedAccounts = accounts.filter(a => selected.has(a.id) && a.status === '已绑定')
    if (selectedAccounts.length === 0) { showToast('请先勾选要执行的平台', 'error'); return }

    setExecuting(true)
    for (const acct of selectedAccounts) {
      const device = devices.find(d => d.id === acct.deviceId)
      if (!device) { showToast(`${acct.accountName} 无绑定设备`, 'error'); continue }

      try {
        const r = await fetch(`/api/devices/${device.id}/execute`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: acct.id, platform: acct.platform, actions: ['search', 'like', 'comment', 'follow'] }),
        })
        const d = await r.json()
        const results: ExecStep[] = d.data?.results || []
        setRecords(prev => [{
          id: Date.now(), deviceName: device.name,
          username: acct.accountName,
          platform: PLATFORM_LABEL[acct.platform] || acct.platform,
          results, time: new Date().toLocaleTimeString(),
        }, ...prev])
        showToast(`${acct.accountName} ${d.success ? '✅' : '❌'}`, d.success ? 'success' : 'error')
      } catch { showToast(`${acct.accountName} 执行异常`, 'error') }
    }
    setExecuting(false)
  }

  if (authLoading || loading) return <Loading />
  if (!user || user.role === 'end-user') return <NoAccess />

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <p className="text-label mb-2">管理后台 / EXECUTION</p>
          <h1 className="text-mono-lg text-white">任务执行中心 / AUTOMATION</h1>
          <p className="text-gray-400 text-sm mt-1">勾选平台 → 一键执行（自动打开App + 运行动作）</p>
        </div>

        {/* ── 全部执行按钮 ── */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            <button onClick={() => setSelected(new Set(accounts.filter(a => a.status === '已绑定').map(a => a.id)))} className="text-xs px-3 py-1 bg-white/5 text-gray-400 rounded-lg hover:bg-white/10">全选</button>
            <button onClick={() => setSelected(new Set())} className="text-xs px-3 py-1 bg-white/5 text-gray-400 rounded-lg hover:bg-white/10">取消</button>
          </div>
          <button onClick={execute} disabled={executing || selected.size === 0}
            className="text-sm px-6 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50 font-medium">
            {executing ? `执行中 (${selected.size}个)...` : `▶ 执行选中 (${selected.size}个)`}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── 设备面板 ── */}
          <div className="lg:col-span-2 space-y-3">
            {devices.length === 0 ? (
              <div className="card-glass p-8 text-center text-gray-500">暂无 Q1 设备</div>
            ) : (
              devices.map(dev => {
                const boundAccounts = accounts.filter((a: any) => (a.device?.id === dev.id || a.deviceId === dev.id) && a.status === '已绑定')
                return (
                  <div key={dev.id} className={`card-glass p-4 border-l-4 ${dev.status === 'online' ? 'border-l-emerald-500' : 'border-l-gray-500'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-2 h-2 rounded-full ${dev.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                      <span className="text-white font-medium text-sm">{dev.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${dev.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-500'}`}>{dev.status}</span>
                      <span className="text-[10px] text-gray-600 ml-auto">端口 {dev.apiPort}</span>
                    </div>
                    {/* 可选平台芯片 */}
                    {boundAccounts.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {boundAccounts.map(acct => {
                          const checked = selected.has(acct.id)
                          const icon = PLATFORM_ICON[acct.platform] || '📱'
                          const label = PLATFORM_LABEL[acct.platform] || acct.platform
                          return (
                            <button key={acct.id} onClick={() => toggle(acct.id)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition ${
                                checked
                                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 ring-1 ring-emerald-500/40'
                                  : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                              }`}
                              title={`${label} / ${acct.accountName}`}>
                              <span className={`w-2 h-2 rounded-full ${checked ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                              {icon} {label}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-[10px] text-gray-600">暂无已绑定账号</p>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* ── 执行记录 ── */}
          <div>
            <h2 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm">
              <span>📋</span> 执行记录 / LOGS
            </h2>
            <div className="card-glass p-4 max-h-[70vh] overflow-y-auto">
              {records.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-8">暂无执行记录</p>
              ) : (
                <div className="space-y-2">
                  {records.map(r => (
                    <div key={r.id} className="border border-white/5 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-gray-300">{r.deviceName} / {r.username}</span>
                        <span className="text-[10px] text-gray-500">{r.platform} · {r.time}</span>
                      </div>
                      <div className="space-y-1">
                        {r.results.map((step, i) => (
                          <div key={i} className="flex items-center gap-2 text-[10px]">
                            <span className={step.success ? 'text-emerald-400' : 'text-red-400'}>
                              {step.success ? '✓' : '✗'}
                            </span>
                            <span className="text-gray-400 w-12">{step.action}</span>
                            <span className={`${step.success ? 'text-gray-500' : 'text-red-400'} truncate`}>
                              {step.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Loading() { return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" /></div> }
function NoAccess() { return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-red-400">无权限</p></div> }
