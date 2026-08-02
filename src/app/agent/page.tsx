'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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
      const ctx = ctxRef.current!
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

interface Attachment { name: string; url: string; type: string }

const SUGGESTIONS = [
  '今天有什么热点可以蹭？给我 3 个选题',
  '帮我写一条小红书种草文案',
  '用这张图做个数字人口播',
  '把这段文案一键成片',
  '帮我做一个产品宣传视频',
  '帮我把这条内容发到抖音',
]

// 思考步骤流工具中文标签（右侧常驻面板渲染用）
const TOOL_STEP_LABEL: Record<string, string> = {
  generate_image: '生成图片',
  generate_video: '生成视频',
  digital_human_speak: '生成数字人口播',
  query_digital_human: '查询口播进度',
  auto_compile: '一键成片',
  query_auto_compile: '查询成片进度',
  search_storage: '检索素材库',
  list_personal_files: '列出个人仓库',
  publish_content: '规划发布',
  upsert_memory: '记忆客户画像',
  search_memory: '回忆长期记忆',
  web_search: '联网搜索',
}

export default function AgentPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [showStorage, setShowStorage] = useState(false)
  const [storageItems, setStorageItems] = useState<any[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [lastPoints, setLastPoints] = useState<number | null>(null)
  // 右侧常驻思考步骤流
  const [liveSteps, setLiveSteps] = useState<{ tool: string; label: string }[]>([])
  // 语音实时识别中间文本
  const [interimText, setInterimText] = useState('')
  // 今日热点（融合 BaiLongma 热点推荐：真实热榜注入主页 + 对话上下文）
  const [hotTopics, setHotTopics] = useState<{ source: string; items: { title: string; hot?: string }[] }[]>([])
  const [hotLoading, setHotLoading] = useState(false)

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
            setInterimText(d.text)
          } else {
            setRecordingTip(d.message || '识别失败')
          }
        } catch (e: any) {
          setRecordingTip('识别出错：' + e.message)
        }
        setIsRecording(false)
        setOrbState('idle')
        setInterimText('')
        setTimeout(() => setRecordingTip(''), 2500)
      }
      rec.start()
      setIsRecording(true)
      setOrbState('listening')
      setRecordingTip('正在听…松开或再点停止')
      voice.blip(660, 0.12)
    } catch (e: any) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError'
      const insecure = typeof window !== 'undefined' && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost'
      setIsRecording(false)
      setOrbState('idle')
      if (denied) {
        setRecordingTip(insecure
          ? '麦克风被拒绝：请通过 https 或 localhost 访问，或下载桌面客户端'
          : '麦克风权限被拒绝：点击地址栏🎤图标允许，或用桌面客户端')
      } else if (insecure) {
        setRecordingTip('当前非 https 环境不支持语音，请下载桌面客户端')
      } else {
        setRecordingTip('无法访问麦克风：' + (e?.message || '未知错误'))
      }
      setTimeout(() => setRecordingTip(''), 4000)
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

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // 加载今日热点（真实热榜，融合 BaiLongma 热点推荐体验）
  const loadHotTopics = async () => {
    setHotLoading(true)
    try {
      const r = await fetch('/api/agent/hotspots', { credentials: 'include' })
      const d = await r.json()
      if (d.success && d.sources?.length) setHotTopics(d.sources)
    } catch {} finally { setHotLoading(false) }
  }
  useEffect(() => { if (messages.length === 0) loadHotTopics() }, [])

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
    setLiveSteps([])

    try {
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      const body: any = { message: finalText, history, sessionId: sessionId || undefined }
      if (attachments.length) body.attachments = attachments
      // 注入今日热点上下文（融合 BaiLongma 热点推荐：让助手能结合真实热榜做内容）
      if (hotTopics.length) {
        body.hotContext = hotTopics
          .map(s => `${s.source}：${s.items.map(i => i.title).join('、')}`)
          .join('；')
      }

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
        if (data.data.steps?.length) setLiveSteps(data.data.steps)
        if (typeof data.data.pointsSpent === 'number') setLastPoints(data.data.pointsSpent)
        // 场景协议：open_page 直接唤起对应页面（懒人模式，不逼用户自己操作页面）
        if (data.data.scene?.type === 'open_page') {
          const path = data.data.scene.path || '/'
          const params = data.data.scene.params || {}
          const qs = new URLSearchParams(params).toString()
          setTimeout(() => router.push(qs ? `${path}?${qs}` : path), 600)
        }
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

  // 异步任务进度/结果卡片（数字人 / 一键成片 / 文生视频）
  const renderTaskCard = (content: string) => {
    if (!content) return null
    const map: Record<string, { kind: string; label: string; doneText: string }> = {
      DH_TASK: { kind: 'dh', label: '数字人口播生成中', doneText: '口播视频已生成' },
      VIDEO_TASK: { kind: 'video', label: 'AI 视频生成中', doneText: '视频已生成' },
    }
    let m: RegExpMatchArray | null
    for (const key of Object.keys(map)) {
      const re = new RegExp(`${key}:([^|]+)\\|?`)
      m = content.match(re)
      if (m) {
        const taskId = m[1].trim()
        return (
          <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-3 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <div className="flex-1">
              <p className="text-sm text-amber-300">{map[key].label}</p>
              <p className="text-[11px] text-gray-500">任务 ID：{taskId}</p>
            </div>
            <button
              onClick={() => askProgress(taskId, map[key].kind)}
              className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium transition"
            >查询进度</button>
          </div>
        )
      }
    }
    // 结果卡片
    const resRe = /(DH_RESULT|VIDEO_RESULT):(.+)/
    const rm = content.match(resRe)
    if (rm) {
      const url = rm[2].trim()
      return (
        <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-sm text-emerald-300 mb-2">{map[rm[1].replace('_RESULT', '_TASK') as string]?.doneText || '任务已完成'}</p>
          <video src={url} controls className="w-full rounded-lg max-h-72 bg-black" />
        </div>
      )
    }
    // 进度卡片
    const progRe = /(DH_PROGRESS|VIDEO_PROGRESS):([^|]+)\|TASK:(.+)/
    const pm = content.match(progRe)
    if (pm) {
      return (
        <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-3 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <div className="flex-1">
            <p className="text-sm text-amber-300">状态：{pm[2].trim()}</p>
            <p className="text-[11px] text-gray-500">任务 ID：{pm[3].trim()}</p>
          </div>
          <button onClick={() => askProgress(pm[3].trim(), pm[1].split('_')[0].toLowerCase())} className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium transition">再查一次</button>
        </div>
      )
    }
    return null
  }

  const askProgress = async (taskId: string, kind: string) => {
    const queryTool = kind === 'dh' ? 'query_digital_human' : kind === 'compile' ? 'query_auto_compile' : 'query_video_task'
    setInput(`查询任务 ${taskId} 的进度（调用 ${queryTool}）`)
    await sendMessage(`请调用 ${queryTool} 查询任务 ${taskId} 的最新进度并返回结果链接。`)
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
        <div className="flex items-center gap-2 ml-1">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-xs font-semibold text-white">AI 营销助手</h1>
            <p className="text-[9px] text-emerald-400">智能体 · 在线</p>
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
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* 右侧常驻·思考步骤流面板（融合 BaiLongma 步骤流） */}
        <aside className="hidden xl:flex w-72 border-l border-white/5 backdrop-blur-xl bg-[#0a0a0f]/80 flex-col shrink-0">
          <div className="p-3 border-b border-white/5">
            <p className="text-[11px] text-gray-300 font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              思考步骤流
            </p>
            <p className="text-[9px] text-gray-600 mt-0.5">实时展示助手执行链路</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {liveSteps.length === 0 ? (
              <p className="text-[10px] text-gray-700 px-1 py-4 text-center">
                {loading ? '分析中…' : '发一条消息，看助手怎么拆解执行'}
              </p>
            ) : (
              liveSteps.map((s, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2 animate-in fade-in">
                  <span className="mt-0.5 w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-[9px] shrink-0 font-semibold">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] text-gray-300 leading-snug">{s.label}</p>
                    <p className="text-[8px] text-cyan-400/70 mt-0.5">{TOOL_STEP_LABEL[s.tool] || s.tool}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          {/* 客户画像（融合 BaiLongma 需求/画像记忆） */}
          <div className="p-3 border-t border-white/5">
            <p className="text-[10px] text-gray-500 mb-1.5">📇 客户画像 · 长期记忆</p>
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
              className={`w-full text-left px-2.5 py-2 rounded-lg text-[10px] transition ${showBrain ? 'bg-purple-500/20 text-purple-300' : 'bg-white/[0.03] hover:bg-white/[0.06] text-gray-400'}`}>
              {showBrain ? `已记录 ${brainMemories.length} 条 · 点击收起` : `共 ${brainMemories.length} 条需求/偏好 · 点击展开`}
            </button>
            {showBrain && (
              <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                {brainMemories.length === 0 ? (
                  <p className="text-[9px] text-gray-700 px-1">聊天中让助手「记住我的行业/偏好…」即生成画像</p>
                ) : (
                  brainMemories.slice(0, 20).map((m, i) => (
                    <div key={i} className="rounded-lg bg-purple-500/5 border border-purple-500/15 px-2 py-1.5">
                      <p className="text-[10px] text-gray-300 leading-snug">{m.content}</p>
                      {m.tags && <p className="text-[8px] text-purple-400/70 mt-0.5">#{m.tags}</p>}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>

        {/* 主对话 */}
        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-3">
            {lastPoints != null && (
              <p className="text-[10px] text-amber-300/80 text-center">🪙 本次对话消耗 {lastPoints} 点</p>
            )}
            {messages.length === 0 && (
              /* BaiLongma 主页气质：顶部居中悬浮声纹球 + 引导 + 今日热点 */
              <div className="flex flex-col items-center w-full px-5 pt-10 pb-8">
                <div className="relative flex flex-col items-center">
                  <div
                    className="pointer-events-none absolute -top-10 h-56 w-56 rounded-full opacity-25 blur-3xl"
                    style={{ background: 'radial-gradient(circle, #ff9f1c, transparent 70%)' }}
                  />
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-orange-500/10 blur-2xl scale-90" />
                    <VoiceOrb
                      state={orbState}
                      volume={micVolume}
                      size={180}
                      className="relative drop-shadow-[0_0_24px_rgba(255,159,28,0.25)]"
                    />
                    <button onClick={toggleRecording}
                      className="absolute inset-0 w-full h-full rounded-full cursor-pointer"
                      title={isRecording ? '点击停止' : '点击说话'} />
                  </div>
                  <p className="text-[12px] text-orange-300/80 text-center mt-5">
                    {orbState === 'listening' ? '🎤 正在聆听…' : orbState === 'recognizing' ? '🔍 识别中…' : orbState === 'thinking' ? '💭 思考中…' : orbState === 'speaking' ? '🔊 朗读中…' : '声纹球待命中 · 点击说话'}
                  </p>
                  {isRecording && interimText && (
                    <div className="mt-2 max-w-sm text-xs text-white/70 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                      {interimText}
                    </div>
                  )}
                </div>

                <h1 className="mt-5 text-2xl sm:text-3xl font-bold text-white tracking-tight mb-3 leading-tight text-center">
                  我能帮你做什么？
                </h1>
                <p className="text-xs text-gray-500 mb-5 leading-relaxed max-w-md text-center">
                  点击上方声纹球直接说话，或在下方输入需求，我帮你生成图片/视频、结合热点做内容、查找素材、发布、推送微信飞书。
                </p>

                <div className="flex flex-wrap gap-2 mb-6 justify-center max-w-xl">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => sendMessage(s)}
                      className="px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-orange-400/30 text-[11px] text-gray-400 hover:text-gray-200 transition-all">
                      {s}
                    </button>
                  ))}
                </div>

                {/* 今日热点（融合 BaiLongma 热点推荐：真实热榜注入主页） */}
                <div className="w-full max-w-3xl">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="text-[11px] font-medium text-gray-500 tracking-wide flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse" />
                      今日热点 · 点条目让助手结合热点出方案
                    </div>
                    <button onClick={loadHotTopics} className="text-[11px] text-gray-500 hover:text-gray-300 transition">
                      {hotLoading ? '刷新中…' : '↻ 刷新'}
                    </button>
                  </div>
                  {hotTopics.length === 0 ? (
                    <div className="text-[11px] text-gray-600 text-center py-4 border border-dashed border-white/10 rounded-xl">
                      {hotLoading ? '正在获取热榜…' : '暂无热点数据'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {hotTopics.slice(0, 3).map((src) => (
                        <div key={src.source} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="text-[11px] font-semibold text-orange-300/90 mb-2">{src.source}</div>
                          <ul className="space-y-1.5">
                            {src.items.slice(0, 5).map((it, i) => (
                              <li key={i}>
                                <button
                                  onClick={() => sendMessage(`结合「${it.title}」这个热点，帮我出一个适合自媒体发布的内容方案`)}
                                  className="text-left text-[11px] text-gray-400 hover:text-gray-100 leading-snug transition line-clamp-1"
                                  title={it.title}
                                >
                                  {i + 1}. {it.title}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 w-full max-w-3xl mt-6">
                  {[
                    ['🎨 多模态生成', '文生图 / 文生视频'],
                    ['🔥 热点结合', '借势做内容'],
                    ['📡 渠道推送', '微信 / 飞书群'],
                    ['🧠 长期记忆', '越用越懂你'],
                  ].map(([t, d], i) => (
                    <div key={i} className="rounded-xl bg-white/[0.02] border border-white/[0.06] px-3 py-2.5">
                      <p className="text-[11px] text-gray-200 font-medium">{t}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{d}</p>
                    </div>
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
                      {renderTaskCard(msg.content)}
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
