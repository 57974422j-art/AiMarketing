'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface DeviceItem { id: number; name: string; status: string; apiPort?: number }
interface AccountItem {
  id: number; platform: string; accountName: string; mobile: string; password: string
  accountId: string; status: string; bindType: string; deviceId: number | null; remark: string
  user: { id: number; username: string; name: string | null; parentId: number | null; parent: { id: number; username: string; name: string | null } | null }
  device: { id: number; name: string } | null; createdAt: string
}

const PLATFORM_ICON: Record<string, string> = { douyin: '🎵', kuaishou: '📹', xiaohongshu: '📕', shipinhao: '💚', weibo: '📢', bilibili: '📺' }
const PLATFORM_LABEL: Record<string, string> = { douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书', shipinhao: '视频号', weibo: '微博', bilibili: 'B站' }
const BIND_TYPE_LABEL: Record<string, string> = { device: 'Q1 群控', usb: '真手机', manual: '指纹浏览器', official: '官方API' }
const BIND_TYPE_COLOR: Record<string, string> = { device: 'bg-blue-500/20 text-blue-400 border-blue-500/30', usb: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30', manual: 'bg-purple-500/20 text-purple-400 border-purple-500/30', official: 'bg-orange-500/20 text-orange-400 border-orange-500/30' }
const STATUS_COLOR: Record<string, string> = { '未绑定': 'bg-gray-500/20 text-gray-400 border-gray-500/30', '已绑定': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', '登录异常': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', '已封禁': 'bg-red-500/20 text-red-400 border-red-500/30' }

function NoAccess() { return <div className="bg-gray-950 p-4 text-gray-400 text-sm">无权访问</div> }
function Loading() { return <div className="bg-gray-950 p-4 text-gray-400 text-sm">加载中...</div> }

export default function SocialAccountsPage() {
  const { user, loading: authLoading } = useAuth()
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [devices, setDevices] = useState<DeviceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ accountName: '', platform: 'douyin', accountId: '', bindType: 'device', password: '', mobile: '', remark: '' })
  const [createLoading, setCreateLoading] = useState(false)

  const [bindId, setBindId] = useState<number | null>(null)
  const [bindAccount, setBindAccount] = useState<AccountItem | null>(null)
  const [bindDeviceId, setBindDeviceId] = useState('')
  const [bindAdbSerial, setBindAdbSerial] = useState('')
  const [bindBrowserPort, setBindBrowserPort] = useState('')
  const [binding, setBinding] = useState(false)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') load()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const load = useCallback(async () => {
    try {
      const [aRes, dRes] = await Promise.all([
        fetch('/api/accounts', { credentials: 'include' }),
        user?.role !== 'end-user' ? fetch('/api/devices', { credentials: 'include' }) : Promise.resolve(null),
      ])
      if (aRes.ok) { const d = await aRes.json(); setAccounts(d.data || []) }
      if (dRes?.ok) { const d = await dRes.json(); setDevices((d.data || []).filter((dev: any) => dev.type === 'q1')) }
    } catch {} finally { setLoading(false) }
  }, [user])

  const handleCreate = async () => {
    if (!createForm.accountName.trim()) { showToast('请输入账号名', 'error'); return }
    setCreateLoading(true)
    try {
      const r = await fetch('/api/accounts', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createForm) })
      if (r.ok) { showToast('账号已创建'); setShowCreate(false); load() }
      else { const d = await r.json(); showToast(d.message || '创建失败', 'error') }
    } catch { showToast('创建失败', 'error') } finally { setCreateLoading(false) }
  }

  const handleBind = async () => {
    const isLocal = bindDeviceId === 'local'
    const isManual = bindAccount?.bindType === 'manual'
    if (!bindId) { showToast('请选择要绑定的账号', 'error'); return }
    if (isManual) {
      if (!bindBrowserPort.trim()) { showToast('请输入浏览器端口', 'error'); return }
      const portNum = parseInt(bindBrowserPort.trim(), 10)
      if (isNaN(portNum) || portNum < 1024 || portNum > 65535) { showToast('端口号无效（1024-65535）', 'error'); return }
    } else {
      if (!bindDeviceId && !bindAdbSerial) { showToast('请选择设备或输入ADB序列号', 'error'); return }
    }
    setBinding(true)
    try {
      const body: any = { id: bindId }
      if (isManual) {
        // 指纹浏览器：端口号存入 accountId 字段
        body.accountId = bindBrowserPort.trim()
        body.deviceId = null
      } else if (isLocal) { body.deviceId = 'local'; body.remark = `adb:${bindAdbSerial}` }
      else if (bindDeviceId) { body.deviceId = parseInt(bindDeviceId) }
      const r = await fetch('/api/accounts', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (r.ok) { showToast('绑定成功', 'success'); setBindId(null); setBindAccount(null); load() }
      else { const d = await r.json(); showToast(d.message || '失败', 'error') }
    } catch { showToast('绑定失败', 'error') } finally { setBinding(false) }
  }

  const handleUnbind = async (id: number) => {
    try {
      const r = await fetch('/api/accounts', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, deviceId: '' }) })
      if (r.ok) { showToast('已解绑', 'success'); load() }
      else { const d = await r.json(); showToast(d.message || '解绑失败', 'error') }
    } catch { showToast('解绑失败', 'error') }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此账号？')) return
    try {
      const r = await fetch('/api/accounts?id=' + id, { method: 'DELETE', credentials: 'include' })
      if (r.ok) { showToast('已删除', 'success'); load() }
      else showToast('删除失败', 'error')
    } catch { showToast('删除失败', 'error') }
  }

  const toggle = (key: string) => {
    setExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return accounts
    const s = search.toLowerCase()
    return accounts.filter(a => a.accountName.toLowerCase().includes(s) || a.user?.username?.toLowerCase().includes(s) || a.platform.toLowerCase().includes(s) || a.mobile.includes(s))
  }, [accounts, search])

  const adminGroups = useMemo(() => {
    const map: Record<string, AccountItem[]> = {}
    filtered.forEach(a => { const k = a.user?.parent?.username || '未归属'; if (!map[k]) map[k] = []; map[k].push(a) })
    return Object.entries(map).sort(([a], [b]) => a === '未归属' ? 1 : b === '未归属' ? -1 : a.localeCompare(b))
  }, [filtered])

  const userGroups = useMemo(() => {
    const map: Record<string, AccountItem[]> = {}
    filtered.forEach(a => { const k = a.user?.username || '未知'; if (!map[k]) map[k] = []; map[k].push(a) })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  if (authLoading || loading) return <Loading />
  if (!user || user.role === 'end-user') return <NoAccess />

  const isAdmin = user.role === 'admin'
  const statusCount = (items: AccountItem[], s: string) => items.filter(a => a.status === s).length

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <p className="text-label mb-2">管理后台 / ACCOUNTS</p>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-mono-lg text-white">{isAdmin ? '账号总览 / ALL ACCOUNTS' : '社交账号 / SOCIAL ACCOUNTS'}</h1>
              <p className="text-gray-400 text-sm mt-1">{accounts.length} 个账号 · {accounts.filter(a => a.status === '已绑定').length} 已绑定</p>
            </div>
            <button onClick={() => setShowCreate(true)} className="btn-primary text-xs py-2">+ 新建账号</button>
          </div>
          <input className="input-dark mt-3 w-full max-w-md text-sm" placeholder="🔍 搜索账号名/用户名/手机号..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold mb-1">新建账号</h3>
              <p className="text-xs text-gray-500 mb-4">选择绑定方式：Q1 群控 / 真手机 / 指纹浏览器 / 官方API</p>
              <div className="space-y-3">
                <select className="input-dark w-full text-sm" value={createForm.platform} onChange={e => setCreateForm(p => ({ ...p, platform: e.target.value }))}>
                  <option value="douyin" className="bg-gray-900">🎵 抖音</option>
                  <option value="kuaishou" className="bg-gray-900">📹 快手</option>
                  <option value="xiaohongshu" className="bg-gray-900">📕 小红书</option>
                  <option value="shipinhao" className="bg-gray-900">💚 视频号</option>
                  <option value="weibo" className="bg-gray-900">📢 微博</option>
                  <option value="bilibili" className="bg-gray-900">📺 B站</option>
                </select>
                <input className="input-dark w-full text-sm" placeholder="账号名称（如：火锅店官方号）" value={createForm.accountName} onChange={e => setCreateForm(p => ({ ...p, accountName: e.target.value }))} />
                <input className="input-dark w-full text-sm" placeholder="抖音号 / 唯一标识" value={createForm.accountId} onChange={e => setCreateForm(p => ({ ...p, accountId: e.target.value }))} />
                <div className="flex gap-2">
                  <input className="input-dark flex-1 text-sm" placeholder="手机号" value={createForm.mobile} onChange={e => setCreateForm(p => ({ ...p, mobile: e.target.value }))} />
                  <input className="input-dark flex-1 text-sm" type="password" placeholder="密码" value={createForm.password} onChange={e => setCreateForm(p => ({ ...p, password: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">绑定方式</label>
                  <div className="flex gap-2">
                    {[
                      { value: 'device', label: '📱 Q1 群控', desc: '容器自动化' },
                      { value: 'usb', label: '📲 真手机', desc: 'USB直连' },
                      { value: 'manual', label: '🌐 指纹浏览器', desc: '脚本发布' },
                      { value: 'official', label: '🔌 官方API', desc: '开放平台' },
                    ].map(opt => (
                      <button key={opt.value} onClick={() => setCreateForm(p => ({ ...p, bindType: opt.value }))}
                        className={`flex-1 p-2 rounded-lg border text-xs transition ${createForm.bindType === opt.value ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-[10px] opacity-60">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                {createForm.bindType === 'imai' && (
                  <input className="input-dark w-full text-sm" placeholder="IMAI WORK 工作台地址" value={createForm.remark} onChange={e => setCreateForm(p => ({ ...p, remark: e.target.value }))} />
                )}
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowCreate(false)} className="flex-1 py-2 border border-white/10 text-gray-400 rounded-lg hover:bg-white/10 text-sm">取消</button>
                <button onClick={handleCreate} disabled={createLoading} className="flex-1 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 text-sm">{createLoading ? '创建中...' : '确认创建'}</button>
              </div>
            </div>
          </div>
        )}

        {bindId && bindAccount && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => { setBindId(null); setBindAccount(null) }}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold mb-1">绑定设备</h3>
              <p className="text-xs text-gray-500 mb-1">
                {bindAccount.accountName} · {PLATFORM_LABEL[bindAccount.platform] || bindAccount.platform}
                <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] border ${BIND_TYPE_COLOR[bindAccount.bindType] || ''}`}>
                  {BIND_TYPE_LABEL[bindAccount.bindType] || bindAccount.bindType}
                </span>
              </p>

              {/* ── device (Q1群控) ── */}
              {bindAccount.bindType === 'device' && (
                <>
                  <p className="text-[11px] text-gray-500 mb-3">选择 Q1 设备</p>
                  <select className="input-dark w-full mb-3" value={bindDeviceId} onChange={e => setBindDeviceId(e.target.value)}>
                    <option value="">选择设备...</option>
                    {devices.filter(d => d.status === 'online').map(d => <option key={d.id} value={d.id} className="bg-gray-900">{d.name} (端口{d.apiPort})</option>)}
                  </select>
                </>
              )}

              {/* ── usb (真手机ADB) ── */}
              {bindAccount.bindType === 'usb' && (
                <>
                  <p className="text-[11px] text-gray-500 mb-3">填写本地 ADB 设备序列号（不占用服务器端口）</p>
                  <select className="input-dark w-full mb-3" value={bindDeviceId} onChange={e => setBindDeviceId(e.target.value)}>
                    <option value="">选择连接方式...</option>
                    <option value="local" className="bg-gray-900 text-purple-400">📱 本地设备（ADB直连）</option>
                  </select>
                  {bindDeviceId === 'local' && (
                    <input className="input-dark w-full mb-3 text-sm" placeholder="ADB 序列号（如 10CF3G0YDS003AD）" value={bindAdbSerial} onChange={e => setBindAdbSerial(e.target.value)} />
                  )}
                </>
              )}

              {/* ── manual (指纹浏览器) ── */}
              {bindAccount.bindType === 'manual' && (
                <>
                  <p className="text-[11px] text-purple-400/80 mb-2">🌐 指纹浏览器 — 分配 CDP 调试端口</p>
                  <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 mb-3">
                    <p className="text-[10px] text-purple-300/70">
                      端口范围建议：9220 ~ 9320<br/>
                      每账号独占一个端口，与 Q1 端口完全隔离
                    </p>
                  </div>
                  <label className="block text-xs text-gray-400 mb-1">浏览器端口</label>
                  <input className="input-dark w-full mb-3 text-sm font-mono" type="number"
                    min="1024" max="65535" placeholder="如 9222"
                    value={bindBrowserPort}
                    onChange={e => setBindBrowserPort(e.target.value)}
                  />
                </>
              )}

              {/* ── official (官方API) ── */}
              {bindAccount.bindType === 'official' && (
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 text-center mb-3">
                  <p className="text-orange-300 text-sm">🔌 官方 API 类型</p>
                  <p className="text-[11px] text-orange-400/70 mt-1">无需绑定设备，使用平台开放接口直接发布</p>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => { setBindId(null); setBindAccount(null) }} className="flex-1 py-2 border border-white/10 text-gray-400 rounded-lg hover:bg-white/10 text-sm">取消</button>
                {bindAccount.bindType !== 'official' ? (
                  <button onClick={handleBind} disabled={binding || (bindAccount.bindType === 'manual' ? !bindBrowserPort.trim() : !bindDeviceId)}
                    className="flex-1 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 text-sm">
                    {binding ? '绑定中...' : '确认绑定'}
                  </button>
                ) : (
                  <button onClick={() => { setBindId(null); setBindAccount(null) }}
                    className="flex-1 py-2 bg-gray-600 text-white rounded-lg text-sm">知道了</button>
                )}
              </div>
            </div>
          </div>
        )}

        {isAdmin ? (
          <div className="space-y-3">
            {adminGroups.map(([editorName, editorAccounts]) => (
              <div key={editorName} className="card-glass overflow-hidden">
                <button onClick={() => toggle(`editor_${editorName}`)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">👤</span>
                    <span className="text-white font-semibold">{editorName}</span>
                    <span className="text-xs text-gray-500">{editorAccounts.length} 个记录 · {statusCount(editorAccounts, '已绑定')} 已绑定 · {statusCount(editorAccounts, '未绑定')} 待绑</span>
                  </div>
                  <span className={`text-gray-500 transition text-xs ${expanded.has(`editor_${editorName}`) ? 'rotate-180' : ''}`}>▼</span>
                </button>
                {expanded.has(`editor_${editorName}`) && (
                  <div className="border-t border-white/5 px-5 pb-4 pt-2 space-y-1">
                    {Object.entries(editorAccounts.reduce<Record<string, AccountItem[]>>((acc, a) => { const k = a.user?.username || '未知'; if (!acc[k]) acc[k] = []; acc[k].push(a); return acc }, {})).map(([userName, userAccounts]) => (
                      <div key={userName}>
                        <button onClick={() => toggle(`user_${editorName}_${userName}`)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg transition">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-gray-400">└─</span>
                            <span className="text-gray-300">{userName}</span>
                            <span className="text-[10px] text-gray-500">· {userAccounts.length} 平台 · {statusCount(userAccounts, '已绑定')} 已绑</span>
                          </div>
                          <span className={`text-gray-600 text-[10px] transition ${expanded.has(`user_${editorName}_${userName}`) ? 'rotate-180' : ''}`}>▾</span>
                        </button>
                        {expanded.has(`user_${editorName}_${userName}`) && (
                          <div className="ml-8 mt-1 space-y-1">
                            {userAccounts.map(a => (
                              <div key={a.id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg text-xs">
                                <div className="flex items-center gap-2">
                                  <span>{PLATFORM_ICON[a.platform] || '📱'}</span>
                                  <span className="text-white">{PLATFORM_LABEL[a.platform] || a.platform}</span>
                                  <span className="text-gray-400">· {a.accountName}</span>
                                  {a.mobile && <span className="text-gray-600">📱{a.mobile}</span>}
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] border ${STATUS_COLOR[a.status] || 'bg-gray-500/20 text-gray-500'}`}>{a.status}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {a.device && <span className="text-gray-600">{a.device.name}</span>}
                                  {a.status !== '已绑定' ? (
                                    <button onClick={() => { setBindId(a.id); setBindAccount(a); setBindDeviceId(''); setBindAdbSerial(''); setBindBrowserPort('') }} className="text-[10px] px-2 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/30">+ 绑</button>
                                  ) : (
                                    <button onClick={() => handleUnbind(a.id)} className="text-[10px] px-2 py-1 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded hover:bg-yellow-500/30">🔓 解绑</button>
                                  )}
                                  <button onClick={() => handleDelete(a.id)} className="text-[10px] px-2 py-1 bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30" title="删除此账号">🗑️</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {userGroups.map(([userName, userAccounts]) => (
              <div key={userName} className="card-glass overflow-hidden">
                <button onClick={() => toggle(`user_${userName}`)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">👤</span>
                    <span className="text-white font-semibold">{userName}</span>
                    <span className="text-xs text-gray-500">{userAccounts.length} 个记录 · {statusCount(userAccounts, '已绑定')} 已绑定 · {statusCount(userAccounts, '未绑定')} 待绑</span>
                  </div>
                  <span className={`text-gray-500 transition text-xs ${expanded.has(`user_${userName}`) ? 'rotate-180' : ''}`}>▼</span>
                </button>
                {expanded.has(`user_${userName}`) && (
                  <div className="border-t border-white/5 px-5 pb-4 pt-2 space-y-1">
                    {userAccounts.map(a => (
                      <div key={a.id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg text-xs">
                        <div className="flex items-center gap-2">
                          <span>{PLATFORM_ICON[a.platform] || '📱'}</span>
                          <span className="text-white">{PLATFORM_LABEL[a.platform] || a.platform}</span>
                          <span className="text-gray-400">· {a.accountName}</span>
                          {a.mobile && <span className="text-gray-600">📱{a.mobile}</span>}
                          <span className={`px-1.5 py-0.5 rounded text-[10px] border ${STATUS_COLOR[a.status] || 'bg-gray-500/20 text-gray-500'}`}>{a.status}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {a.device && <span className="text-gray-600">{a.device.name}</span>}
                          {a.status !== '已绑定' ? (
                            <button onClick={() => { setBindId(a.id); setBindAccount(a); setBindDeviceId(''); setBindAdbSerial(''); setBindBrowserPort('') }} className="text-[10px] px-2 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/30">+ 绑</button>
                          ) : (
                            <button onClick={() => handleUnbind(a.id)} className="text-[10px] px-2 py-1 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded hover:bg-yellow-500/30">🔓 解绑</button>
                          )}
                          <button onClick={() => handleDelete(a.id)} className="text-[10px] px-2 py-1 bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30" title="删除此账号">🗑️</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
