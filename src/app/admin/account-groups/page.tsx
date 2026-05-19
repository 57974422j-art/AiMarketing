'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface SocialAccount {
  id: number; platform: string; username: string; status: string
}

interface GroupItem {
  id: number; socialAccountId: number
  socialAccount: SocialAccount
}

interface AccountGroup {
  id: number; name: string; ownerId: number
  owner?: { id: number; username: string }
  items: GroupItem[]
}

export default function AdminAccountGroupsPage() {
  const { user, loading: authLoading } = useAuth()
  const [groups, setGroups] = useState<AccountGroup[]>([])
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [addingTo, setAddingTo] = useState<number | null>(null)
  const [selectedAccount, setSelectedAccount] = useState('')

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') { loadGroups(); loadAccounts() }
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadGroups = async () => {
    try { const r = await fetch('/api/account-groups', { credentials: 'include' }); if (r.ok) setGroups((await r.json()).data || []) }
    catch {} finally { setLoading(false) }
  }
  const loadAccounts = async () => {
    try { const r = await fetch('/api/social-accounts', { credentials: 'include' }); if (r.ok) setAccounts((await r.json()).data || []) }
    catch {}
  }

  const createGroup = async () => {
    if (!newName.trim()) return
    const r = await fetch('/api/account-groups', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }) })
    if (r.ok) { setNewName(''); loadGroups() } else showToast('创建失败', 'error')
  }

  const deleteGroup = async (id: number) => {
    if (!confirm('确定删除此分组？')) return
    const r = await fetch(`/api/account-groups?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) loadGroups(); else showToast('删除失败', 'error')
  }

  const addToGroup = async () => {
    if (!addingTo || !selectedAccount) return
    const r = await fetch('/api/account-groups', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId: addingTo, accountId: parseInt(selectedAccount) }) })
    if (r.ok) { setAddingTo(null); setSelectedAccount(''); loadGroups() } else { const d = await r.json(); showToast(d.message || '添加失败', 'error') }
  }

  const removeFromGroup = async (groupId: number, accountId: number) => {
    const r = await fetch(`/api/account-groups?groupId=${groupId}&accountId=${accountId}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) loadGroups(); else showToast('移除失败', 'error')
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2">无权限访问</p></div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">管理后台 / ADMIN</p>
          <h1 className="text-mono-lg text-white">账号分组 / ACCOUNT GROUPS</h1>
        </div>

        <div className="card-glass p-6 mb-6">
          <div className="flex gap-3">
            <input className="input-dark flex-1" placeholder="新分组名称" value={newName} onChange={e => setNewName(e.target.value)} />
            <button onClick={createGroup} className="btn-primary" disabled={!newName.trim()}>创建分组</button>
          </div>
        </div>

        {loading ? <div className="text-center text-gray-400 py-12">加载中...</div>
        : groups.length === 0 ? <div className="card-glass p-12 text-center"><p className="text-gray-400">暂无分组</p></div>
        : <div className="space-y-4">
            {groups.map(g => (
              <div key={g.id} className="card-glass p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-bold">{g.name}</h3>
                    <span className="text-gray-500 text-xs">{g.items?.length || 0} 个账号</span>
                    {g.owner && <span className="text-gray-500 text-xs">创建者: {g.owner.username}</span>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setAddingTo(addingTo === g.id ? null : g.id)} className="px-3 py-1 text-xs bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30">
                      {addingTo === g.id ? '取消' : '+ 添加账号'}
                    </button>
                    <button onClick={() => setExpanded(expanded === g.id ? null : g.id)} className="px-3 py-1 text-xs bg-white/10 text-gray-300 rounded hover:bg-white/20">
                      {expanded === g.id ? '收起' : '展开'}
                    </button>
                    <button onClick={() => deleteGroup(g.id)} className="px-3 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30">删除</button>
                  </div>
                </div>

                {addingTo === g.id && (
                  <div className="flex gap-2 mb-3 p-3 bg-black/30 rounded-lg">
                    <select className="input-dark text-sm" value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}>
                      <option value="" className="bg-gray-900">选择账号...</option>
                      {accounts.filter(a => !g.items?.some(i => i.accountId === a.id)).map(a => (
                        <option key={a.id} value={a.id} className="bg-gray-900">{a.platform} - {a.username}</option>
                      ))}
                    </select>
                    <button onClick={addToGroup} className="btn-primary text-sm" disabled={!selectedAccount}>添加</button>
                  </div>
                )}

                {expanded === g.id && g.items?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {g.items.map(item => (
                      <div key={item.id} className="flex items-center justify-between bg-black/30 rounded px-3 py-2 text-sm">
                        <span className="text-gray-300">
                          <span className="bg-white/5 px-1.5 py-0.5 rounded text-xs mr-2">{item.socialAccount.platform}</span>
                          {item.socialAccount.username}
                          <span className={`ml-2 text-xs ${item.socialAccount.status === '已绑定' ? 'text-emerald-400' : item.socialAccount.status === '已封禁' ? 'text-red-400' : 'text-gray-500'}`}>
                            ({item.socialAccount.status})
                          </span>
                        </span>
                        <button onClick={() => removeFromGroup(g.id, item.accountId)} className="text-xs text-red-400 hover:text-red-300">移除</button>
                      </div>
                    ))}
                  </div>
                )}
                {expanded === g.id && (!g.items || g.items.length === 0) && (
                  <p className="text-gray-500 text-sm mt-2">暂无账号</p>
                )}
              </div>
            ))}
          </div>}
      </div>
    </div>
  )
}
