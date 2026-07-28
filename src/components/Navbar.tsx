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
    return () => { active = false }
  }, [])

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
              <Link href="/" className="text-mono text-xl font-bold tracking-wider"><span className="text-emerald-400">AI</span><span className="text-white">MARKETING</span></Link>
              {appVersion && <span className="ml-2 text-mono-sm text-emerald-400/50 hidden md:inline">{appVersion}</span>}
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
              <Link href="/" className="text-mono text-xl font-bold tracking-wider"><span className="text-emerald-400">AI</span><span className="text-white">MARKETING</span></Link>
              {appVersion && <span className="ml-2 text-mono-sm text-emerald-400/50 hidden md:inline">{appVersion}</span>}
            </div>
            <div className="flex items-center space-x-3">
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
            <Link href="/" className="text-mono text-xl font-bold tracking-wider"><span className="text-emerald-400">AI</span><span className="text-white">MARKETING</span></Link>
            {appVersion && <span className="ml-2 text-mono-sm text-emerald-400/50 hidden md:inline">{appVersion}</span>}
          </div>

          {/* Desktop nav — 精简：工作台入口已在卡片中，导航只保留核心入口 */}
          <div className="hidden md:flex items-center space-x-1">
            <Link href="/workspace" className="px-3 py-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded-lg transition-all text-sm font-medium">🏠 工作台</Link>
            {(user?.role === 'admin' || user?.role === 'editor') && (
              <Link href="/ai-tools" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">🛠 工具集</Link>
            )}
            {(user?.role === 'admin' || user?.role === 'editor') && (
              <Link href="/admin/" className="px-3 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 rounded-lg transition-all text-sm font-bold">⚙ 管理中心</Link>
            )}
            <Link href="/download" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">📥 下载客户端</Link>
            <button onClick={() => setFeedbackOpen(true)} className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">💬 反馈</button>
          </div>

          <div className="flex items-center gap-3">
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
                <div className="absolute top-full right-0 mt-1 w-48 bg-gray-900/95 backdrop-blur-md border border-white/10 rounded-xl shadow-xl py-2 z-50">
                  <div className="px-4 py-3 border-b border-white/10">
                    <p className="text-sm text-white">{user?.username?.toUpperCase()}</p>
                    <p className="text-xs text-emerald-400 mt-1">{roleInfo}</p>
                  </div>
                  <Link href="/my-subscription" className="block px-4 py-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 text-sm">💳 查看充值/套餐</Link>
                  {(user?.role === 'admin' || user?.role === 'editor') && (
                    <Link href="/admin/" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">🖥️ 管理中心</Link>
                  )}
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
