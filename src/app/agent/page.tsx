'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import VoiceOrb from '@/components/VoiceOrb'

// 声纹球状态（融合 BaiLongma 语音环观感）
type OrbState = 'idle' | 'listening' | 'recognizing' | 'speaking' | 'thinking'

// ===== 阶段一·语音环（融合 BaiLongma 声纹语音能力，复用火山 TTS + 本地 FunASR）=====
function useAgentVoice() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)

  // Jarvis 风格提示音（WebAudio 合成，无需外部文件）
  const blip = (freq = 660, dur = 0.12) => {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!Ctx) return
      if (!ctxRef.current) ctxRef.current = new Ctx()
      const ctx = ctxRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(); osc.stop(ctx.currentTime + dur)
    } catch {}
  }

  const speak = async (text: string): Promise<void> => {
    if (!text) return
    blip(880, 0.1)
    try {
      const res = await fetch('/api/agent/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (data.success && data.audioBase64) {
        const url = `data:${data.mime};base64,${data.audioBase64}`
        await new Promise<void>((resolve) => {
          const audio = new Audio(url)
          audioRef.current = audio
          audio.onended = () => { blip(440, 0.1); resolve() }
          audio.onerror = () => resolve()
          audio.play().catch(() => resolve())
        })
      }
    } catch {}
  }

  const stop = () => {
    audioRef.current?.pause()
    audioRef.current = null
  }

  return { speak, stop, blip }
}

interface SceneCard {
  type: string
  title?: string
  fields?: { label: string; value: string }[]
  options?: string[]
  actions?: { label: string; href?: string }[]
}
interface Message {
  id: number | string
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
  createdAt?: string
  intent?: string
  toolUsed?: boolean
  steps?: { tool: string; label: string }[]
  scene?: SceneCard | null
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
  const [lastPoints, setLastPoints] = useState<number | null>(null)

