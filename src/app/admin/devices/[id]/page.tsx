'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { useParams } from 'next/navigation'
import { showToast } from '@/components/Toast'

interface DeviceDetail {
  id: number; name: string; status: string; lastHeartbeat: string; groupId: string | null
  owner: { id: number; username: string }
  socialAccounts: { id: number; platform: string; username: string; status: string }[]
  automationTasks: { id: number; type: string; status: string; createdAt: string }[]
}

export default function AdminDeviceDetailPage() {
  const params = useParams()
  const { user, loading: authLoading } = useAuth()
  const [device, setDevice] = useState<DeviceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState('')

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadDevice()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadDevice = async () => {
    try {
      const res = await fetch(`/api/devices/${params.id}`, { credentials: 'include' })
      if (res.ok) { const d = await res.json(); setDevice(d.data); setName(d.data.name); setGroupId(d.data.groupId || '') }
    } catch { console.error('加载失败') }
    finally { setLoading(false) }
  }

  const handleSave = async () => {
    const res = await fetch(`/api/devices/${params.id}`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, groupId: groupId || null }),
    })
    if (res.ok) { setEditing(false); loadDevice() } else showToast('保存失败', 'error')
  }

  const statusColor = (s: string) => s === 'online' ? 'text-emerald-400' : s === 'busy' ? 'text-yellow-400' : 'text-gray-500'

  if (authLoading || loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2">无权限</p></div></div>
  if (!device) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400">设备不存在</div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <p className="text-label mb-2">管理后台 / ADMIN</p>
          <h1 className="text-mono-lg text-white">设备详情 / DEVICE #{device.id}</h1>
        </div>

        {/* 基础信息 */}
        <div className="card-glass p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold text-lg">基本信息</h2>
            <button onClick={() => setEditing(!editing)} className="btn-secondary text-sm">
              {editing ? '取消' : '编辑'}
            </button>
          </div>
          {editing ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input className="input-dark" value={name} onChange={e => setName(e.target.value)} placeholder="设备名称" />
              <input className="input-dark" value={groupId} onChange={e => setGroupId(e.target.value)} placeholder="分组ID（可选）" />
              <button onClick={handleSave} className="btn-primary">保存</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-gray-500 block text-xs">名称</span><span className="text-white">{device.name}</span></div>
              <div><span className="text-gray-500 block text-xs">状态</span><span className={statusColor(device.status)}>{device.status}</span></div>
              <div><span className="text-gray-500 block text-xs">分组</span><span className="text-gray-300">{device.groupId || '-'}</span></div>
              <div><span className="text-gray-500 block text-xs">所属</span><span className="text-gray-300">{device.owner.username}</span></div>
              <div><span className="text-gray-500 block text-xs">最后心跳</span><span className="text-gray-300 text-xs">{new Date(device.lastHeartbeat).toLocaleString()}</span></div>
            </div>
          )}
        </div>

        {/* 账号列表 */}
        <div className="card-glass p-6 mb-6">
          <h2 className="text-white font-bold text-lg mb-4">绑定账号 ({device.socialAccounts.length})</h2>
          {device.socialAccounts.length === 0 ? <p className="text-gray-500 text-sm">暂无绑定的社交账号</p>
          : <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead><tr className="border-b border-white/10 text-gray-500 text-mono-sm">
                  <th className="pb-2 pr-4">ID</th><th className="pb-2 pr-4">平台</th><th className="pb-2 pr-4">账号</th><th className="pb-2 pr-4">状态</th>
                </tr></thead>
                <tbody>
                  {device.socialAccounts.map(a => (
                    <tr key={a.id} className="border-b border-white/5">
                      <td className="py-2 pr-4 text-gray-400">{a.id}</td>
                      <td className="py-2 pr-4"><span className="bg-white/5 px-2 py-0.5 rounded text-xs">{a.platform}</span></td>
                      <td className="py-2 pr-4 text-white">{a.username}</td>
                      <td className={`py-2 pr-4 ${statusColor(a.status)}`}>{a.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        </div>

        {/* 任务列表 */}
        <div className="card-glass p-6">
          <h2 className="text-white font-bold text-lg mb-4">最近任务 ({device.automationTasks.length})</h2>
          {device.automationTasks.length === 0 ? <p className="text-gray-500 text-sm">暂无任务</p>
          : <div className="space-y-2">
              {device.automationTasks.map(t => (
                <div key={t.id} className="flex items-center justify-between bg-black/30 rounded px-4 py-2 text-sm">
                  <span className="text-gray-300">{t.type}</span>
                  <span className={`text-xs ${statusColor(t.status)}`}>{t.status}</span>
                  <span className="text-gray-500 text-xs">{new Date(t.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>}
        </div>
      </div>
    </div>
  )
}
