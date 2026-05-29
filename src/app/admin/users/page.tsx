'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface UserInfo {
  id: number; username: string; name: string | null; email: string; role: string; plan: string
  createdAt: string; parentId: number | null
  parent: { id: number; username: string; name: string | null } | null
  childrenCount: number; totalWindows: number; usedWindows: number
  boundAccounts: number; socialAccounts: { platform: string; status: string }[]
}

const PLATFORM_ICON: Record<string, string> = { douyin: '🎵', kuaishou: '📹', xiaohongshu: '📕', shipinhao: '💚', weibo: '📢', bilibili: '📺' }
const PLATFORM_LABEL: Record<string, string> = { douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书', shipinhao: '视频号', weibo: '微博', bilibili: 'B站' }
const STATUS_COLOR: Record<string, string> = { '未绑定': 'text-gray-500', '已绑定': 'text-emerald-400', '登录异常': 'text-yellow-400', '已封禁': 'text-red-400' }
const fmtDate = (s: string) => s?.slice(0, 10) || '-'

export default function AccountInfoPage() {
  const { user, loading: authLoading } = useAuth()
  const [users, setUsers] = useState<UserInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [filterRole, setFilterRole] = useState('')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [cuUsername, setCuUsername] = useState('')
  const [cuEmail, setCuEmail] = useState('')
  const [cuPassword, setCuPassword] = useState('')
  const [cuName, setCuName] = useState('')
  const [cuRole, setCuRole] = useState('editor')
  const [cuWindows, setCuWindows] = useState('10')
  const [submitting, setSubmitting] = useState(false)
  const [editUser, setEditUser] = useState<UserInfo | null>(null)
  const [newQuota, setNewQuota] = useState('')
  const [storageUser, setStorageUser] = useState<{ id: number; name: string } | null>(null)
  const [storageFiles, setStorageFiles] = useState<any[]>([])
  const [storageLoading, setStorageLoading] = useState(false)

  useEffect(() => {
    if (!authLoading && user?.role === 'admin') loadUsers()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadUsers = async () => {
    try { const r = await fetch('/api/admin/users', { credentials: 'include' }); if (r.ok) setUsers((await r.json()).data || []) }
    catch {} finally { setLoading(false) }
  }

  const handleCreate = async () => {
    if (!cuUsername || !cuEmail || !cuPassword) { showToast('请填写完整信息', 'error'); return }
    setSubmitting(true)
    try {
      const body = { username: cuUsername, email: cuEmail, password: cuPassword, name: cuName || null, role: cuRole, totalWindows: cuRole === 'editor' ? parseInt(cuWindows) : undefined }
      const r = await fetch('/api/admin/users', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      if (r.ok) { showToast('创建成功', 'success'); setShowCreate(false); setCuUsername(''); setCuEmail(''); setCuPassword(''); setCuName(''); loadUsers() }
      else showToast(d.message || '创建失败', 'error')
    } catch { showToast('创建失败', 'error') }
    finally { setSubmitting(false) }
  }

  const handleQuotaSave = async () => {
    if (!editUser) return
    const q = parseInt(newQuota, 10)
    if (isNaN(q) || q < 0) { showToast('无效数值', 'error'); return }
    setSubmitting(true)
    try {
      const r = await fetch('/api/admin/users', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: editUser.id, totalWindows: q }) })
      const d = await r.json()
      if (r.ok) { showToast('配额已更新', 'success'); setEditUser(null); loadUsers() }
      else showToast(d.message || '更新失败', 'error')
    } catch { showToast('更新失败', 'error') }
    finally { setSubmitting(false) }
  }

  const filtered = users.filter(u => {
    if (filterRole && u.role !== filterRole) return false
    if (search) { const q = search.toLowerCase(); return u.username.toLowerCase().includes(q) || (u.name?.toLowerCase()||'').includes(q) || u.email.toLowerCase().includes(q) }
    return true
  })

  if (authLoading) return <div className="min-h-screen bg-gray-950 p-4"><p className="text-gray-400 text-sm">加载中...</p></div>
  if (!user || user.role !== 'admin') return <div className="min-h-screen bg-gray-950 p-4"><p className="text-gray-400 text-sm">无权访问</p></div>

  return (
    <div className="min-h-screen bg-gray-950 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-label mb-1">管理中心 / ACCOUNT INFO</p>
            <h1 className="text-mono-lg text-white">账号信息</h1>
          </div>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs hover:bg-emerald-500/30">+ 创建账号</button>
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {['', 'editor', 'end-user'].map(r => (
            <button key={r} onClick={() => setFilterRole(r)} className={`px-3 py-1.5 rounded-lg text-xs border transition ${filterRole===r?'bg-emerald-500/20 text-emerald-400 border-emerald-500/30':'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>{r||'全部'}</button>
          ))}
          <input className="input-dark text-xs flex-1 min-w-[200px]" placeholder="搜索用户名/姓名/邮箱" value={search} onChange={e=>setSearch(e.target.value)} />
          <span className="text-xs text-gray-500 self-center">{filtered.length} 人</span>
        </div>

        {loading ? <p className="text-gray-400 text-xs">加载中...</p> : filtered.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-10">暂无数据</p>
        ) : (
          <div className="space-y-3">
            {filtered.map(u => (
              <div key={u.id} className="card-glass p-4 rounded-xl">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <span className="text-sm font-bold text-white">{u.name || u.username}</span>
                    <span className="text-[10px] text-gray-500 ml-2">#{u.id}</span>
                    <span className={`ml-2 px-2 py-0.5 text-[10px] rounded ${u.role==='editor'?'bg-blue-500/20 text-blue-400':'bg-gray-500/20 text-gray-400'}`}>{u.role==='editor'?'代理商':'终端客户'}</span>
                    <span className={`ml-2 px-2 py-0.5 text-[10px] rounded ${u.plan==='pro'?'bg-purple-500/20 text-purple-400':'bg-white/5 text-gray-400'}`}>{u.plan === 'pro' ? '专业版' : u.plan === 'enterprise' ? '企业版' : '免费版'}</span>
                  </div>
                  {u.role === 'editor' && (
                    <button onClick={() => { setEditUser(u); setNewQuota(String(u.totalWindows)) }} className="text-[10px] px-2 py-1 bg-white/5 text-gray-400 rounded hover:bg-white/10">编辑配额</button>
                  )}
                  <button onClick={async () => {
                    setStorageUser({ id: u.id, name: u.name || u.username })
                    setStorageLoading(true)
                    try { const r = await fetch(`/api/admin/users/${u.id}/storage`, { credentials: 'include' }); if (r.ok) setStorageFiles((await r.json()).data?.files || []) }
                    catch {} finally { setStorageLoading(false) }
                  }} className="text-[10px] px-2 py-1 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 ml-1">仓库</button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[10px]">
                  <div><span className="text-gray-500">用户名</span><p className="text-gray-300">{u.username}</p></div>
                  <div><span className="text-gray-500">注册日期</span><p className="text-gray-300">{fmtDate(u.createdAt)}</p></div>
                  <div><span className="text-gray-500">上级代理</span><p className="text-gray-300">{u.parent ? `${u.parent.name||u.parent.username} (#${u.parent.id})` : '-'}</p></div>
                  <div><span className="text-gray-500">下级客户</span><p className="text-gray-300">{u.childrenCount} 人</p></div>
                  {u.role === 'editor' && <div><span className="text-gray-500">窗口配额</span><p className="text-gray-300">{u.usedWindows} / {u.totalWindows}</p></div>}
                  <div><span className="text-gray-500">已绑定平台</span><p className="text-gray-300">{u.socialAccounts.length === 0 ? <span className="text-gray-600">未绑定</span> : u.socialAccounts.slice(0,4).map(a=>`${PLATFORM_ICON[a.platform]||''}${PLATFORM_LABEL[a.platform]||a.platform}`).join('、')}{u.socialAccounts.length>4 ? ` 等${u.socialAccounts.length}个` : ''}</p></div>
                </div>

                {u.socialAccounts.length > 0 && (
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {u.socialAccounts.map((a, i) => (
                      <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLOR[a.status]||'text-gray-500'} bg-white/5`}>
                        {PLATFORM_ICON[a.platform]||''} {PLATFORM_LABEL[a.platform]||a.platform}{a.status!=='未绑定'?` (${a.status})`:''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {showCreate && <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={()=>setShowCreate(false)}>
          <div className="card-glass p-6 rounded-xl max-w-md w-full mx-4" onClick={e=>e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-4">创建账号</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] text-gray-400">角色</label><select className="input-dark w-full text-xs" value={cuRole} onChange={e=>setCuRole(e.target.value)}><option value="editor">代理商</option><option value="end-user">终端客户</option></select></div>
              <div><label className="text-[10px] text-gray-400">用户名</label><input className="input-dark w-full text-xs" value={cuUsername} onChange={e=>setCuUsername(e.target.value)} /></div>
              <div><label className="text-[10px] text-gray-400">邮箱</label><input className="input-dark w-full text-xs" value={cuEmail} onChange={e=>setCuEmail(e.target.value)} /></div>
              <div><label className="text-[10px] text-gray-400">密码</label><input type="password" className="input-dark w-full text-xs" value={cuPassword} onChange={e=>setCuPassword(e.target.value)} /></div>
              <div><label className="text-[10px] text-gray-400">姓名</label><input className="input-dark w-full text-xs" value={cuName} onChange={e=>setCuName(e.target.value)} /></div>
              {cuRole==='editor'&&<div><label className="text-[10px] text-gray-400">窗口配额</label><input type="number" className="input-dark w-full text-xs" value={cuWindows} onChange={e=>setCuWindows(e.target.value)} /></div>}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={()=>setShowCreate(false)} className="flex-1 py-2 bg-white/5 text-gray-400 rounded-lg text-xs">取消</button>
              <button disabled={submitting} onClick={handleCreate} className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs">{submitting?'创建中...':'确认创建'}</button>
            </div>
          </div>
        </div>}

        {editUser && <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={()=>setEditUser(null)}>
          <div className="card-glass p-6 rounded-xl max-w-sm w-full mx-4" onClick={e=>e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-2">编辑窗口配额</h3>
            <p className="text-[10px] text-gray-500 mb-3">{editUser.name||editUser.username} 当前: {editUser.usedWindows} / {editUser.totalWindows}</p>
            <input type="number" className="input-dark w-full text-xs" value={newQuota} onChange={e=>setNewQuota(e.target.value)} />
            <div className="flex gap-2 mt-4">
              <button onClick={()=>setEditUser(null)} className="flex-1 py-2 bg-white/5 text-gray-400 rounded-lg text-xs">取消</button>
              <button disabled={submitting} onClick={handleQuotaSave} className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs">{submitting?'保存中...':'保存'}</button>
            </div>
          </div>
        </div>}

        {storageUser && <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={()=>setStorageUser(null)}>
          <div className="card-glass p-6 rounded-xl max-w-3xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">{storageUser.name} 的仓库</h3>
              <button onClick={()=>setStorageUser(null)} className="text-gray-400 hover:text-white text-xs">关闭</button>
            </div>
            {storageLoading ? <p className="text-gray-400 text-xs">加载中...</p> : storageFiles.length === 0 ? (
              <p className="text-gray-500 text-xs text-center py-8">暂无文件</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {storageFiles.map(f => (
                  <div key={f.name} className="bg-white/5 rounded-lg overflow-hidden">
                    {f.isVideo && f.thumbUrl ? (
                      <img src={f.thumbUrl} alt={f.name} className="w-full aspect-video object-cover" />
                    ) : f.name.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                      <img src={`/storage/${storageUser.id}/${f.name}`} alt={f.name} className="w-full aspect-video object-cover" />
                    ) : (
                      <div className="w-full aspect-video flex items-center justify-center text-3xl bg-white/5">{f.isVideo ? '🎬' : '📄'}</div>
                    )}
                    <p className="text-[10px] text-gray-400 truncate px-2 py-1">{f.name}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>}
      </div>
    </div>
  )
}
