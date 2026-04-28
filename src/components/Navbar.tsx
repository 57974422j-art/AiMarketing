'use client';
import Link from 'next/link'
import { useState } from 'react'

export default function Navbar() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [username, setUsername] = useState('')
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [showAIMenu, setShowAIMenu] = useState(false)
  const [showVideoMenu, setShowVideoMenu] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password: '123456' })
      })

      const data = await response.json()

      if (data.success) {
        setIsLoggedIn(true)
        setShowLoginModal(false)
      } else {
        alert(data.message)
      }
    } catch (error) {
      console.error('登录错误:', error)
      alert('登录失败，请稍后重试')
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username,
          email: `${username}@example.com`,
          password: '123456',
          name: username
        })
      })

      const data = await response.json()

      if (data.success) {
        setIsLoggedIn(true)
        setShowRegisterModal(false)
      } else {
        alert(data.message)
      }
    } catch (error) {
      console.error('注册错误:', error)
      alert('注册失败，请稍后重试')
    }
  }

  const handleLogout = () => {
    setIsLoggedIn(false)
    setUsername('')
  }

  return (
    <nav className="bg-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 flex-nowrap">
          <div className="flex items-center flex-shrink-0">
            <Link href="/" className="text-xl font-bold text-primary">
              AiMarketing
            </Link>
          </div>
          <div className="flex items-center space-x-4 flex-nowrap">
            <div className="hidden md:flex items-center space-x-4 flex-nowrap">
              <Link href="/" className="text-gray-700 hover:text-primary whitespace-nowrap">
                首页
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
            <div className="flex items-center space-x-2 flex-nowrap">
              {isLoggedIn ? (
                <div className="flex items-center space-x-2 flex-nowrap">
                  <span className="text-gray-700 whitespace-nowrap">{username || '用户'}</span>
                  <button
                    onClick={handleLogout}
                    className="px-3 py-1 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 whitespace-nowrap"
                  >
                    退出
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setShowLoginModal(true)}
                    className="px-3 py-1 bg-primary text-white rounded-md hover:bg-primary-dark whitespace-nowrap"
                  >
                    登录
                  </button>
                  <button
                    onClick={() => setShowRegisterModal(true)}
                    className="px-3 py-1 border border-primary text-primary rounded-md hover:bg-blue-50 whitespace-nowrap"
                  >
                    注册
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {showLoginModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">登录</h2>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  用户名
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  密码
                </label>
                <input
                  type="password"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowLoginModal(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
                >
                  登录
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRegisterModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">注册</h2>
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  用户名
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  密码
                </label>
                <input
                  type="password"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
                >
                  注册
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </nav>
  )
}