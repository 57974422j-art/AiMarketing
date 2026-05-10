'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface EditorUser {
  id: number; username: string; name: string | null; email: string; role: string
  createdAt: string; totalWindows: number; usedWindows: number
  boundAccounts: number; taskCompleted: number
}

export default function AdminUsersPage() {
  const { user, loading: authLoading } = useAuth()
  const [editors, setEditors] = useState<EditorUser[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<EditorUser | null>(null)
  const [newQuota, setNewQuota] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  // 创建表单
  const [cuUsername, setCuUsername] = useState('')
  const [cuEmail, setCuEmail] = useState('')
  const [cuPassword, setCuPassword] = useState('')
  const [cuName, setCuName] = useState('')
  const [cuRole, setCuRole] = useState('editor')
  const [cuWindows, setCuWindows] = useState('10')

  useEffect(() => {
    if (!authLoading && user?.role === 'admin') { loadEditors() }
    else if (!authLoading) { setLoading(false) }
  }, [authLoading, user])

  const loadEditors = async () => {
    try { const r = await fetch('/api/admin/users', { credentials: 'include' }); if (r.ok) setEditors((await r.json()).data || []) }
    catch {} finally { setLoading(false) }
  }

  const handleEdit = (editor: EditorUser) => { setEditing(editor); setNewQuota(editor.totalWindows.toString()) }

  const handleSave = async () => {
    const quota = parseInt(newQuota, 10)
    if (isNaN(quota) || quota < 0) { showToast('请输入有效的窗口数', 'error'); return }
    if (quota < editing!.usedWindows) {
      if (!confirm(`新配额(${quota})低于已使用量(${editing!.usedWindows})，确认？`)) return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/users', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: editing!.id, totalWindows: quota }) })
      if (res.ok) { setEditing(null); loadEditors(); showToast('配额已更新') } else { const d = await res.json(); showToast(d.message || '更新失败', 'error') }
    } catch { showToast('更新失败', 'error') }
    finally { setSubmitting(false) }
  }

  const handleCreate = async () => {
    if (!cuUsername || !cuEmail || !cuPassword) { showToast('请填写完整信息', 'error'); return }
    if (cuRole === 'editor' && !cuWindows) { showToast('请输入窗口配额', 'error'); return }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { username: cuUsername, email: cuEmail, password: cuPassword, name: cuName || null, role: cuRole }
      if (cuRole === 'editor') body.totalWindows = parseInt(cuWindows, 10) || 10
      const res = await fetch('/api/admin/users', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (res.ok) { setShowCreate(false); setCuUsername(''); setCuEmail(''); setCuPassword(''); setCuName(''); setCuWindows('10'); loadEditors(); showToast('账号创建成功') }
      else { const d = await res.json(); showToast(d.message || '创建失败', 'error') }
    } catch { showToast('创建失败', 'error') }
    finally { setSubmitting(false) }
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role !== 'admin') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2">无权限访问</p></div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">管理后台 / ADMIN</p>
            <h1 className="text-mono-lg text-white">客户管理 / USERS</h1>
            <p className="text-gray-400 text-sm mt-2">总数：<span className="text-emerald-400 font-bold">{editors.length}</span></p>
          </div>
          <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
            {showCreate ? '取消' : '+ 创建账号'}
          </button>
        </div>

        {showCreate && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4">直接创建账号（无需邀请码）</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="text-gray-500 text-xs block mb-1">角色</label>
                <select className="input-dark" value={cuRole} onChange={e => setCuRole(e.target.value)}>
                  <option value="editor" className="bg-gray-900">二级客户 (editor)</option>
                  <option value="end-user" className="bg-gray-900">终端客户 (end-user)</option>
                </select>
              </div>
              <input className="input-dark" placeholder="用户名 *" value={cuUsername} onChange={e => setCuUsername(e.target.value)} />
              <input className="input-dark" placeholder="邮箱 *" value={cuEmail} onChange={e => setCuEmail(e.target.value)} />
              <input className="input-dark" type="password" placeholder="密码 *" value={cuPassword} onChange={e => setCuPassword(e.target.value)} />
              <input className="input-dark" placeholder="姓名（可选）" value={cuName} onChange={e => setCuName(e.target.value)} />
              {cuRole === 'editor' && (
                <input className="input-dark" type="number" min="0" placeholder="窗口配额" value={cuWindows} onChange={e => setCuWindows(e.target.value)} />
              )}
            </div>
            <button onClick={handleCreate} disabled={submitting} className="btn-primary disabled:opacity-50">
              {submitting ? '创建中...' : '确认创建'}
            </button>
          </div>
        )}

        {loading ? <div className="text-center text-gray-400 py-12">加载中...</div>
        : editors.length === 0 ? <div className="card-glass p-12 text-center"><p className="text-gray-400">暂无客户</p></div>
        : <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-gray-500 text-mono-sm">
                  <th className="pb-3 pr-4">ID</th>
                  <th className="pb-3 pr-4">用户名</th>
                  <th className="pb-3 pr-4">姓名</th>
                  <th className="pb-3 pr-4">窗口配额</th>
                  <th className="pb-3 pr-4">已绑定账号</th>
                  <th className="pb-3 pr-4">任务完成</th>
                  <th className="pb-3 pr-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {editors.map((e) => (
                  <tr key={e.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-3 pr-4 text-gray-400">{e.id}</td>
                    <td className="py-3 pr-4 text-white font-medium">{e.username}</td>
                    <td className="py-3 pr-4 text-gray-400">{e.name || '-'}</td>
                    <td className="py-3 pr-4"><span className="text-emerald-400">{e.usedWindows}</span><span className="text-gray-500"> / {e.totalWindows}</span></td>
                    <td className="py-3 pr-4 text-gray-300">{e.boundAccounts}</td>
                    <td className="py-3 pr-4 text-gray-300">{e.taskCompleted}</td>
                    <td className="py-3 pr-4">
                      <button onClick={() => handleEdit(e)} className="px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs hover:bg-emerald-500/30">编辑配额</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}

        {editing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="card-glass p-6 w-full max-w-md mx-4">
              <h3 className="text-white font-bold mb-2">编辑窗口配额</h3>
              <p className="text-gray-400 text-sm mb-4">用户：<span className="text-white">{editing.username}</span> · 当前：<span className="text-emerald-400">{editing.usedWindows}</span>/<span className="text-gray-400">{editing.totalWindows}</span></p>
              <label className="text-gray-500 text-xs block mb-1">总窗口数</label>
              <input className="input-dark mb-4" type="number" min="0" value={newQuota} onChange={e => setNewQuota(e.target.value)} />
              <div className="flex justify-end gap-3">
                <button onClick={() => setEditing(null)} className="px-4 py-2 bg-white/10 text-gray-300 rounded-lg hover:bg-white/20">取消</button>
                <button onClick={handleSave} disabled={submitting} className="btn-primary disabled:opacity-50">{submitting ? '保存中...' : '保存'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
