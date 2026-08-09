'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useAuth } from '@/app/providers'
import VoiceOrb from '@/components/VoiceOrb'

// 3D 地球（three.js 纯客户端组件，禁用 SSR 避免服务端预渲染时 require('three') 失败）
const GlobeTrends = dynamic(() => import('@/components/GlobeTrends'), { ssr: false })

// 阶段三：用户关注度埋点（localStorage 轻量实现，按收看/点击习惯累积权重，驱动热点排序）
const ATT_KEY = 'agent_attention'
function readAttention(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(ATT_KEY) || '{}') } catch { return {} }
}
function trackAttention(source: string) {
  if (typeof window === 'undefined' || !source) return
  try {
    const a = readAttention()
    a[source] = (a[source] || 0) + 1
    localStorage.setItem(ATT_KEY, JSON.stringify(a))
  } catch { /* 忽略 */ }
}

// 平台热榜卡片（仿白龙马 .hs-panel：标题行 + 排行列表）
function HotListCard({ source, items, accent, onPick, collapsed, onToggle }: {
  source: string
  items: { title: string; hot?: string; url?: string }[]
  accent: string
  onPick?: (title: string) => void
  collapsed?: boolean
  onToggle?: () => void
}) {
  const rankColor = (i: number) => (i === 0 ? '#ff4444' : i === 1 ? '#ff8800' : i === 2 ? '#ffcc00' : '#6b7180')
  return (
    <div className="flex flex-col min-h-0 bg-[#0c1119]/60 border-b border-white/[0.05]">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 px-2.5 py-2 border-b border-white/[0.05] hover:bg-white/[0.04] transition text-left w-full"
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
        <span className="text-[11px] font-semibold text-[#e6eaf2] truncate">{source}</span>
        <span className="text-[9px] text-[#5a6072] ml-auto shrink-0">{items.length} 条</span>
        {onToggle && <span className={`text-[9px] text-[#6b7180] transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>}
      </button>
      {!collapsed && (
        <ul className="flex-1 min-h-0 overflow-y-auto list-none m-0 p-0">
          {items.slice(0, 10).map((it, i) => (
            <li key={i}>
              <button
                onClick={() => onPick?.(it.title)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1 text-left hover:bg-white/[0.05] transition"
                title={it.title}
              >
                <span className="font-bold text-[11px] w-4 text-center shrink-0" style={{ color: rankColor(i) }}>{i + 1}</span>
                <span className="flex-1 min-w-0 text-[11px] text-[#aab2c2] truncate">{it.title}</span>
                {it.hot && <span className="text-[9px] text-[#5a6072] shrink-0">{it.hot}</span>}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="text-[10px] text-[#5a6072] text-center py-3">暂无数据</li>}
        </ul>
      )}
    </div>
  )
}

// 实时事件流卡片（复刻 BaiLongma hs-feed-bar：横向滚动卡片轮播）
function FeedBar({ items, onPlay, onPick }: {
  items: { id: string; source: string; region: 'cn' | 'global'; title: string; hot?: string; url?: string }[]
  onPlay?: (url: string, title: string) => void
  onPick?: (item: { source: string; title: string }) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="shrink-0 h-[58px] flex items-center gap-2 border-t border-white/[0.07] bg-[#070d18] px-3 overflow-hidden">
      <span className="shrink-0 text-[9px] font-bold text-[#4f8cff] flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[#4f8cff] animate-pulse" />实时事件流
      </span>
      <div className="flex-1 overflow-x-auto flex items-center gap-2 scrollbar-thin">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => onPick?.(it)}
            className="shrink-0 group flex items-center gap-2 max-w-[260px] px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.06] transition cursor-pointer"
            title={`${it.source} · ${it.title}`}
          >
            <span className={`shrink-0 text-[8px] px-1 py-0.5 rounded ${it.region === 'global' ? 'bg-[#1e3a5f] text-[#7db4ff]' : 'bg-[#14361f] text-[#5fd99a]'}`}>{it.source}</span>
            <span className="text-[10px] text-[#cdd3e0] truncate">{it.title}</span>
            {it.hot && <span className="shrink-0 text-[8px] text-[#6b7180]">{it.hot}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// 视频事件流（2026-08-08：通栏横向视频卡片，点击播放；白龙马 feed-bar 样式，固定高度不溢出）
function VideoFeedBar({ videos, onPlay }: {
  videos: { platform: string; title: string; url: string; thumbnail?: string }[]
  onPlay: (url: string, title: string) => void
}) {
  if (videos.length === 0) return null
  return (
    <div className="shrink-0 h-[64px] flex items-center gap-2 border-t border-white/[0.07] bg-[#070d18] px-3 overflow-hidden">
      <span className="shrink-0 text-[9px] font-bold text-[#ff6b4f] flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[#ff6b4f] animate-pulse" />视频精选
      </span>
      <div className="flex-1 overflow-x-auto flex items-center gap-2 scrollbar-thin">
        {videos.map((v, i) => (
          <button key={i} onClick={() => onPlay(v.url, v.title)}
            className="shrink-0 flex items-center gap-2 px-2 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.06] transition cursor-pointer max-w-[300px]"
            title={v.title}>
            {v.thumbnail && <img src={v.thumbnail} className="w-10 h-6 rounded object-cover shrink-0" alt="" loading="lazy" />}
            <span className="text-[8.5px] px-1 py-0.5 rounded bg-[#2a1a2e] text-[#ff9f7a] shrink-0">{v.platform}</span>
            <span className="text-[10px] text-[#cdd3e0] truncate">{v.title}</span>
            <span className="text-[8px] text-[#6b7180] shrink-0">▶</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// 全局视频播放器（路线1·真播放：复刻 BaiLongma video-surface，支持 B站/YouTube/直链 iframe 真播放）
// URL 归一：B站/youtube 链接转可嵌入 iframe；直链 .mp4/.webm 用 <video>；其余走 iframe 尝试。
function iframeUrlFor(raw: string): { kind: 'iframe' | 'video'; url: string } {
  if (!raw) return { kind: 'iframe', url: '' }
  let u = raw.trim()
  const lower = u.toLowerCase()
  // 直链视频文件 → <video>
  if (/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(lower) || u.startsWith('blob:') || u.startsWith('data:video')) {
    return { kind: 'video', url: u }
  }
  try {
    const url = new URL(u.startsWith('http') ? u : `https://${u}`)
    const h = url.hostname.replace(/^www\./, '')
    // Bilibili
    if (h.includes('bilibili.com') || h.includes('b23.tv') || h.includes('biliintl')) {
      const bv = url.pathname.match(/\/(BV[0-9A-Za-z]+)/)
      const av = url.pathname.match(/\/av(\d+)/)
      const ep = url.pathname.match(/\/ep(\d+)/)
      const ss = url.pathname.match(/\/ss(\d+)/)
      const id = bv?.[1] || av?.[1] ? (bv ? `bv=${bv[1]}` : `aid=${av?.[1]}`) : ep?.[1] ? `ep_id=${ep[1]}` : ss?.[1] ? `season_id=${ss[1]}` : ''
      return { kind: 'iframe', url: id ? `https://player.bilibili.com/player.html?${id}&autoplay=1&high_quality=1&danmaku=0` : url.href }
    }
    // YouTube
    if (h.includes('youtube.com') || h.includes('youtu.be')) {
      let id = ''
      if (h.includes('youtu.be')) id = url.pathname.slice(1)
      else id = url.searchParams.get('v') || (url.pathname.includes('/embed/') ? url.pathname.split('/embed/')[1] : '')
      return { kind: 'iframe', url: id ? `https://www.youtube.com/embed/${id}?autoplay=1` : url.href }
    }
    // 已是 embed/player 直链
    if (h.includes('player.') || url.pathname.includes('/embed/')) return { kind: 'iframe', url: url.href }
    // 兜底：原样走 iframe（部分站点允许 X-Frame-Options）
    return { kind: 'iframe', url: url.href }
  } catch {
    return { kind: 'iframe', url: raw }
  }
}

function VideoPlayer({ state, onClose }: {
  state: { open: boolean; url: string; title: string }
  onClose: () => void
}) {
  if (!state.open) return null
  const { kind, url } = iframeUrlFor(state.url)
  return (
    // 不遮挡主对话：浮层仅覆盖中部预览区，AI 始终在场（参考 BaiLongma video-mode 不隐藏对话）
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-md" onClick={onClose}>
      <div
        className="relative w-[min(92vw,920px)] bg-[#060a12] rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/[0.03]">
          <span className="text-[12px] text-gray-200 truncate max-w-[80%]">{state.title || '视频播放'}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-base leading-none px-2 py-0.5 rounded hover:bg-white/10">✕</button>
        </div>
        <div className="relative w-full bg-black" style={{ aspectRatio: '16 / 9' }}>
          {kind === 'video' ? (
            <video src={url} controls autoPlay className="absolute inset-0 w-full h-full bg-black" />
          ) : (
            <iframe
              src={url}
              title={state.title || 'video'}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              className="absolute inset-0 w-full h-full border-0"
            />
          )}
        </div>
        <p className="px-4 py-2 text-[10px] text-gray-500">AI 助手仍在场，可继续对话让它换源或搜索其它视频。</p>
      </div>
    </div>
  )
}

// 声纹球状态（融合 BaiLongma 语音环观感）
type OrbState = 'idle' | 'listening' | 'recognizing' | 'speaking' | 'thinking'

// ===== 阶段一·语音环（融合 BaiLongma 声纹语音能力，复用火山 TTS + 本地 FunASR）=====
// 视频嵌入解析（2026-08-07）：B站/油管 → iframe 播放器；其他 → 本地 video
function embedVideoUrl(u: string): { kind: 'bili' | 'yt' | 'video'; src: string } {
  if (!u) return { kind: 'video', src: u }
  const bi = u.indexOf('bilibili.com/video/')
  if (bi !== -1) {
    const rest = u.slice(bi + 18)
    const bv = rest.split(/[?/#]/)[0]
    if (bv.startsWith('BV')) {
      return { kind: 'bili', src: 'https://player.bilibili.com/player.html?bvid=' + bv + '&page=1&high_quality=1&autoplay=0' }
    }
  }
  const yi = u.indexOf('youtu')
  if (yi !== -1) {
    const rest = u.slice(yi)
    let id = ''
    if (rest.indexOf('watch?v=') !== -1) id = rest.slice(rest.indexOf('watch?v=') + 8)
    else if (rest.startsWith('youtu.be/')) id = rest.slice(9)
    id = id.split(/[?&#]/)[0]
    if (id.length === 11) return { kind: 'yt', src: 'https://www.youtube.com/embed/' + id }
  }
  return { kind: 'video', src: u }
}

function useAgentVoice(onVolume?: (v: number) => void) {
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

  const speak = async (text: string, voice?: string): Promise<void> => {
    if (!text) return
    try {
      const res = await fetch('/api/agent/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      })
      const data = await res.json()
      if (data.success && data.audioBase64) {
        const url = `data:${data.mime};base64,${data.audioBase64}`
        await new Promise<void>((resolve) => {
          const audio = new Audio(url)
          audioRef.current = audio
          // 2026-08-07：WebAudio 实时分析播放音量 → 驱动声纹球波动（朗读时球也有声纹）
          let volClean: (() => void) | null = null
          try {
            const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
            const actx = new Ctx()
            const src = actx.createMediaElementSource(audio)
            const analyser = actx.createAnalyser()
            analyser.fftSize = 256
            src.connect(analyser); analyser.connect(actx.destination)
            const abuf = new Uint8Array(analyser.frequencyBinCount)
            let rafId = 0
            const tick = () => {
              analyser.getByteTimeDomainData(abuf)
              let sum = 0
              for (let i = 0; i < abuf.length; i++) { const v = (abuf[i] - 128) / 128; sum += v * v }
              onVolume?.(Math.min(1, Math.sqrt(sum / abuf.length) * 3))
              rafId = requestAnimationFrame(tick)
            }
            rafId = requestAnimationFrame(tick)
            volClean = () => { cancelAnimationFrame(rafId); try { actx.close() } catch {} }
          } catch {}
          audio.onended = () => { volClean?.(); onVolume?.(0); blip(440, 0.1); resolve() }
          audio.onerror = () => { volClean?.(); onVolume?.(0); resolve() }
          audio.play().catch(() => {
            // 自动播放可能被策略拦截：解除静音重试一次（Electron 已放行，浏览器需点过页面）
            try { audio.muted = false } catch {}
            audio.play().catch(() => { volClean?.(); onVolume?.(0); resolve() })
          })
        })
      }
    } catch {}
  }

  const stop = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      onVolume?.(0)
      // 打断：主动触发 onended，让 speak() 的 Promise 正常收尾（否则悬挂）
      audioRef.current.onended?.()
      audioRef.current = null
    }
  }

  return { speak, stop, blip }
}

interface SceneCard {
  type: string
  title?: string
  desc?: string
  url?: string
  fields?: { label: string; value: string }[]
  options?: string[]
  actions?: { label: string; href?: string }[]
  // 阶段1 Scene 扩展（对齐 BaiLongma 场景化卡片）
  video?: { url: string; poster?: string }     // video 卡片
  confirm?: { label: string; prompt?: string } // confirm 卡片（点击确认回传 prompt）
  link?: { url: string }                        // link 卡片（外链，系统浏览器打开）
  task?: { status: string; progress?: number } // task 卡片（任务状态/进度）
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
  '查一下海外 YouTube 上最近什么最火',
]

// 斜杠命令（BaiLongma slash-menu）：输入 / 唤起，命令式触发，替代堆按钮
const SLASH_COMMANDS: { cmd: string; desc: string; fill: string }[] = [
  { cmd: '/热点', desc: '呼出热点大屏', fill: '打开热点大屏' },
  { cmd: '/选题', desc: '结合今日热点出 3 个选题', fill: '今天有什么热点可以蹭？给我 3 个选题' },
  { cmd: '/生图', desc: '文生图', fill: '帮我生成一张图片：' },
  { cmd: '/生视频', desc: '文生视频', fill: '帮我生成一段视频：' },
  { cmd: '/文案', desc: '写一条种草文案', fill: '帮我写一条小红书种草文案，主题是：' },
  { cmd: '/口播', desc: '数字人口播', fill: '用这张图做个数字人口播，台词是：' },
  { cmd: '/成片', desc: '文案一键成片', fill: '把这段文案一键成片：' },
  { cmd: '/素材', desc: '检索素材库', fill: '帮我在素材库里找：' },
  { cmd: '/发布', desc: '发布到平台', fill: '帮我把这条内容发到抖音' },
  { cmd: '/记忆', desc: '查看长期记忆', fill: '看看你都记住了我哪些偏好' },
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
  collect_unmet_need: '登记未接入需求',
  clear_memory: '清空旧画像',
  set_agent_profile: '设定助手人设',
  search_trends: '搜索全球热点',
}

export default function AgentPage() {
  const { user, logout } = useAuth()
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<number | null>(null)
  // 首次登录对话式 onboarding（纯对话、无按钮/标签，区别于被回退的 ada9740 按钮条）
  const [onboarded, setOnboarded] = useState(false)
  const [onboarding, setOnboarding] = useState(false)
  // 欢迎词单独存放，不进 messages，避免顶掉 BaiLongma 风格的主页欢迎区（声纹球+卡片）
  const [welcomeMsg, setWelcomeMsg] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [showStorage, setShowStorage] = useState(false)
  const [storageItems, setStorageItems] = useState<any[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [lastPoints, setLastPoints] = useState<number | null>(null)
  // 助手人设名字（来自记忆中的 agent_profile，白龙马式自定义名）
  const [agentName, setAgentName] = useState('AI 助手')
  const [showNameEdit, setShowNameEdit] = useState(false)
  const [nameInput, setNameInput] = useState('')
  // ⚙️ AI 设置（2026-08-07：音色/温度/语音灵敏度）
  const [showPrefs, setShowPrefs] = useState(false)
  const [ttsVoice, setTtsVoice] = useState('longxiaochun')
  const [temperature, setTemperature] = useState(0.7)
  const [vadThreshold, setVadThreshold] = useState(0.045)
  const [vadSilence, setVadSilence] = useState(1800)
  const [ttsVoices, setTtsVoices] = useState<{ id: string; label: string }[]>([])
  // ── 自检 + 左侧信息面板（2026-08-08：账号/订阅/点数/模型/记忆 + A+B 自检）──
  const [selfChecks, setSelfChecks] = useState<{ key: string; label: string; ok: boolean; detail?: string }[]>([])
  const [selfModel, setSelfModel] = useState<{ brain: string; asr: string; tts: string } | null>(null)
  const [selfChecking, setSelfChecking] = useState(false)
  const [showSelfCheck, setShowSelfCheck] = useState(false)
  const [sessionStart] = useState(Date.now())
  const [sessionReqs, setSessionReqs] = useState(0)
  const runSelfCheck = async (silent = true) => {
    setSelfChecking(true)
    try {
      const r = await fetch('/api/agent/selfcheck', { credentials: 'include' })
      const d = await r.json()
      if (d.success && d.data) {
        setSelfChecks(d.data.checks || [])
        setSelfModel(d.data.model || null)
      }
    } catch {}
    setSelfChecking(false)
    if (!silent) setShowSelfCheck(true)
  }
  useEffect(() => {
    if (!user) return
    // 启动自动静默自检；首次（本机）自动弹窗
    runSelfCheck(true)
    const first = typeof localStorage !== 'undefined' && !localStorage.getItem('agent_selfcheck_done')
    if (first && typeof localStorage !== 'undefined') localStorage.setItem('agent_selfcheck_done', '1')
    if (first) setTimeout(() => setShowSelfCheck(true), 2500)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])
  const roleLabel = user?.role === 'admin' ? '超级管理' : user?.role === 'editor' ? '代理' : '普通用户'
  const roleColor = user?.role === 'admin' ? 'bg-red-500/20 text-red-300 border-red-500/30'
    : user?.role === 'editor' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
  const allOk = selfChecks.length > 0 && selfChecks.every(ch => ch.ok)
  const failCount = selfChecks.filter(ch => !ch.ok).length
  const [savingPrefs, setSavingPrefs] = useState(false)
  // 加载自定义名称（2026-08-07：User.agentName > SystemConfig.agent_name > 默认）
  useEffect(() => {
    if (!user) return
    fetch('/api/agent/name', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.success && d.data?.name) setAgentName(d.data.name) })
      .catch(() => {})
  }, [user])
  // 加载 AI 设置（音色/温度/VAD）
  useEffect(() => {
    if (!user) return
    fetch('/api/agent/prefs', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setTtsVoice(d.data.ttsVoice || 'longxiaochun')
          setTemperature(d.data.temperature ?? 0.7)
          setVadThreshold(d.data.vadThreshold ?? 0.045)
          setVadSilence(d.data.vadSilence ?? 1800)
          if (d.data.voices?.length) setTtsVoices(d.data.voices)
        }
      })
      .catch(() => {})
  }, [user])
  // 保存设置
  const savePrefs = async () => {
    setSavingPrefs(true)
    try {
      await fetch('/api/agent/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ttsVoice, temperature, vadThreshold, vadSilence }), credentials: 'include' })
    } catch {}
    setSavingPrefs(false)
    setShowPrefs(false)
    setRecordingTip('设置已保存')
  }
  // 试听音色
  const testVoice = async (voice: string) => {
    setRecordingTip('试听中…')
    try {
      const r = await fetch('/api/agent/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '你好，我是你的 AI 运营助手，这是 ' + (ttsVoices.find(v => v.id === voice)?.label || voice) + ' 的声音。', voice }) })
      const d = await r.json()
      if (d.success && d.audioBase64) {
        const a = new Audio('data:' + (d.mime || 'audio/mpeg') + ';base64,' + d.audioBase64)
        a.play().catch(() => setRecordingTip('试听被浏览器拦截，请点一下页面再试'))
      } else setRecordingTip('试听失败：' + (d.message || 'TTS 未配置'))
    } catch (e: any) { setRecordingTip('试听出错：' + (e?.message || e)) }
  }
  // 保存名称
  const saveAgentName = async () => {
    const n = nameInput.trim()
    if (!n) return
    const r = await fetch('/api/agent/name', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }), credentials: 'include' })
    const d = await r.json()
    if (d.success) { setAgentName(n); setShowNameEdit(false) }
  }

  // 右侧常驻思考步骤流
  const [liveSteps, setLiveSteps] = useState<{ tool: string; label: string }[]>([])
  // 语音实时识别中间文本
  const [interimText, setInterimText] = useState('')
  // 今日热点（融合 BaiLongma 热点推荐：真实热榜注入主页 + 对话上下文）
  const [hotTopics, setHotTopics] = useState<{ source: string; region: 'cn' | 'global'; items: { title: string; hot?: string; url?: string }[] }[]>([])
  // 大屏视频推荐 + 发布统计（2026-08-08）
  const [trendVideos, setTrendVideos] = useState<{ platform: string; title: string; url: string; thumbnail?: string; duration?: string }[]>([])
  const [publishStats, setPublishStats] = useState<{ platform: string; count: number }[]>([])
  const loadTrendVideos = async () => {
    try {
      const r = await fetch('/api/agent/trend-videos', { credentials: 'include' })
      const d = await r.json()
      if (d.success && d.data?.videos) setTrendVideos(d.data.videos)
    } catch {}
  }
  const loadPublishStats = async () => {
    try {
      const r = await fetch('/api/agent/publish-stats', { credentials: 'include' })
      const d = await r.json()
      if (d.success && Array.isArray(d.data)) setPublishStats(d.data)
    } catch {}
  }
  const [hotLoading, setHotLoading] = useState(false)
  // 热点大屏（融合 BaiLongma hotspot-mode 全屏互斥布局：呼出时对话框右移收窄）
  const [hotspotOpen, setHotspotOpen] = useState(false)
  useEffect(() => { if (hotspotOpen) { loadTrendVideos(); loadPublishStats() } }, [hotspotOpen])
  // 热点大屏手风琴：左右柱各仅头部 1 个固定展开，其余折叠互斥（key=source）
  const [leftExpanded, setLeftExpanded] = useState<string | null>(null)
  const [rightExpanded, setRightExpanded] = useState<string | null>(null)
  useEffect(() => {
    document.body.classList.toggle('hotspot-mode', hotspotOpen)
    return () => { document.body.classList.remove('hotspot-mode') }
  }, [hotspotOpen])

  // 通用应用大屏（2026-08-05：一键成片/指纹浏览器等 iframe 应用，AI 对话栏右 1/3 常驻；紧凑模式右下角小窗）
  const [activeApp, setActiveApp] = useState<{ path: string; title: string } | null>(null)
  const [appCompact, setAppCompact] = useState(false)
  useEffect(() => {
    const m = !!activeApp
    document.body.classList.toggle('app-mode', m)
    document.body.classList.toggle('app-compact', m && appCompact)
    return () => { document.body.classList.remove('app-mode', 'app-compact') }
  }, [activeApp, appCompact])
  const closeApp = () => { setActiveApp(null); setAppCompact(false) }

  // 应用清单（白龙马式快捷入口，AI 全程在场）
  // 应用卡片（2026-08-08：按角色过滤 + 颜色区分 + 文字宽度自适应 + 错落排列）
  const APPS = [
    // 全员可见（营销核心工具）
    { path: '/auto-compile', title: '一键成片', color: 'emerald', roles: ['admin', 'editor', 'end-user'] },
    { path: '/text-to-video', title: '文生视频', color: 'cyan', roles: ['admin', 'editor', 'end-user'] },
    { path: '/ai-copy', title: 'AI 文案', color: 'amber', roles: ['admin', 'editor', 'end-user'] },
    { path: '/image-generator', title: 'AI 生图', color: 'violet', roles: ['admin', 'editor', 'end-user'] },
    { path: '/storage', title: '素材库', color: 'sky', roles: ['admin', 'editor', 'end-user'] },
    // 代理+管理可见
    { path: '/dashboard', title: '数据看板', color: 'rose', roles: ['admin', 'editor'] },
    { path: '/lead-collector', title: '意向采集', color: 'orange', roles: ['admin', 'editor'] },
    // 仅 admin（管理/自动化）
    { path: '/my-fingerprint', title: '指纹浏览器', color: 'pink', roles: ['admin'] },
    { path: '/admin', title: '管理后台', color: 'red', roles: ['admin'] },
    { path: '/data-center', title: '数据中台', color: 'teal', roles: ['admin'] },
    { path: '/live', title: '直播引擎', color: 'fuchsia', roles: ['admin'] },
    { path: '/trendvideo', title: '趋势猎手', color: 'lime', roles: ['admin', 'editor'] },
  ]
  const APP_COLORS: Record<string, { border: string; text: string; bg: string }> = {
    emerald: { border: 'border-emerald-400/40', text: 'text-emerald-300', bg: 'bg-emerald-500/[0.06]' },
    cyan:    { border: 'border-cyan-400/40', text: 'text-cyan-300', bg: 'bg-cyan-500/[0.06]' },
    amber:   { border: 'border-amber-400/40', text: 'text-amber-300', bg: 'bg-amber-500/[0.06]' },
    violet:  { border: 'border-violet-400/40', text: 'text-violet-300', bg: 'bg-violet-500/[0.06]' },
    sky:     { border: 'border-sky-400/40', text: 'text-sky-300', bg: 'bg-sky-500/[0.06]' },
    rose:    { border: 'border-rose-400/40', text: 'text-rose-300', bg: 'bg-rose-500/[0.06]' },
    orange:  { border: 'border-orange-400/40', text: 'text-orange-300', bg: 'bg-orange-500/[0.06]' },
    pink:    { border: 'border-pink-400/40', text: 'text-pink-300', bg: 'bg-pink-500/[0.06]' },
    red:     { border: 'border-red-400/40', text: 'text-red-300', bg: 'bg-red-500/[0.06]' },
    teal:    { border: 'border-teal-400/40', text: 'text-teal-300', bg: 'bg-teal-500/[0.06]' },
    fuchsia: { border: 'border-fuchsia-400/40', text: 'text-fuchsia-300', bg: 'bg-fuchsia-500/[0.06]' },
    lime:    { border: 'border-lime-400/40', text: 'text-lime-300', bg: 'bg-lime-500/[0.06]' },
  }
  const visibleApps = APPS.filter(a => a.roles.includes(user?.role || 'end-user'))
  const openApp = (path: string) => {
    setAppCompact(false)
    setActiveApp({ title: (APPS.find(a => a.path === path)?.title || '应用'), path })
    setHotspotOpen(false)
  }

  // 客户端（Electron）每日首启询问是否进入热点大屏（Web 端不弹）
  const [showHotspotPrompt, setShowHotspotPrompt] = useState(false)
  useEffect(() => {
    const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)
    if (!isElectron) return
    const today = new Date().toISOString().slice(0, 10)
    const last = typeof localStorage !== 'undefined' ? localStorage.getItem('hotspot_prompt_date') : today
    if (last !== today) setShowHotspotPrompt(true)
  }, [])
  const answerHotspotPrompt = (enter: boolean) => {
    const today = new Date().toISOString().slice(0, 10)
    if (typeof localStorage !== 'undefined') localStorage.setItem('hotspot_prompt_date', today)
    setShowHotspotPrompt(false)
    if (enter) { if (hotTopics.length === 0) loadHotTopics(); setHotspotOpen(true) }
  }

  // ===== 阶段一·语音环状态 =====
  const [showBrain, setShowBrain] = useState(false)
  const [brainMemories, setBrainMemories] = useState<{ content: string; tags: string; salience: number }[]>([])

  // 媒体舞台（阶段1：音乐库 + AI 生成记录，对齐 BaiLongma media-stage）
  const [mediaOpen, setMediaOpen] = useState(false)
  const [mediaData, setMediaData] = useState<{ bgm: { id: number; title: string; mood: string; url: string }[]; records: { id: number; type: string; url: string; prompt: string; createdAt: string }[] } | null>(null)
  const [mediaLoading, setMediaLoading] = useState(false)
  const [mediaPlayingId, setMediaPlayingId] = useState<number | null>(null)
  const mediaAudioRef = useRef<HTMLAudioElement | null>(null)

  const loadMedia = async () => {
    setMediaLoading(true)
    try {
      const r = await fetch('/api/agent/media', { credentials: 'include' })
      const d = await r.json()
      if (d.success) setMediaData(d.data)
    } catch {} finally { setMediaLoading(false) }
  }
  const toggleMedia = () => {
    const next = !mediaOpen
    setMediaOpen(next)
    if (next && !mediaData) loadMedia()
  }
  const toggleBgm = (b: { id: number; title: string; mood: string; url: string }) => {
    if (mediaPlayingId === b.id) {
      mediaAudioRef.current?.pause()
      mediaAudioRef.current = null
      setMediaPlayingId(null)
      return
    }
    if (mediaAudioRef.current) mediaAudioRef.current.pause()
    const audio = new Audio(b.url)
    mediaAudioRef.current = audio
    audio.onended = () => setMediaPlayingId(null)
    audio.play().catch(() => setMediaPlayingId(null))
    setMediaPlayingId(b.id)
  }

  // 文档面板（阶段1：智能体知识库/训练文档，对齐 BaiLongma 文档面板）
  const [docsOpen, setDocsOpen] = useState(false)
  const [agents, setAgents] = useState<{ id: number; name: string; replyStyle?: string; welcomeMessage?: string; trainingDocuments: { id: number; title: string }[] }[]>([])

  const loadDocs = async () => {
    try {
      const r = await fetch('/api/ai-agent', { credentials: 'include' })
      const d = await r.json()
      if (d.success) setAgents(d.data || [])
    } catch {}
  }
  const toggleDocs = () => {
    const next = !docsOpen
    setDocsOpen(next)
    if (next && agents.length === 0) loadDocs()
  }

  // 终端流（阶段1：实时请求/执行日志，对齐 BaiLongma terminal-stream）
  const [termOpen, setTermOpen] = useState(false)
  const [termLines, setTermLines] = useState<{ t: string; msg: string; level: 'info' | 'ok' | 'err' }[]>([])
  const pushTerm = (msg: string, level: 'info' | 'ok' | 'err' = 'info') => {
    setTermLines(prev => [...prev.slice(-59), { t: new Date().toLocaleTimeString('zh-CN', { hour12: false }), msg, level }])
  }

  // 主动推送建议（阶段2：Tick 简化版 —— 登录后 8s + 每 10 分钟拉一次服务器建议）
  const [suggestions, setSuggestions] = useState<{ type: string; title: string; desc: string; prompt: string }[]>([])
  const [suggClosed, setSuggClosed] = useState<string[]>([])

  const loadSuggestions = async () => {
    try {
      const r = await fetch('/api/agent/suggestions', { credentials: 'include' })
      const d = await r.json()
      if (d.success && d.data?.length) {
        setSuggestions(d.data.filter((s: any) => !suggClosed.includes(s.prompt)))
      }
    } catch {}
  }
  useEffect(() => {
    if (!user) return
    const first = setTimeout(() => loadSuggestions(), 8000)
    const timer = setInterval(() => loadSuggestions(), 10 * 60 * 1000)
    return () => { clearTimeout(first); clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, suggClosed.length])
  const [isRecording, setIsRecording] = useState(false)
  const [dialogMode, setDialogMode] = useState(false) // 白龙马式语音对话循环：说→答→自动再听
  const [recordingTip, setRecordingTip] = useState('')
  const [orbState, setOrbState] = useState<OrbState>('idle')
  const orbStateRef = useRef(orbState)
  orbStateRef.current = orbState
  const [micVolume, setMicVolume] = useState(0)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<BlobPart[]>([])
  const recStartTsRef = useRef<number>(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  // 讯飞 RTASR 流式（2026-08-07）
  const xfWsRef = useRef<WebSocket | null>(null)
  const xfCtxRef = useRef<AudioContext | null>(null)
  const xfProcRef = useRef<ScriptProcessorNode | null>(null)
  const idleTimerRef = useRef<any>(null)
  const lastResultTsRef = useRef(0)
  const [streamText, setStreamText] = useState('')
  const streamTextRef = useRef('')
  const cleanupXf = () => {
    if (idleTimerRef.current) { clearInterval(idleTimerRef.current); idleTimerRef.current = null }
    try { xfProcRef.current?.disconnect() } catch {}
    try { xfCtxRef.current?.close() } catch {}
    try { xfWsRef.current?.close() } catch {}
    try { mediaStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
    xfProcRef.current = null; xfCtxRef.current = null; xfWsRef.current = null
  }
  const analyserRef = useRef<AnalyserNode | null>(null)
  const volRafRef = useRef<number>(0)
  // ── C1 连续聆听（2026-08-05：常开监听 + VAD 自动断句 + barge-in 打断，参考白龙马 voice-continuous）──
  const contStreamRef = useRef<MediaStream | null>(null)
  const contRecorderRef = useRef<MediaRecorder | null>(null)
  const contChunksRef = useRef<BlobPart[]>([])
  const contRafRef = useRef<number>(0)
  const vadRef = useRef<{ state: 'silent' | 'speech'; lastVoiceTs: number; loudFrames: number }>({ state: 'silent', lastVoiceTs: 0, loudFrames: 0 })
  const VAD_SILENCE_MS = 2000   // 静音 2s → 自动断句发送
  const BARGEIN_TH = 0.06       // TTS 播放时认为用户插话的音量
  const BARGEIN_FRAMES = 3      // 连续 3 帧高音量才算打断（防噪音误触）
  const [ttsVolume, setTtsVolume] = useState(0)
  const voice = useAgentVoice((v) => setTtsVolume(v))

  // ===== AI 当前活动指示器（BaiLongma ai-activity）：纯派生，不逼 AI 自述 =====
  const aiBusy = loading || orbState === 'listening' || orbState === 'recognizing' || orbState === 'thinking' || orbState === 'speaking'
  const aiActivity = (() => {
    if (orbState === 'listening') return { label: '聆听中', detail: streamText || interimText || '正在接收语音…' }
    if (orbState === 'recognizing') return { label: '识别中', detail: '语音转文字' }
    if (loading || orbState === 'thinking') {
      const last = liveSteps[liveSteps.length - 1]
      return { label: '执行中', detail: last ? (TOOL_STEP_LABEL[last.tool] || last.label) : '拆解需求 · 规划链路' }
    }
    if (orbState === 'speaking') return { label: '回复中', detail: '语音播报' }
    return { label: '空闲', detail: '等待指令' }
  })()

  // ===== 全局视频播放器（阶段二：对话/语音"找视频"统一在此播放）=====
  const [player, setPlayer] = useState<{ open: boolean; url: string; title: string }>({ open: false, url: '', title: '' })
  const handlePlayVideo = (url: string, title = '') => {
    if (!url) return
    setPlayer({ open: true, url, title })
  }
  // 对话/语音命中"找视频"类意图时，由外部调用（search_video 工具结果经消息渲染触发）
  const openVideoFromUrl = (url: string, title = '') => handlePlayVideo(url, title)

  // 共用语音识别处理（C1：点按模式 onstop 与连续聆听断句共用）
  const handleRecordingBlob = async (blob: Blob, opts?: { continuous?: boolean }) => {
    setOrbState('recognizing')
    if (recStartTsRef.current && Date.now() - recStartTsRef.current < 700) { if (!opts?.continuous) setRecordingTip('说久一点，至少 1 秒'); setOrbState('idle'); return }
    if (blob.size < 1500) {
      if (!opts?.continuous) setRecordingTip('没听到声音')
      setOrbState('idle')
      return
    }
    setRecordingTip('识别中…')
    let asrTimer: any = null
    try {
      const fd = new FormData()
      fd.append('audio', blob, 'rec.webm')
      const ac = new AbortController()
      asrTimer = setTimeout(() => ac.abort(), 45000)
      const r = await fetch('/api/agent/asr', { method: 'POST', body: fd, credentials: 'include', signal: ac.signal })
      const d = await r.json()
      if (d.success && d.text) {
        const t = String(d.text).replace(/[\s。，,.！!？?]/g, '')
        if (/(打开|呼出|看看|来个|显示|调出).*(热点大屏|热点|大屏)/.test(t)) {
          if (hotTopics.length === 0) loadHotTopics()
          if (activeApp) closeApp()
          setHotspotOpen(true)
          setRecordingTip('已为你呼出热点大屏')
        } else if (/(关闭|收起|退出).*(热点大屏|热点|大屏)/.test(t)) {
          setHotspotOpen(false)
          setRecordingTip('已收起热点大屏')
        } else if (/(关闭|收起|退出).*(应用|页面|这个|工具)/.test(t) && activeApp) {
          closeApp()
          setRecordingTip('已关闭「' + activeApp.title + '」')
        } else {
          setRecordingTip('识别到：' + d.text)
          setInterimText(d.text)
          sendMessage(d.text)
        }
      } else {
        setRecordingTip(d.text ? '' : '没听清，请再说一次（或检查麦克风）')
        if (d.text) setRecordingTip('识别失败：' + (d.message || ''))
      }
    } catch (e: any) {
      setRecordingTip(e?.name === 'AbortError' ? '识别超时（首次加载模型较慢），请再试一次' : '识别出错：' + (e?.message || e))
    } finally {
      if (asrTimer) clearTimeout(asrTimer)
    }
    setInterimText('')
    if (!opts?.continuous) {
      setIsRecording(false)
      setOrbState('idle')
      setTimeout(() => setRecordingTip(''), 2500)
    } else {
      setOrbState('idle')
    }
  }


  // ── 语音对话循环（2026-08-07 白龙马式）：说→AI 答→自动朗读→自动再听，可插话 ──
  const startVoiceListen = async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setRecordingTip('当前环境不支持语音'); return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      await fetch('/api/agent/asr-config', { credentials: 'include' }).catch(() => {})
      const ws = new WebSocket('ws://127.0.0.1:8766')
      xfWsRef.current = ws
      setOrbState('listening'); setIsRecording(true)
      setRecordingTip('🎤 我在听，直接说'); setStreamText(''); streamTextRef.current = ''
      let echoFloor = 0, echoCount = 0, loud = 0
      ws.onopen = () => {
        try {
          const AC = (window as any).AudioContext || (window as any).webkitAudioContext
          const ctx = new AC({ sampleRate: 16000 })
          xfCtxRef.current = ctx
          const src = ctx.createMediaStreamSource(stream)
          const proc = ctx.createScriptProcessor(4096, 1, 1)
          xfProcRef.current = proc
          proc.onaudioprocess = (e) => {
            const data = e.inputBuffer.getChannelData(0)
            let rms = 0
            for (let i = 0; i < data.length; i += 64) { const v = data[i]; rms += v * v }
            rms = Math.sqrt(rms / (data.length / 64))
            setMicVolume(Math.min(1, rms * 4))
            const st = orbStateRef.current
            if (st === 'speaking') {
              // 朗读中：测回声基线 + 检测插话，不发送音频（防回音被识别）
              if (echoCount < 10) { echoFloor = (echoFloor * echoCount + rms) / (echoCount + 1); echoCount++ }
              if (rms > echoFloor + vadThreshold) { loud++; if (loud >= 3) { loud = 0; try { voice.stop() } catch {}; setOrbState('listening'); echoFloor = 0; echoCount = 0 } }
              else loud = 0
              return
            }
            echoFloor = 0; echoCount = 0; loud = 0
            const pcm = new Int16Array(data.length)
            for (let i = 0; i < data.length; i++) { const s = Math.max(-1, Math.min(1, data[i])); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF }
            if (ws.readyState === 1) { try { ws.send(pcm.buffer) } catch {} }
          }
          src.connect(proc); proc.connect(ctx.destination)
          // 停顿兜底：vadSilence 无新识别 → 视为说完自动发送（2026-08-07 设置可调）
          idleTimerRef.current = setInterval(() => {
            if (streamTextRef.current && Date.now() - lastResultTsRef.current > vadSilence) autoSendVoice(streamTextRef.current)
          }, 600)
        } catch (err) { console.warn('[voice] PCM 采集失败', err) }
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.action === 'result') {
            const text = String(msg.text || '')
            if (text) { streamTextRef.current = text; setStreamText(text) }
            lastResultTsRef.current = Date.now()
            if (msg.final && text.trim()) autoSendVoice(text)
          } else if (msg.action === 'error') { setRecordingTip('百炼识别错误: ' + (msg.desc || '')) }
        } catch {}
      }
      ws.onerror = () => { setRecordingTip('百炼语音服务连接失败'); stopVoiceListen() }
    } catch (e: any) {
      setRecordingTip(e?.name === 'NotAllowedError' ? '麦克风权限被拒绝' : '语音启动失败：' + (e?.message || e))
    }
  }
  const stopVoiceListen = () => {
    cleanupXf()
    setIsRecording(false)
    if (orbStateRef.current !== 'speaking') setOrbState('idle')
    setStreamText(''); streamTextRef.current = ''
  }

  // 语音自动执行（2026-08-07）：百炼 sentence_end 触发，边说边执行
  const autoSendVoice = (text: string) => {
    const t = String(text).replace(/[\s。，,.！!？?、]/g, '')
    // 停止/打断指令：丢弃不发送，并停止朗读/录音
    if (/(停|停止|算了|别说了|不要|闭嘴|取消)/.test(t)) {
      voice?.stop()
      setRecordingTip('已停止')
      cleanupXf()
      try { mediaRecorderRef.current?.stop() } catch {}
      setIsRecording(false)
      setOrbState('idle')
      return
    }
    // TTS 朗读中收到新指令 → 打断朗读
    if (orbStateRef.current === 'speaking') { try { voice?.stop() } catch {} }
    setStreamText('')
    streamTextRef.current = ''
    lastResultTsRef.current = 0
    setInterimText(text)
    sendMessage(text)
    // 结束本次录音会话（自动执行后无需再点停止）
    cleanupXf()
    try { mediaRecorderRef.current?.stop() } catch {}
    setIsRecording(false)
    setOrbState('idle')
    setRecordingTip('已自动发送')
  }

  const stopRecording = () => {
    if (xfWsRef.current) {
      try { xfWsRef.current?.send(JSON.stringify({ action: 'finish' })) } catch {}
      const finalText = streamTextRef.current.trim()
      cleanupXf()
      setIsRecording(false)
      setOrbState('idle')
      if (finalText) {
        setInput(finalText)
        setInterimText('')
        sendMessage(finalText)
      } else {
        setRecordingTip('没听清，请再说一次')
      }
      return
    }
    mediaRecorderRef.current?.stop()
  }
  const toggleRecording = () => {
    // 朗读中点击声纹球 = 打断朗读（不进入录音）
    if (orbState === 'speaking') {
      voice.stop()
      setOrbState('idle')
      return
    }
    if (dialogMode) {
      setDialogMode(false)
      stopVoiceListen()
      setRecordingTip('已退出对话，点击声纹球重新开始')
      return
    }
    setDialogMode(true)
    startVoiceListen()
  }

  // 朗读某条消息（自动朗读时会在收到助手消息后调用）
  const speakMessage = (content: string) => {
    // 2026-08-05：朗读前先停止上一段，避免两段 TTS 重叠（双声）
    voice.stop()
    const plain = content.replace(/【[^\]]*】/g, '').replace(/https?:\/\/[^\s]+/g, '（链接已发到对话）').replace(/\n+/g, '。').slice(0, 400)
    setOrbState('speaking')
    voice.speak(plain, ttsVoice).then(() => {
      if (dialogMode && !isRecording) {
        // 对话模式：朗读完自动重新听（无需再点声纹球，直接接话）
        startVoiceListen()
      } else {
        setOrbState('idle')
      }
    })
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
  // 大屏打开时若数据为空则自动拉取（覆盖每日首启 modal 等所有入口，避免左列国内为空）
  useEffect(() => { if (hotspotOpen && hotTopics.length === 0) loadHotTopics() }, [hotspotOpen])
  // 大屏打开时隐藏全局导航栏（避免遮挡顶栏统计信息 / 文字重叠）
  useEffect(() => {
    document.body.classList.toggle('hotspot-open', hotspotOpen)
    return () => document.body.classList.remove('hotspot-open')
  }, [hotspotOpen])

  // 加载助手人设名字（agent_profile 记忆，白龙马式自定义名）
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/agent/memories?limit=20', { credentials: 'include' })
        const d = await r.json()
        const mem = (d.memories || []).find((m: any) => (m.tags || '').includes('agent_profile'))
        if (mem) {
          const nm = (mem.content || '').match(/名字[:：]\s*([^\n;；]+)/)
          if (nm?.[1]?.trim()) setAgentName(nm[1].trim())
        }
      } catch {}
    })()
  }, [])

  // 首次登录对话式 onboarding：检查是否已有画像记忆，无则自动发欢迎词（纯对话、语音朗读、有记录）
  useEffect(() => {
    (async () => {
      const done = typeof localStorage !== 'undefined' && localStorage.getItem('agent_onboarded') === '1'
      if (done) { setOnboarded(true); return }
      try {
        const r = await fetch('/api/agent/memories?limit=30', { credentials: 'include' })
        const d = await r.json()
        const hasProfile = (d.items || d.memories || []).some((m: any) => (m.tags || '').includes('画像'))
        if (hasProfile) {
          localStorage.setItem('agent_onboarded', '1')
          setOnboarded(true)
          return
        }
      } catch {}
      // 无画像 → 进入 onboarding，注入欢迎词（用独立 welcomeMsg，不进 messages，保住声纹球主页区）
      setOnboarding(true)
      const welcome = '嗨，我是你的营销搭子～先聊两句我就能更懂你：你目前在做什么行业、平常最头疼的是写内容还是发内容？你想让我帮你干点啥，直接说，我记一下就好。'
      setWelcomeMsg(welcome)
      // 2026-08-06：欢迎语仅文字展示，不自动朗读（消除双声）
    })()
  }, [])

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

    // 自然语言触发热点大屏（融合 BaiLongma onUserMessage 意图路由：说"热点/热搜"即开，说"关闭"即关）
    if (hotspotOpen && /关闭|退出|关掉|隐藏|不要/.test(msgText)) {
      setHotspotOpen(false)
    } else if (/热点|热搜|打开热点|看热点|今日热榜|舆情/.test(msgText)) {
      if (hotTopics.length === 0) loadHotTopics()
      if (activeApp) closeApp()
      setHotspotOpen(true)
    }

    let finalText = msgText
    if (attachments.length && !msgText) finalText = '请帮我看一下这些附件'
    if (!finalText) return

    const userMsg: Message = {
      id: Date.now().toString(), role: 'user',
      content: attachments.length
        ? `${finalText}

📎 ${attachments.map(a => `[${a.name}](${a.url})`).join(' ')}`
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
      const t0 = Date.now()
      pushTerm(`POST /api/agent/chat  ${finalText.slice(0, 24) || '(附件)'}`)
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      const body: any = { message: finalText, history, sessionId: sessionId || undefined }
      if (activeApp) body.currentApp = activeApp.title
      if (onboarding) body.onboarding = true
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
        pushTerm(`chat 完成 · ${Date.now() - t0}ms${data.data?.toolUsed ? ` · 工具 ${(data.data.steps?.length || 0)} 步` : ' · 直接回复'}`, 'ok')
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(), role: 'assistant',
          content: data.data.reply, timestamp: Date.now(),
          intent: data.data.intent?.join?.(',') || data.data.intent,
          toolUsed: data.data.toolUsed,
          steps: data.data.steps,
          scene: data.data.scene,
        }])
        // onboarding 收尾：AGENT 给出"已记住/随时服务"类收尾语即结束摸底
        if (onboarding) {
          const tail = data.data.reply || ''
          if (/随时(为|给)你(服务|效劳)|已经(记|记住|记下|了解)|记住了|了解你了|懂你了/.test(tail)) {
            setOnboarding(false)
            setOnboarded(true)
            if (typeof localStorage !== 'undefined') localStorage.setItem('agent_onboarded', '1')
          }
        }
        if (data.data.sessionId) setSessionId(data.data.sessionId)
        setOrbState('idle')
        // AI 回复自动朗读（2026-08-07：所有回复都朗读，对话模式朗读完自动再听）
        if (data.data.reply) {
          const plain = String(data.data.reply).replace(/【[^]]*】/g, '').replace(/https?:\/\/[^\s]+/g, '（链接已发到对话）').replace(/\n+/g, '。').slice(0, 400)
          setOrbState('speaking')
          voice.speak(plain, ttsVoice).then(() => {
            if (dialogMode && !isRecording) startVoiceListen()
            else setOrbState('idle')
          })
        }
        if (data.data.steps?.length) setLiveSteps(data.data.steps)
        if (typeof data.data.pointsSpent === 'number') setLastPoints(data.data.pointsSpent)
        // 场景协议：open_page 唤起功能（2026-08-05 改为应用随行——在 Agent 工作区内打开 iframe 大屏，
        // AI 对话栏右侧常驻不离场，而非跳转独立页面）
        if (data.data.scene?.type === 'open_page') {
          const path = data.data.scene.path || '/'
          const params = data.data.scene.params || {}
          const qs = new URLSearchParams(params).toString()
          const sep = path.includes('?') ? '&' : '?'
          const target = `${path}${qs ? sep + qs : ''}${qs ? '' : sep}embed=1`
          const known = APPS.find(a => a.path === path)
          const title = known?.title || (path.split('/').filter(Boolean).pop() || '功能')
          if (hotspotOpen) setHotspotOpen(false)
          openApp(target, title)
        }
      } else {
        pushTerm(`chat 失败 · ${Date.now() - t0}ms · ${data.message || res.status}`, 'err')
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(), role: 'assistant',
          content: data.message || '出错了', timestamp: Date.now(),
        }])
      }
    } catch {
      pushTerm('chat 异常：网络请求失败', 'err')
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: '网络连接失败', timestamp: Date.now(),
      }])
    } finally { setLoading(false) }
  }

  // ===== 斜杠命令菜单（BaiLongma slash-menu）=====
  const slashOpen = input.startsWith('/')
  const slashList = slashOpen
    ? SLASH_COMMANDS.filter(c => c.cmd.startsWith(input.trim()) || input.trim() === '/')
    : []

  const applySlash = (c: { cmd: string; desc: string; fill: string }) => {
    if (c.cmd === '/热点') {
      if (hotTopics.length === 0) loadHotTopics()
      if (activeApp) closeApp()
      setHotspotOpen(true)
      setInput('')
      return
    }
    // 完整句子直接发送，半截提示词留给用户补全
    if (c.fill.endsWith('：')) { setInput(c.fill); inputRef.current?.focus() }
    else { setInput(''); sendMessage(c.fill) }
    setSlashIndex(0)
  }

  const [slashIndex, setSlashIndex] = useState(0)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (slashOpen && slashList.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => (i + 1) % slashList.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => (i - 1 + slashList.length) % slashList.length); return }
      if (e.key === 'Escape') { e.preventDefault(); setInput(''); return }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        applySlash(slashList[Math.min(slashIndex, slashList.length - 1)])
        return
      }
    }
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
    // 结果卡片（支持 VIDEO_RESULT / VIDEO_WEB :url|TITLE:标题 触发全局播放器真播放）
    const resRe = /(DH_RESULT|VIDEO_RESULT|VIDEO_WEB):([^|]+)(?:\|TITLE:([^|\n]+))?/
    const rm = content.match(resRe)
    if (rm) {
      const url = rm[2].trim()
      const title = (rm[3] || '').trim()
      // 视频类结果：弹出全局播放器真播放（路线1：B站/YouTube/直链 iframe 均支持）
      if (rm[1] === 'VIDEO_RESULT' || rm[1] === 'VIDEO_WEB') {
        if (typeof window !== 'undefined') openVideoFromUrl(url, title)
        return (
          <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-sm text-emerald-300 mb-2">{title || '已为你找到视频，正在播放…'}</p>
            <button onClick={() => openVideoFromUrl(url, title)} className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium transition">▶ 点击在此播放</button>
          </div>
        )
      }
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
    <div className="fixed inset-0 h-screen w-screen bg-[#07070c] flex flex-col overflow-hidden z-50">
      {/* 背景：BaiLongma 风格动态渐变光晕 */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -top-32 -left-32 w-[28rem] h-[28rem] bg-emerald-500/[0.08] rounded-full blur-[140px] animate-pulse" style={{ animationDuration: '9s' }} />
        <div className="absolute -bottom-40 -right-24 w-[24rem] h-[24rem] bg-indigo-500/[0.07] rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '7s', animationDelay: '1.5s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[36rem] h-[36rem] bg-cyan-500/[0.04] rounded-full blur-[160px] animate-pulse" style={{ animationDuration: '11s', animationDelay: '0.8s' }} />
        {/* 细网格纹理 */}
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.6) 1px,transparent 1px)', backgroundSize: '40px 40px' }} />
      </div>

      {/* 🏥 自检弹窗（2026-08-08 A+B：启动自动 + 点击/语音触发） */}
      {showSelfCheck && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowSelfCheck(false)}>
          <div className="w-[360px] max-h-[80vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d14] p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white mb-1">🏥 AI 系统自检</h3>
            <p className="text-[10px] text-gray-500 mb-4">账号 / 订阅 / 语音 / 记忆 / 模型 一次性体检</p>
            <div className="space-y-2">
              {selfChecks.length === 0 && <p className="text-[11px] text-gray-600">{selfChecking ? '正在检查…' : '暂无数据，请稍后重试'}</p>}
              {selfChecks.map(ch => (
                <div key={ch.key} className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-[11px] ${ch.ok ? 'bg-emerald-500/[0.06]' : 'bg-red-500/[0.06]'}`}>
                  <span>{ch.ok ? '✅' : '❌'}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium ${ch.ok ? 'text-emerald-300' : 'text-red-300'}`}>{ch.label}</p>
                    <p className="text-gray-500 text-[10px] truncate">{ch.detail || ''}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowSelfCheck(false)} className="flex-1 rounded-lg bg-white/[0.06] py-2 text-[11px] text-gray-400 hover:bg-white/10 transition">关闭</button>
              <button onClick={() => runSelfCheck(false)} disabled={selfChecking}
                className="flex-1 rounded-lg bg-emerald-500/20 py-2 text-[11px] text-emerald-300 hover:bg-emerald-500/30 transition disabled:opacity-50">{selfChecking ? '检查中…' : '重新检查'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ⚙️ AI 设置弹窗（2026-08-07：音色/温度/语音灵敏度） */}
      {showPrefs && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowPrefs(false)}>
          <div className="w-[340px] max-h-[80vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d14] p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white mb-1">⚙️ AI 设置</h3>
            <p className="text-[10px] text-gray-500 mb-4">你的个性化设置，AI 回复会按此执行</p>

            <p className="text-[11px] text-gray-400 mb-1.5">🎙 AI 声音（音色）</p>
            <div className="flex gap-2 mb-3">
              <select value={ttsVoice} onChange={e => setTtsVoice(e.target.value)}
                className="flex-1 rounded-lg bg-white/[0.06] border border-white/10 px-2 py-1.5 text-[11px] text-white outline-none focus:border-emerald-400/50">
                {ttsVoices.map(v => <option key={v.id} value={v.id} className="bg-[#0d0d14]">{v.label}</option>)}
              </select>
              <button onClick={() => testVoice(ttsVoice)}
                className="shrink-0 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-[11px] text-emerald-300 hover:bg-emerald-500/30 transition">试听</button>
            </div>

            <p className="text-[11px] text-gray-400 mb-1.5">🎛 回复温度：<span className="text-emerald-300">{temperature.toFixed(1)}</span></p>
            <input type="range" min="0" max="1.5" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))}
              className="w-full mb-1 accent-emerald-400" />
            <p className="text-[9px] text-gray-600 mb-3">低=严谨稳定，高=创意发散（默认 0.7）</p>

            <p className="text-[11px] text-gray-400 mb-1.5">🎤 语音灵敏度：<span className="text-emerald-300">{vadThreshold.toFixed(3)}</span></p>
            <input type="range" min="0.02" max="0.12" step="0.005" value={vadThreshold} onChange={e => setVadThreshold(parseFloat(e.target.value))}
              className="w-full mb-1 accent-emerald-400" />
            <p className="text-[9px] text-gray-600 mb-3">小=识别灵敏（安静环境），大=更抗噪（嘈杂环境）</p>

            <p className="text-[11px] text-gray-400 mb-1.5">⏱ 说话停顿多久算说完：<span className="text-emerald-300">{vadSilence}ms</span></p>
            <input type="range" min="1000" max="3500" step="100" value={vadSilence} onChange={e => setVadSilence(parseInt(e.target.value))}
              className="w-full mb-1 accent-emerald-400" />
            <p className="text-[9px] text-gray-600 mb-4">短=反应快（一句话说完立即执行），长=等更久（防误判）</p>

            <div className="flex gap-2">
              <button onClick={() => setShowPrefs(false)} className="flex-1 rounded-lg bg-white/[0.06] py-2 text-[11px] text-gray-400 hover:bg-white/10 transition">取消</button>
              <button onClick={savePrefs} disabled={savingPrefs}
                className="flex-1 rounded-lg bg-emerald-500/20 py-2 text-[11px] text-emerald-300 hover:bg-emerald-500/30 transition">{savingPrefs ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 自定义 AI 名称弹窗（2026-08-07） */}
      {showNameEdit && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowNameEdit(false)}>
          <div className="w-[300px] rounded-2xl border border-white/10 bg-[#0d0d14] p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white mb-1">✎ 给 AI 起个名字</h3>
            <p className="text-[10px] text-gray-500 mb-3">名字会显示在标题栏，AI 也会用这个名字自称（如「我是XX」）</p>
            <input value={nameInput} onChange={e => setNameInput(e.target.value)} maxLength={20}
              placeholder="例如：小美 / 麦子 / 张老板"
              className="w-full rounded-lg bg-white/[0.06] border border-white/10 px-3 py-2 text-xs text-white placeholder-gray-600 outline-none focus:border-emerald-400/50" />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowNameEdit(false)} className="flex-1 rounded-lg bg-white/[0.06] py-2 text-[11px] text-gray-400 hover:bg-white/10 transition">取消</button>
              <button onClick={saveAgentName} className="flex-1 rounded-lg bg-emerald-500/20 py-2 text-[11px] text-emerald-300 hover:bg-emerald-500/30 transition">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 客户端每日首启·是否进入热点大屏（仅 Electron，Web 端不渲染） */}
      {showHotspotPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[340px] rounded-2xl border border-white/10 bg-[#0d0d14] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-white mb-1">🌐 进入今日热点大屏？</h3>
            <p className="text-[11px] text-gray-400 mb-4 leading-relaxed">
              可查看全球实时热榜与舆情地球分布。今天不再询问，明天会再次提示。
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => answerHotspotPrompt(false)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-gray-400 transition">
                暂不
              </button>
              <button onClick={() => answerHotspotPrompt(true)}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-[11px] text-emerald-300 transition">
                进入热点
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative z-10 agent-shell min-h-0">
        {/* ═══ 左面板（BaiLongma primary panel）：品牌 + AI活动指示器 + 声纹球语音面板 ═══ */}
        <aside className="agent-left-panel hidden lg:flex w-[300px] xl:w-[330px] shrink-0 flex-col backdrop-blur-xl min-h-0">
          {/* 品牌区（panel-identity）：logo + 名字 */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06] shrink-0">
            <div className="w-7 h-7 rounded-full shrink-0 bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shadow-[0_0_18px_rgba(16,185,129,0.35)]">
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            </div>
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="text-[9px] tracking-[0.22em] uppercase text-gray-600 font-mono">AI MARKETING</span>
              <span className="text-[14px] font-semibold text-white tracking-tight truncate">{agentName}</span>
              <button onClick={() => { setNameInput(agentName); setShowNameEdit(true) }}
                className="text-[9px] text-gray-600 hover:text-emerald-300 transition shrink-0" title="自定义 AI 名称">✎ 改名</button>
              <button onClick={() => setShowPrefs(true)}
                className="text-[9px] text-gray-600 hover:text-emerald-300 transition shrink-0" title="AI 设置">⚙️</button>
            </div>
            {user ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-gray-400 max-w-[72px] truncate" title={user.username}>{user.username}</span>
                {user.role === 'admin' && (
                  <button onClick={() => router.push('/admin')}
                    className="px-2 py-1 rounded-md bg-amber-500/15 border border-amber-500/25 text-[9px] text-amber-300 hover:bg-amber-500/25 transition" title="管理后台（API Key/系统配置）">⚙ 管理</button>
                )}
                <button onClick={async () => { await logout(); router.push('/login') }}
                  className="px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[9px] text-gray-400 hover:text-red-300 transition">退出</button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => router.push('/login')}
                  className="px-2.5 py-1 rounded-md bg-emerald-500/20 border border-emerald-500/30 text-[9px] text-emerald-400 hover:bg-emerald-500/30 transition">登录</button>
                <button onClick={() => router.push('/register')}
                  className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-[9px] text-gray-300 hover:bg-white/10 transition">注册</button>
              </div>
            )}
          </div>

          {/* AI 当前活动指示器（ai-activity：纯派生，不逼 AI 开口） */}
          <div className="px-4 py-2.5 border-b border-white/[0.06] shrink-0">
            <div className={`flex items-center gap-2 text-[10px] font-mono tracking-wide ${aiBusy ? 'text-cyan-300' : 'text-gray-600'}`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${aiBusy ? 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.7)] animate-pulse' : 'bg-gray-700'}`} />
              <span className="shrink-0">{aiActivity.label}</span>
              <span className="flex-1 opacity-70 truncate text-right">{aiActivity.detail}</span>
            </div>
          </div>

          {/* 声纹球语音面板（BaiLongma voice-panel 位置：左面板内，非中栏顶部） */}
          <div className="px-1 py-1 shrink-0 flex flex-col items-center gap-2">
            <div className="relative">
              <div className="pointer-events-none absolute -inset-px rounded-full opacity-25 blur-3xl"
                style={{ background: 'radial-gradient(circle, #ff9f1c, transparent 70%)' }} />
              {/* 左侧信息面板（2026-08-08：账号/订阅/点数/模型/记忆 + 自检状态） */}
              <div className="px-4 pb-1 shrink-0">
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-white truncate">
                      {user?.username || '未登录'}
                      <span className={`px-1.5 py-0.5 rounded border text-[9px] font-normal ${roleColor}`}>{roleLabel}</span>
                    </span>
                    <button onClick={() => runSelfCheck(false)}
                      className={`shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] transition ${allOk ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08] hover:bg-emerald-500/20' : 'border-red-500/30 text-red-300 bg-red-500/[0.08] hover:bg-red-500/20'}`}
                      title="点击查看自检明细">
                      {selfChecking ? <span className="animate-pulse">自检中…</span> : <>{allOk ? '✅ 全部正常' : `⚠️ ${failCount} 项异常`}</>}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-gray-400">
                    <span className="truncate">📅 {selfChecks.find(c => c.key === 'subscription')?.detail || '—'}</span>
                    <span className="truncate">💎 {selfChecks.find(c => c.key === 'points')?.detail || '—'}</span>
                    <span className="truncate col-span-2">🧠 {selfModel?.brain || '—'} <span className="text-gray-600">· {selfChecks.find(c => c.key === 'memory')?.detail || ''}</span></span>
                  </div>
                  <div className="text-[9px] text-gray-600 border-t border-white/[0.05] pt-1.5 flex items-center justify-between">
                    <span>会话 {Math.floor((Date.now() - sessionStart) / 60000)} 分钟</span>
                    <span>请求 {sessionReqs} 次</span>
                  </div>
                </div>
              </div>

              <VoiceOrb state={orbState} volume={Math.max(micVolume, ttsVolume)} size={290}
                className="relative drop-shadow-[0_0_10px_rgba(255,159,28,0.22)]" />
              <button onClick={toggleRecording}
                className="absolute inset-0 w-full h-full rounded-full cursor-pointer"
                title={isRecording ? '点击停止' : '点击说话'} />
            </div>
          </div>

          {/* 应用入口（2026-08-05：一键成片等 iframe 大屏，AI 对话栏右 1/3 常驻） */}
          <div className="px-4 py-3 border-t border-white/[0.06] shrink-0">
            <p className="text-[9px] text-gray-600 mb-2 tracking-wide">📱 应用 · 打开即 AI 随行</p>
            {/* 2026-08-08：按角色过滤 + 颜色区分（字体/边框同色）+ 文字宽度自适应 + 错落排列 */}
            <div className="flex flex-wrap gap-x-2 gap-y-1 pt-0.5">
              {visibleApps.map((a, i) => {
                const col = APP_COLORS[a.color] || APP_COLORS.emerald
                return (
                  <button key={a.path} onClick={() => { if (hotspotOpen) setHotspotOpen(false); openApp(a.path) }}
                    className={`px-3 py-1.5 rounded-xl border text-[11px] font-medium transition hover:brightness-125 ${col.border} ${col.text} ${col.bg} ${['', 'mt-2.5', 'mt-1.5', 'mt-3'][i % 4]} ${activeApp?.path === a.path ? 'ring-1 ring-current' : ''}`}>
                    {a.title}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 面板底部动作（panel-actions）：热点大屏呼出（也支持语音呼出） */}
          <div className="px-4 py-3 border-t border-white/[0.06] shrink-0">
            <button onClick={() => { if (hotTopics.length === 0) loadHotTopics(); if (!hotspotOpen && activeApp) closeApp(); setHotspotOpen(!hotspotOpen) }}
              className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] transition ${hotspotOpen ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-white/[0.03] hover:bg-white/[0.08] text-gray-400 hover:text-gray-200 border border-white/[0.06]'}`}
              title="也可以直接说「打开热点大屏」">
              🌐 {hotspotOpen ? '收起热点大屏' : '呼出热点大屏'}
            </button>
            <p className="text-[8px] text-gray-700 text-center mt-1.5">或直接说「打开热点大屏」</p>
          </div>
        </aside>

        <main className="agent-main-col flex-1 flex flex-col min-w-0 min-h-0 agent-main">
          <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 flex flex-col">
            {lastPoints != null && (
              <p className="text-[10px] text-amber-300/80 text-center">🪙 本次对话消耗 {lastPoints} 点</p>
            )}
            {messages.length === 0 && (
              /* 中栏 console：声纹球与建议已移至左面板，这里只留引导 + 今日热点 + 能力卡 */
              <div className="flex-1 min-h-full flex flex-col items-center justify-center w-full px-5 py-6">
                {/* 小屏（无左面板）时的声纹球兜底入口 */}
                <div className="lg:hidden relative flex flex-col items-center mb-5">
                  <div className="pointer-events-none absolute -top-6 h-40 w-40 rounded-full opacity-25 blur-3xl"
                    style={{ background: 'radial-gradient(circle, #ff9f1c, transparent 70%)' }} />
                  <div className="relative">
                    <VoiceOrb state={orbState} volume={Math.max(micVolume, ttsVolume)} size={132}
                      className="relative drop-shadow-[0_0_10px_rgba(255,159,28,0.22)]" />
                    <button onClick={toggleRecording}
                      className="absolute inset-0 w-full h-full rounded-full cursor-pointer"
                      title={isRecording ? '点击停止' : '点击说话'} />
                  </div>
                  <p className="text-[11px] text-orange-300/80 text-center mt-3">
                    {orbState === 'listening' ? '🎤 正在聆听…' : orbState === 'recognizing' ? '🔍 识别中…' : orbState === 'thinking' ? '💭 思考中…' : orbState === 'speaking' ? '🔊 朗读中…' : '声纹球待命 · 点击说话'}
                  </p>
                </div>

                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2.5 leading-tight text-center">
                  我能帮你做什么？
                </h1>
                <p className="text-xs text-gray-500 mb-5 leading-relaxed max-w-md text-center">
                  点击左侧声纹球直接说话，或在下方输入需求（输入 <span className="text-gray-400 font-mono">/</span> 唤起命令），我帮你生成图片/视频、结合热点做内容、查找素材、发布。
                </p>

                {/* 主动推送建议（阶段2：Tick 简化版） */}
                {suggestions.length > 0 && (
                <div className="w-full max-w-3xl mb-3 flex flex-col gap-1.5">
                <p className="text-[10px] text-gray-600 tracking-wide">💡 为你推荐</p>
                {suggestions.map(s => (
                <div key={s.prompt} className="flex items-start justify-between gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.05] px-3 py-2 animate-in fade-in">
                <button onClick={() => { sendMessage(s.prompt); setSuggClosed(p => [...p, s.prompt]); setSuggestions(l => l.filter(x => x.prompt !== s.prompt)) }}
                className="text-left flex-1 min-w-0">
                <p className="text-[11px] text-cyan-200/90 font-medium">{s.title}</p>
                <p className="text-[10px] text-gray-500 leading-snug mt-0.5 line-clamp-1">{s.desc}</p>
                </button>
                <button onClick={() => { setSuggClosed(p => [...p, s.prompt]); setSuggestions(l => l.filter(x => x.prompt !== s.prompt)) }}
                className="shrink-0 text-gray-600 hover:text-gray-300 text-[11px] px-1" title="不再显示">✕</button>
                </div>
                ))}
                </div>
                )}
                
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

              </div>
            )}

            {/* 首次 onboarding 欢迎词：独立于 messages，与声纹球主页区并存，不顶掉 BaiLongma 风格欢迎区 */}
            {welcomeMsg && messages.length === 0 && (
              <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2 mt-2">
                <div className="flex items-start gap-2 max-w-[88%] sm:max-w-[75%]">
                  <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 overflow-hidden bg-gradient-to-br from-emerald-400 to-cyan-500">
                    <VoiceOrb state="idle" size={28} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] text-gray-500 mb-0.5 font-medium">{agentName}</p>
                    <div className="rounded-2xl px-3 py-2 text-xs leading-relaxed break-words bg-white/[0.04] text-gray-200 border border-white/[0.06] rounded-bl-md">
                      <div className="text-gray-300 whitespace-pre-wrap">{welcomeMsg}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {messages.length > 0 && (
              <div className="flex-1 flex flex-col justify-end space-y-3 pt-3">
                {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
                <div className={`flex items-start gap-2 max-w-[88%] sm:max-w-[75%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 overflow-hidden ${msg.role === 'user' ? 'bg-blue-500/20 border border-blue-500/30 rounded-full' : 'bg-gradient-to-br from-emerald-400 to-cyan-500'}`}>
                    {msg.role === 'user'
                      ? <span className="text-[9px] text-blue-300 font-semibold">{user?.username?.[0]?.toUpperCase() || 'U'}</span>
                      : <VoiceOrb state="idle" size={28} />}
                  </div>
                  <div className="min-w-0">
                    {msg.role === 'assistant' && <p className="text-[9px] text-gray-500 mb-0.5 font-medium">{agentName}</p>}
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
                      {/* 阶段二·Scene 投影：AGENT 返回结构化卡片原生渲染 */}
                      {msg.role === 'assistant' && msg.scene && (
                                                <div className="mt-2 rounded-xl bg-white/[0.03] border border-white/[0.08] p-3 scene-in">
                          {msg.scene.type === 'image' ? (
                            <div className="flex flex-col items-center">
                              {msg.scene.title && <p className="text-[11px] text-emerald-300 font-medium mb-2 text-center">{msg.scene.title}</p>}
                              {msg.scene.url && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={msg.scene.url} alt={msg.scene.title || '图片'} className="w-36 h-36 object-contain rounded-lg bg-white" />
                              )}
                              {msg.scene.desc && <p className="text-[10px] text-gray-400 mt-2 text-center">{msg.scene.desc}</p>}
                            </div>
                          ) : msg.scene.type === 'video' ? (
                            <div className="flex flex-col gap-2">
                              {msg.scene.title && <p className="text-[11px] text-emerald-300 font-medium">{msg.scene.title}</p>}
                              {(() => {
                                const embed = embedVideoUrl(msg.scene.video?.url || msg.scene.url || '')
                                return embed.kind === 'bili' || embed.kind === 'yt' ? (
                                  <iframe src={embed.src} className="w-full aspect-video rounded-lg bg-black border-0" allowFullScreen allow="accelerometer; autoplay; encrypted-media; picture-in-picture" />
                                ) : (
                                  <video src={embed.src} poster={msg.scene.video?.poster} controls className="w-full max-h-64 rounded-lg bg-black" />
                                );
                              })()}
                              {msg.scene.desc && <p className="text-[10px] text-gray-400">{msg.scene.desc}</p>}
                            </div>
                          ) : msg.scene.type === 'confirm' ? (
                            <div className="flex flex-col gap-2">
                              {msg.scene.title && <p className="text-[11px] text-emerald-300 font-medium">{msg.scene.title}</p>}
                              {msg.scene.desc && <p className="text-[10px] text-gray-400">{msg.scene.desc}</p>}
                              <button onClick={() => sendMessage(msg.scene.confirm?.prompt || `好的，${msg.scene.confirm?.label || '请继续'}`)}
                                className="self-start px-3 py-1.5 rounded-lg bg-emerald-500/20 text-[10px] text-emerald-300 hover:bg-emerald-500/30 transition">
                                {msg.scene.confirm?.label || '确认'}
                              </button>
                            </div>
                          ) : msg.scene.type === 'link' || msg.scene.type === 'card' ? (
                            <a href={msg.scene.link?.url || msg.scene.url} target="_blank" rel="noopener noreferrer"
                              className="flex flex-col gap-1 rounded-lg bg-white/[0.04] border border-white/[0.08] p-2.5 hover:border-emerald-400/40 transition">
                              {msg.scene.title && <p className="text-[11px] text-emerald-300 font-medium">{msg.scene.title}</p>}
                              {msg.scene.desc && <p className="text-[10px] text-gray-400">{msg.scene.desc}</p>}
                              <span className="text-[9px] text-gray-500 mt-0.5">↗ 打开链接</span>
                            </a>
                          ) : msg.scene.type === 'task' ? (
                            <div className="flex flex-col gap-1.5">
                              {msg.scene.title && <p className="text-[11px] text-emerald-300 font-medium">{msg.scene.title}</p>}
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] text-gray-500">{msg.scene.task?.status || '进行中'}</span>
                                {typeof msg.scene.task?.progress === 'number' && (
                                  <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                                    <div className="h-full bg-emerald-400/80 transition-all" style={{ width: `${Math.min(100, Math.max(0, msg.scene.task.progress))}%` }} />
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <>
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
                                      <a key={i} href={a.href} target={a.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
                                        className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-[10px] text-emerald-300 hover:bg-emerald-500/30 transition">{a.label}</a>
                                    ) : (
                                      <span key={i} className="px-2.5 py-1 rounded-lg bg-white/5 text-[10px] text-gray-400">{a.label}</span>
                                    )
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      <p className="text-[8px] mt-1 opacity-30">{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
              </div>
            )}

            {loading && (
              <div className="flex justify-start animate-in fade-in">
                <div className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-lg overflow-hidden bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shrink-0">
                    <VoiceOrb state="thinking" size={28} />
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-500 mb-1">{agentName}</p>
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
              {/* 斜杠命令菜单（BaiLongma slash-menu：输入 / 唤起，命令式触发） */}
              {slashOpen && slashList.length > 0 && (
                <div className="mb-2 rounded-xl border border-white/[0.12] bg-[#0d0d14]/95 backdrop-blur-xl shadow-2xl p-1.5 max-h-64 overflow-y-auto">
                  {slashList.map((c, i) => (
                    <button key={c.cmd} onClick={() => applySlash(c)}
                      onMouseEnter={() => setSlashIndex(i)}
                      className={`w-full flex items-center gap-3 px-2.5 py-1.5 rounded-lg text-left transition ${i === Math.min(slashIndex, slashList.length - 1) ? 'bg-emerald-500/15' : 'hover:bg-white/[0.05]'}`}>
                      <span className="text-[11px] font-mono text-emerald-300 shrink-0 w-16">{c.cmd}</span>
                      <span className="text-[10px] text-gray-500 truncate">{c.desc}</span>
                    </button>
                  ))}
                  <p className="text-[8px] text-gray-700 px-2.5 pt-1">↑↓ 选择 · Enter 确认 · Esc 取消</p>
                </div>
              )}
              <div className="relative flex items-end gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded-2xl px-2 sm:px-3 py-1.5 focus-within:border-emerald-500/30 transition-colors">
                {/* 附件按钮 */}
                <button onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-500 hover:text-gray-300 transition">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
                </button>
                <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFilePick} multiple />
                <textarea ref={inputRef} value={input}
                  onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder="输入需求，或输入 / 唤起命令..."
                  rows={1}
                  className="flex-1 bg-transparent text-xs sm:text-sm text-gray-200 placeholder-gray-600 resize-none outline-none py-1 max-h-32"
                  disabled={loading} />
                <button onClick={() => sendMessage()} disabled={(!input.trim() && !attachments.length) || loading}
                  className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition ${(input.trim() || attachments.length) && !loading
                    ? 'bg-gradient-to-br from-emerald-400 to-cyan-500 text-white hover:opacity-90' : 'bg-white/5 text-gray-700 cursor-not-allowed'}`}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
                <button onClick={toggleRecording}
                  className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition ${isRecording ? 'bg-red-500/30 text-red-300 animate-pulse' : orbState === 'thinking' ? 'bg-purple-500/20 text-purple-300' : orbState === 'speaking' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 hover:bg-white/10 text-gray-400'}`}
                  title={isRecording ? '点击停止录音' : (orbState === 'thinking' ? '思考中' : orbState === 'speaking' ? '朗读中' : '点击说话')}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2m7 9v3"/></svg>
                </button>
              </div>
              <p className="text-[8px] text-gray-700 text-center mt-1 hidden sm:block">Enter 发送 · Shift+Enter 换行 · / 命令 · 📎 图片/视频 · 🎤 点击声纹球说话</p>
            </div>
          </footer>
        </main>

        {/* 右侧常驻·思考步骤流面板（融合 BaiLongma 步骤流） */}
        <aside className="agent-thinking-aside hidden lg:flex w-72 backdrop-blur-xl flex-col shrink-0">
          {/* 终端流（阶段1：实时请求日志，对齐 BaiLongma terminal-stream） */}
          <div className="p-3 border-b border-white/5">
            <button onClick={() => setTermOpen(v => !v)}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-[10px] transition ${termOpen ? 'bg-white/[0.08] text-white' : 'bg-white/[0.03] hover:bg-white/[0.06] text-gray-400'}`}>
              🖥 终端流 {termOpen ? '· 收起' : termLines.length ? `· ${termLines.length}条` : ''}
            </button>
            {termOpen && (
              <div className="mt-2 max-h-44 overflow-y-auto rounded-lg bg-black/50 border border-white/[0.06] p-2 font-mono text-[8.5px] leading-relaxed">
                {termLines.length === 0 ? (
                  <p className="text-gray-700">等待活动…发消息/语音后实时显示请求日志</p>
                ) : (
                  termLines.map((l, i) => (
                    <p key={i} className={l.level === 'err' ? 'text-red-400' : l.level === 'ok' ? 'text-emerald-400/90' : 'text-gray-500'}>
                      <span className="text-gray-700">[{l.t}]</span> {l.msg}
                    </p>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="p-3 border-b border-white/5">
            <p className="text-[11px] text-gray-300 font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              思考步骤流
            </p>
            <p className="text-[9px] text-gray-600 mt-0.5">实时展示助手执行链路</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {liveSteps.length === 0 && !loading ? (
              (() => {
                // 从对话历史取最新一条 assistant 的步骤，保证右栏始终有内容
                const last = [...messages].reverse().find(m => m.role === 'assistant' && m.steps?.length)
                if (!last) return (
                  <p className="text-[10px] text-gray-700 px-1 py-4 text-center">
                    发一条消息，看助手怎么拆解执行
                  </p>
                )
                return last.steps!.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
                    <span className="mt-0.5 w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-[9px] shrink-0 font-semibold">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] text-gray-300 leading-snug">{s.label}</p>
                      <p className="text-[8px] text-cyan-400/70 mt-0.5 flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-cyan-400/70" />
                        {TOOL_STEP_LABEL[s.tool] || s.tool}
                      </p>
                    </div>
                  </div>
                ))
              })()
            ) : (
              <>
                {/* 流式思考占位：请求尚未返回 steps 时显示脉冲卡 */}
                {loading && liveSteps.length === 0 && (
                  <div className="flex items-start gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
                    <span className="mt-0.5 w-4 h-4 rounded-full bg-purple-500/20 flex items-center justify-center text-[9px] shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-300 animate-ping" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] text-gray-400 leading-snug animate-pulse">思考中 · 正在拆解你的需求…</p>
                      <p className="text-[8px] text-purple-400/60 mt-0.5">规划执行链路</p>
                    </div>
                  </div>
                )}
                {liveSteps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2 animate-in fade-in"
                    style={{ animationDelay: `${i * 90}ms` }}>
                    <span className="mt-0.5 w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-[9px] shrink-0 font-semibold">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] text-gray-300 leading-snug">{s.label}</p>
                      <p className="text-[8px] text-cyan-400/70 mt-0.5 flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-cyan-400/70" />
                        {TOOL_STEP_LABEL[s.tool] || s.tool}
                      </p>
                    </div>
                  </div>
                ))}
              </>
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
          {/* 媒体舞台（阶段1：音乐库 + AI 生成记录） */}
          <div className="p-3 border-t border-white/5">
            <button onClick={toggleMedia}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-[10px] transition ${mediaOpen ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/[0.03] hover:bg-white/[0.06] text-gray-400'}`}>
              🎵 媒体舞台 {mediaOpen ? '· 收起' : mediaData ? `· ${mediaData.bgm.length}曲 / ${mediaData.records.length}条` : '· 音乐/AI生成'}
            </button>
            {mediaOpen && (
              <div className="mt-2 space-y-2 max-h-56 overflow-y-auto pr-1">
                {mediaLoading ? (
                  <p className="text-[9px] text-gray-700 px-1">加载中…</p>
                ) : (
                  <>
                    <p className="text-[9px] text-gray-500">🎶 音乐库</p>
                    {(mediaData?.bgm.length ? mediaData.bgm : []).map(b => (
                      <button key={b.id} onClick={() => toggleBgm(b)}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[10px] transition ${mediaPlayingId === b.id ? 'bg-cyan-500/15 text-cyan-300' : 'bg-white/[0.03] hover:bg-white/[0.06] text-gray-400'}`}>
                        <span className="truncate">{b.title}</span>
                        <span className="shrink-0 ml-2">{mediaPlayingId === b.id ? '⏸ 停止' : '▶ 试听'}</span>
                      </button>
                    ))}
                    <p className="text-[9px] text-gray-500 pt-1">🎬 AI 生成</p>
                    {(mediaData?.records.length ? mediaData.records : []).map(r => (
                      <div key={r.id} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-1.5">
                        {r.type === 'text2video' && r.url ? (
                          <video src={r.url} controls className="w-full max-h-36 rounded-md bg-black" />
                        ) : r.type === 'text2img' && r.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.url} alt="生成图" className="w-full max-h-28 object-contain rounded-md bg-black/40" />
                        ) : (
                          <p className="text-[9px] text-gray-500 truncate">{r.type} · {r.prompt || '已生成'}</p>
                        )}
                        <p className="text-[8px] text-gray-600 mt-1 truncate">{r.prompt || r.type}</p>
                      </div>
                    ))}
                    {(!mediaData?.bgm.length && !mediaData?.records.length) && (
                      <p className="text-[9px] text-gray-700 px-1">暂无媒体 · 用文生视频/文生图生成后这里会显示</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {/* 文档面板（阶段1：智能体知识库/训练文档） */}
          <div className="p-3 border-t border-white/5">
            <button onClick={toggleDocs}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-[10px] transition ${docsOpen ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.03] hover:bg-white/[0.06] text-gray-400'}`}>
              📚 文档 · 知识库 {docsOpen ? '· 收起' : agents.length ? `· ${agents.length}个智能体` : ''}
            </button>
            {docsOpen && (
              <div className="mt-2 space-y-2 max-h-56 overflow-y-auto pr-1">
                {agents.length === 0 ? (
                  <p className="text-[9px] text-gray-700 px-1">暂无智能体文档 · 到「AI 智能体」页创建并上传训练文档</p>
                ) : (
                  agents.map(a => (
                    <div key={a.id} className="rounded-lg bg-amber-500/[0.04] border border-amber-500/15 p-2">
                      <p className="text-[10px] text-amber-200/90 font-medium flex items-center gap-1">
                        🤖 {a.name}
                        {a.replyStyle && <span className="text-[8px] text-gray-500 font-normal">· {a.replyStyle}</span>}
                      </p>
                      {a.welcomeMessage && <p className="text-[8px] text-gray-600 mt-0.5 truncate">{a.welcomeMessage}</p>}
                      {(a.trainingDocuments?.length ? a.trainingDocuments : []).map(doc => (
                        <button key={doc.id} onClick={() => sendMessage(`参考知识库文档「${doc.title}」的内容来回答：${doc.title}`)}
                          title="点击让助手结合该文档回答"
                          className="w-full text-left mt-1.5 px-2 py-1 rounded-md bg-white/[0.03] hover:bg-white/[0.08] text-[9px] text-gray-400 hover:text-amber-200 transition">
                          📄 {doc.title}
                        </button>
                      ))}
                      {(!a.trainingDocuments?.length) && (
                        <p className="text-[8px] text-gray-700 mt-1">无训练文档</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>

        {/* 通用应用大屏（2026-08-05：iframe 嵌入 + AI 对话栏右 1/3 常驻；紧凑模式 AI 收右下角小窗） */}
        {activeApp && (
          <div className="agent-app">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-[#0a0a0f]/90 backdrop-blur-xl shrink-0">
              <span className="text-[12px] text-white font-medium flex items-center gap-2">
                <span className="shrink-0">{APPS.find(a => a.path === activeApp.path)?.icon || '📄'}</span>
                {activeApp.title}
                <span className="text-[9px] text-gray-500 font-normal hidden xl:inline">AI 在右侧随行 · 说「关闭」可退出</span>
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => setAppCompact(v => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] transition ${appCompact ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/25' : 'bg-white/5 hover:bg-white/10 text-gray-400 border border-white/[0.08]'}`}
                  title="页面拥挤时把 AI 收成右下角小窗，功能页获得全屏">
                  {appCompact ? '🪟 展开 AI' : '⚡ 紧凑模式'}
                </button>
                <button onClick={closeApp}
                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-300 text-[10px] transition border border-white/[0.08]" title="关闭应用，回到对话">✕ 关闭</button>
              </div>
            </div>
            <iframe src={activeApp.path} className="w-full flex-1 bg-white" title={activeApp.title} />
          </div>
        )}
        {/* 热点大屏（融合 BaiLongma hotspot 三柱布局：左平台热榜 / 中地球+辅助 / 右平台热榜） */}
        {hotspotOpen && (() => {
          const cnSources = hotTopics.filter((s) => s.region === 'cn')
          const globalSources = hotTopics.filter((s) => s.region === 'global')
          const leftSources = cnSources.filter((s) => s.source !== '微信' && s.source !== '微博')
          const rightSources = [...cnSources.filter((s) => s.source === '微信' || s.source === '微博'), ...globalSources]
          const totalItems = hotTopics.reduce((n, s) => n + s.items.length, 0)
          const tickerItems = hotTopics.flatMap((s) => s.items.slice(0, 4).map((it) => ({ src: s.source, title: it.title })))
          // 手风琴默认：左右柱各仅第一个平台卡固定展开，其余折叠
          const leftDefault = leftSources[0]?.source ?? null
          const rightDefault = rightSources[0]?.source ?? null
          const leftOpen = leftExpanded ?? leftDefault
          const rightOpen = rightExpanded ?? rightDefault
          // 阶段三：用户关注度（localStorage 埋点，按用户收看/点击习惯加权排序）
          const attention = readAttention()
          const attWeight = (source: string) => attention[source] || 0
          // 中间辅助：平台爆款覆盖度（按各源话题数 + 用户关注度加权派生）、情绪指数（mock 稳定值）
          // 发布次数统计（竖排，2026-08-08：AgentPublishTask 按平台；空则显示引导）
          const publishRows = publishStats.length > 0
            ? publishStats.slice(0, 6).map((p) => ({ name: p.platform, pct: p.count }))
            : cnSources.slice(0, 6).map((s) => ({ name: s.source, pct: s.items.length + attWeight(s.source) * 3 }))
          const regionMax = Math.max(1, ...publishRows.map((r) => r.pct))
          // 情绪指数（2026-08-08：热榜标题情感词库规则，正面/负面词占比 → 0-100）
          const POS_WORDS = ['爆', '涨', '红', '火', '热', '喜', '赢', '新', '强', '大', '赞', '好', '增', '破', '领', '佳', '美', '爱']
          const NEG_WORDS = ['跌', '亏', '难', '痛', '忧', '罚', '禁', '查', '危', '乱', '骗', '假', '坏', '暗', '疑', '下']
          const allTitles = hotTopics.flatMap((s) => s.items.map((i) => i.title)).join('')
          let pos = 0, neg = 0
          for (const w of POS_WORDS) { const n = allTitles.split(w).length - 1; pos += n }
          for (const w of NEG_WORDS) { const n = allTitles.split(w).length - 1; neg += n }
          const sentiment = pos + neg === 0 ? 60 : Math.min(98, Math.max(2, Math.round((pos / (pos + neg)) * 100)))
          // 实时事件流卡片（扁平化所有源，按用户关注度排序：常看的 source 前置）
          const feedItems = hotTopics
            .sort((a, b) => attWeight(b.source) - attWeight(a.source))
            .flatMap((s) =>
              s.items.slice(0, 6).map((it, i) => ({
                id: `${s.source}-${i}`,
                source: s.source,
                region: s.region,
                title: it.title,
                hot: it.hot,
                url: it.url,
              }))
            )
          return (
        <section className="agent-hotspot bg-[#05050a] text-[#e6eaf2] relative">
          <div className="w-full h-full flex flex-col" style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
            {/* 顶栏 */}
            <div className="shrink-0 h-12 px-4 flex items-center gap-3 border-b border-white/[0.07] bg-[#0a0e16]/90">
              <span className="inline-block h-2 w-2 rounded-full bg-[#ff5a3c] animate-pulse" />
              <h2 className="text-[13px] font-semibold tracking-wide text-white">AiMarketing · 全球热点感知中枢</h2>
              <span className="text-[10px] text-[#6b7180] hidden sm:inline">实时聚合 · 多源容错 · 拖拽地球旋转</span>
              <div className="ml-auto flex items-center gap-3 text-[10px] text-[#6b7180]">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#4f8cff]" />卫星在线</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#3ad29f]" />AI引擎: 在线</span>
                <button onClick={loadHotTopics} className="px-2.5 py-1 rounded-md bg-white/[0.05] hover:bg-white/10 text-[#aab2c2] transition">
                  {hotLoading ? '刷新中…' : '↻ 刷新'}
                </button>
                <button onClick={() => setHotspotOpen(false)} className="px-2.5 py-1 rounded-md bg-white/[0.05] hover:bg-white/10 text-[#aab2c2] transition">✕ 关闭</button>
              </div>
            </div>
            {/* 统计条 */}
            <div className="shrink-0 h-10 flex items-stretch border-b border-white/[0.07] bg-[#0a0e16]/60 text-[10px]">
              {[
                ['国内信源', String(cnSources.length), '#ff8a3c'],
                ['全球信源', String(globalSources.length), '#4f8cff'],
                ['监测话题', String(totalItems), '#3ad29f'],
                ['实时抓取率', `${Math.round((hotTopics.length / (cnSources.length + globalSources.length || 1)) * 100)}%`, '#b098f0'],
              ].map(([label, val, color], i) => (
                <div key={i} className="flex-1 flex items-center gap-2 px-4 border-r border-white/[0.05]">
                  <span className="text-[#6b7180]">{label}</span>
                  <span className="text-[15px] font-bold" style={{ color }}>{val}</span>
                </div>
              ))}
            </div>
            {/* 三柱主体（复刻 BaiLongma：左右柱 percentage + min-width，地球 flex:1 1 0 + min-h-0） */}
            <div className="flex-1 flex overflow-hidden min-h-0">
              {/* 左柱：国内平台热榜（头部 1 个固定展开 + 其余折叠手风琴） */}
              <div className="flex-[0_0_23%] min-w-[150px] shrink-0 flex flex-col gap-px overflow-y-auto bg-white/[0.02] border-r border-white/[0.07]">
                {leftSources.length === 0 && <p className="text-[11px] text-[#5a6072] text-center py-8">暂无国内热榜</p>}
                {leftSources.map((src, idx) => {
                  const isFirst = idx === 0
                  return (
                    <HotListCard
                      key={src.source}
                      source={src.source}
                      items={src.items}
                      accent="#ff8a3c"
                      collapsed={!isFirst && src.source !== leftOpen}
                      onToggle={isFirst ? undefined : () => setLeftExpanded((cur) => (cur === src.source ? null : src.source))}
                      onPick={(t) => { trackAttention(src.source); sendMessage(`结合「${t}」这个热点，帮我出一个适合自媒体发布的内容方案`) }}
                    />
                  )
                })}
              </div>
              {/* 中柱：地球 + 辅助信息（复刻 BaiLongma 结构，地球 flex:1 1 0 + min-h-0） */}
              <div className="flex-1 flex flex-col min-w-0 min-h-0">
                {/* 地球容器：占满中柱剩余高度(flex-1 min-h-0)，内部正方形以高定宽，绝不挤压底部卡片 */}
                <div className="flex-1 min-h-0 flex items-center justify-center py-2">
                  <div className="relative h-full aspect-square max-w-full" style={{ background: 'radial-gradient(ellipse at center, #0a1a2e 0%, #050b14 100%)' }}>
                    {hotTopics.length > 0 ? <GlobeTrends sources={hotTopics} /> : (
                      <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[#5a6072]">暂无热点数据</div>
                    )}
                  </div>
                </div>
                {/* 辅助：区域关注度 + 情绪指数（固定高度底部条，正常 flex 流） */}
                <div className="shrink-0 h-[110px] flex border-t-2 border-[#1c2740] bg-[#070d18]">
                  <div className="flex-1 p-2.5 border-r border-white/[0.07] overflow-hidden">
                    <div className="text-[10px] text-[#aab2c2] font-semibold mb-1.5">发布次数 <span className="text-[8.5px] text-[#6b7180] font-normal">已发布平台</span></div>
                    <div className="flex flex-col gap-1.5">
                      {regionRows.map((r) => (
                        <div key={r.name} className="flex items-center gap-2">
                          <span className="text-[9.5px] text-[#aab2c2] w-[52px] shrink-0 truncate">{r.name}</span>
                          <div className="flex-1 h-[3px] bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${(r.pct / regionMax) * 100}%`, background: 'linear-gradient(90deg,#4f8cff,#88ccff)' }} />
                          </div>
                          <span className="text-[9px] text-[#6b7180] w-7 text-right">{r.pct}</span>
                        </div>
                      ))}
                      {regionRows.length === 0 && <span className="text-[9px] text-[#5a6072]">暂无数据</span>}
                    </div>
                  </div>
                  <div className="w-[150px] shrink-0 p-2.5 flex flex-col items-center justify-center">
                    <div className="text-[10px] text-[#aab2c2] font-semibold mb-1 self-start">情绪指数 <span className="text-[8.5px] text-[#6b7180] font-normal">演示指标</span></div>
                    <div className="relative w-[68px] h-[68px]">
                      <svg viewBox="0 0 36 36" className="w-[68px] h-[68px] -rotate-90">
                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="#3ad29f" strokeWidth="3" strokeLinecap="round"
                          strokeDasharray={`${(sentiment / 100) * 97.4} 97.4`} />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[16px] font-bold text-white">{sentiment}</span>
                        <span className="text-[8px] text-[#6b7180]">积极</span>
                      </div>
                    </div>
                    <span className="text-[9.5px] text-[#3ad29f] mt-1">▲ 较昨日 +3</span>
                  </div>
                </div>
                {/* 实时事件流（复刻 BaiLongma hs-feed-bar：区域关注度下方、跑马灯上方的横向卡片轮播） */}
                <VideoFeedBar videos={trendVideos} onPlay={handlePlayVideo} />
              </div>
              {/* 右柱：视频推荐（2026-08-08：TikTok/YouTube/X，点击播放；文字热榜已并入左柱） */}
              <div className="flex-[0_0_23%] min-w-[150px] shrink-0 flex flex-col gap-2 overflow-y-auto bg-white/[0.02] border-l border-white/[0.07] p-2">
                <div className="text-[10px] text-[#aab2c2] font-semibold mb-0.5">🎬 视频推荐 <span className="text-[8.5px] text-[#6b7180] font-normal">点击播放</span></div>
                {trendVideos.length === 0 && <p className="text-[10px] text-[#5a6072] text-center py-6">视频加载中…</p>}
                {trendVideos.map((v, i) => (
                  <button key={i} onClick={() => handlePlayVideo(v.url, v.title)}
                    className="group shrink-0 flex flex-col gap-1.5 rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.03] hover:border-[#ff6b4f]/40 hover:bg-white/[0.06] transition text-left">
                    {v.thumbnail && (
                      <div className="relative w-full aspect-video bg-black/40">
                        <img src={v.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                          <span className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white text-xs">▶</span>
                        </span>
                      </div>
                    )}
                    <div className="px-2 pb-2">
                      <span className="text-[8px] px-1 py-0.5 rounded bg-[#2a1a2e] text-[#ff9f7a]">{v.platform}</span>
                      <p className="text-[10px] text-[#cdd3e0] line-clamp-2 mt-1 leading-snug">{v.title}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            {/* 底部跑马灯（复刻 BaiLongma：flex 正常流 flex:0 0 auto，不绝对定位，不挤压地球） */}
            {tickerItems.length > 0 && (
              <div className="shrink-0 h-8 flex items-center border-t border-white/[0.07] bg-[#0a0e16]/85 overflow-hidden">
                <span className="shrink-0 px-3 text-[10px] font-bold text-[#ff5a3c] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#ff5a3c] animate-pulse" /> LIVE 实时热点
                </span>
                <div className="flex-1 overflow-hidden relative">
                  <div className="relative inline-flex whitespace-nowrap animate-[hsmarquee_40s_linear_infinite] text-[11px] text-[#aab2c2] will-change-transform">
                    {[...tickerItems, ...tickerItems].map((t, i) => (
                      <span key={i} className="mx-6"><span className="text-[#6b7180]">[{t.src}]</span> {t.title}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
          )
        })()}

        {/* 全局视频播放器（对话/语音"找视频"统一播放） */}
        <VideoPlayer state={player} onClose={() => setPlayer({ open: false, url: '', title: '' })} />

      </div>
    </div>
  )
}
