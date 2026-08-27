'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { LocaleProvider } from '@/i18n/context'

export interface User {
  id: number
  username: string
  role: string
}

interface AuthContextType {
  user: User | null
  isLoggedIn: boolean
  loading: boolean
  logout: () => void
  refreshAuth: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loading, setLoading] = useState(true)
  const pathname = usePathname()

  const fetchSession = async () => {
    try {
      const response = await fetch('/api/auth/login', {
        credentials: 'include',
        method: 'GET'
      })
      const data = await response.json()
      if (data.authenticated && data.user) {
        setUser(data.user)
        setIsLoggedIn(true)
      } else {
        setUser(null)
        setIsLoggedIn(false)
      }
    } catch (error) {
      console.error('获取会话失败:', error)
      setUser(null)
      setIsLoggedIn(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSession()
  }, [pathname])

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      })
    } catch (error) {
      console.error('退出失败:', error)
    }
    // 2026-08-28: 退出清所有 agent_ 本地缓存（换账号不残留）+ 通知客户端清 session cookie
    try { if (typeof localStorage !== 'undefined') { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('agent_')) localStorage.removeItem(k) } } } catch {}
    try { (window as any).electronAPI?.clearSession?.() } catch {}
    setUser(null)
    setIsLoggedIn(false)
    window.location.href = '/login'
  }

  return (
    <LocaleProvider>
      <AuthContext.Provider value={{ user, isLoggedIn, loading, logout, refreshAuth: fetchSession }}>
        {children}
      </AuthContext.Provider>
    </LocaleProvider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}