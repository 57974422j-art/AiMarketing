'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/app/providers'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const WELCOME_MSG =
  '👋 你好！我是 AiMarketing 的 AI 引导助手。\n\n我可以帮你：\n\n- **生成营销文案** — 输入关键词，自动生成适配多平台的推广文案\n- **AI 生图** — 一句话生成营销配图\n- **视频处理** — 剪辑、配音、字幕一条龙\n- **数字人** — 克隆形象，自动生成口播视频\n\n你想体验哪个功能？'

export default function AIGuide() {
  const { user, isLoggedIn, loading } = useAuth()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 判断是否自动弹出
  useEffect(() => {
    if (loading || initialized) return

    const dismissed = localStorage.getItem('ai_guide_dismissed')
    const today = new Date().toDateString()
    if (dismissed === today) { setInitialized(true); return }

    const welcomed = localStorage.getItem('ai_guide_welcomed')

    if (isLoggedIn && user) {
      // 已登录：检查用户是否有营销数据
      fetch('/api/ai-copy', { credentials: 'include' })
        .then(r => r.json())
        .catch(() => ({}))
        .then((data: any) => {
          const hasData = Array.isArray(data) ? data.length > 0 : Array.isArray(data?.data) ? data.data.length > 0 : false
          if (!hasData && !welcomed) {
            // 新用户，无历史数据 → 自动弹出
            setTimeout(() => {
              setOpen(true)
              setMessages([{ role: 'assistant', content: WELCOME_MSG }])
              localStorage.setItem('ai_guide_welcomed', '1')
            }, 1500)
          }
          setInitialized(true)
        })
    } else if (!isLoggedIn) {
      // 未登录用户也弹出（但只弹一次）
      if (!welcomed) {
        setTimeout(() => {
          setOpen(true)
          setMessages([{ role: 'assistant', content: WELCOME_MSG }])
          localStorage.setItem('ai_guide_welcomed', '1')
        }, 2000)
      }
      setInitialized(true)
    } else {
      setInitialized(true)
    }
  }, [loading, isLoggedIn, user, initialized])

  // 自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 关闭 → 当天不再自动弹出
  const handleClose = useCallback(() => {
    setOpen(false)
    localStorage.setItem('ai_guide_dismissed', new Date().toDateString())
  }, [])

  // 发送消息
  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return
    const text = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setSending(true)

    try {
      const history = messages.slice(-10)
      const res = await fetch('/api/ai-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: text, history }),
      })
      const data = await res.json()
      if (data.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `❌ ${data.message || '请求失败，请稍后重试'}` }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ 网络错误，请稍后重试' }])
    } finally {
      setSending(false)
    }
  }, [input, sending, messages])

  // Enter 发送
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      {/* 浮窗按钮 */}
      <button
        onClick={() => { setOpen(v => !v); if (!open) setMessages(prev => prev.length === 0 ? [{ role: 'assistant', content: WELCOME_MSG }] : prev) }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 text-white shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
        title="AI 引导助手"
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        ) : (
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
        )}
      </button>

      {/* 聊天窗口 */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] h-[550px] max-w-[calc(100vw-48px)] max-h-[calc(100vh-160px)] bg-gray-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden backdrop-blur-xl">
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-white text-sm font-bold">AI</div>
              <div>
                <div className="text-sm text-white font-medium">AI 引导助手</div>
                <div className="text-[10px] text-emerald-400">在线</div>
              </div>
            </div>
            <button onClick={handleClose} className="text-gray-500 hover:text-white transition-colors p-1" title="关闭">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {/* 消息区 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full text-gray-600 text-xs font-mono">
                输入消息开始对话
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-emerald-500 text-white rounded-br-sm'
                      : 'bg-white/10 text-gray-200 rounded-bl-sm'
                  }`}
                >
                  <div dangerouslySetInnerHTML={{ __html: msg.content.replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-white/10 rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* 输入区 */}
          <div className="border-t border-white/10 p-3 bg-white/5">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息..."
                rows={1}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 resize-none"
                disabled={sending}
              />
              <button
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="px-3 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
