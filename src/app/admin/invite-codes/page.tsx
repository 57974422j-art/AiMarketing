'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface InviteItem {
  id: number; code: string; role: string; isUsed: boolean; isActive: boolean
  createdAt: string; usedByUser: { username: string } | null; creator: { username: string } | null
}

export default function AdminInviteCodesPage() {
  const { user, loading: authLoading } = useAuth()
  const [items, setItems] = useState<InviteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState('editor')
  const [count, setCount] = useState('1')

  useEffect(() => {
    if (!authLoading && user?.role === 'admin') loadItems()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadItems = async () => {
    try { const r = await fetch('/api/admin/invite-codes', { credentials: 'include' }); if (r.ok) setItems((await r.json()).data || []) }
    catch {} finally { setLoading(false) }
  }

  const handleCreate = async () => {
    const num = parseInt(count, 10) || 1
    const r = await fetch('/api/admin/invite-codes', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, count: num }),
    })
    if (r.ok) { const d = await r.json(); showToast(d.message, 'success'); loadItems() }
    else { const d = await r.json(); showToast(d.message || '生成失败', 'error') }
  }

  const toggleActive = async (id: number, current: boolean) => {
    const r = await fetch('/api/admin/invite-codes', {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive: !current }),
    })
    if (r.ok) loadItems(); else showToast('操作失败', 'error')
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2">无权限访问</p></div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">管理后台 / ADMIN</p>
          <h1 className="text-mono-lg text-white">邀请码管理 / INVITE CODES</h1>
        </div>

        <div className="card-glass p-6 mb-6">
          <h3 className="text-white font-bold mb-4">生成邀请码</h3>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-gray-500 text-xs block mb-1">角色</label>
              <select className="input-dark" value={role} onChange={e => setRole(e.target.value)}>
                <option value="editor" className="bg-gray-900">二级客户 (editor)</option>
                <option value="end-user" className="bg-gray-900">终端客户 (end-user)</option>
              </select>
            </div>
            <div>
              <label className="text-gray-500 text-xs block mb-1">数量（最多50）</label>
              <input className="input-dark w-24" type="number" min="1" max="50" value={count} onChange={e => setCount(e.target.value)} />
            </div>
            <button onClick={handleCreate} className="btn-primary">生成</button>
          </div>
        </div>

        {loading ? <div className="text-center text-gray-400 py-12">加载中...</div>
        : items.length === 0 ? <div className="card-glass p-12 text-center"><p className="text-gray-400">暂无邀请码</p></div>
        : <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-gray-500 text-mono-sm">
                  <th className="pb-3 pr-4">邀请码</th>
                  <th className="pb-3 pr-4">角色</th>
                  <th className="pb-3 pr-4">状态</th>
                  <th className="pb-3 pr-4">使用人</th>
                  <th className="pb-3 pr-4">创建时间</th>
                  <th className="pb-3 pr-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-3 pr-4 text-white font-mono text-xs">{item.code}</td>
                    <td className="py-3 pr-4"><span className={`px-2 py-0.5 rounded text-xs ${item.role === 'editor' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>{item.role}</span></td>
                    <td className="py-3 pr-4">
                      {item.isUsed ? <span className="text-gray-500 text-xs">已使用</span>
                      : item.isActive ? <span className="text-emerald-400 text-xs">有效</span>
                      : <span className="text-red-400 text-xs">已禁用</span>}
                    </td>
                    <td className="py-3 pr-4 text-gray-400">{item.usedByUser?.username || (item.isUsed ? '未知' : '-')}</td>
                    <td className="py-3 pr-4 text-gray-500 text-xs">{new Date(item.createdAt).toLocaleString()}</td>
                    <td className="py-3 pr-4">
                      {!item.isUsed && (
                        <button onClick={() => toggleActive(item.id, item.isActive)}
                          className={`px-2 py-1 text-xs rounded ${item.isActive ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'}`}>
                          {item.isActive ? '禁用' : '启用'}
                        </button>
                      )}
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
