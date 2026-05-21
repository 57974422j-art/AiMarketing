'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface PhyDevice {
  id: number; name: string; ip: string; port: number; note: string | null
  status: string; createdAt: string; owner: { id: number; username: string; name: string | null } | null
  devices: { id: number; name: string; status: string; apiPort: number | null; ownerId: number; owner: { username: string } | null }[]
}

export default function PhyDevicesPage() {
  const { user, loading: authLoading } = useAuth()
  const [items, setItems] = useState<PhyDevice[]>([])
  const [editors, setEditors] = useState<{ id: number; username: string; name: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [scanningIds, setScanningIds] = useState<Set<number>>(new Set())
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', ip: '', port: '8000', note: '' })
  const [assignId, setAssignId] = useState<number | null>(null)
  const [assignUserId, setAssignUserId] = useState('')
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') load()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const load = async () => {
    try {
      const [r, uR] = await Promise.all([
        fetch('/api/phy-devices', { credentials: 'include' }),
        user?.role === 'admin' ? fetch('/api/admin/users', { credentials: 'include' }) : Promise.resolve(null),
      ])
      if (r.ok) setItems((await r.json()).data || [])
      if (uR?.ok) { const d = await uR.json(); setEditors(d.data || []) }
    } catch {} finally { setLoading(false) }
  }

  const assign = async () => {
    if (!assignId || !assignUserId) return
    setAssigning(true)
    const r = await fetch('/api/phy-devices', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: assignId, ownerId: parseInt(assignUserId) }) })
    if (r.ok) { showToast('已分配', 'success'); setAssignId(null); load() }
    else { const d = await r.json(); showToast(d.message || '失败', 'error') }
    setAssigning(false)
  }

  const handleAdd = async () => {
    if (!form.name.trim() || !form.ip.trim()) { showToast('名称和 IP 必填', 'error'); return }
    try {
      const r = await fetch('/api/phy-devices', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (r.ok) { showToast('添加成功', 'success'); setShowForm(false); setForm({ name: '', ip: '', port: '8000', note: '' }); load() }
      else { const d = await r.json(); showToast(d.message || '失败', 'error') }
    } catch { showToast('网络错误', 'error') }
  }

  const scan = async (phyDeviceId: number) => {
    setScanningIds(prev => new Set(prev).add(phyDeviceId))
    try {
      const r = await fetch('/api/q1-devices/scan', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phyDeviceId }) })
      const d = await r.json()
      if (d.success) showToast(`扫描完成：在线 ${d.data.online} 个`, 'success')
      else showToast(d.message || '扫描失败', 'error')
      load()
    } catch { showToast('扫描异常', 'error') } finally { setScanningIds(prev => { const n = new Set(prev); n.delete(phyDeviceId); return n }) }
  }

  if (authLoading || loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400">无权限</div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-label mb-2">管理后台 / Q1</p>
            <h1 className="text-mono-lg text-white">Q1 物理机管理 / Q1 DEVICES</h1>
            <p className="text-gray-400 text-sm mt-1">共 {items.length} 台 Q1 设备</p>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm py-2">+ 添加 Q1</button>
        </div>

        {/* 添加表单弹窗 */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold mb-4">添加 Q1 设备</h3>
              <div className="space-y-3">
                <input className="input-dark w-full" placeholder="名称 *（如：办公室Q1）" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                <input className="input-dark w-full" placeholder="IP 地址 *（如：192.168.1.14）" value={form.ip} onChange={e => setForm(p => ({ ...p, ip: e.target.value }))} />
                <input className="input-dark w-full" type="number" placeholder="管理端口（默认 8000）" value={form.port} onChange={e => setForm(p => ({ ...p, port: e.target.value }))} />
                <textarea className="input-dark w-full h-20" placeholder="备注（选填）" value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} />
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2 bg-white/5 text-gray-400 rounded-lg hover:bg-white/10">取消</button>
                <button onClick={handleAdd} className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30">确认添加</button>
              </div>
            </div>
          </div>
        )}

        {/* 分配弹窗 */}
        {assignId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setAssignId(null)}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold mb-1">分配 Q1 设备</h3>
              <p className="text-xs text-gray-500 mb-4">选择接收的二级客户</p>
              <select className="input-dark w-full mb-4" value={assignUserId} onChange={e => setAssignUserId(e.target.value)}>
                <option value="">选择用户...</option>
                {editors.map(e => <option key={e.id} value={e.id} className="bg-gray-900">{e.name || e.username}</option>)}
              </select>
              <div className="flex gap-3">
                <button onClick={() => setAssignId(null)} className="flex-1 py-2 border border-white/10 text-gray-400 rounded-lg hover:bg-white/10 text-sm">取消</button>
                <button onClick={assign} disabled={assigning || !assignUserId} className="flex-1 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 text-sm">{assigning ? '分配中...' : '确认分配'}</button>
              </div>
            </div>
          </div>
        )}

        {/* Q1 设备卡片列表 */}
        <div className="space-y-4">
          {items.map(phy => {
            const onlineDevices = phy.devices.filter(d => d.status === 'online')
            const unassigned = phy.devices.filter(d => d.ownerId && d.owner)
            return (
              <div key={phy.id} className="card-glass p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${phy.status === 'online' ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                    <div>
                      <h3 className="text-white font-bold">{phy.name}</h3>
                      <p className="text-xs text-gray-400">{phy.ip}:{phy.port} {phy.owner && `· 归属: ${phy.owner.name || phy.owner.username}`} {phy.note && `— ${phy.note}`}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {user?.role === 'admin' && (
                      <button onClick={() => { setAssignId(phy.id); setAssignUserId('') }}
                        className="text-xs px-3 py-1.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/30 transition">
                        📤 分给
                      </button>
                    )}
                    <button onClick={() => scan(phy.id)} disabled={scanningIds.has(phy.id)}
                      className="text-xs px-3 py-1.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/30 transition disabled:opacity-50">
                      {scanningIds.has(phy.id) ? '扫描中...' : '📡 扫描窗口'}
                    </button>
                  </div>
                </div>

                <div className="text-xs text-gray-500 mb-2">容器窗口：{phy.devices.length} 个（在线 {onlineDevices.length}）</div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-500 border-b border-white/10">
                      <tr>
                        <th className="text-left py-1.5 px-2">名称</th>
                        <th className="text-left py-1.5 px-2">状态</th>
                        <th className="text-left py-1.5 px-2">API端口</th>
                        <th className="text-left py-1.5 px-2">分配用户</th>
                      </tr>
                    </thead>
                    <tbody>
                      {phy.devices.map(d => (
                        <tr key={d.id} className="border-b border-white/5 hover:bg-white/5">
                          <td className="py-1.5 px-2 text-white">{d.name}</td>
                          <td className="py-1.5 px-2">
                            <span className={`px-1.5 py-0.5 rounded ${d.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-500'}`}>{d.status}</span>
                          </td>
                          <td className="py-1.5 px-2 text-gray-400">{d.apiPort || '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">{d.owner?.username || '未分配'}</td>
                        </tr>
                      ))}
                      {phy.devices.length === 0 && <tr><td colSpan={4} className="text-gray-500 text-center py-3">尚未扫描</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
          {items.length === 0 && (
            <div className="card-glass p-8 text-center text-gray-500">
              暂无 Q1 设备。点击上方「+ 添加 Q1」开始。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
