'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface DeviceItem {
  id: number; name: string; status: string; apiPort?: number; type?: string
}
interface AccountItem {
  id: number; platform: string; username: string; status: string; deviceId: number | null
}

type TaskAction = 'like' | 'comment' | 'follow' | 'share' | 'search' | 'dm' | 'publish' | 'extract' | 'comments'
type Platform = '抖音' | '快手' | '小红书' | '视频号' | '微博' | 'B站'

const PLATFORMS: Platform[] = ['抖音', '快手', '小红书', '视频号', '微博', 'B站']

const TASK_OPTIONS: { key: TaskAction; label: string; desc: string }[] = [
  { key: 'like', label: '点赞', desc: '随机等待后点赞' },
  { key: 'comment', label: '评论', desc: '输入评论内容' },
  { key: 'follow', label: '关注', desc: '关注作者' },
  { key: 'share', label: '转发', desc: '分享/复制链接' },
  { key: 'search', label: '搜索', desc: '搜索关键词' },
  { key: 'dm', label: '私信', desc: '发私信给用户' },
  { key: 'publish', label: '发布', desc: '发布视频' },
  { key: 'extract', label: '提取数据', desc: '提取视频/用户信息' },
  { key: 'comments', label: '抓评论', desc: '提取评论区内容' },
]

