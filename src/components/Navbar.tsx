'use client';
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface User {
  id: number
  username: string
  role: string
}

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [showAIMenu, setShowAIMenu] = useState(false)
  const [showVideoMenu, setShowVideoMenu] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [mounted, setMounted] = useState(false)
  const router = useRouter()

  useEffect(() => {
    setMounted(true)
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/login')
      const data = await response.json()
      if (data.authenticated && data.user) {
        setUser(data.user)
        setIsLoggedIn(true)
      } else {
        setIsLoggedIn(false)
        setUser(null)
      }
    } catch (error) {
      setIsLoggedIn(false)
      setUser(null)
    }
  }

  const handleLogout = async () => {
    document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    setIsLoggedIn(false)
    setUser(null)
    router.push('/login')
  }

  const getRoleName = (role: string) => {
    switch (role) {
      case 'admin': return '管理员'
      case 'editor': return '编辑'
      default: return '普通用户'
    }
  }

  if (!mounted) {
    return null
  }

  if (!isLoggedIn) {
    return (
      <nav className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 flex-nowrap">
            <div className="flex items-center flex-shrink-0">
              <Link href="/" className="text-xl font-bold text-primary">
                AiMarketing
              </Link>
            </div>
            <div className="flex items-center space-x-2 flex-nowrap">
              <Link
                href="/login"
                className="px-3 py-1 bg-primary text-white rounded-md hover:bg-primary-dark whitespace-nowrap"
              >
                登录
              </Link>
              <Link
                href="/register"
                className="px-3 py-1 border border-primary text-primary rounded-md hover:bg-blue-50 whitespace-nowrap"
              >
                注册
              </Link>
            </div>
          </div>
        </div>
      </nav>
    )
  }

  return (
    <nav className="bg-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 flex-nowrap">
          <div className="flex items-center flex-shrink-0">
            <Link href="/projects" className="text-xl font-bold text-primary">
              AiMarketing
            </Link>
          </div>
          <div className="flex items-center space-x-4 flex-nowrap">
            <div className="hidden md:flex items-center space-x-4 flex-nowrap">
              <Link href="/projects" className="text-gray-700 hover:text-primary whitespace-nowrap">
                项目
              </Link>
              <Link href="/video-edit" className="text-gray-700 hover:text-primary whitespace-nowrap">
                视频剪辑
              </Link>
              <Link href="/ai-copy" className="text-gray-700 hover:text-primary whitespace-nowrap">
                AI 文案
              </Link>
              <Link href="/accounts" className="text-gray-700 hover:text-primary whitespace-nowrap">
                账号管理
              </Link>

              <div className="relative"
                onMouseEnter={() => setShowVideoMenu(true)}
                onMouseLeave={() => setShowVideoMenu(false)}
              >
                <button className="text-gray-700 hover:text-primary whitespace-nowrap flex items-center gap-1 px-2 py-1 rounded-md hover:bg-gray-50">
                  AI 视频
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showVideoMenu && (
                  <div className="absolute top-full left-0 mt-0 w-48 bg-white rounded-lg shadow-lg border border-gray-100 py-2 z-50">
                    <Link href="/text-to-video" className="block px-4 py-2 text-gray-700 hover:bg-gray-50 whitespace-nowrap">
                      文生视频
                    </Link>
                    <Link href="/digital-human" className="block px-4 py-2 text-gray-700 hover:bg-gray-50 whitespace-nowrap">
                      数字人口播
                    </Link>
                    <Link href="/nfc-promo" className="block px-4 py-2 text-gray-700 hover:bg-gray-50 whitespace-nowrap">
                      碰一碰推广
                    </Link>
                  </div>
                )}
              </div>

              <div className="relative"
                onMouseEnter={() => setShowAIMenu(true)}
                onMouseLeave={() => setShowAIMenu(false)}
              >
                <button className="text-gray-700 hover:text-primary whitespace-nowrap flex items-center gap-1 px-2 py-1 rounded-md hover:bg-gray-50">
                  AI 营销
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showAIMenu && (
                  <div className="absolute top-full left-0 mt-0 w-48 bg-white rounded-lg shadow-lg border border-gray-100 py-2 z-50">
                    <Link href="/ai-agent" className="block px-4 py-2 text-gray-700 hover:bg-gray-50 whitespace-nowrap">
                      AI 员工
                    </Link>
                    <Link href="/referral" className="block px-4 py-2 text-gray-700 hover:bg-gray-50 whitespace-nowrap">
                      导流配置
                    </Link>
                    <Link href="/lead-collector" className="block px-4 py-2 text-gray-700 hover:bg-gray-50 whitespace-nowrap">
                      意向采集
                    </Link>
                  </div>
                )}
              </div>

              <Link href="/dashboard" className="text-gray-700 hover:text-primary whitespace-nowrap">
                仪表盘
              </Link>
              <Link href="/admin/settings" className="text-gray-700 hover:text-primary whitespace-nowrap">
                系统设置
              </Link>
            </div>
            <div className="relative" onMouseEnter={() => setShowUserMenu(true)} onMouseLeave={() => setShowUserMenu(false)}>
              <button className="flex items-center space-x-2 px-3 py-1 border border-gray-300 rounded-md hover:bg-gray-50">
                <span className="text-gray-700">{user?.username || '用户'}</span>
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showUserMenu && (
                <div className="absolute top-full right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-100 py-2 z-50">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="font-medium text-gray-900">{user?.username}</p>
                    <p className="text-sm text-gray-500">{getRoleName(user?.role || 'viewer')}</p>
                  </div>
                  <Link href="/projects" className="block px-4 py-2 text-gray-700 hover:bg-gray-50">
                    我的项目
                  </Link>
                  <Link href="/admin/settings" className="block px-4 py-2 text-gray-700 hover:bg-gray-50">
                    系统设置
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-red-600 hover:bg-red-50"
                  >
                    退出登录
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