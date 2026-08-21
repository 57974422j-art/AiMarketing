'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'

interface Acct { id: string; name: string; loggedIn: boolean }

export default function BrowserAccountsPage() {
  const { user } = useAuth()
  const [bound, setBound] = useState(false)
  const [accounts, setAccounts] = useState<Acct[]>([])
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (!user) window.location.href = '/login?redirect=/browser-accounts'; refresh() }, [user])

  const refresh = async () => {
    try {
      const r = await (window as any).electronAPI?.browserAccounts()
      if (r?.success) { setBound(!!r.bound); setAccounts(r.accounts || []) }
      else setMsg(r?.error || '未绑定浏览器')
    } catch (e: any) { setMsg('请在客户端使用：' + (e?.message || e)) }
  }

  const bind = async () => {
    setLoading(true); setMsg('')
    try {
      const r = await (window as any).electronAPI?.browserBind()
      if (r?.success) { setMsg('✅ 浏览器已绑定（' + (r.exe || '') + '），正在检测登录账号...'); setTimeout(refresh, 2500) }
      else setMsg('❌ ' + (r?.error || '绑定失败'))
    } catch (e: any) { setMsg('❌ ' + (e?.message || e)) }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-200 p-6">
      <h1 className="text-lg font-semibold mb-1">浏览器账号（发布通道）</h1>
      <p className="text-[11px] text-gray-500 mb-4">检测你日常浏览器（Chrome/Edge）已登录的平台账号——与「账号登记」无关，仅用于发布/采集的登录态。</p>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={bind} disabled={loading}
          className="px-4 py-2 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 text-xs hover:bg-indigo-500/30 disabled:opacity-50">
          {loading ? '绑定中...' : (bound ? '🔄 重新绑定浏览器' : '🔗 绑定浏览器')}
        </button>
        <button onClick={refresh} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 text-xs hover:bg-white/10">刷新</button>
        <span className={`text-[11px] ${bound ? 'text-emerald-400' : 'text-gray-500'}`}>{bound ? '● 已绑定' : '○ 未绑定'}</span>
      </div>
      {msg && <p className="text-[11px] text-amber-300 mb-3 whitespace-pre-wrap">{msg}</p>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {accounts.map(a => (
          <div key={a.id} className="rounded-xl bg-white/[0.04] border border-white/10 p-3 flex items-center justify-between">
            <span className="text-sm">{a.name}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${a.loggedIn ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/15 text-red-400'}`}>
              {a.loggedIn ? '✅ 已登录' : '未登录'}
            </span>
          </div>
        ))}
        {!accounts.length && <p className="text-gray-600 text-xs col-span-3">暂无检测结果——绑定浏览器后自动识别已登录平台</p>}
      </div>
    </div>
  )
}
