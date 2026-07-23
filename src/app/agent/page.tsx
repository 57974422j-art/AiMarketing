'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'

interface Message {
  id: number | string
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
  createdAt?: string
  intent?: string
  toolUsed?: boolean
}

interface Session {
  id: number
  title: string
  updatedAt: string
}

interface Attachment { name: string; url: string; type: string }

const SUGGESTIONS = [
  '帮我写一个文案',
  '帮我做一个海报',
  '帮我做一个视频',
  '帮我发一个抖音',
  '帮我做一个数字人口播',
  '帮我找一张产品图',
]

export default function AgentPage() {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [showStorage, setShowStorage] = useState(false)
  const [storageItems, setStorageItems] = useState<any[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    try {
      const r = await fetch('/api/agent/chat?action=sessions', { credentials: 'include' })
      const d = await r.json()
      if (d.success) setSessions(d.data)
    } catch {}
  }, [])

  useEffect(() => { if (user) loadSessions() }, [user, loadSessions])

  // 切换会话
  const switchSession = async (id: number) => {
    setSidebarOpen(false)
    try {
      const r = await fetch(`/api/agent/chat?action=messages&sessionId=${id}`, { credentials: 'include' })
      const d = await r.json()
      if (d.success) {
        setSessionId(id)
        setMessages(d.data.messages.map((m: any) => ({
          id: m.id, role: m.role,
          content: m.content, intent: m.intent,
          toolUsed: m.toolUsed,
          timestamp: new Date(m.createdAt).getTime(),
        })))
        d.data.session.title && (document.title = d.data.session.title)
      }
    } catch {}
  }

  // 新建对话
  const newChat = () => {
    setMessages([])
    setSessionId(null)
    setAttachments([])
    setSidebarOpen(false)
    document.title = 'AI 助手'
  }

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // 加载素材仓库
  const loadStorageForPicker = async () => {
    try {
      const r = await fetch('/api/agent/chat', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '__storage__' }),
      })
      // 直接查DB
      const items = await fetch('/api/media-library?limit=12', { credentials: 'include' }).then(r => r.json())
      if (items.success) setStorageItems(items.data || [])
    } catch {}
  }

  const sendMessage = async (text?: string) => {
    const msgText = (text || input).trim()
    if ((!msgText && !attachments.length) || loading) return

    let finalText = msgText
    if (attachments.length && !msgText) finalText = '请帮我看一下这些附件'
    if (!finalText) return

    const userMsg: Message = {
      id: Date.now().toString(), role: 'user',
      content: attachments.length
        ? `${finalText}\n\n📎 ${attachments.map(a => `[${a.name}](${a.url})`).join(' ')}`
        : finalText,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setAttachments([])
    setLoading(true)

    try {
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      const body: any = { message: finalText, history, sessionId: sessionId || undefined }
      if (attachments.length) body.attachments = attachments

      const res = await fetch('/api/agent/chat', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(), role: 'assistant',
          content: data.data.reply, timestamp: Date.now(),
          intent: data.data.intent?.join?.(',') || data.data.intent,
          toolUsed: data.data.toolUsed,
        }])
        if (data.data.sessionId) setSessionId(data.data.sessionId)
        loadSessions()
      } else {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(), role: 'assistant',
          content: data.message || '出错了', timestamp: Date.now(),
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: '网络连接失败', timestamp: Date.now(),
      }])
    } finally { setLoading(false) }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  // 文件上传处理（图片/视频 → 个人仓库 /api/storage/files）
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    Array.from(files).forEach(async (file) => {
      const isVideo = file.type.startsWith('video')
      const isImage = file.type.startsWith('image')
      if (!isVideo && !isImage) return
      if (file.size > 100 * 1024 * 1024) return
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/storage/files', { method: 'POST', body: fd, credentials: 'include' })
      const d = await r.json()
      if (d.success && d.data?.name) {
        const url = `/api/storage/file?userId=${user?.id}&name=${encodeURIComponent(d.data.name)}`
        setAttachments(prev => [...prev, { name: file.name, url, type: isVideo ? 'video' : 'image' }])
      }
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Markdown 渲染
  const renderContent = (content: string) => {
    if (!content) return null
    // 图片展示
    const imgMatch = content.match(/!\[([^\]]*)\]\(([^)]+)\)/)
    const parts = content.split(/(```[\s\S]*?```)/g)
    return (
      <>
        {parts.map((part, i) => {
          if (part.startsWith('```')) {
            const code = part.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
            return (
              <pre key={i} className="bg-black/40 rounded-lg p-3 my-2 overflow-x-auto text-[11px] text-emerald-300 font-mono leading-relaxed border border-white/5">
                <code>{code}</code>
              </pre>
            )
          }
          return part.split('\n').map((line, j) => {
            const linkRegex = /(https?:\/\/[^\s)<>]+)/g
            const p2 = line.split(linkRegex)
            return <span key={`${i}-${j}`}>{j > 0 && <br />}{p2.map((p, k) =>
              /^https?:\/\//.test(p)
                ? <a key={k} href={p} target="_blank" rel="noopener" className="text-blue-400 hover:underline break-all">{p}</a>
                : <span key={k}>{p}</span>
            )}</span>
          })
        })}
        {imgMatch && (
          <img src={imgMatch[2]} alt={imgMatch[1]} className="mt-2 rounded-lg max-w-full max-h-64 object-contain border border-white/5" />
        )}
      </>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col relative overflow-hidden">
      {/* 背景 */}
      <div className="fixed inset-0 pointer-events-none opacity-15">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-[128px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/10 rounded-full blur-[96px] animate-pulse" style={{ animationDuration: '6s', animationDelay: '2s' }} />
      </div>

      {/* Header */}
      <header className="relative z-10 h-14 border-b border-white/5 backdrop-blur-xl bg-[#0a0a0f]/80 flex items-center px-3 sm:px-4 shrink-0">
        <button onClick={() => setSidebarOpen(!sidebarOpen)}
          className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center lg:hidden">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
        <div className="flex items-center gap-2 ml-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-xs font-semibold text-white">AI 助手</h1>
            <p className="text-[9px] text-emerald-400">在线</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <a href="/workspace" className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-gray-400 hover:text-gray-200 transition" title="工具箱">
            工具箱
          </a>
          <button onClick={newChat} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center" title="新对话">
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* 侧边栏 */}
        {/* 桌面端常驻侧边栏 */}
        <aside className="hidden lg:flex w-56 border-r border-white/5 backdrop-blur-xl bg-[#0a0a0f]/90 flex-col shrink-0">
          <div className="p-3 border-b border-white/5">
            <button onClick={newChat}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300 transition">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
              新对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            <p className="text-[10px] text-gray-600 px-2 py-1">对话历史</p>
            {sessions.length === 0 ? (
              <p className="text-[10px] text-gray-700 px-2 py-2">暂无对话</p>
            ) : (
              sessions.map(s => (
                <button key={s.id} onClick={() => switchSession(s.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[10px] truncate transition ${sessionId === s.id ? 'bg-white/10 text-gray-200' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'}`}>
                  {s.title}
                </button>
              ))
            )}
          </div>
          <div className="p-3 border-t border-white/5">
            <p className="text-[9px] text-gray-600 text-center">{user?.username}</p>
          </div>
        </aside>
        {/* 移动端浮层侧边栏 */}
        <aside className={`lg:hidden ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed z-20 left-0 top-14 bottom-0 w-64 border-r border-white/5 backdrop-blur-xl bg-[#0a0a0f]/95 transition-transform duration-300 flex flex-col`}>
          <div className="p-3 border-b border-white/5">
            <button onClick={newChat}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300 transition">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
              新对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            <p className="text-[10px] text-gray-600 px-2 py-1">对话历史</p>
            {sessions.length === 0 ? (
              <p className="text-[10px] text-gray-700 px-2 py-2">暂无对话</p>
            ) : (
              sessions.map(s => (
                <button key={s.id} onClick={() => switchSession(s.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[10px] truncate transition ${sessionId === s.id ? 'bg-white/10 text-gray-200' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'}`}>
                  {s.title}
                </button>
              ))
            )}
          </div>
          <div className="p-3 border-t border-white/5">
            <p className="text-[9px] text-gray-600 text-center">{user?.username}</p>
          </div>
        </aside>
        {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-10" onClick={() => setSidebarOpen(false)} />}

        {/* 主对话 */}
        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] pt-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20 animate-in fade-in zoom-in">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="1.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                </div>
                <h2 className="text-base text-white font-semibold mb-1">我能帮你做什么？</h2>
                <p className="text-xs text-gray-500 text-center mb-6 max-w-xs px-2">
                  输入需求，我直接帮你执行
                </p>
                <div className="flex flex-wrap justify-center gap-2 max-w-xl w-full px-2">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => sendMessage(s)}
                      className="px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-emerald-500/20 text-[11px] text-gray-400 hover:text-gray-200 transition-all">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
                <div className={`flex items-start gap-2 max-w-[88%] sm:max-w-[75%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${msg.role === 'user' ? 'bg-blue-500/20 border border-blue-500/30 rounded-full' : 'bg-gradient-to-br from-emerald-400 to-cyan-500'}`}>
                    {msg.role === 'user'
                      ? <span className="text-[9px] text-blue-300 font-semibold">{user?.username?.[0]?.toUpperCase() || 'U'}</span>
                      : <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>}
                  </div>
                  <div className="min-w-0">
                    {msg.role === 'assistant' && <p className="text-[9px] text-gray-500 mb-0.5 font-medium">AI 助手</p>}
                    <div className={`rounded-2xl px-3 py-2 text-xs leading-relaxed break-words ${msg.role === 'user'
                      ? 'bg-blue-500/15 text-blue-100 border border-blue-500/20 rounded-br-md'
                      : 'bg-white/[0.04] text-gray-200 border border-white/[0.06] rounded-bl-md'}`}>
                      {msg.role === 'assistant' && msg.toolUsed && (
                        <p className="text-[9px] text-emerald-400/70 mb-1 font-mono flex items-center gap-1">
                          <span className="w-1 h-1 bg-emerald-400 rounded-full" /> 已执行{msg.intent ? ` · ${msg.intent}` : ''}
                        </p>
                      )}
                      <div className="text-gray-300 whitespace-pre-wrap">{renderContent(msg.content)}</div>
                      <p className="text-[8px] mt-1 opacity-30">{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start animate-in fade-in">
                <div className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shrink-0">
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-500 mb-1">AI 助手</p>
                    <div className="rounded-2xl rounded-bl-md bg-white/[0.04] border border-white/[0.06] px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '120ms' }} />
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '240ms' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 输入区 */}
          <footer className="relative border-t border-white/[0.04] backdrop-blur-xl bg-[#0a0a0f]/80 px-2 sm:px-6 py-2 sm:py-3 shrink-0">
            <div className="max-w-3xl mx-auto">
              {/* 附件预览 */}
              {attachments.length > 0 && (
                <div className="flex gap-2 mb-2 flex-wrap">
                  {attachments.map((a, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 text-[10px] text-gray-400">
                      {a.type === 'image' ? '🖼' : a.type === 'video' ? '🎬' : '🎵'} {a.name}
                      <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-gray-600 hover:text-red-400">×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded-2xl px-2 sm:px-3 py-1.5 focus-within:border-emerald-500/30 transition-colors">
                {/* 附件按钮 */}
                <button onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-500 hover:text-gray-300 transition">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
                </button>
                <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFilePick} multiple />
                <textarea ref={inputRef} value={input}
                  onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder="输入需求，我帮你干活..."
                  rows={1}
                  className="flex-1 bg-transparent text-xs sm:text-sm text-gray-200 placeholder-gray-600 resize-none outline-none py-1 max-h-32"
                  disabled={loading} />
                <button onClick={() => sendMessage()} disabled={(!input.trim() && !attachments.length) || loading}
                  className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition ${(input.trim() || attachments.length) && !loading
                    ? 'bg-gradient-to-br from-emerald-400 to-cyan-500 text-white hover:opacity-90' : 'bg-white/5 text-gray-700 cursor-not-allowed'}`}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
              </div>
              <p className="text-[8px] text-gray-700 text-center mt-1 hidden sm:block">Enter 发送 · Shift+Enter 换行 · 📎 上传图片/视频</p>
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}
