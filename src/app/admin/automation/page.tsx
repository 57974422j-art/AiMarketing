'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface DeviceItem { id: number; name: string; status: string; apiPort?: number; type?: string }
interface AccountItem { id: number; platform: string; username: string; status: string; deviceId: number | null }

interface ExecRecord {
  id: number; deviceName: string; username: string; platform: string
  actions: string[]; result: 'success' | 'fail'; time: string
}

export default function AutomationExecPage() {
  const { user, loading: authLoading } = useAuth()
  const [devices, setDevices] = useState<DeviceItem[]>([])
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState<Set<string>>(new Set())
  const [records, setRecords] = useState<ExecRecord[]>([])

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadAll()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadAll = async () => {
    try {
      const [dRes, aRes, tRes] = await Promise.all([
        fetch('/api/devices', { credentials: 'include' }),
        fetch('/api/social-accounts', { credentials: 'include' }),
        fetch('/api/automation-templates', { credentials: 'include' }),
      ])
      if (dRes.ok) setDevices(((await dRes.json()).data || []).filter((d: any) => d.type === 'q1'))
      if (aRes.ok) setAccounts((await aRes.json()).data || [])
      if (tRes.ok) setTemplates((await tRes.json()).data || [])
    } catch {} finally { setLoading(false) }
  }

  // 执行任务
  const execute = async (deviceId: number, accountId: number, actions: string[]) => {
    const key = `${deviceId}-${Date.now()}`
    setExecuting(prev => new Set(prev).add(key))
    try {
      const r = await fetch(`/api/devices/${deviceId}/execute`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, actions }),
      })
      const d = await r.json()
      // 记录执行结果
      setRecords(prev => [{
        id: Date.now(), deviceName: devices.find(d => d.id === deviceId)?.name || '',
        username: accounts.find(a => a.id === accountId)?.username || '',
        platform: accounts.find(a => a.id === accountId)?.platform || '',
        actions, result: d.success ? 'success' : 'fail', time: new Date().toLocaleTimeString(),
      }, ...prev])
      if (d.success) showToast('执行成功', 'success')
      else showToast(d.message || '执行失败', 'error')
    } catch { showToast('执行失败', 'error') } finally { setExecuting(prev => { const n = new Set(prev); n.delete(key); return n }) }
  }

  if (authLoading || loading) return <Loading />
  if (!user || user.role === 'end-user') return <NoAccess />

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">管理后台 / EXECUTION</p>
          <h1 className="text-mono-lg text-white">任务执行中心 / AUTOMATION</h1>
          <p className="text-gray-400 text-sm mt-1">查看设备状态、执行已配置的任务模板</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 设备面板 */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-white font-semibold flex items-center gap-2"><span>📱</span> 在线设备 / DEVICES</h2>

            {devices.length === 0 ? (
              <div className="card-glass p-8 text-center text-gray-500">暂无 Q1 设备</div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {devices.map(dev => {
                  const boundAccounts = accounts.filter(a => a.deviceId === dev.id)
                  return (
                    <div key={dev.id} className={`card-glass p-4 border-l-4 ${dev.status === 'online' ? 'border-l-emerald-500' : 'border-l-gray-500'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${dev.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                          <span className="text-white font-medium">{dev.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${dev.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-500'}`}>{dev.status}</span>
                        </div>
                        <span className="text-xs text-gray-500">端口: {dev.apiPort}</span>
                      </div>

                      {/* 平台状态芯片 */}
                      {boundAccounts.length > 0 && (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {boundAccounts.map(acct => {
                              const st = acct.status
                              const stColor = st === '已绑定' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                : st === '登录异常' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                                : st === '已封禁' ? 'bg-red-500/20 text-red-400 border-red-500/30'
                                : 'bg-gray-500/20 text-gray-500 border-gray-500/30'
                              const icon = acct.platform === '抖音' ? '🎵' : acct.platform === '快手' ? '📹' : acct.platform === '小红书' ? '📕' : acct.platform === '视频号' ? '💚' : acct.platform === '微博' ? '📢' : '📺'
                              return (
                                <span key={acct.id} className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border ${stColor}`} title={`${acct.platform} / ${acct.username}`}>
                                  {icon} {acct.platform}
                                </span>
                              )
                            })}
                          </div>
                          <button onClick={() => {
                            const first = boundAccounts[0]
                            execute(dev.id, first.id, [])
                          }} disabled={executing.size > 0}
                            className="text-xs px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 disabled:opacity-30">
                            ▶ 执行
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 执行记录 */}
          <div>
            <h2 className="text-white font-semibold mb-3 flex items-center gap-2"><span>📋</span> 执行记录 / LOGS</h2>
            <div className="card-glass p-4 max-h-[70vh] overflow-y-auto">
              {records.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-8">暂无执行记录</p>
              ) : (
                <div className="space-y-2">
                  {records.map(r => (
                    <div key={r.id} className="border border-white/5 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-300">{r.deviceName} / {r.username}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.result === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{r.result}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-1">
                        {r.actions.map((a, i) => <span key={i} className="text-[10px] bg-white/5 px-1.5 py-0.5 rounded text-gray-400">{a}</span>)}
                      </div>
                      <div className="text-[10px] text-gray-600">{r.platform} · {r.time}</div>
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
