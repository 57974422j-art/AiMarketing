'use client'

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '@/app/providers'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  intent?: string
  toolUsed?: boolean
}

const SUGGESTIONS = [
  { icon: '✍️', text: '帮我写个口红推广文案' },
  { icon: '🎨', text: '生成一张产品海报图' },
  { icon: '🎬', text: '做一个护肤品的短视频' },
  { icon: '🤖', text: '数字人怎么用？' },
]

export default function AgentPage() {
  const { user, loading: authLoading } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text?: string) => {
    const msgText = (text || input).trim()
    if (!msgText || loading) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: msgText, timestamp: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msgText, history }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: data.success ? data.data.reply : (data.message || '出错了，请重试'),
        timestamp: Date.now(), intent: data.data?.intent, toolUsed: data.data?.toolUsed,
      }])
    } catch {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: '网络连接失败，请检查网络后重试', timestamp: Date.now() }])
    } finally { setLoading(false) }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const renderContent = (content: string) => {
    return content.split('\n').map((line, i) => (
      <span key={i}>{i > 0 && <br />}
        {/(https?:\/\/[^\s]+)/.test(line)
          ? line.split(/(https?:\/\/[^\s]+)/).map((part, j) =>
              /^(https?:\/\/)/.test(part) ? <a key={j} href={part} target="_blank" rel="noopener" className="text-blue-400 hover:underline break-all">{part}</a> : <span key={j}>{part}</span>)
          : line}
      </span>
    ))
  }

  if (authLoading) {
    return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center"><p className="text-gray-500 text-xs">加载中...</p></div>
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      {/* Header */}
      <header className="px-6 py-3 border-b border-white/5">
        <p className="text-label mb-0.5">AI 营创作业平台 / 智能助手</p>
        <h1 className="text-mono-lg text-white">🤖 AI 助手</h1>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center mb-4">
              <span className="text-2xl">🤖</span>
            </div>
            <p className="text-sm text-white mb-1">你好，我是 AI 助手</p>
            <p className="text-xs text-gray-500 text-center mb-6 max-w-xs">
              我可以帮你生成文案、图片、视频，管理数字人和素材仓库。直接告诉我就好！
            </p>
            <div className="grid grid-cols-2 gap-2 max-w-sm">
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => sendMessage(s.text)}
                  className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-blue-500/20 transition-all text-left">
                  <span className="text-sm">{s.icon}</span>
                  <span className="text-[11px] text-gray-300 leading-tight">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-blue-500/20 text-blue-200 border border-blue-500/25 rounded-br-md'
                : 'card-glass rounded-bl-md'}`}>
              {msg.role === 'assistant' && msg.toolUsed && (
                <p className="text-[9px] text-emerald-400/60 mb-1 font-mono">⚡ 已执行</p>
              )}
              <div className="text-gray-300">{renderContent(msg.content)}</div>
              <p className="text-[8px] text-gray-600 mt-1 text-right">
                {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="card-glass rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-[10px] text-gray-500">思考中...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Input */}
      <footer className="border-t border-white/5 bg-[#0a0a0f]/95 backdrop-blur-sm p-4">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea ref={inputRef} value={input}
            onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="输入你的需求..."
            rows={1}
            className="input-dark flex-1 rounded-xl px-4 py-2.5 text-sm resize-none"
            disabled={loading} />
          <button onClick={() => sendMessage()} disabled={!input.trim() || loading}
            className={`px-4 py-2.5 rounded-xl text-xs font-medium transition ${
              input.trim() && !loading ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-white/5 text-gray-600 cursor-not-allowed'}`}>
            发送
          </button>
        </div>
        <p className="text-[8px] text-gray-700 text-center mt-2">内容由 AI 生成，仅供参考</p>
      </footer>
    </div>
  )
}
