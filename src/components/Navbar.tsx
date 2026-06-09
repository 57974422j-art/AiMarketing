'use client';
import Link from 'next/link'
import { useState } from 'react'
import { useAuth } from '@/app/providers'
import { useLocale } from '@/i18n/context'
import LanguageSwitcher from './LanguageSwitcher'

export default function Navbar() {
  const { user, isLoggedIn, loading, logout } = useAuth()
  const { t } = useLocale()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)

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
              <span className="ml-2 text-mono-sm text-gray-500 hidden md:inline">// v2.0</span>
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
              <span className="ml-2 text-mono-sm text-gray-500 hidden md:inline">// v2.0</span>
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
            <span className="ml-2 text-mono-sm text-emerald-400/50 hidden md:inline">// {t.home.online}</span>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center space-x-1">
            <Link href="/workspace" className="px-3 py-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded-lg transition-all text-sm font-medium">🏠 工作台</Link>
            <Link href="/storage" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">📁 仓库</Link>
            <Link href="/my-fingerprint" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">🌐 指纹浏览器</Link>
            {(user?.role === 'admin' || user?.role === 'editor') && (
              <Link href="/data-center" className="px-3 py-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded-lg transition-all text-sm font-medium">📊 数据中心</Link>
            )}
            <Link href="/accounts" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">{t.nav.accounts}</Link>
            {(user?.role === 'admin' || user?.role === 'editor') && (
              <Link href="/admin/" className="px-3 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 rounded-lg transition-all text-sm font-bold">⚙ 管理中心</Link>
            )}
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
                <div className="absolute top-full right-0 mt-1 w-56 bg-gray-900/95 backdrop-blur-md border border-white/10 rounded-xl shadow-xl py-2 z-50">
                  <div className="px-4 py-3 border-b border-white/10">
                    <p className="text-sm text-white">{user?.username?.toUpperCase()}</p>
                    <p className="text-xs text-emerald-400 mt-1">{roleInfo}</p>
                  </div>
                  <Link href="/storage" className="block px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">{t.projects.title}</Link>
                  {(user?.role === 'admin' || user?.role === 'editor') && (
                    <Link href="/data-center" className="block px-4 py-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 text-sm">📊 数据中心</Link>
                  )}
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
            <Link href="/storage" onClick={() => setShowMobileMenu(false)} className="block px-3 py-2.5 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg text-sm">📁 仓库</Link>
            <Link href="/my-fingerprint" onClick={() => setShowMobileMenu(false)} className="block px-3 py-2.5 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg text-sm">🌐 指纹浏览器</Link>
            {(user?.role === 'admin' || user?.role === 'editor') && (
              <Link href="/data-center" onClick={() => setShowMobileMenu(false)} className="block px-3 py-2.5 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded-lg text-sm font-medium">📊 数据中心</Link>
            )}
            <Link href="/accounts" onClick={() => setShowMobileMenu(false)} className="block px-3 py-2.5 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg text-sm">{t.nav.accounts}</Link>
            {(user?.role === 'admin' || user?.role === 'editor') && (
              <Link href="/admin/" onClick={() => setShowMobileMenu(false)} className="block px-3 py-2.5 text-yellow-400 hover:bg-yellow-500/10 rounded-lg text-sm font-bold">⚙ 管理中心</Link>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
