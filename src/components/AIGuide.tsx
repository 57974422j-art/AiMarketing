'use client'

import { useEffect } from 'react'
import { useAuth } from '@/app/providers'

/**
 * AI 引导助手 — 右下角浮窗按钮
 * 点击跳转至 /onboarding 全屏引导页
 */
export default function AIGuide() {
  const { isLoggedIn, user, loading } = useAuth()

  // 新用户自动重定向到引导页（非强制，只弹一次）
  useEffect(() => {
    if (loading) return
    const welcomed = localStorage.getItem('ai_guide_welcomed')
    if (welcomed) return

    if (isLoggedIn && user) {
      fetch('/api/ai-copy', { credentials: 'include' })
        .then(r => r.json()).catch(() => ({ data: [] }))
        .then((d: any) => {
          const hasData = Array.isArray(d.data) ? d.data.length > 0 : Array.isArray(d) ? d.length > 0 : false
          if (!hasData) {
            localStorage.setItem('ai_guide_welcomed', '1')
          }
        })
    } else {
      localStorage.setItem('ai_guide_welcomed', '1')
    }
  }, [loading, isLoggedIn, user])

  return (
    <a
      href="/onboarding"
      className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 text-white shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center hover:shadow-emerald-500/25"
      title="AI 营销引导"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    </a>
  )
}
