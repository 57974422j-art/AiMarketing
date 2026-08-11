'use client';
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { useLocale } from '@/i18n/context'
import LanguageSwitcher from './LanguageSwitcher'

export default function Navbar() {
  const { user, isLoggedIn, loading, logout } = useAuth()
  const { t } = useLocale()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'>('idle')
  const [updateVersion, setUpdateVersion] = useState('')
  const [updatePercent, setUpdatePercent] = useState(0)
  const [mounted, setMounted] = useState(false)
  // 嵌入模式（2026-08-05）：iframe 内加载时隐藏全局导航（应用随行大屏自带标题栏）
  const [embedMode, setEmbedMode] = useState(false)
  useEffect(() => {
    setEmbedMode(typeof window !== 'undefined' && window.location.search.includes('embed=1'))
  }, [])

  useEffect(() => {
    let active = true
    const api = (window as any).electronAPI
    if (api?.getAppVersion) {
      api.getAppVersion().then((info: any) => {
        if (active && info?.version) {
          setAppVersion(`v${info.version}${info.buildDate ? ' · ' + info.buildDate : ''}`)
        }
      }).catch(() => {})
    }
    if (embedMode) return null

  return () => { active = false }
  }, [])

  // 标记客户端已挂载，避免服务端预渲染时访问 window 报错（版本徽标/更新提示仅在客户端渲染）
  useEffect(() => { setMounted(true) }, [])

  // 监听 Electron 自动更新事件，驱动 Navbar 的「立即重启更新」提示
  useEffect(() => {
    const api = (window as any).electronAPI
    if (!api?.onUpdateStatus) return
    const off = api.onUpdateStatus((data: any) => {
      if (!data?.status) return
      if (data.status === 'available') { setUpdateState('available'); setUpdateVersion(data.version || '') }
      else if (data.status === 'downloading') { setUpdateState('downloading'); setUpdatePercent(typeof data.percent === 'number' ? data.percent : 0) }
      else if (data.status === 'ready') { setUpdateState('ready'); setUpdateVersion(data.version || '') }
      else setUpdateState(data.status)
    })
    return off
  }, [])

  // 点击版本号手动检查更新
  const checkUpdate = () => {
    const api = (window as any).electronAPI
    if (!api?.updaterCheck) return
    setUpdateState('checking')
    api.updaterCheck().catch(() => setUpdateState('idle'))
  }

  // 点击「重启更新」立即安装并重启客户端
  const installUpdate = () => {
    const api = (window as any).electronAPI
    if (api?.updaterInstall) api.updaterInstall().catch(() => {})
  }

  const getRoleName = (role: string) => {
    switch (role) {
      case 'admin': return t.team.admin
      case 'editor': return t.team.editor
      default: return t.team.viewer
    }
  }

  if (loading) {
    return (
      <nav className="bg-gray-950/80 backdrop-blur-md border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <a href="/" className="text-mono text-xl font-bold tracking-wider" title="返回首页"><span className="text-emerald-400">AI</span><span className="text-white">MARKETING</span></a>
              {mounted && <VersionBadge version={appVersion} onCheck={checkUpdate} />}
            </div>
            <div className="w-24" />
          </div>
        </div>
      </nav>
    )
  }

  if (!isLoggedIn) {
    return (
      <nav className="bg-gray-950/80 backdrop-blur-md border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <a href="/" className="text-mono text-xl font-bold tracking-wider" title="返回首页"><span className="text-emerald-400">AI</span><span className="text-white">MARKETING</span></a>
              {mounted && <VersionBadge version={appVersion} onCheck={checkUpdate} />}
            </div>
            <div className="flex items-center space-x-3">
              <UpdatePill state={updateState} version={updateVersion} percent={updatePercent} onInstall={installUpdate} />
              <LanguageSwitcher />
              <Link href="/login" className="px-4 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-all font-mono text-sm tracking-wider">{t.auth.signIn}</Link>
              <Link href="/register" className="px-4 py-2 bg-white/5 border border-white/10 text-gray-300 rounded-lg hover:bg-white/10 transition-all font-mono text-sm tracking-wider">{t.auth.signUp}</Link>
            </div>
          </div>
        </div>
      </nav>
    )
  }

  const roleInfo = getRoleName(user?.role || 'viewer')

  return (
    <nav className="bg-gray-950/80 backdrop-blur-md border-b border-white/10 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <a href="/" className="text-mono text-xl font-bold tracking-wider" title="返回首页"><span className="text-emerald-400">AI</span><span className="text-white">MARKETING</span></a>
            {mounted && <VersionBadge version={appVersion} onCheck={checkUpdate} />}
          </div>

          {/* Desktop nav — 主入口全部收进头像下拉框，桌面顶栏只留品牌+版本 */}
          <div className="hidden md:flex items-center space-x-1 text-xs text-gray-500">
            <span>导航菜单见右侧头像 ▾</span>
          </div>

          <div className="flex items-center gap-3">
            <UpdatePill state={updateState} version={updateVersion} percent={updatePercent} onInstall={installUpdate} />
            <LanguageSwitcher />
            {/* Mobile hamburger */}
            <button onClick={() => setShowMobileMenu(!showMobileMenu)} className="md:hidden px-2 py-2 text-gray-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {showMobileMenu
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                }
              </svg>
            </button>
            <div className="relative">
              <button onClick={() => setShowUserMenu(!showUserMenu)} onBlur={() => setTimeout(() => setShowUserMenu(false), 200)}
                className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-all">
                <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                <span className="text-sm text-gray-300">{user?.username || '用户'}</span>
                <svg className={`w-3 h-3 text-gray-500 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showUserMenu && (
                <div className="absolute top-full right-0 mt-1 w-52 bg-gray-900/95 backdrop-blur-md border border-white/10 rounded-xl shadow-xl py-2 z-50">
                  <div className="px-4 py-3 border-b border-white/10">
                    <p className="text-sm text-white">{user?.username?.toUpperCase()}</p>
                    <p className="text-xs text-emerald-400 mt-1">{roleInfo}</p>
                  </div>
                  <Link href="/workspace" className="block px-4 py-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 text-sm">🏠 工作台</Link>
                  {(user?.role === 'admin' || user?.role === 'editor') && (
                    <Link href="/ai-tools" className="block px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">🛠 工具集</Link>
                  )}
                  {(user?.role === 'admin' || user?.role === 'editor') && (
                    <Link href="/admin/" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm font-bold">⚙ 管理中心</Link>
                  )}
                  <Link href="/download" className="block px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">📥 下载客户端</Link>
                  <Link href="/my-subscription" className="block px-4 py-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 text-sm">💳 查看充值/套餐</Link>
                  <button onClick={() => { setShowUserMenu(false); setFeedbackOpen(true) }} className="w-full text-left px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">💬 反馈</button>
                  <div className="border-t border-white/10 my-1" />
                  <button onClick={logout} className="w-full text-left px-4 py-2 text-red-400 hover:bg-red-500/10 text-sm">{t.common.logout}</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {showMobileMenu && (
        <div className="md:hidden border-t border-white/10 bg-gray-900/95 backdrop-blur-md">
          <div className="px-4 py-3 space-y-1">
            <Link href="/workspace" onClick={() => setShowMobileMenu(false)} className="block px-3 py-2.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg text-sm font-medium">🏠 工作台</Link>
            {(user?.role === 'admin' || user?.role === 'editor') && (
              <Link href="/ai-tools" onClick={() => setShowMobileMenu(false)} className="block px-3 py-2.5 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg text-sm">🛠 工具集</Link>
            )}
            <Link href="/my-subscription" onClick={() => setShowMobileMenu(false)} className="block px-3 py-2.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg text-sm font-medium">💳 查看充值/套餐</Link>
            {(user?.role === 'admin' || user?.role === 'editor') && (
              <Link href="/admin/" onClick={() => setShowMobileMenu(false)} className="block px-3 py-2.5 text-yellow-400 hover:bg-yellow-500/10 rounded-lg text-sm font-bold">⚙ 管理中心</Link>
            )}
            <Link href="/download" onClick={() => setShowMobileMenu(false)} className="block px-3 py-2.5 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg text-sm">📥 下载客户端</Link>
            <button onClick={() => { setShowMobileMenu(false); setFeedbackOpen(true) }} className="block w-full text-left px-3 py-2.5 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg text-sm">💬 反馈</button>
          </div>
        </div>
      )}

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </nav>
  )
}

function VersionBadge({ version, onCheck }: { version: string; onCheck: () => void }) {
  const api = (window as any).electronAPI
  // 纯网页（浏览器）无 electronAPI，不显示版本徽标
  if (!api?.isElectron) return null
  return (
    <button onClick={onCheck} title="点击检查客户端更新"
      className="ml-2 inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-mono text-emerald-300 hover:bg-emerald-500/20 transition-colors">
      {version || '版本加载中…'}
    </button>
  )
}

function UpdatePill({ state, version, percent, onInstall }: { state: string; version: string; percent: number; onInstall: () => void }) {
  if (state === 'ready') {
    return (
      <button onClick={onInstall} title="点击立即重启并更新到最新版本"
        className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-medium hover:bg-emerald-500/30 transition-colors">
        🔄 重启更新{version ? ' ' + version : ''}
      </button>
    )
  }
  if (state === 'downloading') {
    return (
      <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-gray-400 text-xs">
        ⬇️ 更新 {percent}%
      </span>
    )
  }
  if (state === 'available') {
    return (
      <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-gray-400 text-xs">
        🆕 发现新版本
      </span>
    )
  }
  return null
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState('问题')
  const [content, setContent] = useState('')
  const [images, setImages] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')
  const pagePath = typeof window !== 'undefined' ? window.location.pathname : ''

  const submit = async () => {
    if (!content.trim()) { setMsg('请填写反馈内容'); return }
    setSubmitting(true); setMsg('')
    try {
      const fd = new FormData()
      fd.append('type', type)
      fd.append('content', content + `\n\n[页面路径: ${pagePath}]`)
      images.forEach(f => fd.append('images', f))
      const r = await fetch('/api/feedback', { method: 'POST', credentials: 'include', body: fd })
      const d = await r.json()
      if (d.success) { setMsg('已提交，感谢反馈！'); setTimeout(onClose, 1200) }
      else setMsg(d.message || '提交失败')
    } catch {
      setMsg('提交失败，请稍后重试')
    } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-gray-900 border border-white/10 rounded-2xl shadow-2xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">💬 意见反馈</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="flex gap-2 mb-3">
          {(['问题', '建议', '其他'] as const).map(tp => (
            <button key={tp} onClick={() => setType(tp)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${type === tp ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}>
              {tp}
            </button>
          ))}
        </div>
        <textarea value={content} onChange={e => setContent(e.target.value)} rows={5}
          placeholder="请描述你遇到的问题或建议…（当前页面路径会自动附带）"
          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-emerald-500/50 resize-none" />
        <div className="mt-3">
          <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-gray-400 hover:bg-white/10">
            📎 添加截图（最多4张）
            <input type="file" accept="image/*" multiple className="hidden"
              onChange={e => { const fs = Array.from(e.target.files || []).slice(0, 4); setImages(fs) }} />
          </label>
          {images.length > 0 && <span className="ml-2 text-xs text-gray-500">已选 {images.length} 张</span>}
        </div>
        {msg && <p className="mt-3 text-xs text-amber-400">{msg}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300 hover:bg-white/10">取消</button>
          <button onClick={submit} disabled={submitting}
            className="flex-1 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600 disabled:opacity-50">
            {submitting ? '提交中…' : '提交反馈'}
          </button>
        </div>
      </div>
    </div>
  )
}
