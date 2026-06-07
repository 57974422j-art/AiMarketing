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
  { icon: '✍️', text: '帮我写个口红推广文案', label: 'AI文案' },
  { icon: '🎨', text: '生成一张产品海报图', label: 'AI生图' },
  { icon: '🎬', text: '做一个护肤品的短视频', label: 'AI视频' },
  { icon: '🤖', text: '数字人怎么用？', label: '数字人' },
]

export default function AgentPage() {
  const { user, loading: authLoading } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 自动调整输入框高度
  const adjustInputHeight = () => {
    const el = inputRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 120) + 'px'
    }
  }

  // 发送消息
  const sendMessage = async (text?: string) => {
    const msgText = (text || input).trim()
    if (!msgText || loading) return

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: msgText,
      timestamp: Date.now(),
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      // 构建历史（最近10条）
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))

      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msgText, history }),
      })

      const data = await res.json()

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.success ? data.data.reply : (data.message || '出错了，请重试'),
        timestamp: Date.now(),
        intent: data.data?.intent,
        toolUsed: data.data?.toolUsed,
      }

      setMessages(prev => [...prev, assistantMsg])
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '网络连接失败，请检查网络后重试',
        timestamp: Date.now(),
      }])
    } finally {
      setLoading(false)
    }
  }

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // 渲染消息内容（支持简单的图片/链接解析）
  const renderContent = (content: string) => {
    // 解析图片链接 ![xxx](url)
    const parts: JSX.Element[] = []
    let remaining = content
    let key = 0

    // 图片匹配
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
    let match: RegExpExecArray | null
    let lastIdx = 0

    while ((match = imgRegex.exec(remaining)) !== null) {
      if (match.index > lastIdx) {
        parts.push(<span key={key++}>{renderText(remaining.substring(lastIdx, match.index))}</span>)
      }
      parts.push(
        <img
          key={key++}
          src={match[2]}
          alt={match[1]}
          className="max-w-full rounded-xl my-2 cursor-pointer"
          onClick={() => window.open(match[2] || '', '_blank')}
        />
      )
      lastIdx = match.index + match[0].length
    }
    if (lastIdx < remaining.length) {
      parts.push(<span key={key++}>{renderText(remaining.substring(lastIdx))}</span>)
    }

    return parts.length > 0 ? parts : renderText(content)
  }

  // 渲染纯文本（换行处理）
  const renderText = (text: string) => {
    return text.split('\n').map((line, i) => (
      <span key={i}>
        {i > 0 && <br />}
        {/* 简单的链接检测 */}
        {/(https?:\/\/[^\s]+)/.test(line)
          ? line.split(/(https?:\/\/[^\s]+)/).map((part, j) =>
              /^(https?:\/\/)/.test(part)
                ? <a key={j} href={part} target="_blank" rel="noopener" className="text-emerald-400 hover:underline break-all">{part}</a>
                : <span key={j}>{part}</span>
            )
          : line}
      </span>
    ))
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 font-mono text-sm">加载中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* ===== Header ===== */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-sm font-bold text-white">
          AI
        </div>
        <div>
          <h1 className="text-sm font-medium text-white">AiMarketing 助手</h1>
          <p className="text-[10px] text-gray-500 font-mono">AI 营创作业平台 · 随时为你服务</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-emerald-400/70 font-mono">在线</span>
        </div>
      </header>

      {/* ===== Messages Area ===== */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* 欢迎消息 */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] px-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400/20 to-cyan-500/20 border border-emerald-500/20 flex items-center justify-center mb-4">
              <span className="text-3xl">🤖</span>
            </div>
            <h2 className="text-lg font-medium text-white mb-1">你好，我是 AI 助手</h2>
            <p className="text-xs text-gray-500 text-center mb-6 max-w-xs">
              我可以帮你生成文案、图片、视频，管理数字人和素材仓库。直接告诉我就好！
            </p>

            {/* 快捷建议 */}
            <div className="w-full max-w-sm grid grid-cols-2 gap-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s.text)}
                  className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-emerald-500/30 transition-all text-left"
                >
                  <span className="text-base">{s.icon}</span>
                  <div>
                    <p className="text-xs text-white leading-tight">{s.text}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{s.label}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 消息列表 */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-emerald-600 text-white rounded-br-md'
                  : 'bg-white/5 text-gray-200 border border-white/10 rounded-bl-md'
              }`}
            >
              {msg.role === 'assistant' && msg.toolUsed && (
                <p className="text-[10px] text-emerald-400/60 mb-1.5 font-mono">⚡ 工具调用完成</p>
              )}
              <div className={`text-sm ${msg.role === 'assistant' ? 'leading-relaxed' : ''}`}>
                {renderContent(msg.content)}
              </div>
              <p className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-emerald-300/50' : 'text-gray-600'} text-right`}>
                {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}

        {/* 加载中指示器 */}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white/5 border border-white/10 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs text-gray-500 font-mono">思考中...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* ===== Input Area ===== */}
      <footer className="border-t border-white/5 bg-gray-950/90 backdrop-blur-sm p-3 safe-area-bottom">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); adjustInputHeight() }}
            onKeyDown={handleKeyDown}
            placeholder="输入你的需求..."
            rows={1}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 resize-none transition-colors"
            disabled={loading}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              input.trim() && !loading
                ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                : 'bg-white/5 text-gray-500 cursor-not-allowed'
            }`}
          >
            发送
          </button>
        </div>
        <p className="text-[9px] text-gray-600 text-center mt-2 font-mono">
          AiMarketing Agent · 基于 LLM 驱动 · 内容由 AI 生成仅供参考
        </p>
      </footer>
    </div>
  )
}
