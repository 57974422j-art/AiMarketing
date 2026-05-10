'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface DeviceItem {
  id: number
  name: string
  status: string
  lastHeartbeat: string
  groupId: string | null
  ownerId: number
  owner: { id: number; username: string; name: string | null }
  createdAt: string
}

export default function AdminDevicesPage() {
  const { user, loading: authLoading } = useAuth()
  const [devices, setDevices] = useState<DeviceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState('')

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') {
      loadDevices()
    } else if (!authLoading) {
      setLoading(false)
    }
  }, [authLoading, user])

  const loadDevices = async () => {
    try {
      const res = await fetch('/api/devices', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setDevices(data.data || [])
      }
    } catch {
      console.error('加载设备列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, groupId: newGroup || null }),
      })
      if (res.ok) {
        setShowCreate(false)
        setNewName('')
        setNewGroup('')
        loadDevices()
      } else {
        const d = await res.json()
        showToast(d.message || '创建失败', 'error')
      }
    } catch {
      showToast('创建失败', 'error')
    }
  }

  const statusColor = (s: string) => {
    switch (s) {
      case 'online': return 'text-emerald-400'
      case 'busy': return 'text-yellow-400'
      default: return 'text-gray-500'
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
          <p className="text-gray-500">仅管理员和二级客户可访问此页面</p>
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
            <h1 className="text-mono-lg text-white">设备管理 / DEVICES</h1>
            <p className="text-gray-400 text-sm mt-2">
              设备总数：<span className="text-emerald-400 font-bold">{devices.length}</span>
            </p>
          </div>
          <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
            {showCreate ? '取消' : '+ 新增设备'}
          </button>
        </div>

        {showCreate && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4">新增设备</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <input
                className="input-dark"
                placeholder="设备名称 *"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <input
                className="input-dark"
                placeholder="分组ID（可选）"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
              />
            </div>
            <button onClick={handleCreate} className="btn-primary" disabled={!newName.trim()}>
              确认创建
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-400 py-12">加载中...</div>
        ) : devices.length === 0 ? (
          <div className="card-glass p-12 text-center">
            <p className="text-gray-400">暂无设备</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-gray-500 text-mono-sm">
                  <th className="pb-3 pr-4">ID</th>
                  <th className="pb-3 pr-4">名称</th>
                  <th className="pb-3 pr-4">状态</th>
                  <th className="pb-3 pr-4">分组</th>
                  <th className="pb-3 pr-4">所属用户</th>
                  <th className="pb-3 pr-4">最后心跳</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-3 pr-4 text-gray-400">{d.id}</td>
                    <td className="py-3 pr-4 text-white font-medium">{d.name}</td>
                    <td className={`py-3 pr-4 font-medium ${statusColor(d.status)}`}>{d.status}</td>
                    <td className="py-3 pr-4 text-gray-400">{d.groupId || '-'}</td>
                    <td className="py-3 pr-4 text-gray-400">{d.owner?.username || '-'}</td>
                    <td className="py-3 pr-4 text-gray-500 text-xs">{new Date(d.lastHeartbeat).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
