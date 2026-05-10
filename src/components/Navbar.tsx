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
  const [showAdminMenu, setShowAdminMenu] = useState(false)

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
            {user?.role !== 'end-user' && (
              <Link href="/accounts" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">
                {t.nav.accounts}
              </Link>
            )}

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
            <Link href="/image-generator" className="px-3 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 rounded-lg transition-all text-sm">
              AI 生图
            </Link>
            {(user?.role === 'admin' || user?.role === 'editor') && (
              <div className="relative"
                onMouseEnter={() => setShowAdminMenu(true)}
                onMouseLeave={() => setShowAdminMenu(false)}
              >
                <button className="px-3 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 rounded-lg transition-all text-sm flex items-center gap-1">
                  管理中心
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showAdminMenu && (
                  <div className="absolute top-full left-0 mt-1 w-52 bg-gray-900/95 backdrop-blur-md border border-white/10 rounded-xl shadow-xl py-2 z-50">
                    {user?.role === 'admin' && (
                      <Link href="/admin/" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm font-bold border-b border-white/10">
                        📊 管理后台首页
                      </Link>
                    )}
                    <Link href="/admin/devices" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                      🖥️ 设备管理
                    </Link>
                    <Link href="/admin/social-accounts" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                      🔗 社交账号
                    </Link>
                    <Link href="/admin/content-submissions" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                      📋 素材审核
                    </Link>
                    <Link href="/admin/automation" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                      ⚡ 任务中心
                    </Link>
                    <Link href="/admin/poi-addresses" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                      📍 POI 地址
                    </Link>
                    <Link href="/admin/script-templates" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                      💬 话术模板
                    </Link>
                    <Link href="/admin/account-groups" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                      📁 账号分组
                    </Link>
                    <div className="border-t border-white/10 my-1"></div>
                        <Link href="/admin/invite-codes" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                          🔑 邀请码管理
                        </Link>
                        <Link href="/admin/dashboard" className="block px-4 py-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 text-sm font-bold">
                          📊 数据看板
                        </Link>
                    <Link href="/admin/media-library" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                      🎬 素材库
                    </Link>
                    <Link href="/admin/automation-templates" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                      📋 任务模板
                    </Link>
                    <Link href="/admin/prompt-templates" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                      🖼️ 提示词模板
                    </Link>
                    {user?.role === 'admin' && (
                      <>
                        <div className="border-t border-white/10 my-1"></div>
                        <Link href="/admin/users" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                          👥 客户管理
                        </Link>
                        <Link href="/admin/review" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                          模板审核
                        </Link>
                        <Link href="/admin/settings" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                          系统设置
                        </Link>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                onBlur={() => setTimeout(() => setShowUserMenu(false), 200)}
                className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-all"
              >
                <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                <span className="text-sm text-gray-300">{user?.username?.toUpperCase() || 'USER'}</span>
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
                  <Link href="/projects" className="block px-4 py-2 text-gray-300 hover:text-emerald-400 hover:bg-white/5 text-sm">
                    {t.projects.title}
                  </Link>
                  {(user?.role === 'admin' || user?.role === 'editor') && (
                    <>
                      <Link href="/admin/" className="block px-4 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 text-sm">
                        🖥️ 管理中心
                      </Link>
                    </>
                  )}
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
