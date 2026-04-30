'use client';
import Link from 'next/link'
import { useState } from 'react'
import { useAuth } from '@/app/providers'
import { useLocale } from '@/i18n/context'
import LanguageSwitcher from './LanguageSwitcher'

export default function Navbar() {
  const { user, isLoggedIn, loading, logout } = useAuth()
  const { t } = useLocale()
  const [showAIMenu, setShowAIMenu] = useState(false)
  const [showVideoMenu, setShowVideoMenu] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)

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
              <Link href="/" className="text-mono text-xl font-bold tracking-wider">
                <span className="text-emerald-400">AI</span>
                <span className="text-white">MARKETING</span>
              </Link>
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
              <Link href="/" className="text-mono text-xl font-bold tracking-wider">
                <span className="text-emerald-400">AI</span>
                <span className="text-white">MARKETING</span>
              </Link>
              <span className="ml-2 text-mono-sm text-gray-500 hidden md:inline">// v2.0</span>
            </div>
            <div className="flex items-center space-x-3">
              <LanguageSwitcher />
              <Link
                href="/login"
                className="px-4 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-all font-mono text-sm tracking-wider"
              >
                {t.auth.signIn}
              </Link>
              <Link
                href="/register"
                className="px-4 py-2 bg-white/5 border border-white/10 text-gray-300 rounded-lg hover:bg-white/10 transition-all font-mono text-sm tracking-wider"
              >
                {t.auth.signUp}
              </Link>
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
            <Link href="/projects" className="text-mono text-xl font-bold tracking-wider">
              <span className="text-emerald-400">AI</span>
              <span className="text-white">MARKETING</span>
            </Link>
            <span className="ml-2 text-mono-sm text-emerald-400/50 hidden md:inline">// {t.home.online}</span>
          </div>

          <div className="hidden md:flex items-center space-x-1">
            <Link href="/projects" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">
              {t.nav.projects}
            </Link>
            <Link href="/video-edit" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">
              {t.nav.videoEdit}
            </Link>
            <Link href="/ai-copy" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">
              {t.nav.aiCopy}
            </Link>
            <Link href="/accounts" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">
              {t.nav.accounts}
            </Link>

            <div className="relative"
              onMouseEnter={() => setShowVideoMenu(true)}
              onMouseLeave={() => setShowVideoMenu(false)}
            >
              <button className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm flex items-center gap-1">
                {t.nav.digitalHuman}
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showVideoMenu && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-gray-900/95 backdrop-blur-md border border-white/10 rounded-xl shadow-xl py-2 z-50">
                  <Link href="/text-to-video" className="block px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">
                    {t.nav.textToVideo}
                  </Link>
                  <Link href="/digital-human" className="block px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">
                    {t.nav.digitalHuman}
                  </Link>
                  <Link href="/nfc-promo" className="block px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">
                    {t.nav.nfcPromo}
                  </Link>
                </div>
              )}
            </div>

            <div className="relative"
              onMouseEnter={() => setShowAIMenu(true)}
              onMouseLeave={() => setShowAIMenu(false)}
            >
              <button className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm flex items-center gap-1">
                {t.nav.aiAgent}
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showAIMenu && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-gray-900/95 backdrop-blur-md border border-white/10 rounded-xl shadow-xl py-2 z-50">
                  <Link href="/ai-agent" className="block px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">
                    {t.nav.aiAgent}
                  </Link>
                  <Link href="/referral" className="block px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">
                    {t.nav.referral}
                  </Link>
                  <Link href="/lead-collector" className="block px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">
                    {t.nav.leadCollector}
                  </Link>
                </div>
              )}
            </div>

            <Link href="/dashboard" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">
              {t.nav.dashboard}
            </Link>
            <Link href="/admin/settings" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">
              {t.nav.settings}
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <div className="relative" onMouseEnter={() => setShowUserMenu(true)} onMouseLeave={() => setShowUserMenu(false)}>
              <button className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-all">
                <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                <span className="text-sm text-gray-300">{user?.username?.toUpperCase() || 'USER'}</span>
                <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showUserMenu && (
                <div className="absolute top-full right-0 mt-1 w-56 bg-gray-900/95 backdrop-blur-md border border-white/10 rounded-xl shadow-xl py-2 z-50">
                  <div className="px-4 py-3 border-b border-white/10">
                    <p className="text-sm text-white">{user?.username?.toUpperCase()}</p>
                    <p className="text-xs text-emerald-400 mt-1">{roleInfo}</p>
                  </div>
                  <Link href="/projects" className="block px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">
                    {t.projects.title}
                  </Link>
                  <Link href="/admin/settings" className="block px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">
                    {t.nav.settings}
                  </Link>
                  <button
                    onClick={logout}
                    className="w-full text-left px-4 py-2 text-red-400 hover:bg-red-500/10 text-sm"
                  >
                    {t.common.logout}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}
