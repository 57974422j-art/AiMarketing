'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

const PLATFORMS = [
  { key: 'douyin',    label: '抖音',       icon: '🎵', color: 'from-pink-500/10 to-purple-500/10', border: 'border-pink-500/30', hover: 'hover:bg-pink-500/10' },
  { key: 'kuaishou',  label: '快手',       icon: '📹', color: 'from-yellow-500/10 to-orange-500/10', border: 'border-yellow-500/30', hover: 'hover:bg-yellow-500/10' },
  { key: 'xiaohongshu', label: '小红书',    icon: '📕', color: 'from-red-500/10 to-orange-500/10', border: 'border-red-500/30', hover: 'hover:bg-red-500/10' },
  { key: 'shipinhao', label: '视频号',      icon: '💚', color: 'from-green-500/10 to-emerald-500/10', border: 'border-green-500/30', hover: 'hover:bg-green-500/10' },
  { key: 'weibo',     label: '微博',       icon: '📢', color: 'from-orange-500/10 to-red-500/10', border: 'border-orange-500/30', hover: 'hover:bg-orange-500/10' },
  { key: 'bilibili',  label: 'B站',        icon: '📺', color: 'from-blue-500/10 to-cyan-500/10', border: 'border-blue-500/30', hover: 'hover:bg-blue-500/10' },
]

const BIND_TYPES = [
  { key: 'device',    label: '真机群控',     desc: 'Q1 手机群控',     icon: '📱', color: 'from-green-500/20 to-emerald-500/20', border: 'border-green-500/30', accent: 'text-green-400' },
  { key: 'manual',    label: '指纹浏览器',   desc: '模拟器/云手机',   icon: '🖥️', color: 'from-yellow-500/20 to-orange-500/20', border: 'border-yellow-500/30', accent: 'text-yellow-400' },
  { key: 'official',  label: '官方API',      desc: '平台开放接口',   icon: '🔗', color: 'from-blue-500/20 to-cyan-500/20', border: 'border-blue-500/30', accent: 'text-blue-400' },
]

interface Account {
  id: number; platform: string; accountName: string; accountId: string
  isBound: boolean; bindType: string; remark: string; createdAt: string
}