export default function AdminAutomationPage() {
  const { user, loading: authLoading } = useAuth()
  const [devices, setDevices] = useState<DeviceItem[]>([])
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDevices, setSelectedDevices] = useState<Set<number>>(new Set())
  const [selectedActions, setSelectedActions] = useState<Set<TaskAction>>(new Set())
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('抖音')
  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [expandedResult, setExpandedResult] = useState<number | null>(null)

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadData()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadData = async () => {
    try {
      const [dRes, aRes] = await Promise.all([
        fetch('/api/devices', { credentials: 'include' }),
        fetch('/api/social-accounts', { credentials: 'include' }),
      ])
      if (dRes?.ok) { const d = await dRes.json(); setDevices(d.data?.filter((x: any) => x.type === 'q1') || []) }
      if (aRes?.ok) { const d = await aRes.json(); setAccounts(d.data || []) }
    } catch (e) { console.error('[任务] 加载失败:', e) } finally { setLoading(false) }
  }

  const getAccountsForDevice = (deviceId: number) => accounts.filter(a => a.deviceId === deviceId)

  const toggleDevice = (id: number) => {
    setSelectedDevices(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const toggleAction = (key: TaskAction) => {
    setSelectedActions(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  const getInput = (key: string, deviceId: number) => taskInputs[`${deviceId}-${key}`] || taskInputs[`_-${key}`] || ''

  const runTask = async (deviceId: number) => {
    if (selectedActions.size === 0) { showToast('请选择至少一个任务', 'error'); return }
    const deviceName = devices.find(d => d.id === deviceId)?.name || ''
    const accs = getAccountsForDevice(deviceId)
    const acc = accs.find(a => a.platform === selectedPlatform)

    const actionResults: any[] = []
    for (const action of selectedActions) {
      const body: any = { action }
      if (action === 'comment') body.message = getInput('comment', deviceId) || '不错'
      if (action === 'search') body.keyword = getInput('search', deviceId) || '热门'
      if (action === 'dm') {
        const parts = (getInput('dm', deviceId) || '用户,你好').split(',')
        body.username = parts[0].trim(); body.message = parts.slice(1).join(',').trim()
      }
      if (action === 'publish') body.options = { title: getInput('publish', deviceId) || '' }

      try {
        const r = await fetch(`/api/devices/${deviceId}/ui`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        const d = await r.json()
        actionResults.push({ action, success: d.success, message: d.message || d.data?.message || 'OK' })
      } catch (e: any) { actionResults.push({ action, success: false, message: e.message }) }

      if (selectedActions.size > 1) await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000))
    }

    setResults(prev => [{ id: Date.now() + deviceId, deviceId, deviceName, time: new Date().toLocaleString(), platform: selectedPlatform, account: acc?.username || '-', results: actionResults }, ...prev])
  }

  const runAll = async () => {
    if (selectedDevices.size === 0) { showToast('请选择至少一个设备', 'error'); return }
    if (selectedActions.size === 0) { showToast('请选择至少一个任务', 'error'); return }
    setRunning(true)
    for (const devId of selectedDevices) { await runTask(devId) }
    setRunning(false)
    showToast('全部任务执行完成')
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400">无权限访问</div></div>

  const inputArea = (
    <div className="card-glass p-4">
      <h3 className="text-white font-bold mb-3 text-sm">任务输入</h3>
      <div className="space-y-2">
        {selectedActions.has('comment') && (
          <div><label className="text-gray-400 text-xs">评论内容:</label><input className="input-dark w-full mt-1" value={taskInputs['_-comment'] || ''} onChange={e => setTaskInputs(p => ({ ...p, '_-comment': e.target.value }))} placeholder="写的真不错" /></div>
        )}
        {selectedActions.has('search') && (
          <div><label className="text-gray-400 text-xs">搜索关键词:</label><input className="input-dark w-full mt-1" value={taskInputs['_-search'] || ''} onChange={e => setTaskInputs(p => ({ ...p, '_-search': e.target.value }))} placeholder="热门推荐" /></div>
        )}
        {selectedActions.has('dm') && (
          <div><label className="text-gray-400 text-xs">私信 (用户名,内容):</label><input className="input-dark w-full mt-1" value={taskInputs['_-dm'] || ''} onChange={e => setTaskInputs(p => ({ ...p, '_-dm': e.target.value }))} placeholder="用户A,你好" /></div>
        )}
        {selectedActions.has('publish') && (
          <div><label className="text-gray-400 text-xs">视频标题:</label><input className="input-dark w-full mt-1" value={taskInputs['_-publish'] || ''} onChange={e => setTaskInputs(p => ({ ...p, '_-publish': e.target.value }))} placeholder="我的新视频" /></div>
        )}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-label mb-2">管理后台 / AUTOMATION</p>
            <h1 className="text-mono-lg text-white">任务中心 / TASK CENTER</h1>
            <p className="text-gray-400 text-sm mt-1">Q1 在线: {devices.filter(d => d.status === 'online').length}/{devices.length}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setResults([])} className="px-4 py-2 bg-white/10 text-gray-300 rounded-lg text-sm hover:bg-white/20">清空记录</button>
            <button onClick={runAll} disabled={running || selectedDevices.size === 0}
              className="px-6 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600 disabled:opacity-50 font-bold">
              {running ? '执行中...' : `▶ 批量执行 (${selectedDevices.size}台)`}
            </button>
          </div>
        </div>

        {/* 平台 & 任务选择 */}
        <div className="card-glass p-4 mb-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="text-gray-400 text-xs block mb-1">平台</label>
              <div className="flex gap-1.5">
                {PLATFORMS.map(p => (
                  <button key={p} onClick={() => setSelectedPlatform(p)}
                    className={`px-3 py-1 text-sm rounded-full ${selectedPlatform === p ? 'bg-emerald-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}>{p}</button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="text-gray-400 text-xs block mb-1">任务（选中的会依次执行）</label>
              <div className="flex flex-wrap gap-1.5">
                {TASK_OPTIONS.map(opt => (
                  <button key={opt.key} onClick={() => toggleAction(opt.key)}
                    className={`px-3 py-1 text-sm rounded-full ${selectedActions.has(opt.key) ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                    title={opt.desc}>{opt.label}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 设备面板 */}
          <div className="lg:col-span-2">
            <div className="card-glass p-4">
              <h3 className="text-white font-bold mb-3">Q1 设备 <span className="text-gray-500 text-xs font-normal">点击选择，再次点击取消</span></h3>
              {loading ? <div className="text-gray-400 text-center py-8">加载中...</div>
              : devices.length === 0 ? <div className="text-gray-500 text-center py-8">暂无 Q1 设备，请先在设备管理添加</div>
              : <div className="space-y-1.5">
                  {devices.map(d => {
                    const accs = getAccountsForDevice(d.id)
                    const accP = accs.find(a => a.platform === selectedPlatform)
                    const isOn = selectedDevices.has(d.id)
                    return (
                      <div key={d.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${isOn ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                        onClick={() => toggleDevice(d.id)}>
                        <input type="checkbox" checked={isOn} onChange={() => toggleDevice(d.id)} className="accent-emerald-500" />
                        <div className={`w-2 h-2 rounded-full ${d.status === 'online' ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-sm font-medium truncate">{d.name}</div>
                          <div className="text-gray-500 text-xs truncate">{d.status} | {accP ? `账号: ${accP.username}` : (accs.length > 0 ? `${accs[0].username}...` : '未绑定账号')}</div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); runTask(d.id) }}
                          disabled={selectedActions.size === 0}
                          className="px-3 py-1 bg-cyan-500 text-white text-xs rounded-lg hover:bg-cyan-600 disabled:opacity-30 whitespace-nowrap">▶ 执行</button>
                      </div>
                    )
                  })}
                </div>}
            </div>
            {selectedActions.size > 0 && <div className="mt-4">{inputArea}</div>}
          </div>

          {/* 执行结果 */}
          <div>
            <div className="card-glass p-4">
              <h3 className="text-white font-bold mb-3 text-sm">执行记录 <span className="text-gray-500 font-normal">({results.length})</span></h3>
              <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                {results.length === 0
                  ? <div className="text-gray-500 text-sm text-center py-8">暂无记录，选择一个或多个设备执行任务</div>
                  : results.map((r, i) => (
                      <div key={r.id} className="bg-white/5 rounded-lg p-3 text-xs border border-white/10">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-cyan-400 font-bold">{r.deviceName}</span>
                          <span className="text-gray-500">{r.time}</span>
                        </div>
                        <div className="text-gray-400 mb-1.5">{r.platform}/{r.account}</div>
                        {r.results.map((ar: any, j: number) => (
                          <div key={j} className={`${ar.success ? 'text-emerald-400' : 'text-red-400'} truncate`}>
                            [{j + 1}] {ar.action}: {ar.message}
                          </div>
                        ))}
                      </div>
                    ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
