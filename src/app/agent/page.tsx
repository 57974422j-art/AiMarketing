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
  { icon: '✍️', label: '写文案', text: '帮我写个口红推广文案' },
  { icon: '🎨', label: '生成海报', text: '生成一张产品海报图' },
  { icon: '🎬', label: '做视频', text: '做一个护肤品的短视频' },
  { icon: '🤖', label: '数字人', text: '数字人怎么用？' },
]

export default function AgentPage() {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
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
        method: 'POST', credentials: 'include',
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

  // Markdown 简单渲染
  const renderContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g)
    return parts.map((part, i) => {
      if (part.startsWith('```')) {
        const code = part.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
        return (
          <pre key={i} className="bg-black/40 rounded-lg p-3 my-2 overflow-x-auto text-[11px] text-emerald-300 font-mono leading-relaxed border border-white/5">
            <code>{code}</code>
          </pre>
        )
      }
      return part.split('\n').map((line, j) => {
        const linkRegex = /(https?:\/\/[^\s)+]+)/g
        const parts2 = line.split(linkRegex)
        return (
          <span key={`${i}-${j}`}>
            {j > 0 && <br />}
            {parts2.map((p, k) =>
              /^https?:\/\//.test(p)
                ? <a key={k} href={p} target="_blank" rel="noopener" className="text-blue-400 hover:underline break-all">{p}</a>
                : <span key={k}>{p}</span>
            )}
          </span>
        )
      })
    })
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col relative overflow-hidden">
      {/* 背景动画 */}
      <div className="fixed inset-0 pointer-events-none opacity-20">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-[128px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/10 rounded-full blur-[96px] animate-pulse" style={{ animationDuration: '6s', animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-purple-500/10 rounded-full blur-[96px] animate-pulse" style={{ animationDuration: '10s', animationDelay: '4s' }} />
      </div>

      {/* 顶部 Header */}
      <header className="relative z-10 h-14 border-b border-white/5 backdrop-blur-xl bg-[#0a0a0f]/80 flex items-center px-4 shrink-0">
        <button onClick={() => setSidebarOpen(!sidebarOpen)}
          className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center mr-3 lg:hidden">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          </div>
          <div>
            <h1 className="text-xs font-semibold text-white">AI 助手</h1>
            <p className="text-[9px] text-emerald-400">在线 · 随时待命</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button onClick={() => { setMessages([]) }} className="text-[10px] text-gray-500 hover:text-gray-300 transition">
            <svg className="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            清空
          </button>
          <span className="text-[10px] text-gray-600">{user?.username}</span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* 侧边栏 */}
        <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} fixed lg:relative z-20 left-0 top-14 bottom-0 w-60 border-r border-white/5 backdrop-blur-xl bg-[#0a0a0f]/90 transition-transform duration-300 flex flex-col shrink-0`}>
          <div className="p-4 border-b border-white/5">
            <button onClick={() => { setMessages([]); setSidebarOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300 transition">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
              新对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            <p className="text-[10px] text-gray-600 px-2 pb-2">对话历史</p>
            {messages.filter(m => m.role === 'user').length === 0 ? (
              <p className="text-[10px] text-gray-700 px-2">暂无对话</p>
            ) : (
              messages.filter(m => m.role === 'user').slice(-20).reverse().map(m => (
                <div key={m.id} className="px-3 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer group">
                  <p className="text-[10px] text-gray-500 truncate group-hover:text-gray-300 transition">{m.content}</p>
                </div>
              ))
            )}
          </div>
          <div className="p-3 border-t border-white/5">
            <p className="text-[9px] text-gray-600 text-center">AI 助手 v2.0</p>
          </div>
        </aside>
        {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-10 lg:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* 主对话区 */}
        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[55vh]">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center mb-5 shadow-lg shadow-emerald-500/20 animate-in fade-in zoom-in">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="1.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                </div>
                <h2 className="text-base text-white font-semibold mb-1">有什么可以帮助你的？</h2>
                <p className="text-xs text-gray-500 text-center mb-8 max-w-xs">
                  文案创作 · 图片视频 · 数字人口播 · 素材管理
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-xl w-full">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => sendMessage(s.text)}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-blue-500/20 transition-all group">
                      <span className="text-lg group-hover:scale-110 transition-transform">{s.icon}</span>
                      <span className="text-[10px] text-gray-400 group-hover:text-gray-200">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
                <div className="flex items-start gap-2.5 max-w-[75%] md:max-w-[65%]">
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shrink-0 mt-0.5">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    </div>
                  )}
                  <div>
                    {msg.role === 'assistant' && (
                      <p className="text-[9px] text-gray-500 mb-1 font-medium">AI 助手</p>
                    )}
                    <div className={`rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-500/15 text-blue-100 border border-blue-500/20 rounded-br-md'
                        : 'bg-white/[0.04] text-gray-200 border border-white/[0.06] rounded-bl-md'
                    }`}>
                      {msg.role === 'assistant' && msg.toolUsed && (
                        <p className="text-[9px] text-emerald-400/70 mb-1.5 font-mono flex items-center gap-1">
                          <span className="w-1 h-1 bg-emerald-400 rounded-full" /> 已执行{msg.intent ? ` · ${msg.intent}` : ''}
                        </p>
                      )}
                      <div className="text-gray-300">{renderContent(msg.content)}</div>
                      <p className="text-[8px] mt-1.5 opacity-40">
                        {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] text-blue-300 font-semibold">{user?.username?.[0]?.toUpperCase() || 'U'}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-start gap-2.5 max-w-[75%]">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-500 mb-1 font-medium">AI 助手</p>
                    <div className="rounded-2xl rounded-bl-md bg-white/[0.04] border border-white/[0.06] px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '120ms' }} />
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '240ms' }} />
                        <span className="text-[10px] text-gray-500 ml-1">生成中</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 输入区 */}
          <footer className="relative border-t border-white/[0.04] backdrop-blur-xl bg-[#0a0a0f]/80 px-4 md:px-8 py-3 shrink-0">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-end gap-2 bg-white/[0.03] border border-white/[0.06] rounded-2xl px-3 py-2 focus-within:border-blue-500/30 transition-colors">
                <textarea ref={inputRef} value={input}
                  onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder="输入你的需求..."
                  rows={1}
                  className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 resize-none outline-none py-1 max-h-32"
                  disabled={loading} />
                <button onClick={() => sendMessage()} disabled={!input.trim() || loading}
                  className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition ${input.trim() && !loading
                    ? 'bg-gradient-to-br from-emerald-400 to-cyan-500 text-white hover:opacity-90'
                    : 'bg-white/5 text-gray-700 cursor-not-allowed'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
              </div>
              <p className="text-[8px] text-gray-700 text-center mt-2">内容由 AI 生成，仅供参考 · Enter 发送 · Shift+Enter 换行</p>
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}