export default function AccountsPage() {
  const { user, loading: authLoading } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  // 表单
  const [nickname, setNickname] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [bindType, setBindType] = useState('device')
  const [profileLink, setProfileLink] = useState('')
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 工作台弹窗
  const [workbench, setWorkbench] = useState<Account | null>(null)

  useEffect(() => {
    if (!authLoading && user) load()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const load = async () => {
    try { const r = await fetch('/api/accounts', { credentials: 'include' }); if (r.ok) setAccounts(Array.isArray(await r.json()) ? await r.json() : (await r.json()).data || []) }
    catch {} finally { setLoading(false) }
  }

  const togglePlatform = (key: string) => {
    setSelectedPlatforms(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  const handleSubmit = async () => {
    if (!nickname.trim()) { showToast('请输入账号昵称', 'error'); return }
    if (selectedPlatforms.length === 0) { showToast('请选择至少一个平台', 'error'); return }
    setSubmitting(true)

    for (const platform of selectedPlatforms) {
      try {
        await fetch('/api/accounts', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountName: nickname.trim(), platform, accountId: profileLink.trim(), bindType, remark: remark.trim() }),
        })
      } catch {}
    }

    showToast(`已登记 ${selectedPlatforms.length} 个账号`, 'success')
    setShowAdd(false); setNickname(''); setSelectedPlatforms([]); setBindType('device'); setProfileLink(''); setRemark('')
    load()
    setSubmitting(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此账号？')) return
    const r = await fetch(`/api/accounts?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) { showToast('已删除', 'success'); load() }
    else showToast('删除失败', 'error')
  }

  // 快捷登录链接
  const getLoginUrl = (platform: string) => {
    const urls: Record<string, string> = {
      douyin: 'https://www.douyin.com/login',
      kuaishou: 'https://www.kuaishou.com/login',
      xiaohongshu: 'https://www.xiaohongshu.com/login',
      shipinhao: 'https://channels.weixin.qq.com/login',
      weibo: 'https://weibo.com/login',
      bilibili: 'https://www.bilibili.com/login',
    }
    return urls[platform] || '#'
  }

  const platformMeta = (key: string) => PLATFORMS.find(p => p.key === key)

  if (authLoading || loading) return <Loading />

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">平台管理 / ACCOUNTS</p>
            <h1 className="text-mono-lg text-white">
              {user?.role === 'end-user' ? '我的账号 / MY ACCOUNTS' : '账号管理 / ACCOUNTS'}
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              共 <span className="text-emerald-400">{accounts.length}</span> 个账号
              {user?.role === 'end-user' && ' · 登记后管理员会帮你绑定设备'}
            </p>
          </div>
          <button onClick={() => setShowAdd(true)} className="btn-primary text-sm py-2">
            + 登记账号
          </button>
        </div>

        {/* 账号列表 */}
        {accounts.length === 0 ? (
          <div className="card-glass p-12 text-center text-gray-500">
            <p className="text-lg mb-2">暂无账号</p>
            <p className="text-xs">点击右上角「登记账号」添加</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map(acct => {
              const pm = platformMeta(acct.platform)
              const bindLabel = BIND_TYPES.find(b => b.key === acct.bindType)
              return (
                <div key={acct.id} className={`card-glass p-4 border-l-4 ${acct.isBound ? 'border-l-emerald-500' : 'border-l-gray-500'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{pm?.icon || '📱'}</span>
                      <div>
                        <span className="text-white font-medium text-sm">{acct.accountName}</span>
                        <span className="text-xs text-gray-500 ml-2">{pm?.label || acct.platform}</span>
                      </div>
                    </div>
                    <button onClick={() => handleDelete(acct.id)} className="text-xs text-red-400 hover:text-red-300">删除</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${bindLabel?.border || 'border-gray-500/30'} ${bindLabel?.accent || 'text-gray-500'} border`}>
                      {bindLabel?.label || acct.bindType}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${acct.isBound ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-500'}`}>
                      {acct.isBound ? '已绑定' : '未绑定'}
                    </span>
                  </div>
                  {acct.accountId && <p className="text-[10px] text-gray-600 truncate mb-2">🔗 {acct.accountId}</p>}
                  {acct.remark && <p className="text-[10px] text-gray-600 italic mb-2">📝 {acct.remark}</p>}

                  {/* 工作台入口 */}
                  <button onClick={() => setWorkbench(acct)}
                    className={`w-full text-xs py-1.5 mt-1 rounded-lg border transition ${
                      acct.isBound
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'
                        : 'bg-white/5 text-gray-500 border-white/10 cursor-not-allowed'
                    }`}
                    disabled={!acct.isBound}>
                    🚀 进入工作台
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* ── 登记弹窗 ── */}
        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold text-lg mb-1">📝 登记账号</h3>
              <p className="text-xs text-gray-500 mb-5">登记后管理员会帮你绑定设备并填密码</p>

              {/* 昵称 */}
              <label className="block text-xs text-gray-400 mb-1">昵称 <span className="text-red-400">*</span></label>
              <input className="input-dark w-full text-sm mb-4" placeholder="如：我的抖音号" value={nickname} onChange={e => setNickname(e.target.value)} />

              {/* 平台多选 */}
              <label className="block text-xs text-gray-400 mb-2">选择平台 <span className="text-red-400">*</span> <span className="text-gray-600">（可多选）</span></label>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {PLATFORMS.map(p => (
                  <button key={p.key} onClick={() => togglePlatform(p.key)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs transition bg-gradient-to-br ${
                      selectedPlatforms.includes(p.key)
                        ? `${p.color} ${p.border} text-white`
                        : 'border-white/10 text-gray-500 hover:bg-white/5'
                    }`}>
                    <span className="text-lg">{p.icon}</span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>

              {/* 绑定类型 */}
              <label className="block text-xs text-gray-400 mb-2">绑定方式</label>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {BIND_TYPES.map(bt => (
                  <button key={bt.key} onClick={() => setBindType(bt.key)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs transition ${
                      bindType === bt.key
                        ? `${bt.color} ${bt.border} ${bt.accent}`
                        : 'border-white/10 text-gray-500 hover:bg-white/5'
                    }`}>
                    <span className="text-lg">{bt.icon}</span>
                    <span className="font-medium">{bt.label}</span>
                    <span className="text-[10px] opacity-60">{bt.desc}</span>
                  </button>
                ))}
              </div>

              {/* 主页链接 */}
              <label className="block text-xs text-gray-400 mb-1">主页链接</label>
              <input className="input-dark w-full text-sm mb-4" type="url" placeholder="https://www.douyin.com/user/..." value={profileLink} onChange={e => setProfileLink(e.target.value)} />

              {/* 备注 */}
              <label className="block text-xs text-gray-400 mb-1">备注</label>
              <textarea className="input-dark w-full text-sm mb-5 h-16" placeholder="可选，如：引流号、客服号" value={remark} onChange={e => setRemark(e.target.value)} />

              <div className="flex gap-3">
                <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 border border-white/10 text-gray-400 rounded-xl hover:bg-white/10 text-sm">取消</button>
                <button onClick={handleSubmit} disabled={submitting || !nickname.trim() || selectedPlatforms.length === 0}
                  className="flex-1 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50 text-sm font-medium">
                  {submitting ? '提交中...' : `✅ 登记 (${selectedPlatforms.length}个平台)`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 工作台弹窗 ── */}
        {workbench && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setWorkbench(null)}>
            <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{platformMeta(workbench.platform)?.icon || '📱'}</span>
                  <div>
                    <h3 className="text-white font-bold">{workbench.accountName}</h3>
                    <p className="text-xs text-gray-500">{platformMeta(workbench.platform)?.label || workbench.platform}</p>
                  </div>
                </div>
                <button onClick={() => setWorkbench(null)} className="text-gray-500 hover:text-white text-xl">&times;</button>
              </div>

              <div className="space-y-2">
                <a href={getLoginUrl(workbench.platform)} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-sm hover:bg-emerald-500/30 transition block text-center">
                  🔑 前往 {platformMeta(workbench.platform)?.label || workbench.platform} 登录
                </a>
                <a href="/admin/social-accounts" className="flex items-center gap-3 px-4 py-3 bg-white/5 text-gray-400 border border-white/10 rounded-xl text-sm hover:bg-white/10 transition block text-center">
                  ⚙️ 账号设置（管理员用）
                </a>
              </div>

              <p className="text-[10px] text-gray-600 text-center mt-4">
                登录后通知管理员绑定设备即可使用
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Loading() {
  return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" /></div>
}
