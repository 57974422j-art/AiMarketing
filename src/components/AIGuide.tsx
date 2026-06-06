'use client'

import { useEffect } from 'react'

/**
 * AI 智能助手 — 右下角浮窗按钮
 * 功能开发中，点击显示提示（原 Onboarding 引导已移除）
 */
export default function AIGuide() {
  // 新用户标记（保留 localStorage 逻辑避免报错）
  useEffect(() => {
    const welcomed = localStorage.getItem('ai_guide_welcomed')
    if (!welcomed) {
      localStorage.setItem('ai_guide_welcomed', '1')
    }
  }, [])

  return (
    <button
      onClick={() => alert('AI 智能客服功能正在开发中，敬请期待！')}
      className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 text-white shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center hover:shadow-emerald-500/25"
      title="AI 智能助手（开发中）"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    </button>
  )
}
