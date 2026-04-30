'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
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
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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

    fetchSession()
  }, [])

  const logout = () => {
    document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    setUser(null)
    setIsLoggedIn(false)
    window.location.href = '/login'
  }

  return (
    <LocaleProvider>
      <AuthContext.Provider value={{ user, isLoggedIn, loading, logout }}>
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