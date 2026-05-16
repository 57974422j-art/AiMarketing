'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface UserItem { id: number; username: string; name: string | null }
interface DeviceItem {
  id: number; name: string; status: string; lastHeartbeat: string; groupId: string | null
  ownerId: number; owner: UserItem; createdAt: string
  ip?: string; apiPort?: number; rpaPort?: number; adbPort?: number; type?: string
}

export default function AdminDevicesPage() {
  const { user, loading: authLoading } = useAuth()
  const [devices, setDevices] = useState<DeviceItem[]>([])
  const [editors, setEditors] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<number | null>(null)
  const [snapUrl, setSnapUrl] = useState('')
  const [shellOut, setShellOut] = useState('')
  const [execCmd, setExecCmd] = useState('')
  const [shellDevId, setShellDevId] = useState<number | null>(null)
  const [snapLoading, setSnapLoading] = useState(false)
  const [shellLoading, setShellLoading] = useState(false)

  // 表单
  const [form, setForm] = useState({ name: '', groupId: '', ownerId: '', ip: '', apiPort: '', rpaPort: '', adbPort: '', type: 'mock' })

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') { loadData() } else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadData = async () => {
    try {
      const [dRes, uRes] = await Promise.all([
        fetch('/api/devices', { credentials: 'include' }),
        user?.role === 'admin' ? fetch('/api/admin/users', { credentials: 'include' }) : Promise.resolve(null),
      ])
      if (dRes?.ok) { const d = await dRes.json(); setDevices(d.data || []); console.log('[设备] 列表:', d.data?.length) }
      if (uRes?.ok) { const d = await uRes.json(); setEditors(d.data || []); console.log('[设备] 用户列表:', d.data?.map((u: any) => u.username)) }
    } catch (e) { console.error('[设备] 加载失败:', e) } finally { setLoading(false) }
  }

  const openEdit = (d: DeviceItem) => {
    setEditId(d.id)
    setForm({
      name: d.name, groupId: d.groupId || '',
      ownerId: String(d.ownerId), ip: d.ip || '',
      apiPort: d.apiPort ? String(d.apiPort) : '',
      rpaPort: d.rpaPort ? String(d.rpaPort) : '',
      adbPort: d.adbPort ? String(d.adbPort) : '',
      type: d.type || 'mock',
    })
  }
  const resetForm = () => {
    setEditId(null); setForm({ name: '', groupId: '', ownerId: '', ip: '', apiPort: '', rpaPort: '', adbPort: '', type: 'mock' })
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) { showToast('请输入设备名称', 'error'); return }
    try {
      const body: any = { ...form, ownerId: form.ownerId || user?.id }
      if (form.apiPort) body.apiPort = parseInt(form.apiPort)
      if (form.rpaPort) body.rpaPort = parseInt(form.rpaPort)
      if (form.adbPort) body.adbPort = parseInt(form.adbPort)
      const url = editId ? `/api/devices?id=${editId}` : '/api/devices'
      const r = await fetch(url, {
        method: editId ? 'PUT' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editId ? { ...body, id: editId } : body),
      })
      const d = await r.json()
      if (r.ok) { resetForm(); loadData(); showToast(editId ? '已更新' : '已创建') }
      else showToast(d.message || '操作失败', 'error')
    } catch { showToast('操作失败', 'error') }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此设备？')) return
    const r = await fetch(`/api/devices?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) { loadData(); showToast('已删除') } else showToast('删除失败', 'error')
  }

  const handleScreenshot = async (id: number) => {
    setSnapLoading(true); setSnapUrl('')
    try {
      const r = await fetch(`/api/devices/${id}/screenshot`, { credentials: 'include' })
      if (!r.ok) { showToast('截图失败', 'error'); return }
      const blob = await r.blob()
      setSnapUrl(URL.createObjectURL(blob))
    } catch { showToast('截图失败', 'error') }
    finally { setSnapLoading(false) }
  }

  const testLike = async (id: number) => {
    setSnapLoading(true); setSnapUrl('')
    showToast('开始测试点赞...')
    try {
      // 1. 启动抖音
      await fetch(`/api/devices/${id}/shell`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'am start -n com.ss.android.ugc.aweme/.main.MainActivity' }),
      })
      // 2. 等 6 秒让抖音完全加载
      await new Promise(r => setTimeout(r, 6000))
      // 3. 先用 Shell 截图看看当前画面
      await fetch(`/api/devices/${id}/shell`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'screencap -p /sdcard/before.png' }),
      })
      // 4. 直接点点赞（不滑动）
      await fetch(`/api/devices/${id}/shell`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'input tap 162 135' }),
      })
      await new Promise(r => setTimeout(r, 2000))
      // 5. 截图
      const r = await fetch(`/api/devices/${id}/screenshot`, { credentials: 'include' })
      if (r.ok) { const blob = await r.blob(); setSnapUrl(URL.createObjectURL(blob)) }
      showToast('已完成，看截图确认点赞按钮是否变色')
    } catch { showToast('测试失败', 'error') }
    finally { setSnapLoading(false) }
  }

  const handleShell = async (id: number, cmd: string) => {
    if (!cmd.trim()) { showToast('请输入命令', 'error'); return }
    setShellLoading(true); setShellOut('')
    try {
      const r = await fetch(`/api/devices/${id}/shell`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      })
      const d = await r.json()
      setShellOut(d.output || d.message || '无输出')
    } catch { showToast('Shell 执行失败', 'error') }
    finally { setShellLoading(false) }
  }

  const statusColor = (s: string) => {
    switch (s) { case 'online': return 'text-emerald-400'; case 'busy': return 'text-yellow-400'; default: return 'text-gray-500' }
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2">无权限访问</p></div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-label mb-2">管理后台 / ADMIN</p>
            <h1 className="text-mono-lg text-white">设备管理 / DEVICES</h1>
            <p className="text-gray-400 text-sm mt-1">设备总数：<span className="text-emerald-400 font-bold">{devices.length}</span></p>
          </div>
          <button onClick={() => { resetForm(); setEditId(0) }} className="btn-primary text-sm py-2">+ 新增设备</button>
        </div>

        {/* 新增/编辑表单 */}
        {(editId !== null) && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4">{editId ? '编辑设备' : '新增设备'}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <input className="input-dark" placeholder="设备名称 *" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              <input className="input-dark" placeholder="分组（可选）" value={form.groupId} onChange={e => setForm(p => ({ ...p, groupId: e.target.value }))} />
              {user?.role === 'admin' && (
                <select className="input-dark" value={form.ownerId} onChange={e => setForm(p => ({ ...p, ownerId: e.target.value }))}>
                  <option value="">选择所属用户</option>
                  {editors.map(e => <option key={e.id} value={e.id} className="bg-gray-900">{e.name || e.username}</option>)}
                </select>
              )}
              <input className="input-dark" placeholder="容器 IP（Q1 必填）" value={form.ip} onChange={e => setForm(p => ({ ...p, ip: e.target.value }))} />
              <input className="input-dark" type="number" placeholder="API 端口 (30001)" value={form.apiPort} onChange={e => setForm(p => ({ ...p, apiPort: e.target.value }))} />
              <input className="input-dark" type="number" placeholder="RPA 端口 (30002)" value={form.rpaPort} onChange={e => setForm(p => ({ ...p, rpaPort: e.target.value }))} />
              <input className="input-dark" type="number" placeholder="ADB 端口 (30000)" value={form.adbPort} onChange={e => setForm(p => ({ ...p, adbPort: e.target.value }))} />
              <select className="input-dark" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                <option value="mock">Mock（模拟器）</option>
                <option value="q1">Q1（真机容器）</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSubmit} className="btn-primary">{editId ? '保存' : '创建'}</button>
              <button onClick={resetForm} className="px-4 py-2 bg-white/5 text-gray-300 rounded-lg text-sm hover:bg-white/10">取消</button>
            </div>
          </div>
        )}

        {/* 截图弹窗 */}
        {snapUrl && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center" onClick={() => setSnapUrl('')}>
            <img src={snapUrl} alt="截图" className="max-w-[80vw] max-h-[80vh] rounded-xl border border-white/20" onClick={e => e.stopPropagation()} />
          </div>
        )}

        {/* Shell 弹窗 */}
        {shellDevId !== null && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center" onClick={() => setShellDevId(null)}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold mb-3">Shell 执行</h3>
              <div className="flex gap-2 mb-3">
                <input className="input-dark flex-1" placeholder="输入命令" value={execCmd} onChange={e => setExecCmd(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleShell(shellDevId, execCmd)} />
                <button onClick={() => handleShell(shellDevId, execCmd)} disabled={shellLoading || !execCmd.trim()}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600 disabled:opacity-50">
                  {shellLoading ? '执行中...' : '执行'}
                </button>
              </div>
              {shellOut && (
                <pre className="bg-black/40 rounded-lg p-3 text-xs text-green-400 font-mono max-h-60 overflow-auto whitespace-pre-wrap">{shellOut}</pre>
              )}
            </div>
          </div>
        )}

        {loading ? <div className="text-center text-gray-400 py-12">加载中...</div>
        : devices.length === 0 ? <div className="card-glass p-12 text-center"><p className="text-gray-400">暂无设备</p></div>
        : <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-gray-500 text-mono-sm">
                  <th className="pb-3 pr-3">ID</th>
                  <th className="pb-3 pr-3">名称</th>
                  <th className="pb-3 pr-3">类型</th>
                  <th className="pb-3 pr-3">状态</th>
                  <th className="pb-3 pr-3">IP:API:RPA:ADB</th>
                  <th className="pb-3 pr-3">所属用户</th>
                  <th className="pb-3 pr-3">心跳</th>
                  <th className="pb-3 pr-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {devices.map(d => (
                  <tr key={d.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-3 pr-3 text-gray-400 text-xs">{d.id}</td>
                    <td className="py-3 pr-3 text-white">{d.name}</td>
                    <td className="py-3 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] ${d.type === 'q1' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-gray-400'}`}>{d.type || 'mock'}</span></td>
                    <td className={`py-3 pr-3 font-medium ${statusColor(d.status)}`}>{d.status}</td>
                    <td className="py-3 pr-3 text-gray-400 text-xs font-mono">{d.ip ? `${d.ip}:${d.apiPort||'-'}:${d.rpaPort||'-'}:${d.adbPort||'-'}` : '-'}</td>
                    <td className="py-3 pr-3 text-gray-400">{d.owner?.username || '-'}</td>
                    <td className="py-3 pr-3 text-gray-500 text-[10px]">{new Date(d.lastHeartbeat).toLocaleString()}</td>
                    <td className="py-3 pr-3 whitespace-nowrap">
                      {d.type === 'q1' && (<>
                        <button onClick={() => handleScreenshot(d.id)} disabled={snapLoading}
                          className="text-[10px] text-emerald-400 hover:text-emerald-300 mr-1 disabled:opacity-50">截图</button>
                        <button onClick={() => testLike(d.id)} disabled={snapLoading}
                          className="text-[10px] text-pink-400 hover:text-pink-300 mr-1 disabled:opacity-50">测试点赞</button>
                        <button onClick={() => { setShellDevId(d.id); setExecCmd(''); setShellOut('') }}
                          className="text-[10px] text-yellow-400 hover:text-yellow-300 mr-1">Shell</button>
                      </>)}
                      <button onClick={() => openEdit(d)} className="text-[10px] text-cyan-400 hover:text-cyan-300 mr-1">编辑</button>
                      <button onClick={() => handleDelete(d.id)} className="text-[10px] text-red-400 hover:text-red-300">删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>
    </div>
  )
}