  // ===== 阶段一·语音环状态 =====
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [showBrain, setShowBrain] = useState(false)
  const [brainMemories, setBrainMemories] = useState<{ content: string; tags: string; salience: number }[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTip, setRecordingTip] = useState('')
  const [orbState, setOrbState] = useState<OrbState>('idle')
  const [micVolume, setMicVolume] = useState(0)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<BlobPart[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const volRafRef = useRef<number>(0)
  const voice = useAgentVoice()

  // 录音：按住说话 / 点击切换
  const startRecording = async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setRecordingTip('当前浏览器不支持语音，请下载客户端使用')
        setIsRecording(false)
        setTimeout(() => { if (confirm('当前浏览器不支持语音输入，是否前往下载桌面客户端？')) window.open('/download', '_blank') }, 50)
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      const rec = new MediaRecorder(stream)
      mediaRecorderRef.current = rec
      audioChunksRef.current = []
      // 启动音量分析驱动声纹球
      try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext
        const ac = new AC()
        audioCtxRef.current = ac
        const src = ac.createMediaStreamSource(stream)
        const analyser = ac.createAnalyser()
        analyser.fftSize = 512
        src.connect(analyser)
        analyserRef.current = analyser
        const buf = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          analyser.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / buf.length)
          setMicVolume(Math.min(1, rms * 3))
          volRafRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch {}
      rec.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        cancelAnimationFrame(volRafRef.current)
        setMicVolume(0)
        setOrbState('recognizing')
        const blob = new Blob(audioChunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size < 1500) { setRecordingTip('没听到声音'); setIsRecording(false); setOrbState('idle'); return }
        setRecordingTip('识别中…')
        try {
          const fd = new FormData()
          fd.append('audio', blob, 'rec.webm')
          const r = await fetch('/api/agent/asr', { method: 'POST', body: fd, credentials: 'include' })
          const d = await r.json()
          if (d.success && d.text) {
            setInput(d.text)
          } else {
            setRecordingTip(d.message || '识别失败')
          }
        } catch (e: any) {
          setRecordingTip('识别出错：' + e.message)
        }
        setIsRecording(false)
        setOrbState('idle')
        setTimeout(() => setRecordingTip(''), 2500)
      }
      rec.start()
      setIsRecording(true)
      setOrbState('listening')
      setRecordingTip('正在听…松开或再点停止')
      voice.blip(660, 0.12)
    } catch (e: any) {
      setRecordingTip('麦克风权限被拒绝')
      setIsRecording(false)
    }
  }
  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
  }
  const toggleRecording = () => {
    if (isRecording) stopRecording()
    else startRecording()
  }

  // 朗读某条消息（自动朗读时会在收到助手消息后调用）
  const speakMessage = (content: string) => {
    const plain = content.replace(/【[^\]]*】/g, '').replace(/\n+/g, '。').slice(0, 400)
    setOrbState('speaking')
    voice.speak(plain).then(() => { if (!isRecording) setOrbState('idle') })
  }

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
    setOrbState('thinking')

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
          steps: data.data.steps,
          scene: data.data.scene,
        }])
        if (autoSpeak) speakMessage(data.data.reply)
        if (data.data.sessionId) setSessionId(data.data.sessionId)
        setOrbState('idle')
        if (typeof data.data.pointsSpent === 'number') setLastPoints(data.data.pointsSpent)
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
    <div className="min-h-screen bg-[#07070c] flex flex-col relative overflow-hidden">
      {/* 背景：BaiLongma 风格动态渐变光晕 */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -top-32 -left-32 w-[28rem] h-[28rem] bg-emerald-500/[0.08] rounded-full blur-[140px] animate-pulse" style={{ animationDuration: '9s' }} />
        <div className="absolute -bottom-40 -right-24 w-[24rem] h-[24rem] bg-indigo-500/[0.07] rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '7s', animationDelay: '1.5s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[36rem] h-[36rem] bg-cyan-500/[0.04] rounded-full blur-[160px] animate-pulse" style={{ animationDuration: '11s', animationDelay: '0.8s' }} />
        {/* 细网格纹理 */}
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.6) 1px,transparent 1px)', backgroundSize: '40px 40px' }} />
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
          {/* 阶段一·语音环控制 */}
          <button onClick={() => setAutoSpeak(s => !s)}
            className={`hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] transition ${autoSpeak ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 hover:bg-white/10 text-gray-400'}`}
            title="自动朗读回复">
            🔊 {autoSpeak ? '朗读中' : '自动朗读'}
          </button>
          <button onClick={toggleRecording}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${isRecording ? 'bg-red-500/30 text-red-300 animate-pulse' : orbState === 'thinking' ? 'bg-purple-500/20 text-purple-300' : orbState === 'speaking' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 hover:bg-white/10 text-gray-400'}`}
            title={isRecording ? '点击停止录音' : (orbState === 'thinking' ? '思考中' : orbState === 'speaking' ? '朗读中' : '点击说话')}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2m7 9v3"/></svg>
          </button>
          <a href="/workspace" className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-gray-400 hover:text-gray-200 transition" title="工具箱">
            工具箱
          </a>
          <button onClick={async () => {
            const next = !showBrain
            setShowBrain(next)
            if (next) {
              try {
                const r = await fetch('/api/agent/memories', { credentials: 'include' })
                const d = await r.json()
                if (d.success) setBrainMemories(d.items || [])
              } catch {}
            }
          }}
            className={`hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] transition ${showBrain ? 'bg-purple-500/20 text-purple-300' : 'bg-white/5 hover:bg-white/10 text-gray-400'}`}
            title="认知地图 / 长期记忆">
            🧠 记忆
          </button>
          <button onClick={newChat} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center" title="新对话">
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* 阶段五·认知地图抽屉（融合 BaiLongma Brain UI，轻量版） */}
        {showBrain && (
          <aside className="w-64 border-r border-purple-500/10 backdrop-blur-xl bg-[#0a0a0f]/95 flex-col shrink-0 hidden md:flex">
            <div className="p-3 border-b border-white/5 flex items-center justify-between">
              <span className="text-[11px] text-purple-300 font-medium">🧠 认知地图</span>
              <button onClick={() => setShowBrain(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <div>
                <p className="text-[9px] text-gray-500 mb-1.5">长期记忆 ({brainMemories.length})</p>
                {brainMemories.length === 0 ? (
                  <p className="text-[9px] text-gray-700">暂无记忆（聊天中让助手「记住…」即可）</p>
                ) : (
                  brainMemories.map((m, i) => (
                    <div key={i} className="mb-1.5 rounded-lg bg-purple-500/5 border border-purple-500/15 px-2 py-1.5">
                      <p className="text-[10px] text-gray-300 leading-snug">{m.content}</p>
                      {m.tags && <p className="text-[8px] text-purple-400/70 mt-0.5">#{m.tags}</p>}
                    </div>
                  ))
                )}
              </div>
              <div>
                <p className="text-[9px] text-gray-500 mb-1.5">可用工具</p>
                <div className="flex flex-wrap gap-1">
                  {['写文案', '生图', '生视频', '搜素材', '个人仓库', '发布', '记忆'].map((t, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-[9px] text-cyan-300">· {t}</span>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        )}
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
            {lastPoints != null && (
              <p className="text-[10px] text-amber-300/80 text-center">🪙 本次对话消耗 {lastPoints} 点</p>
            )}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] pt-4">
                {/* BaiLongma 声纹点云球 · 页面主角 */}
                <div className="relative mb-6">
                  <div className="absolute inset-0 rounded-full bg-emerald-500/10 blur-2xl scale-90" />
                  <VoiceOrb
                    state={orbState}
                    volume={micVolume}
                    size={220}
                    className="relative drop-shadow-[0_0_24px_rgba(56,189,248,0.25)]"
                  />
                  <button onClick={toggleRecording}
                    className="absolute inset-0 w-full h-full rounded-full cursor-pointer"
                    title={isRecording ? '点击停止' : '点击说话'} />
                </div>
                <h2 className="text-lg text-white font-semibold mb-1 tracking-tight">我能帮你做什么？</h2>
                <p className="text-xs text-gray-500 text-center mb-1 max-w-xs px-2">
                  点击上方声纹球，或直接输入需求
                </p>
                <p className="text-[10px] text-emerald-400/70 mb-6 text-center">
                  {orbState === 'listening' ? '🎤 正在聆听…' : orbState === 'recognizing' ? '🔍 识别中…' : orbState === 'thinking' ? '💭 思考中…' : orbState === 'speaking' ? '🔊 朗读中…' : '声纹球待命中'}
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
                  <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 overflow-hidden ${msg.role === 'user' ? 'bg-blue-500/20 border border-blue-500/30 rounded-full' : 'bg-gradient-to-br from-emerald-400 to-cyan-500'}`}>
                    {msg.role === 'user'
                      ? <span className="text-[9px] text-blue-300 font-semibold">{user?.username?.[0]?.toUpperCase() || 'U'}</span>
                      : <VoiceOrb state="idle" size={28} />}
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
                      {/* 阶段二·思考流：工具执行步骤可视化 */}
                      {msg.role === 'assistant' && msg.steps && msg.steps.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {msg.steps.map((s, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-[9px] text-cyan-300">
                              <span className="w-1 h-1 bg-cyan-400 rounded-full" /> {s.label}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* 阶段二·Scene 投影：AGENT 返回结构化卡片原生渲染 */}
                      {msg.role === 'assistant' && msg.scene && (
                        <div className="mt-2 rounded-xl bg-white/[0.03] border border-white/[0.08] p-3">
                          {msg.scene.title && <p className="text-[11px] text-emerald-300 font-medium mb-2">{msg.scene.title}</p>}
                          {msg.scene.fields?.map((f, i) => (
                            <div key={i} className="flex justify-between gap-3 text-[10px] py-1 border-b border-white/[0.04] last:border-0">
                              <span className="text-gray-500">{f.label}</span>
                              <span className="text-gray-300 text-right">{f.value}</span>
                            </div>
                          ))}
                          {msg.scene.options && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {msg.scene.options.map((o, i) => (
                                <span key={i} className="px-2 py-0.5 rounded-md bg-white/5 text-[9px] text-gray-400">· {o}</span>
                              ))}
                            </div>
                          )}
                          {msg.scene.actions && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {msg.scene.actions.map((a, i) => (
                                a.href ? (
                                  <a key={i} href={a.href} className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-[10px] text-emerald-300 hover:bg-emerald-500/30 transition">{a.label}</a>
                                ) : (
                                  <span key={i} className="px-2.5 py-1 rounded-lg bg-white/5 text-[10px] text-gray-400">{a.label}</span>
                                )
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {msg.role === 'assistant' && (
                        <button onClick={() => speakMessage(msg.content)}
                          className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-[9px] text-gray-400 hover:text-emerald-300 transition" title="朗读此条">
                          🔊 朗读
                        </button>
                      )}
                      <p className="text-[8px] mt-1 opacity-30">{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start animate-in fade-in">
                <div className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-lg overflow-hidden bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shrink-0">
                    <VoiceOrb state="thinking" size={28} />
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
              {recordingTip && (
                <div className={`mb-2 text-center text-[10px] py-1 rounded-lg ${isRecording ? 'bg-red-500/15 text-red-300' : 'bg-white/5 text-gray-400'}`}>
                  {isRecording && <span className="inline-block w-1.5 h-1.5 bg-red-400 rounded-full mr-1 animate-pulse" />}
                  {recordingTip}
                </div>
              )}
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
