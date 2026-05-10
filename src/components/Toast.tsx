'use client'
import { useState, useCallback } from 'react'

interface ToastMsg { id: number; text: string; type: 'success' | 'error' }

let toastId = 0
let globalSetToasts: ((fn: (prev: ToastMsg[]) => ToastMsg[]) => void) | null = null

export function showToast(text: string, type: 'success' | 'error' = 'success') {
  if (globalSetToasts) {
    const id = ++toastId
    globalSetToasts(prev => [...prev, { id, text, type }])
    setTimeout(() => {
      globalSetToasts?.(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  globalSetToasts = setToasts

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id}
          className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-in ${
            t.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}
          style={{ animation: 'slideIn 0.3s ease-out' }}
        >
          {t.text}
        </div>
      ))}
      <style jsx>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
