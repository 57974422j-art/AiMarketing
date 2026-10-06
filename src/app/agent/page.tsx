'use client'
import React from 'react'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { PLATFORM_NAMES, PLATFORMS } from '@/lib/agent/platforms'
// ★VF_LEAD_V1（2026-09-29 老板定案）：「智能获客」面板所需的常量与纯函数（无副作用，客户端可直接引）
import {
  LEAD_PLATFORMS, LEAD_SPEED_PRESETS, LEAD_DATA_SOURCES, LEAD_DEFAULT_TIER,
  LEAD_SCRIPT_MAX, LEAD_CFG_PREFIX,
  defaultCheckedPlatforms, cleanLeadText, resolveLeadSpeed,
} from '@/lib/agent/lead'
import { useAuth } from '@/app/providers'
// ★VF_MODELSWITCH_V1（2026-09-30 用户原话「不行加一个模型切换，我试试，deepseek-v4.1_flash 和
//   阿里的多模态模型 我切换这试试。每个模型可能理解能力也不一样」）：
//   模型档位选择器挂在【AI 设置】弹窗里（就在「回复温度」下面）—— 用户调温度的地方就能切模型。
//   本文件只引【纯数据 + 纯函数】（model-catalog.ts 零副作用、不 import prisma），客户端直接可用。
//   读写走后端已有的 /api/agent/prefs（它已支持 modelChoice，存 SystemConfig，不新增表）。
import {
  MODEL_PRESET_LIST, BRAIN_MODELS, WRITER_MODELS, resolveModelChoice,
  type ModelPresetId,
} from '@/lib/agent/model-catalog'
// ★VF_STYLES_WIRE_V1（2026-10-01 用户定案「目前模版有2套我是不是有点乱。能统一一下吗？」）：
//   「🎨 画面风格」的 5 套成品风格（唯一真相源 = 渲染层 scripts/video-factory/themes.py 的 STYLES；
//   TS 侧在 anti-ai.ts 的 VF_STYLES，纯数据零副作用 → 客户端可直接引，界面不会与归一化规则漂移）。
import { VF_STYLES } from '@/lib/agent/vf/anti-ai'
import TourGuide from '@/components/TourGuide'
import { Solar } from 'lunar-javascript'
import { createPortal } from 'react-dom'
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
// ★TYPE_CLEAN_V1（2026-09-21）：返回类型补 `'link'` —— 下面 TikTok/X 分支确实会返回 'link'
//   （历史上就是运行时正确、只是类型注解没跟上 → IDE 报 3 条错、且 `kind === 'link'` 被判成"不可能的比较"）
function iframeUrlFor(raw: string): { kind: 'iframe' | 'video' | 'link'; url: string } {
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
    // TikTok（2026-08-09：官方 embed 端点；无 id 走链接）
    if (h.includes('tiktok.com')) {
      const vid = url.pathname.match(/\/video\/(\d+)/)
      return { kind: vid ? 'iframe' : 'link', url: vid ? `https://www.tiktok.com/embed/v2/${vid[1]}` : u }
    }
    // X / Twitter（2026-08-09：无公开嵌入，新窗口打开）
    if (h.includes('x.com') || h.includes('twitter.com')) {
      return { kind: 'link', url: u }
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
  // 2026-09-02: 版本校验自动刷新（部署后新前端——自动 reload 拿新 chunk——不用手动 Ctrl+F5）
  useEffect(() => {
    try {
      fetch('/api/client-info', { credentials: 'include' }).then(r => r.json()).then((vj: any) => {
        const v = vj?.data?.buildCommit || vj?.data?.version || ''
        if (v) {
          const oldV = localStorage.getItem('agent_version')
          if (oldV && oldV !== v) { localStorage.setItem('agent_version', v); location.reload() }
          else if (!oldV) localStorage.setItem('agent_version', v)
        }
      }).catch(() => {})
    } catch {}
  }, [])

  useEffect(() => {
    document.body.classList.toggle('video-mode', state.open)
    // 2026-08-11：视频呼出与应用呼出一致——进入 app-mode（对话收窄右 34% + 声纹球头部）
    document.body.classList.toggle('app-mode', state.open)
    return () => { document.body.classList.remove('video-mode', 'app-mode') }
  }, [state.open])
  if (!state.open) return null
  const { kind, url } = iframeUrlFor(state.url)
  return (
    // 2026-08-09 白龙马式：视频占左 66%，AI 对话区右侧 34% 并存不遮挡；body.video-mode 侧栏滑出
    <div className="fixed top-0 left-0 bottom-0 w-[66vw] z-40 flex items-center justify-center bg-[#05070d]/92 border-r border-white/10" onClick={onClose}>
      <div
        className="relative w-[92%] bg-[#060a12] rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/[0.03]">
          <span className="text-[12px] text-gray-200 truncate max-w-[80%]">{state.title || '视频播放'}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-base leading-none px-2 py-0.5 rounded hover:bg-white/10">✕</button>
        </div>
        <div className="relative w-full bg-black" style={{ aspectRatio: '16 / 9' }}>
          {kind === 'link' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <p className="text-[12px] text-gray-300">该平台不支持站内嵌入播放</p>
              <button onClick={() => window.open(url, '_blank')}
                className="px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs hover:bg-emerald-500/30 transition">
                在浏览器中打开 ↗
              </button>
            </div>
          ) : kind === 'video' ? (
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

  // ── 2026-08-20: TTS 队列串行化——同一条朗读未完不插入第二条（修复"一条没结束又来一条又开始读"）；stop 清空排队 ──
  const ttsQueueRef = useRef<Array<{ text: string; voice?: string; resolve: () => void }>>([])
  const ttsPlayingRef = useRef(false)
  const _doSpeak = async (text: string, voice?: string): Promise<void> => {
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
    ttsQueueRef.current = []   // 清空排队（停止后不再自动读后续）
    if (audioRef.current) {
      audioRef.current.pause()
      onVolume?.(0)
      // 打断：主动触发 onended，让 speak() 的 Promise 正常收尾（否则悬挂）
      audioRef.current.onended?.()
      audioRef.current = null
    }
  }

  const pumpTts = async () => {
    const q = ttsQueueRef.current
    if (ttsPlayingRef.current || !q.length) return
    const job = q.shift()!
    ttsPlayingRef.current = true
    try { await _doSpeak(job.text, job.voice) } catch {} finally {
      ttsPlayingRef.current = false
      job.resolve()
      pumpTts()
    }
  }
  const speak = (text: string, voice?: string): Promise<void> => {
    return new Promise<void>((resolve) => {
      ttsQueueRef.current.push({ text, voice, resolve })
      pumpTts()
    })
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
  scenes?: SceneCard[] | null
  attachments?: { name: string; url: string; type: string; frames?: string[] }[]  // 2026-09-06: 附件独立字段（不再塞 content Markdown）
  videoUrl?: string  // 2026-09-06: 视频结果独立字段（不再塞 content 技术标记）
}

interface Attachment { name: string; url: string; type: string }

// ★2026-09-22（用户实测「播放 3~4 秒必卡一下」）：本地仓库镜像**去重** —— 同一文件只镜像一次。
//   原因：成片完成卡原来在**渲染函数体内**直接调 electronAPI.storageMirror，
//   每次重渲染都会再发一次 IPC；首次是"整文件下载"，会和正在播放的 <video> 抢带宽（放大卡顿）。
const MIRRORED_ONCE = new Set<string>()

// ★VF_SBDUMP_V1（2026-09-29 用户定案）：分镜留档去重（同一份分镜只写一次磁盘）
const STORYBOARD_SAVED = new Set<string>()

const SUGGESTIONS = [
  '今天有什么热点可以蹭？给我 3 个选题',
  '帮我写一条小红书种草文案',
  '用这张图做个数字人口播',
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
  { cmd: '/素材', desc: '检索个人仓库', fill: '帮我在个人仓库里找：' },
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
  search_storage: '检索个人仓库',
  list_personal_files: '列出个人仓库',
  publish_content: '规划发布',
  upsert_memory: '记忆客户画像',
  search_memory: '回忆长期记忆',
  collect_unmet_need: '登记未接入需求',
  clear_memory: '清空旧画像',
  set_agent_profile: '设定助手人设',
  search_trends: '搜索全球热点',
}

// 2026-08-29: 错误边界——React 水合/嵌套错误时不白屏（显示提示+保留数据）
class AgentErrorBoundary extends React.Component<{ children: any }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: any) { return { err: (e && e.message) || String(e) } }
  componentDidCatch(e: any) { console.error('[AgentPage] 渲染异常:', e) }
  render() {
    if (this.state.err) return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] text-gray-300 p-6">
        <div className="max-w-md text-center">
          <p className="text-lg mb-3">页面渲染出现异常</p>
          <p className="text-xs text-gray-500 mb-4 break-all">{(this.state.err).slice(0, 200)}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-sm">刷新重试</button>
          <p className="text-[10px] text-gray-600 mt-4">会话数据已存服务器，刷新后自动恢复</p>
        </div>
      </div>
    )
    return this.props.children
  }
}

/** ★VF_RENDER_ONESHOT_V1（2026-09-29 team-lead 要求 ④）：「只重渲第 N 镜」客户端入口。
 *  片出完后，改一个画面大字/字幕没必要重做整条（重写文案 + 重新配音要 3~4 分钟且再花钱）——
 *  复用已有配音，只重跑渲染，约 1~2 分钟、**不扣点**（服务端走 vf-edit.ts 的 make.py --render-only）。
 *  为什么需要这个按钮：分镜清单卡片只在【出片前】存在；片出完后草稿被作废，界面上就没有入口了。
 *  发的就是 `VF_EDIT:{taskId, edits}`（与分镜清单同一个协议；服务端"无草稿 → 只重渲染"分支处理）。 */
function VfReRenderShot({ taskId, onSend }: { taskId: string; onSend: (msg: string) => void }) {
  const [open, setOpen] = useState(false)
  const [n, setN] = useState('')
  const [txt, setTxt] = useState('')
  const [sub, setSub] = useState('')
  const idx = parseInt(n) || 0
  const ready = idx > 0 && (!!txt.trim() || !!sub.trim())
  const go = () => {
    if (!ready) return
    const e: any = { index: idx }
    if (txt.trim()) e.text = txt.trim()
    if (sub.trim()) e.subtitle = sub.trim()
    onSend('VF_EDIT:' + JSON.stringify({ taskId, edits: [e] }))
    setOpen(false); setN(''); setTxt(''); setSub('')
  }
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(!open)} className="text-[10px] text-gray-400 hover:text-gray-200">
        {open ? '▾' : '▸'} 🔁 只重渲第 N 镜（复用配音，不扣点）
      </button>
      {open && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <input value={n} onChange={(e: any) => setN(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
            placeholder="第几镜" className="w-[64px] px-1.5 py-0.5 rounded text-[10px] bg-white/[0.05] border border-white/[0.08] text-gray-200 placeholder-gray-600 outline-none" />
          <input value={txt} onChange={(e: any) => setTxt(e.target.value)} placeholder="新大字（可空）"
            className="w-[130px] px-1.5 py-0.5 rounded text-[10px] bg-white/[0.05] border border-white/[0.08] text-emerald-200 placeholder-gray-600 outline-none" />
          <input value={sub} onChange={(e: any) => setSub(e.target.value)} placeholder="新字幕（可空；只改字，不重配音）"
            className="flex-1 min-w-[130px] px-1.5 py-0.5 rounded text-[10px] bg-white/[0.05] border border-white/[0.08] text-emerald-200 placeholder-gray-600 outline-none" />
          <button type="button" disabled={!ready} onClick={go}
            className={`px-2.5 py-0.5 rounded text-[10px] ${ready ? 'bg-emerald-500/30 hover:bg-emerald-500/50 text-white' : 'bg-white/[0.03] text-gray-600'}`}>重渲</button>
        </div>
      )}
    </div>
  )
}

// ★VF_FORM_V1（2026-09-20，用户要求）：成片设置表单——一次选完、一次提交
//   背景：老流程“点一个→返回→再点一个”要 3~4 轮（用户原话“感觉有点怪”）。
//   现表单一次提交 VF_FORM:{aspect,dur,voice,source,topic,script}，服务端一次算完。
// ★2026-09-22：加 `userId` 入参 —— 上传后要调 electronAPI.storageMirror（本地仓库镜像），
//   而镜像地址 `/api/storage/file` 强制要 userId；本组件自身拿不到当前用户，由父组件透传。
function VideoFormCard({ vj, onStart, userId }: { vj: any; onStart: (msg: string) => void; userId?: number | string }) {
  const [source, setSource] = useState('repo')
  const [aspect, setAspect] = useState(vj.aspect || 'auto')
  const [dur, setDur] = useState(String(vj.dur || 30))
  const [voice, setVoice] = useState(vj.voice || 'longxiaochun')
  const [topic, setTopic] = useState(vj.topic || '')
  const [script, setScript] = useState('')
  const [bgm, setBgm] = useState('auto')   // ★VF_BGM_V1：默认自动配乐（AI 音乐库挑一首）
  // ★VF_ONELAYER_V1（2026-10-06 用户定案「目的只有一套 PPT 选择…确定重复内容冗余 删除」）：
  //   theme / deck_style **不再上卡** —— 原「高级：主题(10) / PPT 版式(7)」两层手动挡整段删除。
  //   为什么它们是冗余：5 套成品风格（themes.py 的 STYLES）**内部就是 theme + deck 的打包** ——
  //     bluewhite = news + deck ／ darkgrad = data + deck-grad ／ cleanlight = light + deck-soft
  //     ／ magazine = journal + deck-mag ／ softlux = mono + deck-glass（见 themes.py:194-234）
  //   ⇒ 三层并列 = 同一件事的三个旋钮（原本靠"选了风格就把这两层置灰"回避冲突，用户当然觉得乱）。
  //   值仍照原样提交（默认取 vj / 'dark' / 'auto'）—— 服务端契约与「跟随 AI」这条路径**零回归**。
  const theme = vj.theme || 'dark'
  const deckStyle = vj.deckStyle || 'auto'
  // ★VF_STYLES_WIRE_V1（2026-10-01）：「🎨 画面风格」= 5 套成品风格的**主入口**；'' = 跟随 AI / 不指定
  //   （= 不写 plan 根级 style，走老链路 theme + deck_style，行为与今天逐字一致）。
  const [style, setStyle] = useState(vj.style || '')
  // ★OVERLAY_TEXT_SWITCH_V1（2026-09-29 用户定案「在视频图片上直接加大字，加一个开关」）：
  //   只关【压在素材/视频上的大字】；独立文字卡（标题/结尾/列表…）与字幕照旧 ——
  //   用户要的就是"有的视频不一定要，需要文字时用单独的文字卡（几帧）也行"。
  //   选项名按要求"简单点"：加 / 不加。
  const [big, setBig] = useState(vj.big || 'on')
  // ★VF_VIDI2V_V1（2026-09-29 用户定案「图视混剪 → 逐镜图生视频，50 点/秒」）：
  //   「🎞 让图动起来」开关 —— 开=每张图片镜先拿首帧生成一段动图（4~8 秒 ≈ 200~400 点/张，
  //   同一张图只生成一次）；关=全部静态图 + Ken Burns（不额外花钱）。默认开。
  // ★VF_MATUI_V1（2026-09-30 用户定案，覆盖 ★VF_I2VDFLT_V1 的"默认全部动"）：**默认 = 'off'（不动）**。
  //   用户原话：「**能不加 AI 做视频就不加**……加了感觉冲突」；「全部动效 = 调 H3 逐镜生成视频也不是
  //   完全没用，在**图片成片可选 1、2 个**，增加效果」。
  //   四档：off（默认·不调 AI·0 点动图）/ picked（只动清单里打了勾 🎞 的）/ on（智能筛）/ all（全部）。
  const [i2v, setI2v] = useState(vj.i2v || 'off')
  // ★VF_BANNER_V1（2026-09-29 用户定案）：「📌 顶部固定标题」开关 —— 开=AI 自动拟两行（黄字黑边 +
  //   半透明色块白字），全程钉在画面顶部不动；关=不画。默认「自动」（用户要"默认这样，方便后期集成自动化"）。
  const [pin, setPin] = useState(vj.pin || 'on')
  // ★VF_BANNER_PIN2_V1（2026-09-29 用户定案）：手动覆盖固定标题的两行（留空 = AI 自动拟）。
  //   为什么加：AI 拟的标题偶尔不合心意，得让用户能直接写死（两行都填 → 服务端完全不调 AI）。
  const [pin1, setPin1] = useState(vj.pin1 || '')
  const [pin2, setPin2] = useState(vj.pin2 || '')
  const [openAdv, setOpenAdv] = useState(false)
  // ★VF_PPT_SPLIT_V1（2026-10-06 用户定案「彻底拆开」）：本卡（图片成片 / 素材线）**不再有「成片方式」选择** ——
  //   动态 PPT 独占给独立的「PPT成片」线（`VF_ENGINE_UI_V1` 的 engine state 与两个按钮一并删除）。
  //   VF_FORM 里仍带 engine:'classic'（服务端也会强制），只为兼容旧客户端。
  // ★VF_UPLOAD_V1（2026-09-20）：「📤 我上传素材」真正可用 —— 选文件 → 传到个人仓库
  //   （POST /api/storage/files，与素材页同一个接口）→ 本次成片只从【最近上传】取画面。
  // ★VF_UPLOAD_FIX_V1（2026-09-20，用户实测“点了点不动/不弹窗，重启客户端也一样”）：
  //   对比“聊天输入框的上传图片”（能用）：两边写法几乎一致，**唯一实质差异是表单按钮写了
  //   `disabled={uploading}`** —— 一旦 uploading 卡住，按钮就是【静默点不动】：不报错、不弹框。
  //   这里**照抄能用的那套**：① 不加 disabled ② ref 类型对齐 ③ 用可选链 .click()
  //   ④ input 挪出 flex 行 ⑤ 重复保护改用内部守卫（不再禁用按钮）
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  // ★VF_LINETAG_V1（2026-10-06）：本卡被两条线共用（图片成片 `line='local'` / 图视混剪 `line='video'`，
  //   由服务端 formCard 下发）—— **只有图视混剪吃视频**，所以"视频会不会被画出来"这类话必须按线出。
  //   旧版是一句替图片成片写的硬编码文案、两线共用 ⇒ 图视混剪被误告"视频不会被画出来"（用户实测）。
  const isVideoLine = String(vj.line || '') === 'video'

  // ★VF_VIDHINT_V1（2026-09-24 用户实测）：上传框的 accept 里带着 `video/*`（视频**能传**），
  //   但成片画面只从【图片】里取（分镜的 pick 只索引图片），视频只会出现在"素材识别结果"里。
  //   而传完却提示"本次成片的画面只从这批里取" → 用户以为视频会被用上 = **误导**。
  //   现在把"这批里有几个视频"记下来，上传结果里**如实说清**（视频正式支持另开一条线）。
  const [vidN, setVidN] = useState(0)
  const doUpload = async (files: FileList | null) => {
    if (!files || !files.length) return
    setSource('upload')
    setUploading(true)
    const okNames: string[] = []
    let _vid = 0
    try {
      for (const f of Array.from(files).slice(0, 30)) {
        if (/\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(f.name) || String(f.type || '').startsWith('video/')) _vid++
        try {
          const fd = new FormData()
          fd.append('file', f)
          const r = await fetch('/api/storage/files', { method: 'POST', body: fd })
          const j = await r.json().catch(() => null)
          if (j && j.success) {
            const _nm3 = String((j.data && j.data.name) || f.name)
            okNames.push(_nm3)
            // ★2026-09-22（用户要求：本页"生成/上传"的都要个人仓库 + 本地仓库双落地）
            if (!MIRRORED_ONCE.has(_nm3)) {
              MIRRORED_ONCE.add(_nm3)
              try { (window as any).electronAPI?.storageMirror?.(`/api/storage/file?userId=${userId || ''}&name=${encodeURIComponent(_nm3)}`) } catch {}
            }
          }
        } catch {}
      }
    } finally {
      setUploading(false)
      setUploaded(okNames)
      setVidN(_vid)
    }
  }

  const R = (cur: string, val: string, label: string, set: (v: string) => void, dis = false) => (
    <button key={val} disabled={dis} onClick={() => set(val)}
      className={`px-2 py-1 rounded text-[11px] border transition ${cur === val ? 'bg-fuchsia-500/30 border-fuchsia-400/50 text-white' : dis ? 'bg-white/[0.03] border-white/[0.06] text-gray-600 cursor-not-allowed' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>{label}</button>
  )

  // ★VF_SRC_SPLIT_V1（2026-09-21，用户定案）：本卡原来的「全部 AI 生成」已拆到独立的 AI 制片线 →
  //   原来那条"切到 AI 模式就把画幅强制成竖屏"的 useEffect 一并删除（本卡不再有 AI 模式档）。
  return (
    <div className="mb-2 p-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/[0.06]">
      <div className="text-xs text-fuchsia-300 mb-3">🎬 成片设置{typeof vj.hint === 'string' && vj.hint ? ' · ' + vj.hint : ''}</div>

      {/* ★VF_PPT_SPLIT_V1（2026-10-06 用户定案「彻底拆开」）：本卡 = 图文成片（老引擎）专用。
          动态 PPT（HTML 逐帧 deck）自今日起是**独立一线**，入口词「PPT成片」——
          两条线时序真源不同（本线 = 分镜 dur；deck = 配音句），混在一起会出现"卡片承诺 6s/镜、
          实际一页 20 秒"这种对不上的现象（2026-10-06 实测 20261006_001）。
          ★VF_ONELAYER_V1（2026-10-06）：原「成片方式」一整段（纯架构说明、没有任何可选项）删除；
          唯一还需要用户知道的那句「要做动态 PPT 走独立线」已并进下面「🎨 画面风格」的说明行。 */}

      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">画面来源</div>
        <div className="flex flex-wrap gap-1.5">
          {R(source, 'repo', '🎞 素材合成（用我仓库）', setSource)}
          {/* ★VF_SRC_SPLIT_V1（2026-09-21，用户定案）：本卡**只留素材线自己的两个来源** ——
              「✨ 素材+AI 混合」与「🎨 全部 AI 生成」**已从这里拆掉**：它们各自是**独立的线**
              （`src/lib/agent/vf/vf-mix.ts` / `vf-aivideo.ts`，各有自己的入口词与卡片）。
              用户原话：「把『用本地成片帮我做一条视频』中的 素材+AI混合、全部AI生成 帮我拆掉，
              免得你搞不清。」→ 一个概念只留一条路，杜绝"同一个按钮落在不同线"。
              要那两种：直接说「素材+AI」/「AI 制片」。 */}
          {/* ★VF_UPLOAD_FIX_V1：照抄“聊天那个能用的写法” —— 不加 disabled（否则可能永久点不动） */}
          {/* ★VF_SRC_SPLIT_V1（2026-09-21）：「全部 AI 生成」已从本卡拆掉 → `source==='ai'` 的
              置灰逻辑一并删除（本卡不再有 AI 模式这一档；AI 画面请走 AI 制片那条线）。 */}
          <button
            onClick={() => { if (uploading) return; if (fileRef.current) fileRef.current.click() }}
            className={`px-2 py-1 rounded text-[11px] border transition ${source === 'upload' ? 'bg-fuchsia-500/30 border-fuchsia-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>
            {uploading ? '⏳ 上传中…' : (isVideoLine ? '📤 我上传素材（图片 + 视频）' : '📤 我上传素材（图片）')}
          </button>
        </div>
        {/* ★VF_LINETAG_V1（2026-10-06·A2）：accept 也按线走 —— 图片成片只吃图片，
            就别让文件框能选到视频（选了不用 = 就是"误导"的老毛病；要视频请走「图视混剪」）。 */}
        <input ref={fileRef} type="file" accept={isVideoLine ? 'image/*,video/*' : 'image/*'} multiple className="hidden"
          onChange={(e: any) => { doUpload(e.target.files); e.target.value = '' }} />
        {uploaded.length > 0 && (
          <div className="text-[10px] mt-1">
            <span className="text-emerald-300/80">✅ 已上传 {uploaded.length} 个到个人仓库</span>
            {vidN > 0 ? (
              // ★VF_LINETAG_V1（2026-10-06 用户实测「图视混剪这里还是提示不认识视频」）：按线分流 ——
              //   图视混剪（line='video'）的视频**真会被画进片子**（每镜 ≤10s、原声静音、配音统一铺）；
              //   图片成片（line='local'）才只说图片，并顺手指路「图视混剪」。
              isVideoLine ? (
                <div className="text-emerald-300/90 mt-0.5">
                  ✅ 其中 <b>{vidN} 个是视频</b>：<b>会被画进片子里</b>（每个视频镜头最多取 10 秒、原声默认静音，
                  配音与字幕统一铺满）。本次成片**只用你刚传的这批**，不掺仓库旧素材。
                </div>
              ) : (
                <div className="text-amber-300/90 mt-0.5">
                  ⚠️ 其中 <b>{vidN} 个是视频</b>：本线（图片成片）的画面**只用图片**，视频不会被画出来
                  （只会出现在"素材识别结果"里）。要视频混剪请用入口词「<b>图视混剪</b>」。
                  {uploaded.length === vidN
                    ? '你这次只传了视频 → 成片会是【纯文字卡】版（没有素材画面），建议再传几张图片。'
                    : '建议主要用图片，或把视频里的关键画面截图一并上传。'}
                </div>
              )
            ) : (
              <span className="text-emerald-300/80"> —— 本次成片的画面只从这批里取</span>
            )}
          </div>
        )}
        {source === 'upload' && !uploaded.length && !uploading && (
          <div className="text-[10px] text-amber-300/80 mt-1">
            {isVideoLine
              ? '点「📤 我上传素材」选图或选视频（可多选）；传了就只有这批参与成片，仓库里的旧素材不会掺进来'
              : '点「📤 我上传素材」选图（可多选；要视频请用「图视混剪」）；不选则用仓库现有的'}
          </div>
        )}
      </div>

      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">画幅</div>
        <div className="flex flex-wrap gap-1.5">
          {R(aspect, 'auto', '自动（按素材判断）', setAspect)}
          {R(aspect, 'portrait', '竖屏 9:16', setAspect)}
          {R(aspect, 'landscape', '横屏 16:9', setAspect)}
        </div>
      </div>

      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">时长</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {['30', '60', '90', '180'].map((s) => R(dur, s, s + '秒', setDur))}
          <input value={dur} onChange={(e: any) => setDur(String(e.target.value).replace(/[^\d]/g, '').slice(0, 4))}
            placeholder="自定义秒数"
            className="w-[86px] px-2 py-0.5 rounded text-[11px] bg-white/[0.05] border border-white/[0.08] text-gray-200 placeholder-gray-600 outline-none" />
          <span className="text-[10px] text-emerald-300/70">≈ {Math.round((parseInt(dur) || 30) * 4.5)} 字文案</span>
        </div>
      </div>

      {/* ★VF_AVIMG_V1（2026-10-05 用户定案「新制片也要配音和BGM」）：新引擎已支持配音+BGM —— 音色恢复可选 */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">配音音色</div>
        <div className="flex flex-wrap gap-1.5">
          {(Array.isArray(vj.voices) ? vj.voices : []).map((v: any) => R(voice, String(v.id), '🔊 ' + String(v.name || v.id), setVoice))}
        </div>
      </div>

      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">主题 <span className="text-gray-600">（留空由 AI 决定；也可在下面直接贴文案）</span></div>
        <input value={topic} onChange={(e: any) => setTopic(e.target.value.slice(0, 200))}
          placeholder="例如：咖啡店开业，第二杯半价"
          className="w-full px-2 py-1.5 rounded text-[12px] bg-white/[0.05] border border-white/[0.08] text-gray-200 placeholder-gray-600 outline-none" />
      </div>

      {/* ★VF_AVIMG_V1：新引擎已支持 BGM —— 配乐恢复可选 */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">背景音乐 <span className="text-gray-600">（AI 音乐库；无人声时也会铺底）</span></div>
        <div className="flex flex-wrap gap-1.5">
          {R(bgm, 'auto', '🎵 自动配乐', setBgm)}
          {R(bgm, 'none', '🔇 不要 BGM', setBgm)}
        </div>
      </div>

      {/* ★VF_STYLES_WIRE_V1（2026-10-01 用户定案「目前模版有2套我是不是有点乱。能统一一下吗？或者删减不成熟的」）：
          把原来并列的【主题（10 个）】+【🎨 画面模版（6 个）】两套下拉，收敛成**一个「🎨 画面风格」主入口**
          （5 套成品风格 + 一个「跟随 AI / 不指定」）。选项键名/中文名逐字来自渲染层 themes.py 的 STYLES。
          「跟随 AI / 不指定」= ''（不写 plan 根级 style）→ 老链路 theme + deck_style，行为与今天逐字一致。
          ★VF_ONELAYER_V1（2026-10-06 用户定案）：当时"旧能力收进高级"只是过渡 —— 现已**整段删除**
             （theme / deck_style 与风格同维度，见下面 ★VF_ONELAYER_V1 注释），本卡**只剩这一层视觉选择**。 */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">
          🎨 画面风格 <span className="text-gray-600">（一套搞定配色 + 整页 PPT 版式；只选一个）</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {R(style, '', '🤖 跟随 AI / 不指定', setStyle)}
          {VF_STYLES.map((s) => R(style, s.id, '🎨 ' + s.name, setStyle))}
        </div>
        {/* ★VF_STYLEPREVIEW_WIRE_V1（2026-10-02 用户原话「当前5个风格最好能加个模版样式。点了能看到…
            这看不到效果盲猜」）：每套风格下方嵌渲染层样张缩略图（/style-preview/<key>-thumb.png），
            点开看大图（<key>.png 要点页 + <key>-data.png 数据页）。缺图时隐藏并显示"样张生成中"，绝不显示破图。 */}
        <VfStyleSamples onPick={setStyle} cur={style} />
        <div className="text-[10px] text-gray-500 mt-1">
          选一套 → 纯文字页会自动排成该风格的整页 PPT（标签条/要点/数据卡/页码）；不选则由 AI 按题材决定。
          <br />本线 = 图文成片（素材画面 + 整页 PPT 版式页混排）。要做**不含素材、整片都是 PPT 版式页**的
          「动态 PPT 成片」请用独立入口词「PPT成片」。
        </div>
      </div>

      {/* ★VF_ONELAYER_V1（2026-10-06 用户定案「目的只有一套 PPT 选择 … 确定重复内容冗余 删除」）：
          原「高级：主题 / PPT 版式」**两段整段删除**（连同 ★VF_STYLELOCK_ADV_V1 的置灰逻辑与两条 amber 提示、
          以及那个默认收起的折叠按钮）。理由 = 与上面「🎨 画面风格」**完全同维度**：
            5 套风格内部就是 theme + deck_style 的打包（themes.py STYLES），选了风格本来就把这两层置灰
            ⇒ 留着只会让用户以为"还要自己组合"，这就是"很乱/其实都是一个东西"的来源。
          ⚠️ 能力去向（不是丢能力，是换入口）：
            · 原来 10 个主题里，news/data/light/journal/mono 这 5 个**就是** 5 套风格内部用的那 5 个
              （bluewhite=news、darkgrad=data、cleanlight=light、magazine=journal、softlux=mono）→ 未丢失；
            · 另外 5 个"裸主题"（dark/blue/tech/mint/vivid）当前无处可选 —— 待「皮肤扩库」把裸主题升级成
              正式皮肤（并与新引擎 10 母版并入同一列表）时，以皮肤卡的形式回归；
            · theme / deckStyle 两个字段**仍照原样提交**（默认 vj / 'dark' / 'auto'），服务端契约与
              「跟随 AI」路径与改前逐字一致（零回归，老草稿照样能出片）。 */}

      {/* ★OVERLAY_TEXT_SWITCH_V1：压在素材/视频上的大字开关（用户：有的视频不一定要） */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">画面大字 <span className="text-gray-600">（压在素材/视频上的字；选"不加"就只留字幕）</span></div>
        <div className="flex flex-wrap gap-1.5">
          {R(big, 'on', '🔤 加', setBig)}
          {R(big, 'off', '🚫 不加', setBig)}
        </div>
      </div>

      {/* ★VF_VIDI2V_V1：让图动起来（逐镜图生视频）——
          只有【图片镜】会动（视频镜本来就动态、文字卡没有图）；同一张图只生成一次；
          费用在分镜卡上如实写（"含让 N 张图动起来：约 M 点"），不藏。 */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">🎞 让图动起来 <span className="text-gray-600">（图片镜用首帧生成 4~8 秒动图 ≈ 250 点/张；同一张图只算一次）</span></div>
        <div className="flex flex-wrap gap-1.5">
          {/* ★VF_MATUI_V1（2026-09-30 用户定案「能不加 AI 做视频就不加」）：**默认 = 不动**。
              四档 ——
                off    = **本次不动用 AI（默认，0 点动图）**：静态图 + 推拉，只花素材钱
                picked = **只动我勾选的**：清单里打了 🎞 勾的素材才生成动图，报价按勾选张数算
                on     = **智能筛**（只动有主体可动的图，省钱）：海报、界面截图、图表这类**自动跳过**
                all    = **全部动起来**：每张图片镜都做，钱按实际张数算
              服务端契约：'off'→off / 'picked'→只动勾选 / 'all'→all / 其余→on
              （见 i2v-plan.buildI2vShots 注释）。 */}
          {R(i2v, 'off', '🚫 本次不动用 AI（默认，0 点动图）', setI2v)}
          {R(i2v, 'picked', '🎞 只动我勾选的（在素材清单里打勾）', setI2v)}
          {R(i2v, 'on', '🎞 智能筛（只动有主体可动的图，省钱）', setI2v)}
          {R(i2v, 'all', '🎞 全部动起来（每张都做）', setI2v)}
        </div>
        <div className="text-[10px] text-gray-500 mt-1">
          （「图片成片」与「图视混剪」两条线都生效；**默认不动、不花 AI 的钱**。想加动效再选：
          「只动我勾选的」= 到下面素材清单里勾 🎞；「智能筛」会**自动跳过**海报/界面截图这类"动了也看不出"的图；
          「全部动起来」= 每张都做。报价一律按实际要动的张数算）
        </div>
      </div>

      {/* ★VF_BANNER_V1：顶部固定标题（AI 自动拟两行）—— 只做「自动 / 不要」两个按钮，默认自动 */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">📌 顶部固定标题 <span className="text-gray-600">（全程钉在画面顶部的两行；AI 自动拟，颜色随机）</span></div>
        <div className="flex flex-wrap gap-1.5">
          {R(pin, 'on', '✨ 自动', setPin)}
          {R(pin, 'off', '🚫 不要', setPin)}
        </div>
        {/* ★VF_BANNER_PIN2_V1（2026-09-29 用户定案）：手动覆盖两行 —— 留空 = AI 自动拟；填了就优先用你写的
            （服务端同样会去 emoji / 去 markdown / 截断到 12 / 18 字；两行都填 → 完全不走 AI）。 */}
        {pin !== 'off' && (
          <div className="mt-1.5">
            <div className="text-[10px] text-gray-500 mb-1">想自己定这两行就填这里（留空 = AI 自动拟）</div>
            <div className="flex flex-col gap-1.5">
              <input value={pin1} onChange={(e: any) => setPin1(e.target.value.slice(0, 60))}
                placeholder="顶部标题第 1 行（≤12 字）"
                className="w-full px-2 py-1 rounded text-[11px] bg-white/[0.05] border border-white/[0.08] text-gray-200 placeholder-gray-600 outline-none" />
              <input value={pin2} onChange={(e: any) => setPin2(e.target.value.slice(0, 80))}
                placeholder="顶部标题第 2 行（≤18 字）"
                className="w-full px-2 py-1 rounded text-[11px] bg-white/[0.05] border border-white/[0.08] text-gray-200 placeholder-gray-600 outline-none" />
            </div>
          </div>
        )}
      </div>

      <button onClick={() => setOpenAdv(!openAdv)} className="text-[10px] text-gray-500 hover:text-gray-300 mb-2">
        {openAdv ? '▲ 收起「我已有文案」' : '▼ 我已有文案（点这里贴）'}
      </button>
      {openAdv ? (
        <textarea value={script} onChange={(e: any) => setScript(e.target.value.slice(0, 4000))}
          rows={4} placeholder="把你的文案整段贴这里；贴了就用你的，不再由 AI 写"
          className="w-full mb-3 px-2 py-1.5 rounded text-[12px] bg-white/[0.05] border border-white/[0.08] text-gray-200 placeholder-gray-600 outline-none" />
      ) : null}

      <button
        onClick={() => onStart('VF_FORM:' + JSON.stringify({
          // ★VF_PPT_SPLIT_V1（2026-10-06）：本线只出老引擎 —— deck 已独占给独立的「PPT成片」线（服务端也会强制）
          engine: 'classic',
          aspect, dur: parseInt(dur) || 30, voice, source, topic, script, bgm, theme, big,
          // ★VF_DECK_STYLES_V1 / ★VF_ONELAYER_V1（2026-10-06）：deckStyle 已不再上卡（冗余层删除），
          //   但**仍按原值提交** —— 选了「🎨 画面风格」时由风格内部决定，没选时 = 'auto'（AI 按题材选）。
          //   服务端 trim/normalize 契约与改前逐字一致（零回归）。
          deckStyle,
          // ★VF_STYLES_WIRE_V1：🎨 画面风格（'' = 跟随 AI / 不指定 | 5 套成品风格）——
          //   服务端 normalizeStyle 归一后，出片时写进 plan 根级 `style`（渲染层 apply_style 读它）。
          style,
          // ★VF_VIDI2V_V1：让图动起来（'on'|'off'）—— 服务端 vf-video.ts 解析 f.i2v，关掉就完全不注入首帧
          i2v,
          // ★VF_BANNER_V1：顶部固定标题（'on' 默认自动拟两行 | 'off' 不要）—— 服务端解析后决定 plan 是否带 banner
          pin,
          // ★VF_BANNER_PIN2_V1：手填的两行（留空 = AI 自动拟；两行都填 → 完全不调 AI，见 banner.ts 的 buildBanner）
          pin1, pin2,
          // ★VF_UPLOAD_V2（2026-09-20）：把**刚上传的文件名**一起发给后端 → 成片精确只用这几张
          //   （不再靠后端"按时间猜最近"，也就不会再挑到旧素材）
          // ★VF_AIVIDEO_V1（2026-09-20）：AI 模式下**不提交 uploaded** —— 免得日志与后续判断里
          //   残留"这次用了刚上传的图"的错觉（AI 模式的画面由 H3 生成，素材只当参考）。
          ...(uploaded.length && source !== 'ai' ? { uploaded } : {}),
        }))}
        className="w-full px-4 py-2 rounded-lg bg-fuchsia-500/50 hover:bg-fuchsia-500/80 text-sm text-white font-medium">
        🚀 开始出片
      </button>
      <div className="text-[10px] text-gray-500 mt-1">点一下就走 —— 服务器一次算完（取素材 + 写文案 + 排分镜），然后给你确认卡</div>
    </div>
  )
}

// ★VF_LINES_V1（2026-09-21）：【AI 制片】专属卡（用户定案的三步流程）
//   卡1 `ai_setup`：主题（可留空→看素材库猜）+ 上传素材（防止素材库混乱把文案带偏）
//   卡2 `ai_opts` ：文案写好后确认 横竖屏 / 时长 / 成片风格（一张卡；配音配乐不上卡）
//   卡3 `script`  ：分镜清单（含收尾镜）→ 确认出片
//   ⚠️ 不再复用素材合成那张完整表单（用户实测："你搞 2 个一样的"）。

/** 卡1：主题（可留空）+ 上传素材 */
// ★2026-09-22：加 `userId` 入参（同上：上传后要在客户端镜像到本地仓库）
function VfAiSetupCard({ vj, onStart, userId }: { vj: any; onStart: (msg: string) => void; userId?: number | string }) {
  const [topic, setTopic] = useState<string>(String(vj.topic || ''))
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const doUpload = async (files: FileList | null) => {
    if (!files || !files.length) return
    setUploading(true)
    const okNames: string[] = []
    try {
      for (const f of Array.from(files).slice(0, 30)) {
        try {
          const fd = new FormData()
          fd.append('file', f)
          const r = await fetch('/api/storage/files', { method: 'POST', body: fd })
          const j = await r.json().catch(() => null)
          if (j && j.success) {
            const _nm2 = String((j.data && j.data.name) || f.name)
            okNames.push(_nm2)
            // ★2026-09-22（用户要求：本页"生成/上传"的都要个人仓库 + 本地仓库双落地）
            if (!MIRRORED_ONCE.has(_nm2)) {
              MIRRORED_ONCE.add(_nm2)
              try { (window as any).electronAPI?.storageMirror?.(`/api/storage/file?userId=${userId || ''}&name=${encodeURIComponent(_nm2)}`) } catch {}
            }
          }
        } catch { /* 单张失败继续 */ }
      }
    } finally {
      setUploading(false)
      setUploaded((prev) => prev.concat(okNames))
    }
  }

  const go = () => onStart('VF_FORM:' + JSON.stringify({
    topic: topic.trim(),
    ...(uploaded.length ? { uploaded } : {}),
  }))

  return (
    <div className="mb-2 p-3 rounded-xl border border-violet-500/30 bg-violet-500/[0.06]">
      <div className="text-xs text-violet-300 mb-3">{vj.hint || 'AI 制片'}</div>

      <div className="mb-2">
        <div className="text-[10px] text-gray-400 mb-1">主题（留空我就看你的素材库猜）</div>
        <input value={topic} onChange={(e: any) => setTopic(e.target.value)}
          placeholder="例如：咖啡店开业，第二杯半价"
          className="w-full px-2 py-1 rounded text-[12px] bg-white/[0.05] border border-white/[0.08] text-gray-200 placeholder-gray-600 outline-none" />
      </div>

      <div className="mb-3">
        <button onClick={() => { if (uploading) return; fileRef.current?.click() }}
          className={`px-2.5 py-1 rounded text-[11px] border transition ${uploaded.length ? 'bg-emerald-500/25 border-emerald-400/40 text-emerald-100' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>
          {/* ★VF_LINETAG_V1（2026-10-06·A2）：与「图片成片/图视混剪」那张卡**统一口径** ——
              ① 回显统一成"本次只从这几张取（不掺仓库）"；② 明说本线**只吃图片**（本线画面 = 素材 + AI 生成，
              视频进来没有意义）⇒ 而不是让用户以为"传了就会被用"。accept 保持 image/*（不放开视频，
              放开只会制造新的"传了不用"误导）。 */}
          {uploading ? '⏳ 上传中…' : (uploaded.length ? `📤 已上传 ${uploaded.length} 张（本次只从这几张取，不掺仓库）` : '📤 上传这次的素材（可选 · 本线只吃图片）')}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e: any) => { doUpload(e.target.files); e.target.value = '' }} />
        {vj.hintUpload ? <div className="text-[10px] text-gray-500 mt-1">{vj.hintUpload}</div> : null}
      </div>

      {/* ★VF_I2V_V1（2026-09-29）：图生视频 UI 入口（用户不用记命令词）。
          点了先走服务端报价、回「图生视频确认卡」，再点一下才真正扣费生成。 */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={go}
          className="px-4 py-1.5 rounded-lg bg-violet-500/40 hover:bg-violet-500/70 text-sm text-white font-medium">
          🚀 开始出片
        </button>
        <button onClick={() => onStart('用我的图动起来')}
          className="px-4 py-1.5 rounded-lg bg-fuchsia-500/40 hover:bg-fuchsia-500/70 text-sm text-white font-medium">
          🎬 用我的图动起来
        </button>
      </div>
      <div className="text-[10px] text-gray-500 mt-2">
        画面 / 文案 / 分镜 / 配音 / 字幕 / 配乐 —— **全部自动**。费用按秒计（约 50 点/秒，30 秒 ≈ 1500 点）。
      </div>
    </div>
  )
}

/** 卡2：确认 横竖屏 / 时长 / 成片风格（+ 文案可直接改） */
function VfAiOptsCard({ vj, onStart }: { vj: any; onStart: (msg: string) => void }) {
  const [script, setScript] = useState<string>(String(vj.script || ''))
  const [aspect, setAspect] = useState<string>(String(vj.aspect || 'portrait'))
  const [dur, setDur] = useState<string>(String(vj.dur || 30))
  const [style, setStyle] = useState<string>('')
  const list: any[] = Array.isArray(vj.styles) ? vj.styles : []
  const d = parseInt(dur) || 30
  const go = () => onStart('VF_FORM:' + JSON.stringify({ script: script.trim(), aspect, dur: d, style }))
  return (
    <div className="mb-2 p-3 rounded-xl border border-violet-500/30 bg-violet-500/[0.06]">
      <div className="text-xs text-violet-300 mb-2">{vj.hint || 'AI 制片 · 确认'}</div>
      {vj.topic ? <div className="text-[10px] text-gray-500 mb-2">主题：{vj.topic}</div> : null}

      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">文案（可直接改）</div>
        <textarea value={script} onChange={(e: any) => setScript(e.target.value)} rows={4}
          className="w-full px-2 py-1 rounded text-[12px] leading-relaxed bg-white/[0.05] border border-white/[0.08] text-gray-200 outline-none resize-y" />
        <div className="text-[10px] text-gray-500 mt-0.5">{script.length} 字 ≈ {Math.round(script.length / 4.5)} 秒</div>
      </div>

      <div className="mb-2">
        <div className="text-[10px] text-gray-400 mb-1">横屏 / 竖屏</div>
        <div className="flex flex-wrap gap-1.5">
          {[{ id: 'portrait', label: '竖屏 9:16' }, { id: 'landscape', label: '横屏 16:9' }].map((a) => (
            <button key={a.id} onClick={() => setAspect(a.id)}
              className={`px-2.5 py-1 rounded text-[11px] border ${aspect === a.id ? 'bg-violet-500/30 border-violet-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>{a.label}</button>
          ))}
        </div>
      </div>

      <div className="mb-2">
        <div className="text-[10px] text-gray-400 mb-1">时长</div>
        <div className="flex flex-wrap gap-1.5">
          {['10', '30', '60', '90'].map((s) => (
            <button key={s} onClick={() => setDur(s)}
              className={`px-2.5 py-1 rounded text-[11px] border ${dur === s ? 'bg-violet-500/30 border-violet-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>{s}秒</button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">成片风格（不选 = AI 按文案自己挑）</div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setStyle('')}
            title="让 AI 根据文案自动决定风格"
            className={`px-2.5 py-1 rounded text-[11px] border ${style === '' ? 'bg-violet-500/30 border-violet-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>🤖 AI 自选</button>
          {list.map((s: any) => (
            <button key={s.id} onClick={() => setStyle(s.id)} title={s.desc || ''}
              className={`px-2.5 py-1 rounded text-[11px] border ${style === s.id ? 'bg-violet-500/30 border-violet-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>{s.name}</button>
          ))}
        </div>
      </div>

      <button onClick={go}
        className="px-4 py-1.5 rounded-lg bg-violet-500/40 hover:bg-violet-500/70 text-sm text-white font-medium">
        ▶️ 下一步（排分镜）
      </button>
      <div className="text-[10px] text-gray-500 mt-2">
        配音音色 / 背景音乐 **自动**（不用选）；成片风格会决定画面质感、字幕配色与配乐类型。
      </div>
    </div>
  )
}

/** ★VF_I2V_V1（2026-09-29 用户要求「视频能力全部做」）：【AI 制片】第 4 张卡 —— 图生视频确认。
 *  由服务端 vf-aivideo.ts 在 `step==='ai_i2v'` 时产出（`VF_JSON:{step:'ai_i2v',image,cost,...}`）。
 *  为什么单独一张卡：图生视频按 50 点/秒计费，必须**先报价、再确认**（与其它成片线同一规矩）；
 *  且首帧可换（回「重新开始」即重新选图）。
 *  ⚠️ 本卡只做展示与发消息，不在这里调接口 —— 计费/入库全在服务端 animate_image（报价=实扣同源）。 */
function VfAiI2vCard({ vj, onStart }: { vj: any; onStart: (msg: string) => void }) {
  const img = String(vj.image || '')
  const cost = Number(vj.cost) || 250
  return (
    <div className="mb-2 p-3 rounded-xl border border-violet-500/30 bg-violet-500/[0.06]">
      <div className="text-xs text-violet-300 mb-2">{vj.hint || '图生视频（让静态图动起来）'}</div>
      <div className="text-[11px] text-gray-300 mb-1">
        首帧：<span className="text-emerald-300">{img || '（你仓库里最新的一张图）'}</span>
      </div>
      <div className="text-[10px] text-gray-500 mb-3">
        输出 3~6 秒 · 轻微推拉 + 光晕/景深氛围 · 主体保持不变 · 约 <b className="text-amber-300">{cost} 点</b>（50 点/秒）
        <div className="mt-0.5">生成失败会自动退回「静态图 + 缓动」，不会白扣点。</div>
        {/* ★2026-09-29（team-lead 要求把"没确认会怎样"说清）：**不写"超时自动作废"** ——
            现网没有任何超时作废机制（vf-aivideo.ts 里 0 个 setTimeout/过期逻辑），写上去就是假提示，
            撞本项目「不许写假话/假同步」的规矩。改成如实说明：不点确认不扣费、想撤点下面那个按钮。 */}
        <div className="mt-0.5 text-amber-300/80">不点「确认」就**不扣费**；不做了点「↺ 换一张 / 退出」即可（草稿会清掉，不会自动扣费）。</div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => onStart('确认')}
          className="px-4 py-1.5 rounded-lg bg-fuchsia-500/40 hover:bg-fuchsia-500/70 text-sm text-white font-medium">
          ✅ 确认，动起来（约 {cost} 点）
        </button>
        <button onClick={() => onStart('重新开始')}
          className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-gray-300 border border-white/[0.08]">
          ↺ 换一张 / 退出
        </button>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════════
 * ★VF_LEAD_V1（2026-09-29 老板定案）：【智能获客】设置面板
 *
 * 老板原话（逐条落实）：
 *   · 「增加一个按键『智能获客』，前端弹**详细表格**，**可填写可推荐话术**」
 *   · 「**选哪些平台可以勾**，首先要**确认有用户登录态**」→ 每平台显示登录态，未登录默认不勾、给「去登记」
 *   · 「频控上限找个参考值 / **有输入框控制速度**」→ 4 档预设 + 数字输入框
 *   · 「是否使用现有工具去获客，热点采集的模式相似」→ 数据来源复选（复用既有接口，不新写爬虫）
 *   · 「**暂时不做自动获客**」→ 底部只有「💾 保存配置」「👀 预演」，并如实标注范围
 *
 * 提交协议：`LEAD_CFG:{action,platforms,scripts,keywords,speed,sources}`（独立前缀，不与成片线 VF_FORM 混）
 * 登录态来源：父页面的 `buAccounts`（buCheck 的检测结果）——本卡只读，不自己再扫一遍。
 * ══════════════════════════════════════════════════════════════════════════════ */
function LeadSetupCard({ vj, onStart, buAccounts }: { vj: any; onStart: (msg: string) => void; buAccounts?: any[] }) {
  const platforms: any[] = (Array.isArray(vj.platforms) && vj.platforms.length) ? vj.platforms : LEAD_PLATFORMS
  const presets: any[] = (Array.isArray(vj.speedPresets) && vj.speedPresets.length) ? vj.speedPresets : LEAD_SPEED_PRESETS
  const sources: any[] = (Array.isArray(vj.sources) && vj.sources.length) ? vj.sources : LEAD_DATA_SOURCES
  const scriptMax = Number(vj.scriptMax) || LEAD_SCRIPT_MAX
  const accounts: any[] = Array.isArray(buAccounts) ? buAccounts : []
  const accountsReady = accounts.length > 0
  const isOn = (id: string) => !!accounts.find((a: any) => a && a.id === id && a.loggedIn)
  const pfName = (id: string) => (platforms.find((p: any) => p.id === id)?.name) || id

  // 勾选：草稿里有就按草稿，但【未登录的平台一律剔除】——老板定案「首先要确认有用户登录态」。
  const [checked, setChecked] = useState<string[]>(() => {
    const init: string[] = Array.isArray(vj.checked) ? vj.checked : []
    if (accountsReady) return init.filter((id) => isOn(id))
    return init.length ? init : defaultCheckedPlatforms(accounts)
  })
  const [checkedSources, setCheckedSources] = useState<string[]>(() => (Array.isArray(vj.checkedSources) ? vj.checkedSources : []))
  const [scripts, setScripts] = useState<{ scene: string; text: string }[]>(
    () => (Array.isArray(vj.scripts) ? vj.scripts.map((s: any) => ({ scene: String(s?.scene || ''), text: String(s?.text || '') })) : []),
  )
  const [keywords, setKeywords] = useState<string>(() => (Array.isArray(vj.keywords) ? vj.keywords.join('、') : ''))
  const sp0 = resolveLeadSpeed(vj.speed?.tier || LEAD_DEFAULT_TIER, vj.speed)
  const [tier, setTier] = useState<string>(sp0.tier)
  const [cPerDay, setCPerDay] = useState<string>(String(sp0.commentPerDay))
  const [dPerDay, setDPerDay] = useState<string>(String(sp0.dmPerDay))
  const [gapMin, setGapMin] = useState<string>(String(sp0.gapMin))
  const [gapMax, setGapMax] = useState<string>(String(sp0.gapMax))
  const [recLoading, setRecLoading] = useState(false)

  // 登录态晚到（客户端刚启动时 buAccounts 可能先是空）→ 到了就把未登录的平台从勾选里摘掉。
  useEffect(() => {
    if (!accountsReady) return
    setChecked((prev) => prev.filter((id) => isOn(id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buAccounts])

  const toggle = (list: string[], id: string, setter: (v: string[]) => void) =>
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const applyPreset = (p: any) => {
    setTier(p.id)
    setCPerDay(String(p.commentPerDay))
    setDPerDay(String(p.dmPerDay))
    setGapMin(String(p.gapMin))
    setGapMax(String(p.gapMax))
  }

  const numOr = (v: string, dflt: number) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : dflt }
  const payload = (action: string) => ({
    action,
    platforms: checked,
    sources: checkedSources,
    scripts: scripts
      .map((s) => ({ scene: cleanLeadText(s.scene, 20), text: cleanLeadText(s.text, scriptMax) }))
      .filter((s) => s.text),
    keywords: keywords.split(/[,，、|]/).map((s) => cleanLeadText(s, 20)).filter(Boolean).slice(0, 3),
    speed: {
      tier,
      commentPerDay: numOr(cPerDay, 0),
      dmPerDay: numOr(dPerDay, 0),
      gapMin: numOr(gapMin, 90),
      gapMax: numOr(gapMax, 180),
    },
  })
  const send = (action: string) => onStart(LEAD_CFG_PREFIX + JSON.stringify(payload(action)))

  // ✨ 让 AI 推荐话术（一次便宜文本调用；服务端会再清洗/限长一次）
  const recommend = async () => {
    if (recLoading) return
    setRecLoading(true)
    try {
      const r = await fetch('/api/agent/lead-scripts', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry: keywords, target: keywords,
          platform: checked.map(pfName).join('、'), count: 8,
        }),
      })
      const j = await r.json().catch(() => null)
      if (j?.success && Array.isArray(j.scripts) && j.scripts.length) {
        setScripts((prev) => prev.concat(j.scripts.map((s: any) => ({ scene: String(s.scene || '通用'), text: String(s.text || '') }))))
      } else {
        alert('推荐失败：' + (j?.message || '未知原因'))
      }
    } catch (e: any) {
      alert('推荐失败：' + (e?.message || e))
    } finally {
      setRecLoading(false)
    }
  }

  const openRegister = async (loginUrl: string) => {
    try {
      const api = (window as any).electronAPI
      if (!api?.browserOpenUrl) { alert('打开登记浏览器需要用客户端（浏览器里不支持）'); return }
      const r = await api.browserOpenUrl(loginUrl)
      if (!r || r.success !== true) alert('打开登记浏览器失败：' + ((r && r.error) || '未知原因') + '\n登录后回到本页（窗口聚焦会自动重新检测登录态）。')
    } catch (e: any) { alert('打开登记浏览器失败：' + (e?.message || e)) }
  }

  const inputCls = 'px-2 py-1 rounded text-[11px] bg-white/[0.05] border border-white/[0.08] text-gray-200 placeholder-gray-600 outline-none'
  const btnCls = 'px-2.5 py-1 rounded text-[11px] border transition'

  return (
    <div className="mb-2 p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.06]">
      <div className="text-xs text-cyan-300 mb-1">{vj.hint || '智能获客 · 设置面板'}</div>
      {/* 范围说明：老板明说「暂时不做自动获客」——必须写在面板上，免得用户以为点了就真的去评论 */}
      <div className="text-[10px] text-amber-300/90 mb-3">{vj.scopeNote || '本轮只做配置与预演，不会自动执行。'}</div>

      {/* ① 平台勾选（含登录态） */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">① 触达平台（多选；未登录的平台不能勾）</div>
        <div className="flex flex-wrap gap-1.5">
          {platforms.map((p: any) => {
            const on = isOn(p.id)
            const hit = accounts.find((a: any) => a && a.id === p.id)
            const isChecked = checked.includes(p.id)
            const tip = on ? '已登录 ✓' : (hit?.reason === 'expired' ? '登录已过期，点「去登记」重新登录' : '未登录——点「去登记」登录')
            return (
              <span key={p.id} className="inline-flex items-center gap-1">
                <button type="button" disabled={!on} title={tip}
                  onClick={() => toggle(checked, p.id, setChecked)}
                  className={`${btnCls} ${isChecked ? 'bg-cyan-500/30 border-cyan-400/50 text-white' : (on ? 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]' : 'bg-white/[0.02] border-white/[0.05] text-gray-600 cursor-not-allowed')}`}>
                  {p.icon ? p.icon + ' ' : ''}{p.name}{on ? ' ✓' : (hit?.reason === 'expired' ? ' ⏰' : '')}
                </button>
                {!on && (
                  <button type="button" onClick={() => openRegister(p.loginUrl)}
                    className="px-1.5 py-0.5 rounded border border-cyan-500/30 text-[9px] text-cyan-300 hover:bg-cyan-500/15">
                    去登记
                  </button>
                )}
              </span>
            )
          })}
        </div>
        {!accountsReady && <div className="text-[10px] text-gray-500 mt-1">（正在检测登录态…没检测到时默认不勾，请点「去登记」登录）</div>}
      </div>

      {/* ② 话术表（可填 + 可推荐） */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] text-gray-400">② 话术表（一行一条，评论/私信共用；≤{scriptMax} 字，自动去 emoji）</div>
          <div className="flex gap-1.5">
            <button type="button" onClick={recommend} disabled={recLoading}
              className={`${btnCls} bg-fuchsia-500/25 border-fuchsia-400/40 text-fuchsia-100 hover:bg-fuchsia-500/40 ${recLoading ? 'opacity-60' : ''}`}>
              {recLoading ? '⏳ 生成中…' : '✨ 让 AI 推荐话术'}
            </button>
            <button type="button" onClick={() => setScripts((p) => p.concat([{ scene: '', text: '' }]))}
              className={`${btnCls} bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]`}>＋ 加一行</button>
          </div>
        </div>
        {scripts.length === 0 ? (
          <div className="text-[10px] text-gray-500 px-2 py-2 rounded border border-dashed border-white/[0.1]">
            还没有话术——点「✨ 让 AI 推荐话术」按你的关键词生成，或「＋ 加一行」自己写。
          </div>
        ) : (
          <div className="rounded border border-white/[0.07] overflow-hidden">
            <div className="grid grid-cols-[92px_1fr_28px] gap-1 px-2 py-1 bg-white/[0.03] text-[9px] text-gray-500">
              <span>场景/触发条件</span><span>话术正文</span><span />
            </div>
            {scripts.map((s, i) => (
              <div key={i} className="grid grid-cols-[92px_1fr_28px] gap-1 px-2 py-1 border-t border-white/[0.05] items-start">
                <input value={s.scene} placeholder="如：对方问价"
                  onChange={(e: any) => setScripts((p) => p.map((x, j) => j === i ? { ...x, scene: e.target.value } : x))}
                  className={`${inputCls} w-full`} />
                <div>
                  <textarea value={s.text} rows={2} placeholder={`话术正文（≤${scriptMax} 字）`}
                    onChange={(e: any) => setScripts((p) => p.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                    className={`${inputCls} w-full resize-y leading-relaxed`} />
                  <div className="text-[9px] text-gray-600">{(s.text || '').length}/{scriptMax}</div>
                </div>
                <button type="button" onClick={() => setScripts((p) => p.filter((_, j) => j !== i))}
                  className="text-gray-500 hover:text-red-400 text-[12px] leading-5" title="删除这一行">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ③ 目标人群 / 关键词 */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">③ 目标人群 / 关键词（1~3 个，逗号分隔）</div>
        <input value={keywords} onChange={(e: any) => setKeywords(e.target.value)}
          placeholder="如：装修、二手房、本地"
          className={`${inputCls} w-full`} />
      </div>

      {/* ④ 频控速度（预设 + 自定义输入框） */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">④ 频控速度（单号/每日；默认「慢」最稳。⚠️ 这是极限能力参考值，不是合规值）</div>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {presets.map((p: any) => (
            <button key={p.id} type="button" onClick={() => applyPreset(p)}
              className={`${btnCls} ${tier === p.id ? 'bg-cyan-500/30 border-cyan-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400">
          <span>评论/日</span><input value={cPerDay} onChange={(e: any) => setCPerDay(e.target.value)} className={`${inputCls} w-[64px]`} />
          <span>私信/日</span><input value={dPerDay} onChange={(e: any) => setDPerDay(e.target.value)} className={`${inputCls} w-[64px]`} />
          <span>间隔(秒)</span><input value={gapMin} onChange={(e: any) => setGapMin(e.target.value)} className={`${inputCls} w-[56px]`} />
          <span>~</span><input value={gapMax} onChange={(e: any) => setGapMax(e.target.value)} className={`${inputCls} w-[56px]`} />
          <span className="text-gray-600">（0 = 不设上限）</span>
        </div>
        {tier === 'turbo' && <div className="text-[10px] text-red-400 mt-1">⚠️ 极速档不设上限，风险自担——平台反垃圾会限流甚至封号。</div>}
      </div>

      {/* ⑤ 数据来源（复用既有采集能力） */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">⑤ 数据来源（复用现有工具，不新写爬虫）</div>
        <div className="flex flex-col gap-1">
          {sources.map((s: any) => (
            <label key={s.id} className="flex items-start gap-2 text-[10px] text-gray-300 cursor-pointer">
              <input type="checkbox" checked={checkedSources.includes(s.id)}
                onChange={() => toggle(checkedSources, s.id, setCheckedSources)} className="mt-[2px]" />
              <span>
                {s.name}
                <span className="text-gray-600">（{s.api}）</span>
                {s.note ? <span className="text-gray-500"> {s.note}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => send('save')}
          className="px-4 py-1.5 rounded-lg bg-cyan-500/40 hover:bg-cyan-500/70 text-sm text-white font-medium">
          💾 保存配置
        </button>
        <button type="button" onClick={() => send('preview')}
          className="px-4 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.16] text-sm text-gray-100 font-medium border border-white/[0.1]">
          👀 预演（只预览，不发送）
        </button>
      </div>
      <div className="text-[10px] text-gray-500 mt-2">
        本轮**只保存配置 + 预演动作清单**，不会真的去评论/私信（老板定案：暂时不做自动获客）。
      </div>
    </div>
  )
}

/** ★VF_LEAD_V1：预演卡 —— 只展示「将要执行的动作清单 + 频控节奏」，不执行任何动作。 */
function LeadPreviewCard({ vj, onStart }: { vj: any; onStart: (msg: string) => void }) {
  const actions: string[] = Array.isArray(vj.actions) ? vj.actions : []
  const back = () => onStart(LEAD_CFG_PREFIX + JSON.stringify({
    action: 'edit',
    platforms: Array.isArray(vj.checked) ? vj.checked : [],
    scripts: Array.isArray(vj.scripts) ? vj.scripts : [],
    keywords: Array.isArray(vj.keywords) ? vj.keywords : [],
    speed: vj.speed || { tier: LEAD_DEFAULT_TIER },
    sources: Array.isArray(vj.checkedSources) ? vj.checkedSources : [],
  }))
  return (
    <div className="mb-2 p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.06]">
      <div className="text-xs text-cyan-300 mb-2">👀 智能获客 · 预演（只预览，未执行）</div>
      <div className="rounded border border-white/[0.07] divide-y divide-white/[0.05]">
        {actions.map((a, i) => (
          <div key={i} className="px-2 py-1.5 text-[11px] text-gray-200 leading-relaxed">{a}</div>
        ))}
      </div>
      {vj.riskNote ? <div className="text-[10px] text-amber-300/90 mt-2">{vj.riskNote}</div> : null}
      <div className="text-[10px] text-gray-500 mt-1">{vj.scopeNote || '本轮只预览清单，不会真的执行。'}</div>
      <div className="flex items-center gap-2 flex-wrap mt-2">
        <button type="button" onClick={back}
          className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.16] text-[11px] text-gray-200 border border-white/[0.1]">
          ↩ 返回面板修改
        </button>
        <span className="text-[10px] text-gray-500">执行器（真正去评论/私信）留给下一版，本版不做。</span>
      </div>
    </div>
  )
}

/** ★VF_BRIEF_EDIT_V1（2026-09-24 用户定案 P0②）：把「素材识别结果」从**只读**改成**可编辑**。
 *  为什么：这段结论是【直接喂给写文案 + 排分镜】的 —— 它把"营销工具界面"说成"手表海报"时，
 *  文案就围着"手表"写、整片主题跑偏。用户改过的版本，服务端会用 `vd.briefOverride` **优先采用**
 *  （覆盖 AI 新扫出来的那份）。
 */
function VfBriefEdit({ brief, onSend }: { brief: string; onSend: (msg: string) => void }) {
  const [txt, setTxt] = useState(brief)
  const changed = !!txt.trim() && txt.trim() !== brief.trim()
  const save = (redraft: boolean) => onSend('VF_BRIEF:' + JSON.stringify({ text: txt.trim(), redraft }))
  return (
    <details className="mb-2">
      <summary className="text-[10px] text-gray-500 cursor-pointer">
        素材识别结果（点开可改 —— 它决定写文案/排分镜，识别错就改这里）
      </summary>
      <textarea
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        rows={9}
        className="w-full mt-1 px-2 py-1.5 rounded text-[10px] leading-relaxed bg-black/30 border border-white/[0.08] text-gray-300 outline-none resize-y"
      />
      <div className="flex items-center gap-2 flex-wrap mt-1">
        <button
          type="button"
          disabled={!changed}
          onClick={() => save(false)}
          className={`px-3 py-1 rounded-md text-[11px] ${changed ? 'bg-white/[0.08] hover:bg-white/[0.16] text-gray-200' : 'bg-white/[0.03] text-gray-600'}`}
        >
          💾 保存结论
        </button>
        <button
          type="button"
          disabled={!changed}
          onClick={() => save(true)}
          className={`px-3 py-1 rounded-md text-[11px] ${changed ? 'bg-emerald-500/30 hover:bg-emerald-500/50 text-white' : 'bg-white/[0.03] text-gray-600'}`}
        >
          🔄 保存并重写文案
        </button>
        <span className="text-[10px] text-gray-500">「重写文案」= 按你这份结论重新写口播文案 + 重排分镜</span>
      </div>
    </details>
  )
}

/**
 * ★VF_MEMORY_V1（2026-09-30 用户定案「个人仓库怎么分配 AI 仓库主要看哪里的。这个比较关键」）：
 *  素材「提拔 / 禁用」——「✅ 当素材用」→ `VF_MAT_SET:{"name","action":"allow"}`；
 *  「🚫 别用」→ `...{"action":"deny"}`；再点一次同一个动作 = 取消（发 action:"auto"）。
 *
 * ★VF_MATUI_V1（2026-09-30 用户实测截图后定案）—— 上一版清单"看了没用"：
 *   用户原话：「这个什么意思没明白。**这不是使用的素材 也不是 AI 看的素材，有什么用？是不是搞错了**。」
 *   旧版把「出片产物（默认被排除）」排在最前、只显示 12 条 → 前 12 条全是"仅出片产物"，
 *   真正能用的图片一张都没出现。本版四处调整：
 *     ① **可用素材在前**（会被 AI 选中的那批），「已排除」收进下面一个折叠块（默认收起）；
 *     ② 每条显示**缩略图**（图片用服务端 24h 签名 URL；视频给 🎬 占位）+ 文件名 + 类型 + 状态；
 *     ③ 上限 40（服务端已按"可用优先"裁剪），标题里显示"共 N 条可用 / M 条已排除"；
 *     ④ 每条加「🔄 换一张」（同类下一张，`VF_MAT_SWAP:{"out":"文件名"}`）与 🎞 勾选
 *        （`VF_MAT_SET:{"name","action":"pick"|"unpick"}`，配合设置卡「只动我勾选的」档）。
 *  ⚠️ 缩略图只用**短期签名 URL**，bucket 密钥绝不下发到客户端。
 */
function VfMatsPicker({ mats, usableN, excludedN, onSend }: {
  mats: any[]
  usableN?: number
  excludedN?: number
  onSend: (msg: string) => void
}) {
  const stateOf = (m: any) => String(m?.state || 'all')
  const isUsable = (st: string) => st === 'all' || st === 'allow'
  // ★VF_MATUI_V1：状态文案按用户口径改（"可用 / 仅出片产物 / 你标了别用 / 你标了当素材用"）
  const label: Record<string, string> = { all: '可用', allow: '你标了当素材用', outcome: '仅出片产物', deny: '你标了别用' }
  const colorOf = (st: string) => st === 'deny' ? 'text-rose-300' : st === 'outcome' ? 'text-amber-300' : st === 'allow' ? 'text-emerald-300' : 'text-gray-400'
  const all = Array.isArray(mats) ? mats : []
  const usable = all.filter((m: any) => isUsable(stateOf(m)))
  const excluded = all.filter((m: any) => !isUsable(stateOf(m)))
  const act = (name: string, cur: string, action: 'allow' | 'deny') => {
    if (!name) return
    const next = cur === action ? 'auto' : action   // 再点一次同一个动作 = 取消
    onSend('VF_MAT_SET:' + JSON.stringify({ name, action: next }))
  }
  // ★VF_MATUI_V1：🎞 勾选（这一镜生成 AI 动图）—— 与 allow/deny 同一份名单，互不干扰
  const pick = (name: string, on: boolean) => {
    if (!name) return
    onSend('VF_MAT_SET:' + JSON.stringify({ name, action: on ? 'unpick' : 'pick' }))
  }
  // ★VF_MATUI_V1：「🔄 换一张」——只回传"被换掉的是谁"，换成谁由服务端算（见 material-pool.parseMatSwapMessage 注释）
  const swap = (name: string) => { if (name) onSend('VF_MAT_SWAP:' + JSON.stringify({ out: name })) }

  const Row = ({ m }: { m: any }) => {
    const st = stateOf(m)
    const nm = String(m?.name || '')
    const isVideo = String(m?.kind) === 'video'
    return (
      <div className="flex items-center gap-2 text-[10px]">
        {/* 缩略图：图片用服务端签名 URL，视频给 🎬 占位图标 */}
        <span className="w-8 h-8 shrink-0 rounded overflow-hidden bg-black/40 border border-white/[0.08] flex items-center justify-center">
          {isVideo
            ? <span className="text-[13px]" title="视频">🎬</span>
            : (m?.url
              ? <img src={String(m.url)} alt="" loading="lazy" className="w-full h-full object-cover" />
              : <span className="text-[13px]" title="图片">🖼</span>)}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block truncate text-gray-300" title={nm}>
            {isVideo ? '🎬 ' : '🖼 '}{nm}
          </span>
          <span className={`block truncate ${colorOf(st)}`}>{label[st] || '可用'}</span>
        </span>
        {/* 🎞 = 这一镜生成 AI 动图（配合设置卡「只动我勾选的」） */}
        <button type="button" onClick={() => pick(nm, !!m?.i2v)}
          title="打勾 = 这张图生成 AI 动图（只有设置卡选「🎞 只动我勾选的」时才按勾选算钱）"
          className={`shrink-0 px-1.5 py-0.5 rounded border transition ${m?.i2v ? 'bg-fuchsia-500/30 border-fuchsia-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-400 hover:bg-white/[0.12]'}`}>
          🎞
        </button>
        {isUsable(st) && (
          <button type="button" onClick={() => swap(nm)}
            title="换成同类型的下一张（被换掉的这张会记成「别用」，换上的记成「当素材用」）"
            className="shrink-0 px-2 py-0.5 rounded border bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.12]">
            🔄 换一张
          </button>
        )}
        <button type="button" onClick={() => act(nm, st, 'allow')}
          className={`shrink-0 px-2 py-0.5 rounded border transition ${st === 'allow' ? 'bg-emerald-500/30 border-emerald-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.12]'}`}>
          ✅ 当素材用
        </button>
        <button type="button" onClick={() => act(nm, st, 'deny')}
          className={`shrink-0 px-2 py-0.5 rounded border transition ${st === 'deny' ? 'bg-rose-500/30 border-rose-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.12]'}`}>
          🚫 别用
        </button>
      </div>
    )
  }

  return (
    <details className="mb-2">
      <summary className="text-[10px] text-gray-500 cursor-pointer">
        素材清单（共 {Number(usableN ?? usable.length)} 条可用 / {Number(excludedN ?? excluded.length)} 条已排除
        · 可用素材会被 AI 选中用来做画面）
      </summary>
      {/* ① 可用素材（在前）—— 这就是"会被 AI 选中"的那批 */}
      <div className="mt-1 space-y-1">
        {usable.length ? usable.map((m: any, i: number) => <Row key={'u' + i} m={m} />) : (
          <div className="text-[10px] text-amber-300/90">当前没有可用素材（都被标成「别用」或都是出片产物）—— 可在「已排除」里点「✅ 当素材用」提拔回来</div>
        )}
      </div>
      {/* ② 已排除（折叠在下面，默认收起）—— 出片产物 / 你标了别用 */}
      {excluded.length > 0 && (
        <details className="mt-2">
          <summary className="text-[10px] text-gray-500 cursor-pointer">
            ▸ 已排除 {Number(excludedN ?? excluded.length)} 条（出片产物 / 你标了别用）—— 点开可翻案
          </summary>
          <div className="mt-1 space-y-1">
            {excluded.map((m: any, i: number) => <Row key={'x' + i} m={m} />)}
          </div>
        </details>
      )}
      <div className="text-[10px] text-gray-500 mt-1">
        「别用」= 以后起草都不取它；「当素材用」= 即使是之前做的成片也允许当素材；再点一次可取消（回默认规则）。
        🎞 = 这张图生成 AI 动图（设置卡选「🎞 只动我勾选的」时才按勾选算钱）；「🔄 换一张」= 换成同类型的下一张。
      </div>
    </details>
  )
}

/** ★VF_EDIT_V1（2026-09-24 用户定案「B：可编辑分镜清单」）
 *  出片前把分镜清单做成【可逐镜编辑】：改「画面大字 / 字幕」，保存后发 `VF_EDIT:{edits:[…]}`。
 *  · 这一步只改草稿清单，**不渲染、不扣钱**；改完再点「确认出片」按新版出片。
 *  · 片已经出过的（不在出片前）用聊天说一句「第 3 镜大字改成 X」即可 —— 那条路会【只重渲染】
 *    （复用已有配音，1~2 分钟、不扣点）。
 */
/** ★VF_STYLEPREVIEW_WIRE_V1（2026-10-02 用户原话「当前5个风格最好能加个模版样式。点了能看到…
 *  这看不到效果盲猜」）样张网格：每套「画面风格」一张缩略图（<key>-thumb.png），点开看大图
 *  （<key>.png 要点页 + <key>-data.png 数据页）。选中状态由外部 cur 驱动（点样张=选风格）。
 *  ⚠️ <key> 必须与渲染层 scripts/video-factory/themes.py 的 STYLES id **逐字一致**（绝不拼中文名）；
 *     图是渲染层分批交付的 → **缺图时 onError 隐藏 + 兜底文案"样张生成中"**，绝不显示破图/不报错。 */
function VfStyleThumb({ k, onOpen, selected }: { k: string; onOpen?: () => void; selected?: boolean }) {
  const [bad, setBad] = useState(false)
  return (
    <div onClick={onOpen} title="点开看这套风格的样张大图"
      className={`relative w-[160px] h-[90px] rounded-lg overflow-hidden border bg-black/40 transition-transform duration-150 ${onOpen ? 'cursor-pointer hover:scale-[1.03]' : ''} ${selected ? 'border-fuchsia-400/70 ring-1 ring-fuchsia-400/40' : 'border-white/[0.08] hover:border-fuchsia-400/60'}`}>
      {bad ? (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-500">样张生成中</div>
      ) : (
        <img src={`/style-preview/${k}-thumb.png`} alt={`${k} 样张`} onError={() => setBad(true)}
          className="w-full h-full object-cover" />
      )}
    </div>
  )
}

/** 大图（缺图时显示"样张生成中"占位，不留破图） */
function VfStyleBigImg({ src, label }: { src: string; label: string }) {
  const [bad, setBad] = useState(false)
  return (
    <div className="flex flex-col items-center gap-1">
      {bad ? (
        <div className="w-[320px] max-w-[80vw] h-[180px] flex items-center justify-center rounded-lg border border-white/10 bg-black/40 text-[11px] text-gray-500">{label}样张生成中</div>
      ) : (
        <img src={src} alt={label} onError={() => setBad(true)}
          className="max-h-[70vh] max-w-[80vw] rounded-lg border border-white/10 bg-black" />
      )}
      <span className="text-[10px] text-gray-400">{label}</span>
    </div>
  )
}

function VfStyleSamples({ cur, onPick }: { cur: string; onPick: (v: string) => void }) {
  const [big, setBig] = useState<{ id: string; name: string } | null>(null)
  return (
    <>
      <div className="flex flex-wrap gap-2 mt-2">
        {VF_STYLES.map((s) => (
          <div key={s.id} className="flex flex-col gap-1 w-[160px]">
            <VfStyleThumb k={s.id} selected={cur === s.id} onOpen={() => setBig(s)} />
            <button onClick={() => onPick(s.id)}
              className={`w-full px-1 py-0.5 rounded text-[10px] border transition truncate ${cur === s.id
                ? 'bg-fuchsia-500/30 border-fuchsia-400/50 text-white'
                : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>
              {s.name}
            </button>
          </div>
        ))}
      </div>
      <div className="text-[9px] text-gray-500 mt-1">点缩略图看这套风格的样张大图（要点页 / 数据页）</div>
      {big ? (
        <div onClick={() => setBig(null)}
          className="fixed inset-0 z-[9999] bg-black/85 flex flex-col items-center justify-center p-4 gap-2">
          <div className="text-sky-200 text-sm">🎨 {big.name}（{big.id}）样张</div>
          <div className="flex flex-wrap gap-3 items-start justify-center max-h-[78vh] overflow-auto">
            <VfStyleBigImg src={`/style-preview/${big.id}.png`} label="要点页" />
            <VfStyleBigImg src={`/style-preview/${big.id}-data.png`} label="数据页" />
          </div>
          <div className="text-[10px] text-gray-400">点任意处关闭</div>
        </div>
      ) : null}
    </>
  )
}

/** ★VF_PPTPREVIEW_WIRE_V1（2026-10-01 用户定案「完全成片之前能把 PPT 抽出来审核一下效果吗？」）：
 *  出片确认卡上的「👀 先看 PPT 页」—— 把**即将出片的同一份 plan**（卡片里的 `sb.plan`）发给
 *  服务端 /api/agent/vf/ppt-preview；服务端原样落盘 → 用出片同一条渲染链 `render.py --ppt-preview`
 *  每镜抽一张"内容全就位"的 PNG → 入库 + 签名 URL → 这里以缩略图网格展示（可点开大图）。
 *  ⚠️ 不扣点（审核用）；出片不依赖它；失败**如实显示原因**（服务端回的人话 error 原样贴出来）。 */
function VfPptPreview({ plan }: { plan: any }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [imgs, setImgs] = useState<any[]>([])
  const [zoom, setZoom] = useState('')
  const hasPlan = !!(plan && Array.isArray(plan.shots) && plan.shots.length)
  const run = async () => {
    if (loading || !hasPlan) return
    setLoading(true); setErr(''); setImgs([])
    try {
      const r = await fetch('/api/agent/vf/ppt-preview', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const j = await r.json().catch(() => null)
      if (j && j.success && Array.isArray(j.images) && j.images.length) setImgs(j.images)
      else setErr(String((j && j.error) || '预览生成失败：服务端没有返回结果'))
    } catch (e: any) {
      setErr('预览生成失败：' + String(e?.message || e).slice(0, 120))
    } finally { setLoading(false) }
  }
  return (
    <div className="w-full mt-2">
      <button onClick={run} disabled={loading || !hasPlan}
        title={hasPlan
          ? '按即将出片的这份分镜，每镜抽一张「内容全就位」的图给你先审（不配音、不烧字幕、不扣点）'
          : '当前卡片没有可预览的分镜（老卡片或分镜未生成）'}
        className={`px-4 py-1.5 rounded-lg text-sm ${loading || !hasPlan
          ? 'bg-white/[0.04] text-gray-500 cursor-not-allowed'
          : 'bg-sky-500/25 hover:bg-sky-500/40 border border-sky-400/40 text-sky-100'}`}>
        {loading ? '⏳ 正在抽图…' : '👀 先看 PPT 页（不扣点）'}
      </button>
      {err ? <div className="text-[10px] text-amber-300/90 mt-1">{err}</div> : null}
      {imgs.length > 0 ? (
        <div className="mt-1.5">
          <div className="text-[10px] text-sky-300 mb-1">
            共 {imgs.length} 页（每页 = 一镜的「内容全就位」画面，不含字幕/顶部标题）。确认满意再点「确认出片」。
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {imgs.map((it: any) => (
              <button key={it.i} onClick={() => setZoom(String(it.url || ''))}
                className="rounded overflow-hidden border border-white/[0.08] hover:border-sky-400/60 transition text-left">
                <img src={it.url} alt={'第' + it.i + '页'} className="w-full h-20 object-cover bg-black" />
                {/* ★VF_PREVIEWTXT_V1（2026-10-06 用户实测：预览里出现「AIConfid」「标题直接写着：A」以为是片子坏了）：
                    这里原来把每页文字 `.slice(0, 8)` 硬切 8 个字 —— 是**显示截断**，片子里其实是完整的。
                    现在放宽到 14 字 + 悬停看全文（title），避免"看预览以为成片有 bug"。 */}
                <span className="block text-[8px] text-gray-400 px-1 py-0.5 truncate"
                  title={`${String(it.type || '')}${it.variant ? '·' + String(it.variant) : ''} ${String(it.text || '')}`}>
                  {it.i}. {String(it.type || '')}{it.variant ? '·' + String(it.variant) : ''} {String(it.text || '').slice(0, 14)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {zoom ? (
        <div onClick={() => setZoom('')} className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4">
          <img src={zoom} alt="PPT 页大图" className="max-w-full max-h-full rounded-lg" />
        </div>
      ) : null}
    </div>
  )
}

/** ★VF_DECKPREVIEW_WIRE_V1（2026-10-04 用户定案「接」）——「新引擎成片预览」：
 *  出片确认卡上与「👀 先看 PPT 页」并排：把**同一份 plan** 发给 /api/agent/vf/deck-preview，
 *  服务端用 HTML 逐帧引擎（10 套皮肤）真出一条完整成片 MP4 → 入库 + 签名 URL → 这里直接播放。
 *  与老按钮的关系：老按钮看的是「老渲染链的逐镜静帧」（快）；这个看的是「新引擎的动效成片」（慢一些，
 *  含转场/动效，可直接对比投放效果）。不扣点；出片不依赖它；失败如实显示服务端的人话 error。 */
const DECK_SKINS: { id: string; label: string }[] = [
  { id: 'v1', label: '经典 V1' }, { id: 'v2', label: '经典 V2' },
  { id: 'editorial', label: '杂志风' }, { id: 'tech', label: '科技风' },
  { id: 'festive', label: '喜庆风' }, { id: 'mono', label: '极简黑白' },
  { id: 'ecom', label: '电商高饱和' }, { id: 'formal', label: '商务正式' },
  { id: 'health', label: '健康医疗' }, { id: 'edu', label: '教育知识' },
]
function VfDeckPreview({ plan }: { plan: any }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [skin, setSkin] = useState('v1')
  const [ori, setOri] = useState('9:16')
  const [video, setVideo] = useState<any>(null)
  const hasPlan = !!(plan && Array.isArray(plan.shots) && plan.shots.length)
  const run = async () => {
    if (loading || !hasPlan) return
    setLoading(true); setErr(''); setVideo(null)
    try {
      const r = await fetch('/api/agent/vf/deck-preview', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, skin, orientation: ori }),
      })
      const j = await r.json().catch(() => null)
      if (j && j.success && j.url) setVideo(j)
      else setErr(String((j && j.error) || '预览生成失败：服务端没有返回结果'))
    } catch (e: any) {
      setErr('预览生成失败：' + String(e?.message || e).slice(0, 120))
    } finally { setLoading(false) }
  }
  return (
    <div className="w-full mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={skin} onChange={(e) => setSkin(e.target.value)} disabled={loading}
          className="px-2 py-1.5 rounded-lg text-xs bg-white/[0.06] border border-emerald-400/30 text-emerald-100">
          {DECK_SKINS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={ori} onChange={(e) => setOri(e.target.value)} disabled={loading}
          className="px-2 py-1.5 rounded-lg text-xs bg-white/[0.06] border border-emerald-400/30 text-emerald-100">
          <option value="9:16">竖屏 9:16</option>
          <option value="16:9">横屏 16:9</option>
        </select>
        <button onClick={run} disabled={loading || !hasPlan}
          title={hasPlan
            ? '把这份分镜交给新渲染引擎（10 套皮肤），真出一条带动效的完整成片给你先看（不扣点；渲染约 1~3 分钟）'
            : '当前卡片没有可预览的分镜（老卡片或分镜未生成）'}
          className={`px-4 py-1.5 rounded-lg text-sm ${loading || !hasPlan
            ? 'bg-white/[0.04] text-gray-500 cursor-not-allowed'
            : 'bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-400/40 text-emerald-100'}`}>
          {loading ? '⏳ 新引擎渲染中（约 1~3 分钟）…' : '🎬 新引擎成片预览（不扣点）'}
        </button>
      </div>
      {err ? <div className="text-[10px] text-amber-300/90 mt-1">{err}</div> : null}
      {video ? (
        <div className="mt-1.5">
          <div className="text-[10px] text-emerald-300 mb-1">
            新引擎成片 · {String(video.skin || '')} · {String(video.orientation || '')} · {video.pages || '?'} 页 · {video.sizeMB || '?'}MB
            {video.truncated ? `（${String(video.truncated)}）` : ''}。满意就点下方「确认出片 · 新引擎」（正式出片会把文案先转成 PPT 要点版，页数会更充实）。
          </div>
          <video src={String(video.url)} controls className="rounded-lg border border-white/10 max-h-[420px]" />
        </div>
      ) : null}
    </div>
  )
}

/** ★VF_DECKCONFIRM_V1（2026-10-04 用户定案「双轨并存」→ ★VF_ENGINE_UI_V1 改为第一轮已选引擎）：
 *  deck 模式确认卡上的**唯一出片按钮**「🎬 确认出片 · 新引擎」（classic 模式不渲染本组件，
 *  老引擎「确认出片」按钮照旧、后端一行没改）。
 *  点它 = 发机器协议串 `VF_DECK_CONFIRM:{skin}`；服务端在四条成片线分派前接管，
 *  把**同一份文案**（先 AI 转成 PPT 要点版，失败退回规则映射）交给 HTML 逐帧引擎正式出片
 *  （任务文件/进度轮询/入库/签名 URL 与老链同形状全复用，见 src/lib/agent/vf/vf-deck-render.ts）。
 *  ★VF_AVIMG_V1（2026-10-05）：新引擎已支持**配音（逐句 TTS）+ BGM + 素材图片页**；
 *  收费 = 文案费（与老链同公式 ceil(字数/20)），配音/BGM/图片页不另收费，动图/AI 画面不收。 */
function VfDeckConfirm({ vj, onSend }: { vj: any; onSend: (m: string) => void }) {
  const [skin, setSkin] = useState('v1')
  // ★VF_ENGINE_UI_V1：比例不再单独选 —— 直接跟随第一轮定的分镜画幅（用户定的"第二轮只点头"）
  const ori = String(vj?.aspect || '') === 'landscape' ? '16:9' : '9:16'
  // 报价与后端实扣同源（vf-deck-render.ts 的 ★VF_COSTFIX_V1 口径）：script 优先，无则分镜字幕总和
  const chars = String(vj?.script || '').length
    || (Array.isArray(vj?.shots) ? vj.shots.reduce((a: number, s: any) => a + String(s?.subtitle || s?.text || '').length, 0) : 0)
  const cost = Math.max(1, Math.ceil(chars / 20))
  return (
    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
      <select value={skin} onChange={(e) => setSkin(e.target.value)}
        title="10 套皮肤 = 新引擎的动态 PPT 版式配色（可先用上面「新引擎成片预览」逐套看效果）"
        className="px-2 py-1.5 rounded-lg text-xs bg-white/[0.06] border border-emerald-400/30 text-emerald-100">
        {DECK_SKINS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <span className="text-[10px] text-gray-500">{ori === '16:9' ? '横屏 16:9' : '竖屏 9:16'}（跟随分镜画幅）</span>
      <button onClick={() => onSend('VF_DECK_CONFIRM:' + JSON.stringify({ skin }))}
        title={`用新引擎（HTML 逐帧）正式出片：动态 PPT + 逐句配音 + BGM + 素材图片页，文案会先由 AI 转成 PPT 要点版。只收文案费约 ${cost} 点（配音/BGM/图片页不另收费）`}
        className="px-4 py-1.5 rounded-lg text-sm bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-400/40 text-emerald-100 font-medium">
        🎬 确认出片 · 新引擎（约 {cost} 点）
      </button>
    </div>
  )
}

/** ★VF_PPT_UI_V1（2026-10-06 用户定案「彻底拆开」）：【PPT 成片】设置卡（只吃「文案 + 皮肤」）。
 *  入口命令「PPT成片」/「动态PPT」/「动态PPT成片」→ 服务端出 step:'ppt_setup'；
 *  提交发机器协议串 `VF_PPT_FORM:{aspect,dur,voice,bgm,skin,topic,script}`；
 *  确认卡（step:'ppt_confirm'）复用 VfDeckConfirm 出片（它自己发 VF_DECK_CONFIRM:{skin,ori}）。
 *  ⚠️ 本线不取素材、不排分镜 —— 页 = PPT 版式页，**时长由配音决定**（配音是唯一时序真源）。 */
function VfPptCard({ vj, onSend }: { vj: any; onSend: (m: string) => void }) {
  const [aspect, setAspect] = useState(String(vj?.aspect) === 'landscape' ? 'landscape' : 'portrait')
  const [dur, setDur] = useState(String(vj?.dur || 60))
  const [voice, setVoice] = useState(String(vj?.voice || 'longxiaochun'))
  const [bgm, setBgm] = useState(String(vj?.bgm) === 'none' ? 'none' : 'auto')
  const [skin, setSkin] = useState(String(vj?.skin || 'v1'))
  const [topic, setTopic] = useState(String(vj?.topic || ''))
  const [script, setScript] = useState(String(vj?.script || ''))
  const [openAdv, setOpenAdv] = useState(false)
  const voices: any[] = Array.isArray(vj?.voices) && vj.voices.length ? vj.voices : [{ id: voice, name: voice }]
  // 皮肤中文名复用文件里已有的 DECK_SKINS（**不新造第二份映射**）
  const skinIds: string[] = Array.isArray(vj?.skins) && vj.skins.length ? vj.skins : DECK_SKINS.map((s) => s.id)
  const skinLabel = (id: string) => (DECK_SKINS.find((s) => s.id === id)?.label || id)
  const R = (cur: string, val: string, label: string, set: (v: string) => void) => (
    <button key={val} onClick={() => set(val)}
      className={`px-2 py-1 rounded text-[11px] border transition ${cur === val ? 'bg-fuchsia-500/30 border-fuchsia-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>{label}</button>
  )
  return (
    <div className="mb-2 p-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/[0.06]">
      <div className="text-xs text-fuchsia-300 mb-1">🎬 PPT 成片设置（只吃文案 + 皮肤）</div>
      <div className="text-[10px] text-gray-500 mb-3">{String(vj?.hint || 'PPT 成片：只吃「文案 + 皮肤」——页 = PPT 版式页，时长由配音决定（不掺素材图）')}</div>

      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">画幅</div>
        <div className="flex flex-wrap gap-1.5">
          {R(aspect, 'portrait', '竖屏 9:16', setAspect)}
          {R(aspect, 'landscape', '横屏 16:9', setAspect)}
        </div>
      </div>

      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">时长 <span className="text-gray-600">（只决定文案字数；实际时长以配音为准）</span></div>
        <div className="flex flex-wrap gap-1.5">
          {['30', '60', '90', '180'].map((s) => R(dur, s, s + '秒', setDur))}
          <span className="text-[10px] text-emerald-300/70 self-center">≈ {Math.round((parseInt(dur) || 60) * 4.5)} 字文案</span>
        </div>
      </div>

      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">配音音色</div>
        <div className="flex flex-wrap gap-1.5">
          {voices.map((v: any) => R(voice, String(v.id), '🔊 ' + String(v.name || v.id), setVoice))}
        </div>
      </div>

      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">背景音乐</div>
        <div className="flex flex-wrap gap-1.5">
          {R(bgm, 'auto', '🎵 自动配乐', setBgm)}
          {R(bgm, 'none', '🔇 不要 BGM', setBgm)}
        </div>
      </div>

      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">皮肤 <span className="text-gray-600">（10 套 · 一套 = 配色 + 整页 PPT 版式）</span></div>
        <div className="flex flex-wrap gap-1.5">
          {skinIds.map((id) => R(skin, id, skinLabel(id), setSkin))}
        </div>
      </div>

      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">主题 <span className="text-gray-600">（留空则用你贴的文案）</span></div>
        <input value={topic} onChange={(e: any) => setTopic(e.target.value.slice(0, 200))}
          placeholder="例如：咖啡店开业，第二杯半价"
          className="w-full px-2 py-1.5 rounded text-[12px] bg-white/[0.05] border border-white/[0.08] text-gray-200 placeholder-gray-600 outline-none" />
      </div>

      <button onClick={() => setOpenAdv(!openAdv)} className="text-[10px] text-gray-500 hover:text-gray-300 mb-2">
        {openAdv ? '▲ 收起「我已有文案」' : '▼ 我已有文案（点这里贴）'}
      </button>
      {openAdv ? (
        <textarea value={script} onChange={(e: any) => setScript(e.target.value.slice(0, 4000))}
          rows={4} placeholder="把你的文案整段贴这里；贴了就用你的，不再由 AI 写"
          className="w-full mb-3 px-2 py-1.5 rounded text-[12px] bg-white/[0.05] border border-white/[0.08] text-gray-200 placeholder-gray-600 outline-none" />
      ) : null}

      {vj?.err ? <div className="text-[10px] text-amber-300/90 mb-2">{String(vj.err)}</div> : null}

      <button
        onClick={() => onSend('VF_PPT_FORM:' + JSON.stringify({ aspect, dur: parseInt(dur) || 60, voice, bgm, skin, topic, script }))}
        className="w-full px-4 py-2 rounded-lg bg-fuchsia-500/50 hover:bg-fuchsia-500/80 text-sm text-white font-medium">
        🚀 开始排版
      </button>
      <div className="text-[10px] text-gray-500 mt-1">PPT 成片：页 = PPT 版式页，时长由配音决定；**不掺素材图**（要素材画面请用「图片成片」或「图视混剪」）</div>
    </div>
  )
}

function VfShotEditList({ shots, onSend }: { shots: any[]; onSend: (msg: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<number, Record<string, string>>>({})
  // ★VF_EDIT_P0_V1（2026-09-24 用户实测：改「10000」那一镜的大字画面不会变）——
  //   因为不同卡型画的字段根本不是同一个：number 画 value、list 画 title/items、chart 画 items、
  //   compare 画 left/right。所以这里【按卡型】给出真正要改的字段，避免"改了没反应"。
  const FIELDS: Record<string, { key: string; label: string; w: string }[]> = {
    title: [{ key: 'text', label: '大字', w: 'w-[110px]' }],
    bgimage: [{ key: 'text', label: '大字', w: 'w-[110px]' }],
    // ★「按钮文字」= 结尾卡上那个"实心按钮"里显示的字（如"点击咨询/现在就试试"），
    //   留空就不画按钮。字段名写清楚点，否则用户看不懂（用户实测反馈）。
    end: [{ key: 'text', label: '结尾大字', w: 'w-[104px]' }, { key: 'cta', label: '按钮文字（留空=不画按钮）', w: 'w-[92px]' }],
    list: [{ key: 'title', label: '标题', w: 'w-[104px]' }, { key: 'items', label: '条目（用、分隔）', w: 'flex-1 min-w-0' }],
    number: [
      { key: 'value', label: '数值', w: 'w-[76px]' },
      { key: 'suffix', label: '单位', w: 'w-[56px]' },
      { key: 'label', label: '说明', w: 'w-[96px]' },
    ],
    chart: [{ key: 'title', label: '标题', w: 'w-[96px]' }, { key: 'items', label: '条目（标签:数值）', w: 'flex-1 min-w-0' }],
    compare: [{ key: 'left', label: '左边', w: 'w-[96px]' }, { key: 'right', label: '右边', w: 'w-[96px]' }],
  }
  const fieldsFor = (t: any) => FIELDS[String(t || '')] || FIELDS.title
  const itemText = (v: any) => (Array.isArray(v)
    ? v.map((x: any) => (x && typeof x === 'object' ? `${x.label ?? x.text ?? ''}:${x.value ?? ''}` : String(x))).join('、')
    : '')
  const fieldVal = (s: any, k: string) => (k === 'items' ? itemText(s?.items) : String(s?.[k] ?? ''))
  const parseItems = (str: string, type: string) => {
    const parts = String(str || '').split(/[、,，|/\n]+/).map((x) => x.trim()).filter(Boolean)
    if (type !== 'chart') return parts
    return parts.map((p) => {
      const seg = p.split(/[:：]/)
      const n = Number(String(seg[1] ?? '').replace(/[^\d.\-]/g, ''))
      return { label: String(seg[0] || '').trim(), value: Number.isFinite(n) ? n : 0 }
    }).filter((x) => x.label)
  }
  const oneEdit = (i: number): any => {
    const s = shots[i] || {}
    const d = draft[i] || {}
    const e: any = { index: i + 1 }
    for (const f of fieldsFor(s.type)) {
      if (d[f.key] === undefined || String(d[f.key]) === fieldVal(s, f.key)) continue
      if (f.key === 'items') e.items = parseItems(String(d[f.key]), String(s.type || ''))
      else if (f.key === 'value') {
        const n = Number(String(d[f.key]).replace(/[^\d.\-]/g, ''))
        e.value = Number.isFinite(n) ? n : String(d[f.key])
      } else e[f.key] = String(d[f.key])
    }
    if (d.subtitle !== undefined && String(d.subtitle) !== String(s.subtitle || '')) e.subtitle = String(d.subtitle)
    return e
  }
  const changed = shots.map((_, i) => i).filter((i) => Object.keys(oneEdit(i)).length > 1)
  const setOne = (i: number, k: string, v: string) =>
    setDraft((p) => ({ ...p, [i]: { ...(p[i] || {}), [k]: v } }))
  const save = () => {
    const edits = changed.map(oneEdit)
    if (!edits.length) return
    onSend('VF_EDIT:' + JSON.stringify({ edits }))
    setDraft({})
  }
  const types = Array.from(new Set(shots.map((s: any) => String(s.type || '')))).join(' / ')
  return (
    <div className="mb-2">
      <button type="button" onClick={() => setOpen(!open)} className="text-[10px] text-gray-400 hover:text-gray-200">
        {open ? '▾' : '▸'} ✏️ 分镜清单（{shots.length} 镜 · {types}）—— 点开可逐镜改「大字 / 字幕」
      </button>
      {open && (
        <div className="mt-1 rounded-lg border border-white/[0.08] bg-black/20 p-2 space-y-1 max-h-72 overflow-y-auto">
          {shots.map((s: any, i: number) => (
            <div key={i} className="rounded-md bg-white/[0.02] px-1.5 py-1">
              {/* 第一行：卡型 + 该卡型【真正会被画出来】的字段 */}
              <div className="flex items-center gap-1.5">
                <span className="w-4 shrink-0 text-[10px] text-gray-600 text-right">{i + 1}</span>
                <span className="w-[52px] shrink-0 text-[10px] text-gray-500">{String(s.type || '')}</span>
                <span className="w-9 shrink-0 text-[10px] text-emerald-300/50">{s.dur ? `${s.dur}s` : ''}</span>
                {fieldsFor(s.type).map((f) => (
                  <input
                    key={f.key}
                    value={draft[i]?.[f.key] !== undefined ? String(draft[i][f.key]) : fieldVal(s, f.key)}
                    onChange={(e) => setOne(i, f.key, e.target.value)}
                    placeholder={f.label}
                    title={f.label}
                    className={`${f.w} px-1.5 py-0.5 rounded text-[10px] bg-white/[0.05] border border-white/[0.08] text-emerald-200 outline-none`}
                  />
                ))}
              </div>
              {/* 第二行：字幕（这句就是配音念的，成片底部字幕也用它） */}
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-4 shrink-0" />
                <input
                  value={draft[i]?.subtitle !== undefined ? String(draft[i].subtitle) : String(s.subtitle || '')}
                  onChange={(e) => setOne(i, 'subtitle', e.target.value)}
                  placeholder="字幕 / 配音文案（配音念的就是这句，成片底部字幕也用它）"
                  className="flex-1 min-w-0 px-1.5 py-0.5 rounded text-[10px] bg-white/[0.05] border border-white/[0.08] text-gray-300 outline-none"
                />
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button
              type="button"
              onClick={save}
              disabled={!changed.length}
              className={`px-3 py-1 rounded-md text-[11px] ${changed.length ? 'bg-emerald-500/30 hover:bg-emerald-500/50 text-white' : 'bg-white/[0.04] text-gray-600'}`}
            >
              💾 保存修改{changed.length ? `（${changed.length} 镜）` : ''}
            </button>
            <span className="text-[10px] text-gray-500">
              只改清单、还没渲染、不扣钱；保存后点「确认出片」即按新版出片
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function AgentPageInner() {
  const { user, logout, loading: authLoading } = useAuth() || ({ user: undefined, logout: async () => {}, loading: true } as any)
  const router = useRouter()
  // 2026-08-11：未登录访问首页 → 跳转 /landing（5 动画落地页）；已登录正常进对话
  useEffect(() => {
    if (!authLoading && !user) router.replace('/landing')
  }, [user, authLoading, router])
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [durInput, setDurInput] = useState('')   // ★VF_DUR_V1：成片时长自定义输入框
  const [loading, setLoading] = useState(false)
  const [pendingLabel, setPendingLabel] = useState('')  // 2026-08-24: 生成中反馈文案（类型化）
  // 2026-08-24: 视频任务自动轮询——VIDEO_TASK 消息出现后每 10s 查进度，完成/失败自动提醒（用户不再干等催）
  const handledVideoTasks = useRef(new Set<string>()) // 2026-09-06: 已处理过的视频任务——防失败/成功后重复轮询弹多条
  const handledMakeVideos = useRef(new Set<string>()) // ★VF_ASYNC_V1: 本地成片任务（防重复轮询）
  useEffect(() => {
    const lastVt = [...messages].reverse().find(m => m.role === 'assistant' && ((m as any).videoTaskId || (m.content && /VIDEO_TASK:([^|]+)/.test(m.content))))
    if (!lastVt) return
    const taskId = (((lastVt as any).videoTaskId) || ((lastVt.content || '').match(/VIDEO_TASK:([^|]+)/) || [])[1] || '').trim()
    if (!taskId) return
    if (handledVideoTasks.current.has(taskId)) return
    let stopped = false
    const iv = setInterval(async () => {
      try {
        const r = await fetch('/api/agent/video-task-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId }), credentials: 'include' }).then(r2 => r2.json())
        if (!r.success) return
        if (r.done) {
          clearInterval(iv)
          handledVideoTasks.current.add(taskId)
          if (!stopped) {
            if (r.videoUrl) {
              // 2026-09-06: 成片成功——content 只放人话，videoUrl 独立字段；镜像到本地仓库（防丢作品）
              try { (window as any).electronAPI?.storageMirror?.(r.videoUrl) } catch {}
              setMessages(prev => [...prev, { id: 'video-' + Date.now(), role: 'assistant', content: '视频已生成 ✅（已存个人仓库）', videoUrl: r.videoUrl }])
            } else {
              setRecordingTip('✅ 视频已生成（已存个人仓库）')
              setTimeout(() => setRecordingTip(''), 6000)
            }
          }
        } else if (r.failed) {
          clearInterval(iv)
          handledVideoTasks.current.add(taskId)
          if (!stopped) {
            const raw = r.errMsg || ''
            const why = raw.includes('input.media') ? '参考图未正确传入（图生视频）' : (raw.includes('insufficient') ? '余额不足' : raw)
            setMessages(prev => [...prev, { id: 'video-' + Date.now(), role: 'assistant', content: '❌ 视频生成失败' + (why ? ('：' + why) : '') + '——本次未扣点，可重试或换描述再生成。' }])
          }
        }
      } catch {}
    }, 10000)
    return () => { stopped = true; clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])
  // 2026-09-06: 生图任务自动轮询——IMAGE_PENDING 消息出现后每 5s 查，完成后图片卡片推进对话
  useEffect(() => {
    const lastIp = [...messages].reverse().find(m => m.role === 'assistant' && m.content && /IMAGE_PENDING:([^|]+)/.test(m.content))
    if (!lastIp) return
    const mIp = lastIp.content.match(/IMAGE_PENDING:([^|]+)/)
    if (!mIp) return
    const taskId = mIp[1].trim()
    let stopped = false
    const iv = setInterval(async () => {
      try {
        const r = await fetch('/api/agent/image-task-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId }) }).then(r => r.json())
        if (!r.success) return
        if (r.done && r.url) {
          clearInterval(iv)
          if (!stopped) {
            setMessages(prev => [...prev, { id: 'img-' + Date.now(), role: 'assistant', content: 'IMAGE_RESULT:' + r.url + '|TITLE:已生成图片' }])
          }
        }
      } catch {}
    }, 5000)
    return () => { stopped = true; clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // ★VF_ASYNC_V1（2026-09-18）：本地成片（make_ai_video）自动轮询
  //   MAKE_VIDEO_TASK 消息出现后每 6s 查一次进度；完成/失败都往对话里推一条结果。
  useEffect(() => {
    const lastMv = [...messages].reverse().find(m => m.role === 'assistant' && m.content && m.content.includes('MAKE_VIDEO_TASK:'))
    if (!lastMv) return
    const mMv = (lastMv.content || '').match(/MAKE_VIDEO_TASK:(\S+)/)
    if (!mMv) return
    const taskId = mMv[1].trim()
    if (!taskId) return
    if (handledMakeVideos.current.has(taskId)) return
    let stopped = false
    let ticks = 0
    const iv = setInterval(async () => {
      ticks++
      if (ticks > 300) {
        // ★VF_POLLTIMEOUT_V1（2026-09-20 端到端推演发现）：原来超时是【悄悄 clearInterval】
        //   → 用户不知道发生了什么，一直在等。改成明确告知。
        clearInterval(iv)
        if (!stopped) {
          setMessages(prev => [...prev, { id: 'mv-' + Date.now(), role: 'assistant',
            content: '⏱️ 这条成片任务等太久了（超过 30 分钟还没有结果）——可能服务器忙或中途中断了。\n你可以问我"视频做得怎么样了"看进度，或让我重新做一条。' }])
        }
        return
      }
      try {
        const r = await fetch('/api/agent/make-video-status?userId=' + (user?.id || '') + '&taskId=' + taskId, { credentials: 'include' }).then(r2 => r2.json())
        if (!r?.success || !Array.isArray(r.tasks) || !r.tasks.length) return
        // ★VF_POLLMATCH_V1（2026-09-20 端到端推演发现）：原来 `find(...) || r.tasks[0]` ——
        //   接口返回的是【最近 5 个任务】，一旦 find 没命中就会拿到**别的任务**的状态
        //   → 可能误报"完成/失败"（并发任务、或任务文件被清理时尤其危险）。必须精确命中。
        const t = r.tasks.find((x: any) => x.id === taskId)
        if (!t) return
        if (t.status === 'done') {
          clearInterval(iv)
          handledMakeVideos.current.add(taskId)
          if (!stopped) {
            // ★2026-09-19 修（用户实测：上次做好的视频会在下次会话/刷新后又冒出来）：
            //   任务文件一直在（status=done 不会消失），而 handledMakeVideos 是内存 ref
            //   → 刷新/新会话清空 → 轮询又查到 done → 再推一条完成卡 → 重复。
            //   这里按 taskId 去重（完成卡里带上 taskId，推之前查历史有没有）。
            setMessages(prev => {
              const dup = prev.some((m: any) => typeof m.content === 'string' && m.content.startsWith('MAKE_VIDEO_DONE:') && m.content.includes(taskId))
              if (dup) return prev
              return [...prev, { id: 'mv-' + Date.now(), role: 'assistant', content: 'MAKE_VIDEO_DONE:' + JSON.stringify({ taskId, repoName: t.repoName || '', out: t.out || '', url: t.url || '', repoError: t.repoError || '' }) }]
            })
          }
        } else if (t.status === 'failed') {
          clearInterval(iv)
          handledMakeVideos.current.add(taskId)
          if (!stopped) {
            setMessages(prev => [...prev, { id: 'mv-' + Date.now(), role: 'assistant', content: '❌ 本地成片失败（已跑 ' + (t.elapsedSec || 0) + 's）\n' + ((t.error || (t.tail || []).join('\n')) || '（无日志）') + '\n可让我重试。' }])
          }
        }
      } catch {}
    }, 6000)
    return () => { stopped = true; clearInterval(iv) }
  }, [messages, user?.id])

  // 2026-09-06: 数字人口播自动轮询——DH_TASK 消息出现后每 8s 查，完成后口播视频卡片推进对话
  useEffect(() => {
    const lastDh = [...messages].reverse().find(m => m.role === 'assistant' && m.content && /DH_TASK:([^|]+)/.test(m.content))
    if (!lastDh) return
    const mDh = lastDh.content.match(/DH_TASK:([^|]+)/)
    if (!mDh) return
    const taskId = mDh[1].trim()
    let stopped = false
    const iv = setInterval(async () => {
      try {
        const r = await fetch('/api/digital-human', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'query', taskId }) }).then(r => r.json())
        if (!r || !r.success) return
        if (r.avatarUrl) {
          clearInterval(iv)
          if (!stopped) {
            setMessages(prev => [...prev, { id: 'dh-' + Date.now(), role: 'assistant', content: 'DH_RESULT:' + r.avatarUrl + '|TITLE:数字人口播已生成' }])
          }
        } else if (r.status === 'FAILED' || r.status === 'CANCELED') {
          clearInterval(iv)
          if (!stopped) {
            setMessages(prev => [...prev, { id: 'dh-' + Date.now(), role: 'assistant', content: '❌ 数字人口播生成失败——本次未扣点，可重试。' }])
          }
        }
      } catch {}
    }, 8000)
    return () => { stopped = true; clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  const [sessionId, setSessionId] = useState<number | null>(null)
  // 2026-08-11：登录后恢复最近对话历史（界面不空；有历史则跳过欢迎/onboarding）
  const [historyLoaded, setHistoryLoaded] = useState(false)
  // 2026-08-15: 从公共素材库「推送给 AGENT」跳转进来——media 参数作为附件自动发送
  useEffect(() => {
    if (!user) return
    const sp = new URLSearchParams(window.location.search)
    const media = sp.get('media')
    const mt = sp.get('mt') || 'image'
    if (media) {
      setAttachments(prev => [...prev, { name: '推送素材', url: media, type: mt, frames: [] }])
      const t = setTimeout(() => sendMessage('请帮我看看这个素材，提取提示词或给出使用建议'), 800)
      return () => clearTimeout(t)
    }
  }, [user])

  // 2026-08-22: 换号切换上下文——user 变 → 重置加载标记+清 UI（库数据保留，重新加载该账号会话；换回恢复）
  const prevUserRef = useRef<string | null>(null)
  useEffect(() => {
    if (user && prevUserRef.current !== null && prevUserRef.current !== String(user.id)) {
      setHistoryLoaded(false)
      setMessages([])
      setSessionId(null)
      setWelcomeMsg(null)
      setOnboarding(false)
      loadCalendar()
    }
    prevUserRef.current = user ? String(user.id) : null
  }, [user])

  useEffect(() => {
    if (!user || historyLoaded) return
    if (sessionStorage.getItem('agent-fresh-day')) { setHistoryLoaded(true); sessionStorage.removeItem('agent-fresh-day'); return }  // 跨天新会话：不恢复昨天历史
    ;(async () => {
      try {
        // 用现有接口：先取最近会话列表 → 再取该会话消息
        const s = await fetch('/api/agent/chat?action=sessions', { credentials: 'include' }).then(r => r.json())
        const sessions = Array.isArray(s?.data) ? s.data : []
        setHistSessions(sessions)
        setSessionCount(sessions.length)
        if (sessions.length > 0) {
          // 2026-08-23: 最近会话不是今天更新的 → 不恢复（新的一天新会话，显示推荐/热点/提示词）
          const upd = sessions[0].updatedAt ? new Date(sessions[0].updatedAt) : null
          const isToday = !!upd && !isNaN(upd.getTime()) && upd.toDateString() === new Date().toDateString()
          if (!isToday) { setHistoryLoaded(true); return }
          const sid = sessions[0].id
          const m = await fetch(`/api/agent/chat?action=messages&sessionId=${sid}`, { credentials: 'include' }).then(r => r.json())
          const msgs = Array.isArray(m?.data?.messages) ? m.data.messages : []
          if (msgs.length > 0) {
            setMessages(msgs.map((x: any) => ({ role: x.role, content: x.content })))
            setSessionId(sid)
            setWelcomeMsg(null)
            setOnboarding(false)
            localStorage.setItem(`agent_onboarded_${user?.id || 'guest'}`, '1')
          }
        }
      } catch {}
      setHistoryLoaded(true)
    })()
  }, [user, historyLoaded])

  // 首次登录对话式 onboarding（纯对话、无按钮/标签，区别于被回退的 ada9740 按钮条）
  const [onboarded, setOnboarded] = useState(false)
  const [onboarding, setOnboarding] = useState(false)
  // ── 2026-08-20: 白龙马语音 1:1 复刻（点阵球 + 常开 + 自动断句发送 + barge-in）──
  useEffect(() => {
    if (!blmCanvasRef.current) return
    // 2026-08-20: 语音 ws 地址——生产连服务器 wss（nginx 反代 /voice/cloud→3721），本地 dev 用 127.0.0.1
    ;(window as any).__voiceWsUrl =
      typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
        ? 'ws://127.0.0.1:3721/voice/cloud'
        : 'wss://ai-niuma.cc/voice/cloud'
    let disposed = false
    Promise.all([
      import('@/lib/voice/voice-core'),
      import('@/lib/voice/voice-continuous'),
      import('@/lib/voice/voice-ptt'),
    ]).then(([coreMod, contMod, pttMod]) => {
      if (disposed) return
      // transcript 伪元素（textContent → setInterimText）
      const fakeTranscript: any = {}
      Object.defineProperty(fakeTranscript, 'textContent', { set(v: string) { if (!disposed) setInterimText(v) } })
      const core = coreMod.createVoiceCore({
        canvas: blmCanvasRef.current,
        transcript: fakeTranscript,
        getChatInput: () => inputRef.current?.value || '',
        getSendMessage: (opts: any) => { const t = typeof opts === 'string' ? opts : (opts?.text || ''); if (t.trim()) sendMessage(t.trim()) },
        getLang: () => 'zh-CN',
      })
      core.startRenderLoop()   // 2026-08-20: 启动渲染循环——否则主球 canvas 空白（idle 点阵球不显示）
      const continuous = contMod.createContinuousPolicy(core, { getAutoSend: () => true })
      // 4 个 TTS 全局（白龙马打断依赖——映射我们的 voice）
      ;(window as any).stopTTS = () => { try { voice?.stop() } catch {} }
      ;(window as any).duckTTS = () => {}
      ;(window as any).unduckTTS = () => {}
      ;(window as any).resumeTTSIfNoSpeech = () => {}
      core.setOnFrame((vol: number, frame: any) => { continuous.onFrame(vol, frame) })
      core.setOnTranscript((msg: any, isFinal: boolean) => { continuous.onTranscript(msg, isFinal) })
      core.setOnSessionStop(() => continuous.onSessionStop())
      core.setOnSuspendForTTS(() => continuous.onSuspendForTTS())
      core.setOnResume(() => continuous.onResume())
      // 点球 = 两态开关（白龙马 toggleVoice）
      if (blmCanvasRef.current) {
        blmCanvasRef.current.onclick = () => {
          if (core.micActive) { core.stopSession(); setRecordingTip('') }
          else { core.startSession(); setRecordingTip('🎤 聆听中（说一句话停顿自动发送，再点关闭）') }
        }
      }
      blmCoreRef.current = core
    }).catch(e => console.error('[白龙马语音] 初始化失败:', e))
    return () => { disposed = true; try { blmCoreRef.current?.stopSession?.() } catch {} }
  }, [])

  // 欢迎词单独存放，不进 messages，避免顶掉 BaiLongma 风格的主页欢迎区（声纹球+卡片）
  const [welcomeMsg, setWelcomeMsg] = useState<string | null>(null)
  // 画像快速登记（2026-08-10：首登结构化登记，写 AgentMemory）
  // ★PROFILE_FIX_V1 第2批：新增 topics「我关心的主题」—— 按画像推热点就用它
  const [onboardForm, setOnboardForm] = useState({ industry: '', occupation: '', needs: '', topics: '', platforms: [] as string[] })
  const [onboardSaving, setOnboardSaving] = useState(false)
  const PLATFORM_OPTS = ['抖音', '小红书', '视频号', '快手', 'B站', '淘宝直播', '公众号']
  const INDUSTRY_OPTS = ['餐饮', '美业', '教育', '电商', '旅游', '健身', '汽车', '房产', '其他']
  const submitOnboard = async () => {
    const { industry, occupation, needs, topics, platforms } = onboardForm
    if (!industry && !occupation && !needs && !topics) { alert('请至少填写行业、需求或主题'); return }
    setOnboardSaving(true)
    try {
      const r = await fetch('/api/agent/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(onboardForm), credentials: 'include' })
      const d = await r.json()
      if (d.success) {
        localStorage.setItem(`agent_onboarded_${user?.id || 'guest'}`, '1')
        setOnboarded(true); setOnboarding(false)
        setWelcomeMsg(`记住了！你（${industry || '待补充'} / ${occupation || '待补充'}）的核心需求我放进了记忆库，之后聊热点、做内容都会结合你的行业来。随时可以再告诉我更多～`)
      } else alert(d.message || '保存失败')
    } catch { alert('保存失败，请重试') }
    finally { setOnboardSaving(false) }
  }
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [showStorage, setShowStorage] = useState(false)
  const [storageItems, setStorageItems] = useState<any[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [agentMode, setAgentMode] = useState<'standard' | 'free'>('standard') // 2026-08-30: 标准/自由（自由=状态机跳过 AI 完全发挥）
  const [clearMsg, setClearMsg] = useState('') // 2026-08-30: 清理任务结果提示
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [lastPoints, setLastPoints] = useState<number | null>(null)
  // 助手人设名字（来自记忆中的 agent_profile，白龙马式自定义名）
  const [agentName, setAgentName] = useState('AI 助手')
  const [showNameEdit, setShowNameEdit] = useState(false)
  const [nameInput, setNameInput] = useState('')
  // ⚙️ AI 设置（2026-08-07：音色/温度/语音灵敏度）
  const [showPrefs, setShowPrefs] = useState(false)
  const [guideStep, setGuideStep] = useState(0) // 首登引导：0无/1填昵称/2填行业（2026-08-22）
  const [guideTour, setGuideTour] = useState(false) // 第二段功能演示（2026-08-22：设置完成后自动弹）
  // 功能演示步骤：依次展示 一键成片/文生图/文生视频/素材库
  const TOUR_STEPS = [
    { name: '🖼 AI 生图', path: '/image-generator', desc: '文字描述生成海报/配图（12 点/张）' },
    { name: '🎬 AI 视频', path: '/text-to-video', desc: '一句话生成视频（按秒计费，先报费用）' },
    { name: '📦 素材库', path: '/storage', desc: '你的个人仓库（上传/管理视频图片）' },
  ]
  const [showLogout, setShowLogout] = useState(false) // 2026-08-11：退出用自定义弹窗（不用浏览器 confirm）
  const [ttsVoice, setTtsVoice] = useState('longxiaochun')
  const [temperature, setTemperature] = useState(0.7)
  // ★VF_MODELSWITCH_V1：模型档位（默认 fast = 现状，逐字一致，零回归）
  const [modelPreset, setModelPreset] = useState<ModelPresetId>('fast')
  const [modelBrain, setModelBrain] = useState('qwen3.8-flash')
  const [modelWriter, setModelWriter] = useState('deepseek-v4-flash')
  const [vadThreshold, setVadThreshold] = useState(0.045)
  const [vadSilence, setVadSilence] = useState(1800)
  const [ttsVoices, setTtsVoices] = useState<{ id: string; label: string }[]>([])
  const [industry, setIndustry] = useState('') // 行业（视频/热点按行业推送，2026-08-09）
  // ★PROFILE_FIX_V1 第2批：我关心的主题（热点按这些词搜）
  //   注意：变量名用 myTopics —— hotTopics 已被"热榜数据数组"占用（大屏渲染在用）
  const [myTopics, setMyTopics] = useState('')
  // ── 自检 + 左侧信息面板（2026-08-08：账号/订阅/点数/模型/记忆 + A+B 自检）──
  const [selfChecks, setSelfChecks] = useState<{ key: string; label: string; ok: boolean; detail?: string }[]>([])
  const [selfModel, setSelfModel] = useState<{ brain: string; asr: string; tts: string } | null>(null)
  const [selfChecking, setSelfChecking] = useState(false)
  const [showSelfCheck, setShowSelfCheck] = useState(false)
  const [sessionStart] = useState(Date.now())
  // 2026-08-14: 历史会话面板
  const [histOpen, setHistOpen] = useState(false)
  const [histSessions, setHistSessions] = useState<{ id: number; title: string; updatedAt: string }[]>([])
  const [sessionCount, setSessionCount] = useState(0)
  const [appVersion, setAppVersion] = useState('1.0.19')
  useEffect(() => {
    try {
      const w = window as any
      if (w.electronAPI?.getAppVersion) { w.electronAPI.getAppVersion().then((v: any) => v?.version && setAppVersion(v.version)).catch(() => {}) }
      else {
        // 网页端：读服务器版本（不再显示默认 1.0.19）
        fetch('/api/client-info', { credentials: 'include' }).then(r => r.json())
          .then((d: any) => d?.data?.version && setAppVersion(d.data.version)).catch(() => {})
      }
    } catch {}
  }, [])
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
          if (d.data.industry) setIndustry(d.data.industry)
          setTemperature(d.data.temperature ?? 0.7)
          // ★VF_MODELSWITCH_V1：回填模型档位（服务端已 resolve 过，非法值一定回落 fast）
          if (d.data.modelChoice) {
            const _mc = resolveModelChoice(d.data.modelChoice)
            setModelPreset(_mc.preset); setModelBrain(_mc.brain); setModelWriter(_mc.writer)
          }
          setVadThreshold(d.data.vadThreshold ?? 0.045)
          setVadSilence(d.data.vadSilence ?? 1800)
          if (d.data.voices?.length) setTtsVoices(d.data.voices)
        }
      })
      .catch(() => {})
    // ★PROFILE_FIX_V1 第2批：回填「我关心的主题」（存在 AgentMemory 的 画像,主题 记录里）
    fetch('/api/agent/memories', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const t = (d.items || []).find((m: any) => String(m.tags || '').includes('画像,主题'))
        if (t) setMyTopics(String(t.content || '').replace(/^用户关注主题：/, ''))
      })
      .catch(() => {})
  }, [user])
  // 保存设置
  const savePrefs = async () => {
    setSavingPrefs(true)
    try {
      // ★VF_MODELSWITCH_V1：模型档位一并保存（custom 时把两个槽位都带上；服务端会再校验一次）
      await fetch('/api/agent/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ttsVoice, temperature, vadThreshold, vadSilence, industry, modelChoice: { preset: modelPreset, brain: modelBrain, writer: modelWriter } }), credentials: 'include' })
      // ★PROFILE_FIX_V1 第2批：主题一并写入画像（同时把行业同步进画像；没填的字段不会被动到）
      try {
        await fetch('/api/agent/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topics: myTopics, industry }), credentials: 'include' })
      } catch {}
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
  const [hotTopics, setHotTopics] = useState<{ source: string; region: 'cn' | 'global'; items: { title: string; hot?: string; url?: string; fetchedAt?: number; }[] }[]>([])
  // 大屏视频推荐 + 发布统计（2026-08-08）
  const [trendVideos, setTrendVideos] = useState<{ platform: string; title: string; url: string; thumbnail?: string; duration?: string }[]>([])
  const [publishStats, setPublishStats] = useState<{ platform: string; count: number }[]>([])
  const [trendVideosLoading, setTrendVideosLoading] = useState(false)
  const loadTrendVideos = async () => {
    setTrendVideosLoading(true)
    try {
      const r = await fetch('/api/agent/trend-videos', { credentials: 'include' })
      const d = await r.json()
      if (d.success && d.data?.videos) setTrendVideos(d.data.videos)
    } catch {}
    finally { setTrendVideosLoading(false) }
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
    { path: '/auto-compile', title: '一键成片', color: 'emerald', roles: ['admin'] },
    { path: '/text-to-video', title: '文生视频', color: 'cyan', roles: ['admin', 'editor', 'end-user'] },
    { path: '/ai-copy', title: 'AI 文案', color: 'amber', roles: ['admin', 'editor', 'end-user'] },
    { path: '/image-generator', title: 'AI 生图', color: 'violet', roles: ['admin', 'editor', 'end-user'] },
    { path: '/storage', title: '个人仓库', color: 'sky', roles: ['admin', 'editor', 'end-user'] },
    { path: '/media-library', title: '公共素材', color: 'lime', roles: ['admin', 'editor', 'end-user'] },
    { path: '/media-library?tab=prompts', title: '提示词库', color: 'violet', roles: ['admin', 'editor', 'end-user'] },
    { path: '/accounts', title: '账号管理', color: 'teal', roles: ['admin', 'editor', 'end-user'] },
    { path: '/browser-accounts', title: '浏览器账号', color: 'sky', roles: ['admin', 'editor', 'end-user'] },
    { path: '/digital-human', title: '数字人', color: 'orange', roles: ['admin', 'editor', 'end-user'] },
    { path: '/my-subscription', title: '我的套餐', color: 'amber', roles: ['admin', 'editor', 'end-user'] },
    { path: '/music-library', title: '音乐库', color: 'cyan', roles: ['admin', 'editor', 'end-user'] },
    // 代理+管理可见
    { path: '/dashboard', title: '数据看板', color: 'rose', roles: ['admin', 'editor'] },
    { path: '/lead-collector', title: '意向采集', color: 'orange', roles: ['admin', 'editor'] },
    // 仅 admin（管理/自动化）
    { path: '/my-fingerprint', title: '指纹发布', color: 'pink', roles: ['admin', 'editor', 'end-user'] },
    { path: '/admin', title: '管理后台', color: 'red', roles: ['admin'] },
    { path: '/admin/agent-tools', title: '工具箱', color: 'fuchsia', roles: ['admin'] },
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
  // 2026-08-14: AI 生成 BGM（Minimax）
  const [musicPrompt, setMusicPrompt] = useState('')
  const [musicGenBusy, setMusicGenBusy] = useState(false)
  const [musicGenMsg, setMusicGenMsg] = useState('')
  const [musicGenUrl, setMusicGenUrl] = useState('')
  const [musicGenNeedsPay, setMusicGenNeedsPay] = useState(false)

  const loadMedia = async () => {
    setMediaLoading(true)
    try {
      const r = await fetch('/api/agent/media', { credentials: 'include' })
      const d = await r.json()
      if (d.success) setMediaData(d.data)
    } catch {} finally { setMediaLoading(false) }
  }
  // 2026-08-14: AI 生成背景音乐（Minimax music-3.0）
  const genMusic = async () => {
    const prompt = musicPrompt.trim()
    if (!prompt) { setMusicGenMsg('请输入音乐风格描述'); setMusicGenNeedsPay(false); return }
    setMusicGenBusy(true); setMusicGenMsg('生成中，约 30-90 秒…'); setMusicGenUrl(''); setMusicGenNeedsPay(false)
    try {
      const r = await fetch('/api/music/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const d = await r.json()
      if (d.success && d.url) {
        setMusicGenUrl(d.url); setMusicGenMsg('✅ 生成成功（可试听 / 用做背景乐）')
      } else {
        setMusicGenMsg(d.message || '生成失败'); setMusicGenNeedsPay(!!d.needsPayment)
      }
    } catch { setMusicGenMsg('生成失败（网络/服务异常）'); setMusicGenNeedsPay(false) }
    finally { setMusicGenBusy(false) }
  }
  const addGenMusic = () => {
    if (!musicGenUrl) return
    const next = musicGenUrl.trim()
    setMediaData((prev) => prev ? {
      ...prev,
      bgm: [...prev.bgm, { id: Date.now(), title: 'AI 生成 · ' + (musicPrompt.slice(0, 12) || '背景乐'), mood: 'ai', url: next }],
    } : prev)
    setMusicGenMsg('已加入音乐库（本次会话可用）')
  }
  // 2026-08-14: 客户画像实时加载（不再点击才拉取）
  const loadBrainMemories = async () => {
    try {
      const r = await fetch('/api/agent/memories', { credentials: 'include' })
      const d = await r.json()
      if (d.success) setBrainMemories(d.items || [])
    } catch {}
  }
  useEffect(() => { loadBrainMemories(); loadMedia() }, [])
  // 2026-08-14: 历史会话——列表加载 + 切换
  const loadSessions = async () => {
    try {
      const r = await fetch('/api/agent/chat?action=sessions', { credentials: 'include' }).then(r => r.json())
      const list = Array.isArray(r?.data) ? r.data : []
      setHistSessions(list)
      setSessionCount(list.length)
    } catch {}
  }
  const loadSession = async (sid: number) => {
    try {
      const m = await fetch(`/api/agent/chat?action=messages&sessionId=${sid}`, { credentials: 'include' }).then(r => r.json())
      const msgs = Array.isArray(m?.data?.messages) ? m.data.messages : []
      setMessages(msgs.map((x: any) => ({ role: x.role, content: x.content })))
      setSessionId(sid)
      setWelcomeMsg(null)
      setOnboarding(false)
      setHistOpen(false)
    } catch {}
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
  const recognizingRef = useRef(false)           // 识别中互斥（防重复启动崩溃）
  const blmCanvasRef = useRef<HTMLCanvasElement | null>(null)   // 白龙马点阵球 canvas
  // 2026-08-20: 旧球点击转发到白龙马（点=开听/再点=关）
  const blmToggle = () => {
    if (blmCanvasRef.current) blmCanvasRef.current.dispatchEvent(new MouseEvent('click'))
  }
  const blmCoreRef = useRef<any>(null)                          // 白龙马 voice core
  const webRecRef = useRef<any>(null)          // 录音控制器（PCM 采集用）
  const webRecCtxRef = useRef<any>(null)       // PCM AudioContext
  let webRecSampleRate = 16000                 // PCM 采样率
  const webRecBufRef = useRef<Float32Array[]>([]) // 实时发送缓冲
  let vadSilenceMs = 0                            // VAD 静音累计（ms）
  let vadLastVoiceMs = 0                          // 上次有声音时间
  let vadEnding = false                           // 正在结束本句（防重复）
  const webRecChunksRef = useRef<BlobPart[]>([]) // 网页版录音块
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
      // 2026-08-19: 清理上次残留（旧流/旧 AudioContext）——防点多次资源累积崩溃
      try { mediaStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
      try { webRecCtxRef.current?.close?.() } catch {}
      webRecCtxRef.current = null
      console.log('[语音] 开始 getUserMedia...')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      console.log('[语音] getUserMedia OK, tracks:', stream.getAudioTracks().length)
      // 2026-08-19: 统一 MediaRecorder → 上传服务器 ASR（壳/网页都不依赖本地代理——C 方案）
      // 2026-08-20 方案一：PCM 采集（录音完上传服务器百炼识别——不加载本地 sherpa，不崩）
      webRecRef.current = null
      webRecChunksRef.current = []
      webRecSampleRate = 16000
      setInterimText('')
      try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext
        const ctx = new AC()
        webRecCtxRef.current = ctx
        console.log('[语音] AudioContext OK, sampleRate=', ctx.sampleRate)
        webRecSampleRate = ctx.sampleRate || 16000 // 2026-08-20: 真实设备采样率（可能 48000）——IPC 带真实 sr 由 sherpa 重采样
        const src = ctx.createMediaStreamSource(stream)
        const proc = ctx.createScriptProcessor(4096, 1, 1)
        proc.onaudioprocess = (e: any) => {
          const ch = e.inputBuffer.getChannelData(0)
          const f = new Float32Array(ch.length)
          f.set(ch)
          webRecChunksRef.current.push(f)
          let rms = 0
          for (let i = 0; i < ch.length; i += 64) { const v = ch[i]; rms += v * v }
          const vol = Math.min(1, Math.sqrt(rms / (ch.length / 64)) * 4)
          setMicVolume(vol)
          // 2026-08-20 VAD：静音 2.5s → 自动发送本句（实时对话，不用点停止）
          const now = Date.now()
          if (vol > 0.03) { vadLastVoiceMs = now; vadSilenceMs = 0 }
          else if (vadLastVoiceMs > 0 && !vadEnding) {
            vadSilenceMs += (ch.length / webRecSampleRate) * 1000
            if (vadSilenceMs > 2500 && webRecChunksRef.current.length > 8) {
              vadEnding = true
              vadLastVoiceMs = 0; vadSilenceMs = 0
              setRecordingTip('识别中…')
              uploadAndSend(true) // 自动发送本句，继续听
            }
          }
        }
        src.connect(proc); proc.connect(ctx.destination)
        webRecRef.current = { stop: () => { try { src.disconnect(); proc.disconnect() } catch {} } }
      } catch (_) {}
      // 2026-08-20: 不切 orbState('listening')——声纹球动画 rAF 有 TDZ 会卡死主线程（录音后无法停止/上传）
      setIsRecording(true)
      setRecordingTip('🎤 我在听，说完了点声纹球停止')
      console.log('[语音] 录音已启动（方案一服务器上传，orbState 保持 idle）')
      return
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
      console.error('[语音] 启动失败:', e?.name, e?.message, e)
      setRecordingTip(e?.name === 'NotAllowedError' ? '麦克风权限被拒绝' : '语音启动失败：' + (e?.name || '') + ' ' + (e?.message || e))
    }
  }
  // 2026-08-18: 网页版录音上传服务器 ASR（百炼识别）
  // 2026-08-19: PCM → 本地 sherpa 识别（A）→ 失败兜底服务器（C）
  const encodeWav = (samples: Float32Array, sampleRate: number): ArrayBuffer => {
    const buf = new ArrayBuffer(44 + samples.length * 2)
    const dv = new DataView(buf)
    const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
    ws(0, 'RIFF'); dv.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE')
    ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
    dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
    ws(36, 'data'); dv.setUint32(40, samples.length * 2, true)
    for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true) }
    return buf
  }
  // 2026-08-20 方案一：PCM → wav → 上传服务器 ASR（百炼 paraformer）
  const uploadForAsr = async (samples: Float32Array, sampleRate: number): Promise<string> => {
    try {
      const buf = new ArrayBuffer(44 + samples.length * 2)
      const dv = new DataView(buf)
      const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
      ws(0, 'RIFF'); dv.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE')
      ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
      dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
      ws(36, 'data'); dv.setUint32(40, samples.length * 2, true)
      for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true) }
      const fd = new FormData()
      fd.append('audio', new Blob([buf], { type: 'audio/wav' }), 'record.wav')
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 30000)
      const resp = await fetch('/api/agent/asr', { method: 'POST', body: fd, credentials: 'include', signal: ac.signal })
      clearTimeout(t)
      const d = await resp.json()
      return d?.success && d.text ? String(d.text) : ''
    } catch { return '' }
  }
  const recognizeAudio = async (samples: Float32Array, sampleRate: number) => {
    setOrbState('thinking')
    setRecordingTip('识别中…')
    let text = ''
    try {
      // 2026-08-24: sherpa 本地识别已弃用（打包崩溃）——直接走服务器 ASR
      // C 兜底：上传服务器 ASR（PCM → wav）
      if (!text) {
        const wav = encodeWav(samples, sampleRate)
        const fd = new FormData()
        fd.append('audio', new Blob([wav], { type: 'audio/wav' }), 'record.wav')
        const ac = new AbortController()
        const t = setTimeout(() => ac.abort(), 45000)
        const resp = await fetch('/api/agent/asr', { method: 'POST', body: fd, credentials: 'include', signal: ac.signal })
        clearTimeout(t)
        const d = await resp.json()
        if (d.success && d.text) text = d.text
      }
    } catch { /* 静默 */ }
    if (text && text.trim()) {
      setStreamText(text)
      setRecordingTip('已识别')
      sendMessage(text)
    } else {
      setRecordingTip('识别失败，请重试')
    }
    setIsRecording(false)
    setOrbState('idle')
    try { mediaStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
    mediaStreamRef.current = null
  }

  // 2026-08-20: 上传当前录音句 → 识别 → 发送（continueListening=true 继续听下一句 / false 全停）
  const uploadAndSend = async (continueListening: boolean) => {
    const all = webRecChunksRef.current
    const total = all.reduce((n: number, f: Float32Array) => n + f.length, 0)
    webRecChunksRef.current = []
    if (total === 0) {
      vadEnding = false
      if (!continueListening) {
        setIsRecording(false); recognizingRef.current = false
        try { mediaStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
        mediaStreamRef.current = null
      }
      return
    }
    recognizingRef.current = true
    setRecordingTip('识别中…')
    try {
      const samples = new Float32Array(total)
      let off = 0
      for (const f of all) { samples.set(f, off); off += f.length }
      const text = await uploadForAsr(samples, webRecSampleRate)
      if (text && text.trim()) {
        setInterimText('')
        setStreamText(text)
        setRecordingTip(continueListening ? '已发送，继续听…' : '已识别')
        console.log('[语音] 识别成功:', text)
        sendMessage(text.trim())
      } else setRecordingTip(continueListening ? '没听清，继续说…' : '没听清，请再说一次')
    } catch {}
    recognizingRef.current = false
    vadEnding = false
    if (!continueListening) {
      setIsRecording(false)
      setRecordingTip('')
      setInterimText('')
      try { mediaStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
      mediaStreamRef.current = null
    }
  }

  const stopVoiceListen = () => {
    // 手动停止：上传剩余句 → 全停
    if (webRecRef.current) {
      try { webRecRef.current.stop?.() } catch {}
      webRecRef.current = null
      try { webRecCtxRef.current?.close?.() } catch {}
      webRecCtxRef.current = null
      uploadAndSend(false)
      setRecordingTip('')
      setInterimText('')
      return
    }
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
      webRecRef.current = null // 打断：丢弃
      window.electronAPI?.asrSessionAbort?.().catch(() => {}) // 2026-08-19: 打断取消流式会话
      try { mediaRecorderRef.current?.stop() } catch {}
      try { mediaStreamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
      mediaStreamRef.current = null
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
  // 2026-08-20: 克隆白龙马两态纯开关（点=开听/再点=关，任何状态点都关）——不再三态混乱
  const toggleRecording = () => {
    if (isRecording || recognizingRef.current) {
      // 开 → 关（朗读中一并打断 TTS）
      if (orbState === 'speaking') { try { voice.stop() } catch {} }
      setDialogMode(false)
      stopVoiceListen()
      setRecordingTip('')
      setInterimText('')
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
      // 2026-08-12：账号级标记（避免换账号被旧标记跳过）；无画像一律进入
      const onbKey = `agent_onboarded_${user?.id || 'guest'}`
      const done = typeof localStorage !== 'undefined' && localStorage.getItem(onbKey) === '1'
      if (done) { setOnboarded(true); return }
      try {
        const r = await fetch('/api/agent/memories?limit=30', { credentials: 'include' })
        const d = await r.json()
        const hasProfile = (d.items || d.memories || []).some((m: any) => (m.tags || '').includes('画像'))
        if (hasProfile) {
          localStorage.setItem(`agent_onboarded_${user?.id || 'guest'}`, '1')
          setOnboarded(true)
          return
        }
      } catch {}
      // 2026-08-22: 无画像 → 自动打开设置引导（填昵称+行业），不再只发欢迎词
      // 2026-08-23: 仅首次登录弹一次（localStorage 标记），之后开客户端不再自动弹（🎓引导按钮可手动重看）
      const guideDone = localStorage.getItem(`aim_guide_done_${user?.id || 'guest'}`)
      if (guideDone) return
      setGuideStep(1)
      setShowPrefs(true)
      setTimeout(() => { try { voice?.speak('你好！我是你的 AI 助手。先给我起个名字吧，在设置里输入后点保存。') } catch {} }, 800)
      setOnboarding(true)
      const welcome = '嗨，我是你的营销搭子～先聊两句我就能更懂你：你目前在做什么行业、平常最头疼的是写内容还是发内容？你想让我帮你干点啥，直接说，我记一下就好。'
      setWelcomeMsg(welcome)
      // 2026-08-06：欢迎语仅文字展示，不自动朗读（消除双声）
    })()
  }, [user])

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

  // ── 日历（2026-08-21：按天回档会话 + 收藏 + 农历）──
  const [calOpen, setCalOpen] = useState(false)
  const [calY, setCalY] = useState(() => new Date().getFullYear())
  const [calM, setCalM] = useState(() => new Date().getMonth())
  const [calData, setCalData] = useState<Record<string, any[]>>({})
  const [calFavs, setCalFavs] = useState<any[]>([])
  const [calDay, setCalDay] = useState<string | null>(null)
  // ── 浏览器登录登记（系统 Chrome 一条线——bu_check 读 browser-profile Cookies）──
  const [buAccounts, setBuAccounts] = useState<any[]>([]) // 2026-09-05: Browser Use 静默扫描登录态
  const [browserOpen, setBrowserOpen] = useState(false)
  useEffect(() => {
    // USER_READY_V1_C（2026-09-14）：竞态兜底只重试一次
    //   客户端刚启动时主进程可能还没解析出 userId（会先读到空的 default profile）→ 所有平台显示未登录，
    //   用户要"点一次/刷新检测"才恢复。若首次【一个平台都没登录】，1.5s 后自动重查一次即可恢复。
    let retriedOnce = false
    const detect = async () => {
      // 2026-09-07: 统一 buCheck（读 browser-profile Cookies）——登记/发布一条线，删 Playwright CDP 检测
      // KEEP_LAST_ACCOUNTS (2026-09-13 用户要求)：打开浏览器时 Chrome 会锁 Cookies → buCheck 可能读失败
      //   → 原来拿到空数组就把平台 ✓ 全清（显示"登录态消失"）
      //   → 现在：① 只有拿到【非空】结果才覆盖   ② 服务端读失败时会回退上次缓存（bu_check.py）
      try {
        const br = await (window as any).electronAPI?.buCheck()
        const accts: any[] = Array.isArray(br?.accounts) ? br.accounts : []
        const anyLoggedIn = accts.some((a: any) => a && a.loggedIn)
        if (br?.success && accts.length > 0) {
          setBuAccounts(accts)
          // ★LOGIN_UNIFY_V1（2026-09-28）：把登录态【上报服务端】——
          //   原来 /api/agent/browser-status 只有定义、**全仓 0 个调用方**，
          //   于是 AI（chat/route.ts 的 publish_content）读到的是空数据 →
          //   明明已经登录，AI 还会说"请先去登记/未登录平台"。
          //   现在每次检测都上报一份（服务端是 5 分钟内存缓存，够一轮对话用）。
          try {
            fetch('/api/agent/browser-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                accounts: accts.map((a: any) => ({
                  id: a.id, name: a.name, loggedIn: !!a.loggedIn,
                  reason: a.reason || '', expireAt: a.expireAt || 0,
                })),
              }),
            }).catch(() => {})
          } catch {}
          if (!anyLoggedIn && !retriedOnce) { retriedOnce = true; setTimeout(detect, 1500) }
        } else if (!br?.success) {
          // 读失败 → 保留上次结果，不清空（避免误判"未登录"）
        } else {
          // ★BUCHECK_HONEST_V1_C（2026-09-17）：上面注释说要"只有非空才覆盖"，但旧代码这里
          //   照样 setBuAccounts(accts)（可能是空数组）→ 平台被全清 → 用户看到"全部未登录"
          //   （用户实测：重登 3 次仍显示未登录）。现在空数组【不再覆盖】，保留上次结果。
        }
      } catch {}
    }
    detect()
    // 2026-08-25: 切页返回/窗口聚焦时重新检测（不再显示旧"未登录"）
    const onVis = () => { if (document.visibilityState === 'visible') setTimeout(detect, 800) }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis) }
  }, [])
  // ── 功能提示标签（新手引导——点击填入输入框）──
  // 2026-09-13: 任务进度带 + 勾选跳过【已删除】（用户确定：逻辑多易错乱，改为固定 6 步全做；以后换成「日常任务」）
  const FEATURE_TIPS = [
    '帮我发一个视频', '帮我写一个小红书文案', '帮我生成一张产品海报',
    '帮我查一下今日热点', '帮我生成一个数字人口播',
    // ★VF_LINES_V1（2026-09-21）：成片线【各给一个入口词】——用户定案：几条状态机互不共享
    // ★VF_RENAME_V1（2026-09-28，用户定案）：素材线按钮改成短名「图片成片」，
    //   并把【视频混剪】线也放上来 —— 两个短名凑成一对：
    //     图片成片 = 只用你仓库的图；图视混剪 = 你仓库的视频片段 + 图片混排（AI 决定哪几镜用视频）。
    //   ⚠️ 「视频混剪」这条线 09-24 建好后**漏登记命令表**，导致标准模式下说它被锁死回复拦住
    //      （用户实测；能进的那台是因为账号上另有旧草稿把闸门顶开了）—— 09-28 已补上。
    '图片成片',                      // ① 素材智能成片（只用你仓库的图）
    '图视混剪',                      // ② 视频混剪（视频片段 + 图片混排）
    'AI 制片',                       // ③ AI 制片（画面全部 AI 生成）
    '素材+AI',
    'PPT成片',                       // ★VF_PPT_SPLIT_V1（2026-10-06）：PPT 成片独立线（只吃文案+皮肤；配音为时序真源，不掺素材图）                       // ④ 素材+AI 创作（AI 挑该动的镜用 AI，其余用素材）
    // ★VF_LEAD_V1（2026-09-29 老板定案）：第 5 条状态机线 ——「智能获客」设置面板。
    //   ⚠️ 与 standard-commands.ts 的 STD_COMMANDS 必须一字不差（后端是"去空白后完全相等"）。
    '智能获客',
    // ★STD_MODE_V1（2026-09-21，用户定案）：「帮我搜一下小红书…」**删除**（不做）；
    //   剩下的「热点 / 配乐 / 记录待办」先留着 —— 点了由后端回「开发中」（standard-commands.ts 里 kind:'wip'）。
    //   ⚠️ 这里每一条都必须与 `src/lib/agent/standard-commands.ts` 的 STD_COMMANDS **一字不差**
    //      （后端是"去空白后完全相等"的严格匹配；改名时两处一起改）。
    '帮我配一段背景音乐', '帮我记录一件事：明天要交房租',
  ]
  // 2026-08-21: 跨天自动新会话——进入检测（客户端可能不常开）+ 12 点定时（开着时）
  useEffect(() => {
    const checkDay = () => {
      const today = new Date().toDateString()
      const last = localStorage.getItem('agent-last-date')
      if (last && last !== today) {
        setMessages([])
        setSessionId(null)
        sessionStorage.setItem('agent-fresh-day', '1')  // 2026-08-23: 跨天标记——本次开客户端不恢复昨天会话（真新会话，显示推荐/热点/提示词）
        setRecordingTip('新的一天开始了，已为你开启新会话（昨天的对话在日历里可回档）')
      }
      localStorage.setItem('agent-last-date', today)
    }
    checkDay()
    const timer = setInterval(() => {
      const now = new Date()
      if (now.getHours() === 12 && now.getMinutes() < 5) checkDay()
    }, 60000)
    return () => clearInterval(timer)
  }, [])
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  const lunarOf = (y: number, m: number, d: number) => { try { return Solar.fromYmd(y, m + 1, d).getLunar().getDayInChinese() } catch { return '' } }
  const loadCalendar = async () => {
    try {
      const r = await fetch('/api/agent/chat?action=sessionsByDate', { credentials: 'include' }).then(r => r.json())
      if (r.success) { setCalData(r.data || {}); setCalFavs(r.favorites || []) }
    } catch {}
  }
  const toggleFav = async (id: number, fav: boolean) => {
    await fetch(`/api/agent/chat?action=favoriteToggle&id=${id}&fav=${fav ? 1 : 0}`, { credentials: 'include' }).catch(() => {})
    loadCalendar()
  }
  const openCalDay = async (d: string) => { setCalDay(d); await loadCalendar() }
  const loadSessionByDate = async (sid: number) => {
    try {
      const m = await fetch(`/api/agent/chat?action=messages&sessionId=${sid}`, { credentials: 'include' }).then(r => r.json())
      if (m.success && Array.isArray(m.data?.messages)) {
        setMessages(m.data.messages.map((x: any) => ({ id: String(x.id), role: x.role, content: x.content, timestamp: Date.now(), intent: x.intent, toolUsed: x.toolUsed })))
        setSessionId(sid)
        setCalOpen(false)
      }
    } catch {}
  }

  // 2026-08-30: 清会话按钮——清聊天记录（messages + 会话 localStorage）（用户原意：清历史记录）
  const clearTodayTasks = async () => {
    try {
      setMessages([])
      try { fetch('/api/agent/chat', { method: 'DELETE' }).catch(() => {}) } catch {}
      try { localStorage.removeItem('agent_session_' + (sessionId || '')); localStorage.removeItem('agent_messages') } catch {}
      // 2026-08-31: 该路由不存在（静默 404）——本地清 messages 即可（会话已在前端清） }
      setClearMsg('已清空会话（聊天记录已清）')
      setTimeout(() => setClearMsg(''), 3000)
    } catch { setClearMsg('清理失败'); setTimeout(() => setClearMsg(''), 3000) }
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
      content: finalText,
      attachments: attachments.length ? attachments : undefined,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setAttachments([])
    setLoading(true)
    setOrbState('thinking')
    setLiveSteps([])
    // 2026-08-24: 生成中反馈——根据意图显示类型化文案（避免用户干等一直催）
    const ft = (finalText || '').toLowerCase()
    setPendingLabel(
      /图|海报|插画|画|生成.*图/.test(ft) ? '🎨 正在生成图片…' :
      /发布|发.*视频|发.*抖音|发.*小红书|帮我发/.test(ft) ? '🚀 正在准备发布…' :
      // ★A7（2026-09-22）：AI 逐镜生成（H3）**每镜** 1~3 分钟，整条通常 5~15 分钟 ——
      //   原来一律写"约 1-3 分钟"，与实测（9~11 分钟）差了近一个数量级。现在按线区分。
      /文生视频|h3|ai\s*生成|全部\s*ai|素材\s*[+＋]\s*ai|逐镜/.test(ft) ? '🎬 正在生成视频（AI 逐镜生成，约 5-15 分钟）…' :
      /生成.*视频|合成|成片|做视频|做个视频|做一条视频|出片|视频生成/.test(ft) ? '🎬 正在生成视频（约 1-3 分钟）…' :
      /文案|标题|脚本|文章/.test(ft) ? '✍️ 正在写文案…' :
      '💭 正在处理…'
    )

    try {
      const t0 = Date.now()
      pushTerm(`POST /api/agent/chat  ${finalText.slice(0, 24) || '(附件)'}`)
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      const body: any = { message: finalText, history, sessionId: sessionId || undefined, mode: agentMode }
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
        signal: AbortSignal.timeout(660000), // 2026-09-18: 后端 H3 轮询上限 600s（Turbo 实测 101s）+入库 —— 前端必须大于后端，否则后端还在等、前端先断
      })
      const data = await res.json()
      if (data.success) {
        pushTerm(`chat 完成 · ${Date.now() - t0}ms${data.data?.toolUsed ? ` · 工具 ${(data.data.steps?.length || 0)} 步` : ' · 直接回复'}`, 'ok')
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(), role: 'assistant',
          content: data.data.reply, timestamp: Date.now(),
          videoTaskId: data.data.videoTaskId || '',
          intent: data.data.intent?.join?.(',') || data.data.intent,
          toolUsed: data.data.toolUsed,
          steps: data.data.steps,
          scene: data.data.scene,
          scenes: data.data.scenes || (data.data.scene ? [data.data.scene] : null),
        }])
              // 2026-08-23: 浏览器通道指令（原 CLIENT_OPENCLI）——opencli 依赖已清除，采集类用自有热点/搜索 API
        // 2026-08-14: 对话后实时刷新客户画像（记忆可能已更新）
        loadBrainMemories()
        // onboarding 收尾：AGENT 给出"已记住/随时服务"类收尾语即结束摸底
        if (onboarding) {
          const tail = data.data.reply || ''
          if (/随时(为|给)你(服务|效劳)|已经(记|记住|记下|了解)|记住了|了解你了|懂你了/.test(tail)) {
            setOnboarding(false)
            setOnboarded(true)
            if (typeof localStorage !== 'undefined') localStorage.setItem(`agent_onboarded_${user?.id || 'guest'}`, '1')
          }
        }
        if (data.data.sessionId) setSessionId(data.data.sessionId)
        setOrbState('idle')
        // AI 回复自动朗读（2026-08-07：所有回复都朗读，对话模式朗读完自动再听）
        if (data.data.reply && dialogMode) {  // 2026-08-31: 自动朗读默认关——仅语音对话模式
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
          // 2026-08-18: 路径白名单——普通用户路由，禁 admin 后台
          const p2 = (data.data.scene?.path || '').split('?')[0]
          if (p2.startsWith('/admin')) { console.warn('SCENE 拦截 admin 路径:', p2); data.data.scene = null }
          const path = data.data.scene.path || '/'
          const params = data.data.scene.params || {}
          const qs = new URLSearchParams(params).toString()
          const sep = path.includes('?') ? '&' : '?'
          const target = `${path}${qs ? sep + qs : ''}${qs ? '' : sep}embed=1`
          const known = APPS.find(a => a.path === path)
          const title = known?.title || (path.split('/').filter(Boolean).pop() || '功能')
          if (hotspotOpen) setHotspotOpen(false)
          // ★TYPE_CLEAN_V1（2026-09-21）：openApp 只收 1 个参数（标题由它内部 `APPS.find` 推断），
          //   这里原来多传了一个 title —— 运行时被忽略（无害），但 IDE 报"应有 1 个参数，但获得 2 个"。
          openApp(target)
        }
      } else {
        pushTerm(`chat 失败 · ${Date.now() - t0}ms · ${data.message || res.status}`, 'err')
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(), role: 'assistant',
          content: data.message || '出错了', timestamp: Date.now(),
        }])
      }
    } catch (eNet: any) {
      // 2026-09-02: 失败要有原因（超时/网络/服务器状态）
      const errName = String(eNet?.name || '')
      const errMsg = String(eNet?.message || '')
      let failReason = '网络连接失败'
      if (errName === 'TimeoutError' || errMsg.includes('timeout')) failReason = '请求超时（服务器处理超过 240s——封面生成慢）——请重试'
      else if (errMsg.includes('fetch')) failReason = '网络请求失败（请检查网络/服务器）'
      pushTerm('chat 异常：' + failReason, 'err')
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: failReason, timestamp: Date.now(),
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
      let d: any = null
      try { d = await r.json() } catch { d = { success: false, message: '响应解析失败(' + r.status + ')' } }
      if (d.success && d.data?.name) {
        const url = `/api/storage/file?userId=${user?.id}&name=${encodeURIComponent(d.data.name)}`
        // ★2026-09-22（用户要求："这个页面生成的上传的，全部要个人仓库落地 + 本地仓库落地"）：
        //   上传已经进个人仓库（POST /api/storage/files → OSS），这里补**本地仓库镜像**（客户端有效）。
        //   镜像端按 `?name=` 取文件名 → 正好落到本地仓库同名文件。
        if (!MIRRORED_ONCE.has(String(d.data.name))) {
          MIRRORED_ONCE.add(String(d.data.name))
          try { (window as any).electronAPI?.storageMirror?.(url) } catch {}
        }
        setAttachments(prev => [...prev, { name: file.name, url, type: isVideo ? 'video' : 'image', frames: d.data?.frames || [] }])
      } else {
        alert('上传失败：' + (d.message || d.error || ('HTTP ' + r.status)))
      }
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Markdown 渲染
  // 2026-08-24: 视频结果自动播放（从渲染函数移出——渲染期 setState 曾导致 #301 无限重渲染）
  const lastVideoPlayedRef = useRef('')
  useEffect(() => {
    const last = [...messages].reverse().find(m => m.role === 'assistant' && m.content && (m.content.includes('VIDEO_RESULT:') || m.content.includes('VIDEO_WEB:')))
    if (last && last.content !== lastVideoPlayedRef.current) {
      lastVideoPlayedRef.current = last.content
      const rm = last.content.match(/(?:VIDEO_RESULT|VIDEO_WEB):([^|]+)(?:\|TITLE:([^|]+))?/)
      if (rm) setTimeout(() => { try { openVideoFromUrl(rm[1], rm[2] || '') } catch {} }, 300)
    }
  }, [messages])

  // 2026-09-09: 重发浏览器发布任务（前端按钮——不管原任务成功/失败都重建一条让客户端再执行）
  const rebuildTask = async (taskId: number) => {
    try {
      const r = await fetch('/api/agent/browser-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'rebuild', taskId }) })
      const j = await r.json().catch(() => null)
      alert(j?.success ? '已重发——新任务 #' + (j?.newId ?? '') + '，客户端将自动重新执行。' : ('重发失败：' + ((j && j.message) || ('HTTP ' + r.status))))
    } catch (e: any) { alert('重发失败：' + ((e && e.message) || e)) }
  }

  const renderContent = (content: string) => {
    if (!content) return null
    // ★VF_EDIT_V1（2026-09-24）：卡片提交的协议串别把原文（一大坨 JSON）显示在气泡里 ——
    //   用户点「💾 保存修改」发的是 VF_EDIT:{edits:[…]}，这里给他看一句人话。
    if (content.startsWith('VF_EDIT:')) {
      return <span className="text-emerald-300/80">✏️ 已提交分镜修改（改的是出片前的清单，保存后点「确认出片」即按新版出片）</span>
    }
    // ★VF_DECKCONFIRM_V1：新引擎出片确认的协议串同理，气泡里给一句人话（不显示 JSON 原文）
    if (content.startsWith('VF_DECK_CONFIRM:')) {
      return <span className="text-emerald-300/80">🎬 已确认用新引擎出片（HTML 逐帧 · 动态 PPT）——正在后台渲染，可随时问「视频做得怎么样了」</span>
    }
    // ★VF_BRIEF_EDIT_V1（P0②）：提交"纠正过的素材结论"时，气泡里显示一句人话而不是 JSON
    if (content.startsWith('VF_BRIEF:')) {
      return <span className="text-emerald-300/80">🔍 已提交修改后的素材结论（写文案与排分镜会用它）</span>
    }
    // ★VF_I2VDFLT_V1（2026-09-30）：分镜卡「🚫 关掉动图重出」的协议串别把 JSON 显示在气泡里
    if (content.startsWith('VF_I2V_OFF')) {
      return <span className="text-amber-200/90">🚫 已改成「保持静态」（不再生成动图）——正在重出确认卡</span>
    }
    // ★VF_MEMORY_V1（2026-09-30）：素材「✅ 当素材用 / 🚫 别用」的协议串同样只显示人话
    // ★VF_MATUI_V1（2026-09-30）：🎞 勾选（pick/unpick）也走同一条串 —— 提示语按动作区分
    if (content.startsWith('VF_MAT_SET')) {
      return <span className="text-emerald-300/80">
        {content.includes('"pick"') ? '🎞 已更新动效勾选（正在重出确认卡）'
          : content.includes('"unpick"') ? '🎞 已取消动效勾选（正在重出确认卡）'
            : '🎛 已更新素材名单（正在重出确认卡）'}
      </span>
    }
    // ★VF_MATUI_V1：清单「🔄 换一张」的协议串（同样只显示人话）
    if (content.startsWith('VF_MAT_SWAP')) {
      return <span className="text-emerald-300/80">🔄 已换一张素材（旧的记「别用」、新的记「当素材用」；正在重出确认卡）</span>
    }
    // 2026-09-09: AI 浏览器发布任务已建消息 → 卡片带「重发」按钮
    const buM = content.match(/已创建 AI 浏览器发布任务（#(\d+)）/); const buQ = content.includes('BROWSER_TASK_QUEUED') ? buM : null
    if (buQ) {
      const buId = buQ[1] ? Number(buQ[1]) : 0
      // 2026-09-12: 任务回复可能【同时带 WF_JSON(step=full)】→ 前半显示任务卡，后半继续渲染方案卡（平台按钮还在 → 可连续发多平台）
      const wfIdx = content.indexOf('WF_JSON:')
      const headTxt = wfIdx >= 0 ? content.slice(0, wfIdx).trim() : content
      const tail = wfIdx >= 0 ? content.slice(wfIdx) : ''
      return (
        <div className="mt-1 space-y-1">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
            <div className="text-xs text-emerald-200 whitespace-pre-wrap">{headTxt}</div>
            {buId > 0 && (
              <button onClick={() => rebuildTask(buId)} className="mt-2 px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs">
                🔁 重发（不管成功与否，再发一次）
              </button>
            )}
          </div>
          {tail ? renderContent(tail) : null}
        </div>
      )
    }
    // ★VF_FORM_V1（2026-09-20）：成片设置表单（一次选完一次提交）
    if (content.startsWith('VF_JSON:')) {
      try {
        const _vj = JSON.parse(content.slice(8))
        // ★VF_LINES_V1（2026-09-21）：AI 制片走**专属卡**（卡1 主题+上传 / 卡2 横竖屏+时长+风格）
        // ★2026-09-22：把当前用户 id 透传给卡片（上传后要在客户端镜像到本地仓库）
        if (_vj && _vj.step === 'ai_setup') return <VfAiSetupCard vj={_vj} onStart={sendMessage} userId={user?.id} />
        if (_vj && _vj.step === 'ai_opts') return <VfAiOptsCard vj={_vj} onStart={sendMessage} />
        // ★VF_I2V_V1（2026-09-29）：图生视频确认卡（「🎬 用我的图动起来」按钮）
        if (_vj && _vj.step === 'ai_i2v') return <VfAiI2vCard vj={_vj} onStart={sendMessage} />
        // ★VF_LEAD_V1（2026-09-29 老板定案）：智能获客 —— 设置面板卡 / 预演卡（独立线）
        //   buAccounts = 父页面已经检测过的登录态（本卡只读，不自己再扫一遍）
        if (_vj && _vj.step === 'lead_setup') return <LeadSetupCard vj={_vj} onStart={sendMessage} buAccounts={buAccounts} />
        if (_vj && _vj.step === 'lead_preview') return <LeadPreviewCard vj={_vj} onStart={sendMessage} />
        if (_vj && _vj.step === 'form') return <VideoFormCard vj={_vj} onStart={sendMessage} userId={user?.id} />
        {/* ★VF_PPT_UI_V1（2026-10-06 用户定案「彻底拆开」）：【PPT 成片】独立线两张卡 */}
        if (_vj && _vj.step === 'ppt_setup') return <VfPptCard vj={_vj} onSend={sendMessage} />
        if (_vj && _vj.step === 'ppt_confirm') {
          const scriptTxt = String(_vj.script || '')
          return (
            <div className="mb-2 p-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/[0.06]">
              <div className="text-xs text-fuchsia-300 mb-2">🎬 PPT 成片 · 确认排版</div>
              {_vj.hint ? <div className="text-[10px] text-gray-400 mb-2">{String(_vj.hint)}</div> : null}
              {scriptTxt ? (
                <div className="text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto bg-white/[0.04] rounded-lg p-2 mb-2">{scriptTxt}</div>
              ) : null}
              <div className="text-[11px] text-gray-300 mb-2 flex flex-wrap gap-x-3 gap-y-1">
                <span>📝 {Number(_vj.charN) || 0} 字</span>
                <span>⏱ 配音预估 ≈{Number(_vj.estSec) || 0} 秒（目标 {Number(_vj.targetSec) || 0} 秒）</span>
                <span>📄 约 {String(_vj.pagesLo || '')}~{String(_vj.pagesHi || '')} 页</span>
                <span>🎨 皮肤 {String(DECK_SKINS.find((s) => s.id === String(_vj.skin))?.label || _vj.skin || '')}</span>
                <span>🔊 {String(_vj.voiceName || _vj.voice || '')}</span>
                <span>💎 约 {Number(_vj.cost) || 0} 点</span>
              </div>
              <div className="text-[10px] text-gray-500 mb-2">页数与实际时长以 AI 分节 / 配音为准；本线**不显示逐镜时长**（没有分镜）。</div>
              <VfDeckConfirm vj={_vj} onSend={sendMessage} />
            </div>
          )
        }
      } catch {}
    }
    // ★2026-09-19：成片完成卡——内嵌播放（不显示 OSS 链接），并按项目规则自动镜像到本地仓库
    if (content.startsWith('MAKE_VIDEO_DONE:')) {
      try {
        const md = JSON.parse(content.slice(16))
        // ★2026-09-22（用户实测「播放 3~4 秒必卡一下」）：播放**优先用 OSS 直链**（md.url = 24h 签名直链），
        //   绕开 /api/storage/file 的 302 中转 —— 那条接口每次请求都重新签一个 URL，且 302 响应
        //   无缓存头、无 Accept-Ranges → 播放器每次 Range 续传都被打断 → 固定间隔卡顿。
        //   没有 md.url（老消息/入库异常）时才回退到接口地址。
        const _apiSrc = md.repoName ? ('/api/storage/file?userId=' + (user?.id || '') + '&name=' + encodeURIComponent(md.repoName) + '&persist=1') : ''
        const src = md.url || _apiSrc
        // ★VF_MIRRORHONEST_V1（2026-09-20 端到端推演发现）：`storageMirror` 只在**客户端**存在
        //   （浏览器里没有 electronAPI，会静默失败），但卡片原来**无条件**写"（本地仓库自动同步）"
        //   → 浏览器里/镜像失败时这句是**假的**。这里按实际能力说。
        const _canMirror = typeof window !== 'undefined' && !!(window as any).electronAPI?.storageMirror
        const _mirrorKey = String(md.repoName || src || '')
        if (src && _canMirror && _mirrorKey && !MIRRORED_ONCE.has(_mirrorKey)) {
          MIRRORED_ONCE.add(_mirrorKey)   // ★2026-09-22：同一文件只镜像一次（原来每渲染一次就下一次）
          try { (window as any).electronAPI.storageMirror(src) } catch {}
        }
        return (
          <div className="mb-2 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06]">
            <div className="text-xs text-emerald-300 mb-2">🎬 本地成片已完成（配音 + 字幕 + 画面）</div>
            {src ? (
              <video
                src={src}
                controls
                playsInline
                preload="metadata"
                className="w-full max-h-[420px] rounded-lg bg-black"
                // ★2026-09-22：优先走 OSS 直链（无 302 中转、原生 Range）；签名过期/失效时
                //   自动回退到服务端接口地址（它每次都会重新签名，所以永远可用）。
                onError={(e) => {
                  const v = e.currentTarget as HTMLVideoElement
                  if (_apiSrc && v.src !== _apiSrc) v.src = _apiSrc
                }}
              />
            ) : (
              <div className="text-xs text-amber-400">成片已生成，但仓库文件名缺失（{md.out || '未知'}）</div>
            )}
            {md.repoName ? <div className="text-[10px] text-gray-500 mt-2">已入个人仓库：{md.repoName}{_canMirror ? '（已同步到本地仓库）' : '（在客户端里打开会自动同步到本地）'}</div> : null}
            {md.repoError ? <div className="text-[10px] text-amber-400 mt-1">入库提示：{md.repoError}</div> : null}
            {/* ★VF_RENDER_ONESHOT_V1：片出完后改一镜 → 只重渲染（复用配音、不扣点）。入口就在这里。 */}
            {md.taskId ? <VfReRenderShot taskId={String(md.taskId)} onSend={sendMessage} /> : null}
          </div>
        )
      } catch {}
    }
    // ★VF_PREVIEW_V1（2026-09-29 用户定案 P0①「样板镜先确认」，出自 video-talkcraft 的"首镜先做先确认"）：
    //   先出 8 秒样板镜（不配音、不扣点）看画面风格，满意再出整片 —— 治「看到成品才发现风格不对」。
    if (content.startsWith('VF_PREVIEW_DONE:')) {
      try {
        const pd = JSON.parse(content.slice(16))
        return (
          <div className="mb-2 p-3 rounded-xl border border-sky-500/30 bg-sky-500/[0.06]">
            <div className="text-xs text-sky-300 mb-2">
              🎬 样板镜（约 {pd.sec || 8} 秒 / {pd.shots || 1} 镜 · 无配音）—— 先看画面风格对不对
            </div>
            {pd.url ? (
              <video src={pd.url} controls playsInline preload="metadata" className="w-full max-h-[420px] rounded-lg bg-black" />
            ) : null}
            <div className="text-[10px] text-gray-400 mt-2">
              满意 → 点上面的「确认出片」出整片；不满意 → 回「重试」重排分镜，或直接说想怎么改（如「大字再少点」「第三镜换成对比」）。
            </div>
          </div>
        )
      } catch {}
    }
    // ★VF_FLOW_V1（2026-09-18）：成片状态机结构化消息（VF_JSON —— 文案确认卡）
    if (content.startsWith('VF_JSON:')) {
      try {
        const vj = JSON.parse(content.slice(8))
        if (vj.step === 'source') {
          return (
            <div className="mb-2 p-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/[0.06]">
              <div className="text-xs text-fuchsia-300 mb-2">{vj.hint || '这条视频用什么素材？'}</div>
              {vj.topic ? <div className="text-[10px] text-gray-500 mb-2">主题：{vj.topic}</div> : null}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => sendMessage('素材合成')}
                  className="px-3 py-1.5 rounded-lg bg-fuchsia-500/40 hover:bg-fuchsia-500/70 text-sm text-white font-medium">🎞 素材合成（用我仓库的素材）</button>
                {/* ★VF_SRC_SPLIT_V1（2026-09-21，用户定案）：本卡只留素材线自己的两个来源 ——
                    「✨ 素材 + AI 混合（开发中）」与「🎨 全部 AI 生成」已拆掉：
                    它们各自是【独立的一条线】（入口词见 FEATURE_TIPS）：
                    「素材+AI」/「AI 制片」（2026-09-28 起统一短名，旧长句保留为别名）。
                    （原来自相矛盾：这里发文字「素材加AI混合」会被混合线接走，而表单卡发
                      VF_FORM:{source:'mix'} 却落到素材线回"还在开发中"。） */}
                <button onClick={() => sendMessage('我上传素材')}
                  className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-sm text-gray-200">📤 我上传</button>
              </div>
              <div className="text-[10px] text-gray-500 mt-2">画面来源：<b className="text-gray-400">素材合成</b> = 用你仓库的图拼片（最省，30 秒约 7 点）；<b className="text-gray-400">我上传</b> = 只用你这次上传的几张。全 AI / 混合是另外两条线，说「AI 制片」/「素材+AI」；用你自己的视频混剪说「图视混剪」。</div>
              {/* ★VF_ASPECT_V1：画幅——能让用户自己选就让他选；不选则按素材判断（素材多为横图就出横屏，不硬塞竖屏） */}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <span className="text-[10px] text-gray-500">画幅：</span>
                {[
                  { id: 'portrait', label: '竖屏 9:16', send: '竖屏' },
                  { id: 'landscape', label: '横屏 16:9', send: '横屏' },
                  { id: 'auto', label: '自动', send: '自动' },
                ].map((a: any) => (
                  <button key={a.id} onClick={() => sendMessage(a.send)}
                    className={`px-2 py-0.5 rounded text-[10px] border transition ${(vj.aspect || 'auto') === a.id ? 'bg-fuchsia-500/30 border-fuchsia-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>{a.label}</button>
                ))}
                {vj.aspectName ? <span className="text-[10px] text-emerald-300/80">→ 当前 {vj.aspectName}</span> : null}
              </div>
              <div className="text-[10px] text-gray-500 mt-1">不选就按你的素材自动判断（素材多为横图 → 出横屏）；横竖不一致时用模糊铺底 + 完整图居中，不裁切</div>
              {/* ★VF_DUR_V1（2026-09-20）：时长——点按钮或直接输入秒数；AI 靠它决定文案多长、排几镜 */}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <span className="text-[10px] text-gray-500">时长：</span>
                {[30, 60, 90, 180].map((s: number) => (
                  <button key={s} onClick={() => sendMessage('时长' + s)}
                    className={`px-2 py-0.5 rounded text-[10px] border transition ${(vj.dur || 30) === s ? 'bg-fuchsia-500/30 border-fuchsia-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>{s}秒</button>
                ))}
                <input
                  value={durInput}
                  onChange={(e: any) => setDurInput(String(e.target.value).replace(/[^\d]/g, '').slice(0, 4))}
                  onKeyDown={(e: any) => { if (e.key === 'Enter' && durInput) { sendMessage('时长' + durInput); setDurInput('') } }}
                  placeholder="自定义秒数"
                  className="w-[78px] px-2 py-0.5 rounded text-[10px] bg-white/[0.05] border border-white/[0.08] text-gray-200 placeholder-gray-600 outline-none"
                />
                {vj.dur ? <span className="text-[10px] text-emerald-300/80">→ 当前 {vj.dur} 秒（约 {Math.round(vj.dur * 4.5)} 字文案）</span> : null}
              </div>
            </div>
          )
        }
        if (vj.step === 'script') {
          // ★VF_SBDUMP_V1（2026-09-29 用户定案）：把这份分镜留一份到本机
          //   （<安装目录>\data\vf-storyboards\…json）。以后排查"排镜 / 排版"问题不必再去服务器捞分镜；
          //   开发机可用 scripts/vf-local.mjs --sb 该文件 直接复现渲染。纯留档，不影响出片。
          try {
            const _sbKey = (vj.shots || []).map((s: any) => `${s.type}:${s.text || s.title || ''}:${s.dur || ''}`).join(',')
            const _api: any = typeof window !== 'undefined' ? (window as any).electronAPI : null
            if (_sbKey && !STORYBOARD_SAVED.has(_sbKey) && _api?.vfSaveStoryboard) {
              STORYBOARD_SAVED.add(_sbKey)
              _api.vfSaveStoryboard({
                uid: user?.id, topic: vj.topic, script: vj.script, brief: vj.brief,
                size: vj.size, aspect: vj.aspect, theme: vj.theme, big: vj.big, shots: vj.shots,
                // ★VF_SBDUMP_V2（2026-10-01）：服务端随卡片给的**出片真正读的那一份 plan**
                //   （与 make_ai_video 同一个 buildVideoPlan）+ 渲染读的根级参数 + 每镜稳定字段集。
                //   客户端【原样落盘】即可（见 electron/main.js 的 vf:save-storyboard）。
                sb: (vj as any).sb,
              })
            }
          } catch {}
          return (
            <div className="mb-2 p-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/[0.06]">
              <div className="text-xs text-fuchsia-300 mb-2">{vj.hint || '① 文案确认'}</div>
              {vj.topic ? <div className="text-[10px] text-gray-500 mb-1">主题：{vj.topic}</div> : null}
              {vj.shotsFailed ? (
                <div className="text-[10px] text-amber-300/90 mb-1">
                  ⚠️ 分镜没排好{vj.coverage != null && vj.coverage < 0.8
                    ? `：只覆盖文案 ${Math.round(vj.coverage * 100)}%（预计 ${vj.estSec || 0} 秒 / 目标 ${vj.targetSec || 0} 秒）`
                    : '（文案已就绪，已自动重试一次）'}
                </div>
              ) : (vj.usedImages > 0 || (vj.shots && vj.shots.length)) ? (
                <div className="text-[10px] text-emerald-300/80 mb-1">
                  📸 看完你仓库里 {vj.usedImages || 0} 张图，排了 {(vj.shots || []).length} 个镜头
                  {/* ★VF_AIVIDEO_V1（2026-09-20）：AI 模式的画面**不是**你的素材 →
                      原来那句"（画面用你的素材）"在那里是**假话**，必须换成实话。 */}
                  {vj.source === 'ai'
                    ? '（🎨 画面由 AI 逐镜生成，约 50 点/秒）'
                    : ((vj.shots || []).some((s: any) => s.type === 'bgimage') ? '（画面用你的素材）' : '')}
                </div>
              ) : null}
              {/* ★VF_MATUI_V1（2026-09-30 用户定案）：本次**动不动 AI、动几张**必须在卡片上一眼看出 ——
                  默认已改成"不动"（0 点动图），所以这里把两种情况都写清，别让用户猜钱花在哪。 */}
              {vj.i2vMode ? (
                <div className={`text-[10px] mb-1 ${Number(vj.i2vImages) > 0 ? 'text-fuchsia-300/90' : 'text-gray-400'}`}>
                  {Number(vj.i2vImages) > 0
                    ? `🎞 本次让 ${vj.i2vImages} 张图动起来（约 ${Number(vj.i2vPts) || 0} 点 · ${vj.i2vModeLabel || ''}）`
                    : `🎞 本次不动用 AI（0 点动图 · ${vj.i2vModeLabel || '保持静态'}）`}
                  <span className="text-gray-500"> —— 想加动效就在设置卡选「🎞 只动我勾选的」或「🎞 全部动起来」</span>
                </div>
              ) : null}
              {/* ★VF_I2VDFLT_V1（2026-09-30 用户定案）：智能筛跳过的图**明列出来** ——
                  用户看到金额变化能立刻知道"哪几张被跳过、为什么"，而不是只看到钱变了。
                  （结构化字段 i2vSkipped `[{name,reason}]` 由服务端卡片给出，前端直接取用。） */}
              {Number(vj.i2vSkippedN) > 0 && Array.isArray(vj.i2vSkipped) && vj.i2vSkipped.length > 0 && (
                <div className="text-[10px] text-amber-300/90 mb-1">
                  ⏭ 智能筛跳过 {vj.i2vSkippedN} 张（动了也看不出）：
                  {vj.i2vSkipped.slice(0, 3).map((x: any, i: number) => (
                    <span key={i}>{i > 0 ? '、' : ''}{x?.name}{x?.reason ? `（${x.reason}）` : ''}</span>
                  ))}
                  {Number(vj.i2vSkippedN) > 3 ? ' 等' : ''}
                  <span className="text-gray-500"> —— 想全部动就在设置卡选「🎞 全部动起来」</span>
                </div>
              )}
              {/* ★VF_MATUI_V1：picked（只动我勾选的）模式下"哪几张没勾 🎞"也列出来
                  —— 用户才知道"打勾才动"是真的，也知道该去勾哪几张。 */}
              {Number(vj.i2vNotPickedN) > 0 && Array.isArray(vj.i2vNotPicked) && vj.i2vNotPicked.length > 0 && (
                <div className="text-[10px] text-gray-400 mb-1">
                  ⏭ 另有 {vj.i2vNotPickedN} 张没勾 🎞（保持静态）：
                  {vj.i2vNotPicked.slice(0, 3).map((x: any, i: number) => (
                    <span key={i}>{i > 0 ? '、' : ''}{String(x)}</span>
                  ))}
                  {Number(vj.i2vNotPickedN) > 3 ? ' 等' : ''}
                  <span className="text-gray-500"> —— 在上面素材清单里点 🎞 就能让它也动</span>
                </div>
              )}
              {/* ★VF_EDIT_V1（2026-09-24 用户定案 B）：清单从"只读"升级成【可逐镜编辑】——
                  改的是【出片前的草稿清单】（不渲染、不扣钱），保存后点「确认出片」按新版出片。
                  片已经出过的，用聊天说「第 N 镜大字改成 X」→ 那条路只重渲染（复用配音）。 */}
              {Array.isArray(vj.shots) && vj.shots.length > 0 && (
                <VfShotEditList shots={vj.shots} onSend={sendMessage} />
              )}
              {/* ★VF_BRIEF_EDIT_V1（P0②）：从只读 <pre> 升级成【可编辑】——识别错了直接改，
                  改完点「保存并重写文案」就会用这份结论重写文案+重排分镜（见 VfBriefEdit） */}
              {/* ★VF_MATWARN_V1（2026-10-06）：素材"没被采用"的提示必须让用户看到 —— 原来只写服务端日志，
              用户传了视频/超限文件却没被用完全不知情（观感就是"它不认我的素材"）。 */}
          {vj.matWarn ? (
            <div className="mb-2 px-3 py-2 rounded-xl border border-amber-400/40 bg-amber-400/[0.08] text-[11px] text-amber-200">
              ⚠️ {String(vj.matWarn)}
            </div>
          ) : null}
          {vj.brief ? <VfBriefEdit brief={String(vj.brief)} onSend={sendMessage} /> : null}
              {/* ★VF_MEMORY_V1（2026-09-30）：素材「✅ 当素材用 / 🚫 别用」（只新增，挂在识别结果下面）
                  ★VF_MATUI_V1：可用在前、已排除折叠；缩略图 + 🎞 勾选 + 🔄 换一张；
                  标题显示"共 N 条可用 / M 条已排除"（N/M 是服务端给的总数，不是裁剪后条数） */}
              {Array.isArray(vj.mats) && vj.mats.length > 0
                ? <VfMatsPicker mats={vj.mats} usableN={vj.matUsableN} excludedN={vj.matExcludedN} onSend={sendMessage} />
                : null}
              <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap mb-3">{vj.script}</div>
              {Array.isArray(vj.voices) && vj.voices.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {vj.voices.map((v: any, i: number) => (
                    <button key={i} onClick={() => sendMessage(String(v.name || '').split(' ')[0])}
                      className={`px-2.5 py-1 rounded-lg text-[11px] border transition ${vj.voice === v.id ? 'bg-fuchsia-500/30 border-fuchsia-400/50 text-white' : 'bg-white/[0.05] border-white/[0.08] text-gray-300 hover:bg-white/[0.1]'}`}>
                      🔊 {v.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {/* ★VF_GATE_V1：分镜失败时**不给「确认出片」**（否则出来的是没有素材画面的片子） */}
                {/* ★VF_ENGINE_UI_V1（2026-10-04 用户定案「成片方式第一轮就选；第二轮只点头」）：
                    deck 模式下这排**老引擎专属**按钮（样板镜/关动图/确认出片）全部隐藏 ——
                    出片入口只剩下面的「确认出片 · 新引擎」；classic/缺省 = 行为与之前逐字一致。 */}
                {vj.shotsFailed ? (
                  <>
                    <button onClick={() => sendMessage('重试')}
                      className="px-4 py-1.5 rounded-lg bg-fuchsia-500/40 hover:bg-fuchsia-500/70 text-sm text-white font-medium">🔄 重试分镜</button>
                    <button onClick={() => sendMessage('先出字幕版')}
                      className="px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-sm text-gray-300">▶️ 先出字幕版（无素材画面）</button>
                  </>
                ) : vj.engine === 'deck' ? (
                  <span className="text-[10px] text-emerald-300/70">成片方式：新引擎 · 动态 PPT（配音+BGM+素材图）—— 选好皮肤点下面按钮出片</span>
                ) : (
                  <>
                    <button onClick={() => sendMessage('先看样板镜')}
                      title="只渲染开头约 8 秒（无配音、不扣点），先看画面风格对不对；满意再点右边「确认出片」"
                      className="px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-sm text-gray-200">🎬 先看样板镜（8 秒）</button>
                    {/* ★VF_I2VDFLT_V1（2026-09-30 用户定案）：一键关掉动图重出（省 N 点）——
                        替代让用户手打「关掉图转视频，直接生成」（那句会被标准模式白名单拦）。
                        发的是**机器协议串**（不是中文人话）：服务端收到后把草稿 i2v 置 'off' 并重出确认卡。 */}
                    {Number(vj.i2vImages) > 0 && Number(vj.i2vPts) > 0 && (
                      <button onClick={() => sendMessage('VF_I2V_OFF:' + JSON.stringify({ taskId: vj.taskId || '' }))}
                        title="这一版不生成动图，改用静态图 + 推拉（不额外花动图的点）；会重出一张金额更小的确认卡"
                        className="px-4 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/40 text-sm text-amber-100">
                        {/* ★VF_PRICE_CLARITY_V1（2026-09-30 用户实测「价格怎么 2 个差不多」）：
                            原来写"省 754 点"，而右边"约 761 点"是总价 → 用户读成"省了 754 还剩 761"。
                            改成「总价降到约 X 点」：X = 只算文案费（不含动图）的那部分。 */}
                        🚫 关掉动图（总价降到约 {Number(vj.costNoI2v) > 0 ? vj.costNoI2v : Math.max(1, (Number(vj.cost) || 0) - (Number(vj.i2vPts) || 0))} 点）
                      </button>
                    )}
                    <button onClick={() => sendMessage('确认')}
                    title={vj.source === 'ai'
                      ? '画面将由 AI 逐镜生成（约 50 点/秒）；生成较慢，实测每 6 秒画面约需 100 秒'
                      : undefined}
                      className="px-4 py-1.5 rounded-lg bg-fuchsia-500/40 hover:bg-fuchsia-500/70 text-sm text-white font-medium">
                      {/* ★VF_PRICE_CLARITY_V1：把总价拆开写（动图 A + 文案 B），两个数各自有名字，不再歧义 */}
                      {Number(vj.i2vPts) > 0
                        ? `确认出片（约 ${vj.cost} 点 = 动图 ${vj.i2vPts} + 文案 ${Number(vj.costNoI2v) > 0 ? vj.costNoI2v : Math.max(1, (Number(vj.cost) || 0) - (Number(vj.i2vPts) || 0))}）`
                        : `确认出片${vj.cost ? `（约 ${vj.cost} 点）` : ''}`}
                      {vj.source === 'ai' ? ' · 🎨 AI 画面' : ''}
                    </button>
                  </>
                )}
                <span className="text-[10px] text-gray-500">也可直接说「改成…」调文案{vj.voiceName ? `（当前配音：${vj.voiceName}）` : ''}</span>
              </div>
              {/* ★VF_PPTPREVIEW_WIRE_V1（2026-10-01 用户定案「完全成片之前能把 PPT 抽出来审核一下效果吗？」）：
                  出片确认卡上的「👀 先看 PPT 页」—— 用的是**即将出片的同一份 plan**（卡片里的 sb.plan），
                  不是另拼一份（否则预览与成片会漂移）。不扣点、不阻塞出片、失败如实显示原因。
                  ⚠️ 分镜失败（shotsFailed）时没有可审的画面，不显示这个按钮。
                  ★VF_ENGINE_UI_V1：deck 模式下这是老引擎的预览，不显示。 */}
              {!vj.shotsFailed && vj.engine !== 'deck' ? <VfPptPreview plan={(vj as any).sb?.plan} /> : null}
              {/* ★VF_DECKPREVIEW_WIRE_V1：新引擎成片预览（10 套皮肤 · 真出 MP4）—— 与上面的逐镜静帧并排，互不依赖
                  ★VF_ENGINE_UI_V1：classic 模式不显示（成片方式第一轮已定，确认卡不再混两条线的入口）。 */}
              {!vj.shotsFailed && vj.engine === 'deck' ? <VfDeckPreview plan={(vj as any).sb?.plan} /> : null}
              {/* ★VF_DECKCONFIRM_V1（2026-10-04 用户定案「双轨并存」→ ★VF_ENGINE_UI_V1 改为第一轮已选）：
                  deck 模式的唯一出片入口（皮肤下拉 + 出片按钮）；classic/缺省不显示（老引擎按钮在上面）。 */}
              {!vj.shotsFailed && vj.engine === 'deck' ? <VfDeckConfirm vj={vj} onSend={sendMessage} /> : null}
            </div>
          )
        }
        if (vj.step === 'running') {
          return (
            <div className="mb-2 p-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/[0.06]">
              <div className="text-xs text-fuchsia-300">🎬 本地成片已在后台渲染（配音 + 字幕 + 卡片画面）——完成后自动推给你</div>
            </div>
          )
        }
        // ★STD_MODE_V1（2026-09-21，用户定案）：**认不出的卡型不再显示协议串原文** ——
        //   曾出现过：AI 自由发挥时编了一张 `step:'ai_plan'`（代码里根本没有这个卡型）→
        //   用户看到一大串 `VF_JSON:{...}` 原文，像是界面坏了。这里统一给固定提示，也不再泄露内部协议串。
        return (
          <div className="mb-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06]">
            <div className="text-xs text-amber-300">⚠️ 这一步没有可用的卡片（流程状态可能错位了）</div>
            <div className="text-[10px] text-gray-400 mt-1">
              请重新发一条命令（一字不差）：
              <br />· 图片成片
              <br />· 图视混剪
              <br />· AI 制片
              <br />· 素材+AI
            </div>
          </div>
        )
      } catch {}
    }
    // 2026-08-31 v2: WF_JSON 结构化消息（状态机——视频卡片可点击选）
    if (content.startsWith('WF_JSON:')) {
      try {
        const wj = JSON.parse(content.slice(8))
        // 2026-09-03 时机A：full 方案卡出现 → 镜像封面+视频到本地仓库（单向 OSS→本地——发布时 bu_exec 直接用）
        if (wj.step === 'full') {
          const covUrl = wj.coverUrl || ''
          if (covUrl) (window as any).electronAPI?.storageMirror?.(covUrl)
          if (wj.videoName) { try { const vUrl = `/api/storage/file?name=${encodeURIComponent(wj.videoName)}&persist=1`; (window as any).electronAPI?.storageMirror?.(vUrl) } catch {} }
        }
        if (wj.step === 'prep' && Array.isArray(wj.frames)) {
          return (
            <div className="mt-1 space-y-1">
              <p className="text-[9px] text-gray-400">🎞 已抽帧——选封面帧（点击切片选）：</p>
              <div className="grid grid-cols-4 gap-1">
                {wj.frames.map((v: any, i: number) => (
                  <button key={i} onClick={() => sendMessage(v.name || String(i + 1))} className="rounded-lg overflow-hidden border border-white/[0.08] hover:border-emerald-500/50 transition">
                    {/* ★TYPE_CLEAN_V1（2026-09-21）：这里原来写了**两个 `onError`**（TS17001）——
                        后一个把前一个覆盖 → 那个"图失败: xxx"提示**永远不会显示**。保留带提示的那个。 */}
                    <img src={(v.url || '').startsWith('/') ? 'https://ai-niuma.cc' + v.url : v.url} alt={'帧' + (i + 1)} className="w-full h-16 object-cover" onError={(e: any) => { (e.target as any).style.display='none'; const p2=(e.target as any).closest('button'); if(p2){const d=document.createElement('div');d.className='text-[8px] text-red-400 truncate';d.textContent='图失败:'+((e.target as any).src||'').slice(0,70);p2.parentNode?.insertBefore(d,p2.nextSibling)}}} />
                    <span className="block text-center text-[8px] text-gray-400 py-0.5">{i + 1}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        }
        if (wj.step === 'full') {
          // 2026-09-01: 完整方案卡（封面图/标题/话题/帧图——确认/换一批——最后平台发布）
          return (
            <div className="mb-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06]">
              <div className="text-xs text-amber-400 mb-2">{wj.hint || '发布方案已生成'}</div>
              {wj.coverUrl ? <img src={wj.coverUrl} alt="封面" className="w-full max-h-40 object-contain rounded-lg mb-2" onError={(e: any) => { (e.target as any).style.display = 'none' }} /> : <div className="text-xs text-amber-400 mb-1">封面生成失败（换一批重做）</div>}
              <div className="text-sm mb-1">🎬 {wj.videoName || ''}</div>
              <div className="text-sm mb-1">📝 {Array.isArray(wj.titles) ? wj.titles.join(' / ') : (wj.titles || '')}</div>
              <div className="text-xs text-gray-400 mb-2">🏷 {wj.topics || ''}</div>
                            {/* 2026-09-01: 帧图不给用户看（给 AI 看图用）——去掉显示 */}

              <div className="flex gap-2">
                <div className="flex flex-wrap gap-1.5 mb-2">
                {PLATFORM_NAMES.map((pl: string) => (   // 2026-09-13: 取自 platforms.ts
                  <button key={pl} onClick={() => { sendMessage('平台:' + pl) }} className="px-3 py-1.5 rounded-lg bg-amber-500/40 hover:bg-amber-500/70 text-xs text-white font-medium">{pl}</button>
                ))}
              </div>
                <button onClick={() => sendMessage('换一批')} className="px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-sm">换一批（全重做）</button>
              </div>
            </div>
          )
        }
        if (wj.step === 'title' && Array.isArray(wj.titles)) {
          // ② 标题候选卡片（点击选——发编号）
          return (
            <div className="mb-2 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06]">
              <div className="text-xs text-emerald-400 mb-2">{wj.hint || '选标题'}</div>
              <div className="flex flex-col gap-2">
                {wj.titles.map((t: any, i: number) => (
                  <button key={i} onClick={() => sendMessage(String(i + 1))} className="text-left px-3 py-2 rounded-lg bg-white/[0.05] hover:bg-emerald-500/20 border border-white/[0.08] transition text-sm">{t}</button>
                ))}
              </div>
            </div>
          )
        }
        if (wj.step === 'topics' && Array.isArray(wj.topics)) {
          // ③ 话题标签卡片（点击确认）
          return (
            <div className="mb-2 p-3 rounded-xl border border-sky-500/30 bg-sky-500/[0.06]">
              <div className="text-xs text-sky-400 mb-2">{wj.hint || '选话题'}</div>
              <div className="flex flex-wrap gap-2 mb-2">{wj.topics.map((t: any, i: number) => <span key={i} className="px-2 py-1 rounded-full bg-white/[0.06] text-xs">{t}</span>)}</div>
              <button onClick={() => sendMessage('确认')} className="px-4 py-1.5 rounded-lg bg-sky-500/30 hover:bg-sky-500/50 text-sm">确认话题</button>
            </div>
          )
        }
        if (wj.step === 'cover') {
          // ④ 封面卡片（预览——确认/换一批）
          return (
            <div className="mb-2 p-3 rounded-xl border border-violet-500/30 bg-violet-500/[0.06]">
              <div className="text-xs text-violet-400 mb-2">{wj.hint || '封面已生成'}</div>
              {wj.coverUrl ? <img src={wj.coverUrl} alt="封面" className="w-full max-h-48 object-contain rounded-lg mb-2" onError={(e: any) => { e.target.style.display = 'none' }} /> : <div className="text-xs text-red-400 mb-2">封面生成失败——换一批重试</div>}
              <div className="flex gap-2">
                <button onClick={() => sendMessage('确认')} className="px-4 py-1.5 rounded-lg bg-violet-500/30 hover:bg-violet-500/50 text-sm">确认封面</button>
                <button onClick={() => sendMessage('换一批')} className="px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-sm">换一批</button>
              </div>
            </div>
          )
        }
        if (wj.step === 'publish') {
          // ⑤ 发布确认卡片（完整素材包——确认键）
          return (
            <div className="mb-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06]">
              <div className="text-xs text-amber-400 mb-2">{wj.hint || '确认发布'}</div>
              <div className="text-sm space-y-1 mb-2">
                <div>🎬 视频：{wj.videoName || ''}</div>
                <div>📝 标题：{wj.title || ''}</div>
                <div>🏷 话题：{wj.topics || ''}</div>
                {wj.coverUrl ? <div>🖼 封面：<img src={wj.coverUrl} alt="封面" className="w-24 h-16 object-cover rounded-lg inline-block align-middle ml-1" /></div> : null}
              </div>
              <button onClick={() => sendMessage('确认发布')} className="px-5 py-2 rounded-lg bg-amber-500/40 hover:bg-amber-500/60 text-sm font-medium">确认发布</button>
            </div>
          )
        }
        if (wj.step === 'select_video' && Array.isArray(wj.videos)) {
          return (
            <div className="mt-1 space-y-1">
              <p className="text-[9px] text-gray-400">📹 选择视频（点击选中——勾掉自定义=平台默认）：</p>
              {wj.videos.map((v: any, i: number) => (
                <button key={i} onClick={() => sendMessage(v.name || String(i + 1))}
                  className="w-full text-left rounded-lg bg-white/[0.04] hover:bg-emerald-500/15 border border-white/[0.08] px-2 py-1.5 text-[11px] text-gray-200 flex items-center gap-2 transition">
                  <span className="text-emerald-400">▶</span> {v.name}
                </button>
              ))}
            </div>
          )
        }
      } catch {}
    }
    // 2026-08-23: 📎 附件视频 → 渲染 video 播放卡片（用户发视频不再显示链接文本）
    const attachMatch = content.match(/📎\s*\[([^\]]+)\]\(([^)]+)\)/)
    if (attachMatch && /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(attachMatch[2])) {
      return (
        <div className="mt-2">
          <video src={attachMatch[2]} controls className="w-full max-h-64 rounded-lg bg-black border border-white/10" />
          <p className="text-[9px] text-gray-500 mt-1">{attachMatch[1]}</p>
        </div>
      )
    }
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
    const resRe = /(DH_RESULT|VIDEO_RESULT|VIDEO_WEB|IMAGE_RESULT):([^|]+)(?:\|TITLE:([^|\n]+))?/
    // 2026-08-18: 发布任务已创建 → 自动打开指纹浏览器页 + 卡片（任务会自动执行）
    if (content.includes('PUBLISH_QUEUED')) {
      const mId = content.match(/#(\d+)/)
      return (
        <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <p className="text-sm text-emerald-300 mb-1">📤 发布任务已创建{mId ? ` #${mId[1]}` : ''}</p>
          <p className="text-xs text-gray-400 mb-2">客户端指纹浏览器页会自动启动浏览器并执行发布（上传+填文案+发布），保持页面打开即可。</p>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => window.open('/my-fingerprint', '_blank')} className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium transition">🌐 打开指纹浏览器</button>
            <button onClick={() => { const id = mId ? mId[1] : ''; fetch(`/api/agent/publish-tasks?status=all`, { credentials: 'include' }).then(r => r.json()).then(d => { const t = (d.data || []).find((x: any) => String(x.id) === id); const st = t ? (t.status === 'succeeded' ? '✅ 已发布' : t.status === 'failed' ? '❌ 失败：' + (t.error || '') : t.status === 'executing' ? '▶️ 执行中' : '⏳ 等待执行') : '未找到'; alert('任务 #' + id + '：' + st) }) }} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-gray-300 text-xs font-medium transition">🔍 查状态</button>
          </div>
        </div>
      )
    }
    // 2026-08-18: 点数不足 → 充值引导卡片（AI 返回 TOOL_REJECT 含点数不足）
    if (content.includes('TOOL_REJECT') && (content.includes('点数') || content.includes('套餐') || content.includes('点卡'))) {
      return (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-sm text-amber-300 mb-1">⚠️ 点数不足</p>
          <p className="text-xs text-gray-400 mb-2">{content.replace(/TOOL_REJECT:/g, '').slice(0, 120)}</p>
          <div className="flex gap-2">
            <button onClick={() => window.open('/my-subscription', '_blank')} className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium transition">💳 去充值</button>
          </div>
        </div>
      )
    }
    const rm = content.match(resRe)
    if (rm) {
      const url = rm[2].trim()
      const title = (rm[3] || '').trim()
      // 2026-08-18: 图片结果 → 渲染实际图片（不再只给链接）
      if (rm[1] === 'IMAGE_RESULT') {
        return (
          <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-sm text-emerald-300 mb-2">{title || '已为你生成图片'}</p>
            <img src={url} alt={title || '生成图片'} className="w-full rounded-lg max-h-96 object-contain bg-black/40" loading="lazy" />
            <button onClick={() => { setInput('推送图片素材（这是图片不是网页，可用作封面/发小红书）：' + url); setTimeout(() => { const btn = document.querySelector('button[data-send-msg]'); if (btn) (btn as any).click() }, 200) }} className="mt-2 px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-xs mr-2" title="push-to-agent">PUSH-AGENT</button>
            <button onClick={() => navigator.clipboard?.writeText(url)} className="mt-2 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium transition">📋 复制图片链接</button>
          </div>
        )
      }
      // 视频类结果：弹出全局播放器真播放（路线1：B站/YouTube/直链 iframe 均支持）
      if (rm[1] === 'VIDEO_RESULT' || rm[1] === 'VIDEO_WEB') {
        // 2026-08-24: 修复 #301——渲染函数内禁止 setState（openVideoFromUrl 会导致无限重渲染）；自动播放移到顶层 useEffect
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
            {/* 2026-08-11：版本号加入自检明细 */}
            <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-[10px] text-gray-500">
              <span>📦 客户端版本</span>
              <span className="font-mono text-gray-400">v{appVersion}</span>
            </div>
          </div>
        </div>
      )}

      {/* ⚙️ AI 设置弹窗（2026-08-07：音色/温度/语音灵敏度） */}
      {/* 第二段功能演示（2026-08-22：首登设置登记完成后自动弹） */}
      {guideTour && (
        <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/70 backdrop-blur-md" onClick={() => setGuideTour(false)}>
          <div className="w-[420px] rounded-2xl border border-white/10 bg-[#0d0d14] p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white mb-1">🎉 设置完成！带你认识常用功能</h3>
            <p className="text-[10px] text-gray-500 mb-3">点卡片可打开对应功能看看（随时可回来）</p>
            <div className="space-y-2">
              {TOUR_STEPS.map(t => (
                <button key={t.path} onClick={() => window.location.href = t.path}
                  className="w-full flex items-center gap-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 px-3 py-2.5 text-left transition">
                  <span className="text-lg">{t.name.split(' ')[0]}</span>
                  <span>
                    <span className="block text-[11px] text-gray-200">{t.name.split(' ').slice(1).join(' ')}</span>
                    <span className="block text-[9px] text-gray-500 mt-0.5">{t.desc}</span>
                  </span>
                </button>
              ))}
            </div>
            <button onClick={() => { setGuideTour(false); sessionStorage.setItem('tour-step', '1'); window.location.href = '/storage' }}
              className="mt-4 w-full rounded-lg bg-emerald-500/20 py-2 text-[11px] text-emerald-300 hover:bg-emerald-500/30 transition">开始体验 🚀</button>
          </div>
        </div>
      )}
      {showPrefs && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowPrefs(false)}>
          <div className="w-[340px] max-h-[80vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d14] p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white mb-1">⚙️ AI 设置</h3>
            {guideStep > 0 && (
              <div className="mb-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300">
                {guideStep === 1 ? '🎯 第 1 步：给 AI 起个名字（输入后点保存）' : '🎯 第 2 步：填写你的行业/职业（输入后点保存）'}
                <span className="block mt-0.5 text-[9px] text-amber-400/70">不想设置可直接点「取消」跳过</span>
              </div>
            )}
            <div className="mb-3 p-2.5 rounded-lg bg-white/[0.04] border border-white/10">
              <div className="text-[10px] text-gray-400 mb-1.5">✎ 给 AI 起个名字（显示在标题栏与对话中）</div>
              <div className="flex gap-1.5">
                <input value={nameInput} onChange={e => setNameInput(e.target.value)} maxLength={20}
                  placeholder={agentName || '例如：小美 / 麦子'}
                  className={`flex-1 bg-white/5 border rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-gray-600 outline-none focus:border-emerald-400/50 ${guideStep === 1 ? 'border-amber-400/70 animate-pulse' : 'border-white/10'}`} />
                <button onClick={() => { saveAgentName(); if (guideStep === 1) { setGuideStep(2); try { voice?.speak('很好！再告诉我，你从事什么行业？方便我按行业给你推热点和内容。') } catch {} } }}
                  className="shrink-0 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-[11px] text-emerald-300 hover:bg-emerald-500/30 transition">保存</button>
              </div>
            </div>
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

            <p className="text-[11px] text-gray-400 mb-1.5">🏷 我的行业/职业 <span className="text-emerald-300">{industry || '未设置'}</span></p>
            <input value={industry} onChange={e => setIndustry(e.target.value)} maxLength={30}
              placeholder="例如：餐饮 / 美业 / 电商运营…（按行业推热点与内容）"
              className={`w-full bg-white/5 border rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-gray-600 outline-none focus:border-emerald-400/50 mb-3 ${guideStep === 2 ? 'border-amber-400/70 animate-pulse' : 'border-white/10'}`} />
            <p className="text-[9px] text-gray-600 mb-3">按行业推送每日参考视频与热点（可在设置随时改）</p>

            {/* ★PROFILE_FIX_V1 第2批：我关心的主题 —— 热点会按这些词去搜，而不只是推总榜 */}
            <p className="text-[11px] text-gray-400 mb-1.5">🎯 我关心的主题 <span className="text-emerald-300">{myTopics || '未设置'}</span></p>
            <input value={myTopics} onChange={e => setMyTopics(e.target.value)} maxLength={80}
              placeholder="逗号分隔，如：AI,大模型,智能体（热点按这些词搜给你）"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-gray-600 outline-none focus:border-emerald-400/50 mb-1" />
            <p className="text-[9px] text-gray-600 mb-3">填了它，热点大屏/栏目就按这些主题搜（留空则显示总榜）</p>

            <p className="text-[11px] text-gray-400 mb-1.5">🎛 回复温度：<span className="text-emerald-300">{temperature.toFixed(1)}</span></p>
            <input type="range" min="0" max="1.5" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))}
              className="w-full mb-1 accent-emerald-400" />
            <p className="text-[9px] text-gray-600 mb-3">低=严谨稳定，高=创意发散（默认 0.7）</p>

            {/* ★VF_MODELSWITCH_V1（2026-09-30 用户原话「不行加一个模型切换，我试试，deepseek-v4.1_flash 和
                阿里的多模态模型 我切换这试试。每个模型可能理解能力也不一样」）：
                档位按钮 = 一键切换；选「自定义」才出现两个槽位下拉。
                保存后服务端每轮会打一行 `[模型] 大脑=X ｜ 书写=Y`，可据此核对实际生效的模型。 */}
            <p className="text-[11px] text-gray-400 mb-1.5">🧠 AI 模型档位：
              <span className="text-emerald-300">{(MODEL_PRESET_LIST.find(p => p.id === modelPreset) || MODEL_PRESET_LIST[0]).name}</span>
            </p>
            <div className="flex flex-wrap gap-1.5 mb-1">
              {MODEL_PRESET_LIST.map(p => (
                <button key={p.id} type="button" title={p.desc}
                  onClick={() => {
                    setModelPreset(p.id)
                    // 选预设时同步展开两个槽位（custom 保留当前选择，让用户接着改）
                    if (p.id !== 'custom') { setModelBrain(p.brain); setModelWriter(p.writer) }
                  }}
                  className={`rounded-lg border px-2 py-1 text-[10px] transition ${modelPreset === p.id
                    ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                    : 'border-white/10 bg-white/[0.03] text-gray-400 hover:bg-white/[0.08]'}`}>{p.name}</button>
              ))}
            </div>
            {modelPreset === 'custom' ? (
              <div className="mb-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-[52px] shrink-0 text-[10px] text-gray-500">大脑</span>
                  <select value={modelBrain} onChange={e => setModelBrain(e.target.value)}
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white outline-none focus:border-emerald-400/50">
                    {BRAIN_MODELS.map(m => <option key={m.id} value={m.id} className="bg-[#0d0d14]">{m.name}（{m.id}）</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-[52px] shrink-0 text-[10px] text-gray-500">书写</span>
                  <select value={modelWriter} onChange={e => setModelWriter(e.target.value)}
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white outline-none focus:border-emerald-400/50">
                    {WRITER_MODELS.map(m => <option key={m.id} value={m.id} className="bg-[#0d0d14]">{m.name}（{m.id}）</option>)}
                  </select>
                </div>
              </div>
            ) : null}
            <p className="text-[9px] text-gray-600 mb-3">
              现在：大脑 {modelBrain} ｜ 书写 {modelWriter}（换模型后会打一行 [模型] 日志可核对；失败会自动回退，不会把功能搞挂）
            </p>

            <p className="text-[11px] text-gray-400 mb-1.5">🎤 语音灵敏度：<span className="text-emerald-300">{vadThreshold.toFixed(3)}</span></p>
            <input type="range" min="0.02" max="0.12" step="0.005" value={vadThreshold} onChange={e => setVadThreshold(parseFloat(e.target.value))}
              className="w-full mb-1 accent-emerald-400" />
            <p className="text-[9px] text-gray-600 mb-3">小=识别灵敏（安静环境），大=更抗噪（嘈杂环境）</p>

            <p className="text-[11px] text-gray-400 mb-1.5">⏱ 说话停顿多久算说完：<span className="text-emerald-300">{vadSilence}ms</span></p>
            <input type="range" min="1000" max="3500" step="100" value={vadSilence} onChange={e => setVadSilence(parseInt(e.target.value))}
              className="w-full mb-1 accent-emerald-400" />
            <p className="text-[9px] text-gray-600 mb-4">短=反应快（一句话说完立即执行），长=等更久（防误判）</p>

            <div className="flex gap-2">
              <button onClick={() => { setGuideStep(0); setShowPrefs(false); }} className="flex-1 rounded-lg bg-white/[0.06] py-2 text-[11px] text-gray-400 hover:bg-white/10 transition">取消</button>
              <button onClick={() => { savePrefs(); localStorage.setItem(`aim_guide_done_${user?.id || 'guest'}`, '1'); if (guideStep === 2) { setGuideStep(0); setShowPrefs(false); setGuideTour(true); try { voice?.speak('设置完成！带你认识几个常用功能：一键成片、AI生图、AI视频、素材库。看完点开始体验。') } catch {} } }}
                disabled={savingPrefs}
                className="flex-1 rounded-lg bg-emerald-500/20 py-2 text-[11px] text-emerald-300 hover:bg-emerald-500/30 transition">{savingPrefs ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 自定义 AI 名称弹窗（2026-08-07） */}
      {/* 2026-08-11：退出确认弹窗（自定义，非浏览器 confirm） */}
      {showLogout && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowLogout(false)}>
          <div className="w-[300px] rounded-2xl border border-white/15 bg-[#11131c] p-5 text-center" onClick={e => e.stopPropagation()}>
            <div className="text-3xl mb-2">👋</div>
            <h3 className="text-sm font-semibold text-white mb-1">确定退出登录？</h3>
            <p className="text-[11px] text-gray-500 mb-4">当前账号：{user?.username}</p>
            <div className="flex gap-2">
              <button onClick={() => setShowLogout(false)} className="flex-1 rounded-lg bg-white/[0.06] py-2 text-xs text-gray-400 hover:bg-white/10 transition">取消</button>
              <button onClick={async () => { setShowLogout(false); await logout(); router.push('/login') }}
                className="flex-1 rounded-lg bg-red-500/20 py-2 text-xs text-red-300 border border-red-500/30 hover:bg-red-500/30 transition">确认退出</button>
            </div>
          </div>
        </div>
      )}

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
            </div>
            {user ? (
              /* 2026-08-11：右侧一排三卡片——设置 / 管理(按角色跳转) / 退出 */
              <div className="relative flex items-center gap-1.5 shrink-0">
                <button onClick={() => { sessionStorage.setItem('tour-step', '1'); window.location.href = '/storage' }}
                  className="px-2 py-1 rounded-md bg-amber-500/15 border border-amber-500/30 text-[9px] text-amber-300 hover:bg-amber-500/25 transition" title="全自动功能引导（5秒自动进下一步，不真执行）">🎓 引导</button>
                {histOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-white/10 bg-[#0d1428]/95 backdrop-blur-xl shadow-2xl max-h-72 overflow-y-auto">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 sticky top-0 bg-[#0d1428]/95">
                      <span className="text-[10px] text-gray-400 font-mono">📜 历史会话（{sessionCount}）</span>
                      <button onClick={() => { setMessages([]); setSessionId(null); setWelcomeMsg('你好呀！我是你的 AI 营销助手，想聊点什么？'); setHistOpen(false) }}
                        className="text-[9px] text-emerald-300 hover:text-emerald-200">＋ 新对话</button>
                    </div>
                    {histSessions.length === 0 && <p className="px-3 py-3 text-[10px] text-gray-600">暂无历史会话</p>}
                    {histSessions.map((s: any) => (
                      <button key={s.id} onClick={() => loadSession(s.id)}
                        className={`w-full text-left px-3 py-2 text-[10px] border-b border-white/5 hover:bg-white/5 transition ${sessionId === s.id ? 'text-emerald-300 bg-emerald-500/10' : 'text-gray-300'}`}>
                        <span className="block truncate">{s.title || '未命名会话'}</span>
                        <span className="text-[8px] text-gray-600">{s.updatedAt ? new Date(s.updatedAt).toLocaleString('zh-CN') : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => setShowPrefs(true)}
                  className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[9px] text-gray-300 hover:bg-white/10 transition" title="AI 设置（含改名）">设置</button>
                <button onClick={() => router.push(user?.role === 'admin' ? '/admin' : user?.role === 'editor' ? '/ai-tools' : '/workspace')}
                  className="px-2 py-1 rounded-md bg-amber-500/15 border border-amber-500/25 text-[9px] text-amber-300 hover:bg-amber-500/25 transition" title="进入对应管理/工作台">管理</button>
                <button onClick={() => setShowLogout(true)}
                  className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[9px] text-gray-400 hover:text-red-300 hover:bg-white/10 transition" title="退出登录">退出</button>
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

          {/* 声纹球语音面板（BaiLongma voice-panel 位置：左面板内，非中栏顶部） */}
          <div className="px-1 py-1 shrink-0 flex flex-col items-center gap-2">
            <div className="relative">
              <div className="pointer-events-none absolute -inset-px rounded-full opacity-25 blur-3xl"
                style={{ background: 'radial-gradient(circle, #ff9f1c, transparent 70%)' }} />
              {/* 2026-08-20: 白龙马点阵球（1:1 复刻——唯一主球：点=开听/再点=关，静默2s自动断句发送）*/}
              <canvas ref={blmCanvasRef} width={290} height={290}
                className="relative w-[290px] h-[290px] cursor-pointer select-none touch-none"
                style={{ filter: 'drop-shadow(0 0 10px rgba(255,159,28,0.22))' }} />
            </div>
          </div>


          {/* 应用入口（2026-08-05：一键成片等 iframe 大屏，AI 对话栏右 1/3 常驻） */}
          {/* 2026-08-11：flex-1 弹性占满剩余空间——底部「呼出热点大屏」按钮顶到最底部，不贴应用卡 */}
          <div className="px-4 py-3 border-t border-white/[0.06] flex-1 min-h-0 flex flex-col">
            <p className="text-[9px] text-gray-600 mb-2 tracking-wide shrink-0">📱 应用 · 打开即 AI 随行</p>
            {/* 2026-08-08：按角色过滤 + 颜色区分（字体/边框同色）+ 文字宽度自适应 + 错落排列 */}
            {/* 2026-08-11：应用多时内部滚动（不挤压底部） */}
            <div className="flex flex-wrap gap-x-2 gap-y-1 pt-0.5 overflow-y-auto pr-0.5">
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
            <p className="text-[8px] text-gray-800 text-center mt-2 select-none">v{appVersion}</p>
          </div>
        </aside>

        <main className="agent-main-col flex-1 flex flex-col min-w-0 min-h-0 agent-main">
          {/* 2026-08-11：应用/视频模式时声纹球合并到对话栏头部（左面板隐藏后说话入口保留） */}
          {(activeApp || player.open) && (
            <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.03]">
              <div className="relative shrink-0">
                {/* 2026-08-20: 随行入口换成白龙马风格 CSS 圆（不再用旧 VoiceOrb 动画组件），点击转发主球开关 */}
                <div onClick={blmToggle}
                  className="w-11 h-11 rounded-full border border-orange-300/40 bg-orange-300/10 flex items-center justify-center text-orange-300/90 text-base cursor-pointer select-none shadow-[0_0_10px_rgba(255,159,28,0.25)]"
                  title={'点一下开听/再点关闭'}>🎤</div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-gray-200">
                  {orbState === 'listening' ? '🎤 正在聆听…' : orbState === 'recognizing' ? '🔍 识别中…' : orbState === 'thinking' ? '💭 思考中…' : orbState === 'speaking' ? '🔊 朗读中…' : 'AI 随行 · 点击声纹球说话'}
                </p>
                <p className="text-[9px] text-gray-600 truncate">说「关闭」可退出 · 语音可随时打断</p>
              </div>
            </div>
          )}
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
                    {/* 2026-08-20: 小屏兜底入口同样换成 CSS 圆（旧 VoiceOrb 不再使用） */}
                    <div onClick={blmToggle}
                      className="w-[132px] h-[132px] rounded-full border-2 border-orange-300/40 bg-orange-300/10 flex items-center justify-center text-orange-300/90 text-3xl cursor-pointer select-none shadow-[0_0_18px_rgba(255,159,28,0.25)]"
                      title={'点一下开听/再点关闭'}>🎤</div>
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
                    (() => {
                      // ★TOPIC_GROUP_V1（用户批准）：分组显示 —— 🎯 我的主题 / 🔥 全网热搜 分开；
                      // 不再只显示前 3 个源（原来 slice(0,3)：主题源排最前会把百度热搜/HackerNews 挤掉）
                      const isTopicSrc = (s: any) => String((s && s.source) || '').indexOf('HN·') === 0
                      const topicList = hotTopics.filter(isTopicSrc)
                      const generalList = hotTopics.filter((s: any) => !isTopicSrc(s))
                      const HotCard = (src: any) => (
                        <div key={src.source} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="text-[11px] font-semibold text-orange-300/90 mb-2">{src.source}</div>
                          <ul className="space-y-1.5">
                            {src.items.slice(0, 5).map((it: any, i: number) => (
                              <li key={i}>
                                <button
                                  onClick={() => sendMessage(`结合这个热点：${it.title}${it.url ? '（原文链接：' + it.url + ' —— 请先抓取原文，再结合原文内容' : ''}，帮我出一个适合自媒体发布的内容方案`)}
                                  className="text-left text-[11px] text-gray-400 hover:text-gray-100 leading-snug transition line-clamp-1"
                                  title={it.title}
                                >
                                  {i + 1}. {it.title}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                      return (
                        <>
                          {topicList.length > 0 && (
                            <div className="mb-3">
                              <div className="text-[10px] text-cyan-300/80 mb-1.5">🎯 我的主题（按你关心的主题搜到的）</div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">{topicList.map(HotCard)}</div>
                            </div>
                          )}
                          {generalList.length > 0 && (
                            <div>
                              <div className="text-[10px] text-orange-300/70 mb-1.5">🔥 全网热搜</div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">{generalList.map(HotCard)}</div>
                            </div>
                          )}
                        </>
                      )
                    })()
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
                    {onboarding && (
                      <div className="mt-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 w-[300px] sm:w-[340px]">
                        <div className="text-[10px] text-emerald-300/80 mb-2">⚡ 快速登记（也可直接打字告诉我，我会记住）</div>
                        <select value={onboardForm.industry} onChange={e => setOnboardForm({ ...onboardForm, industry: e.target.value })}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mb-2 text-white">
                          <option value="" className="bg-gray-900">行业（选一个）</option>
                          {INDUSTRY_OPTS.map(i => <option key={i} value={i} className="bg-gray-900">{i}</option>)}
                        </select>
                        <input value={onboardForm.occupation} onChange={e => setOnboardForm({ ...onboardForm, occupation: e.target.value })}
                          placeholder="职业/身份，如：餐饮店老板、美业运营"
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mb-2 text-white placeholder-gray-600" />
                        <textarea value={onboardForm.needs} onChange={e => setOnboardForm({ ...onboardForm, needs: e.target.value })}
                          placeholder="主要需求，如：想每天做短视频获客但没时间写文案"
                          rows={2} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mb-2 text-white placeholder-gray-600" />
                        {/* ★PROFILE_FIX_V1 第2批：我关心的主题（热点按这些词搜给你看） */}
                        <input value={onboardForm.topics} onChange={e => setOnboardForm({ ...onboardForm, topics: e.target.value })}
                          placeholder="★ 我关心的主题（逗号分隔，如：AI,大模型,智能体）"
                          maxLength={80} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs mb-2 text-white placeholder-gray-600" />
                        <div className="flex gap-1 flex-wrap mb-2">
                          {PLATFORM_OPTS.map(pf => (
                            <button key={pf} type="button" onClick={() => setOnboardForm(prev => ({ ...prev, platforms: prev.platforms.includes(pf) ? prev.platforms.filter(x => x !== pf) : [...prev.platforms, pf] }))}
                              className={`px-2 py-0.5 rounded text-[10px] border ${onboardForm.platforms.includes(pf) ? 'bg-emerald-500/25 text-emerald-300 border-emerald-500/40' : 'bg-white/5 text-gray-400 border-white/10'}`}>{pf}</button>
                          ))}
                        </div>
                        <button onClick={submitOnboard} disabled={onboardSaving}
                          className="w-full py-2 rounded-lg bg-emerald-500/25 text-emerald-200 text-xs border border-emerald-500/40 hover:bg-emerald-500/35 disabled:opacity-50">
                          {onboardSaving ? '保存中…' : '💾 保存我的画像'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {messages.length > 0 && (
              <div className="flex-1 flex flex-col justify-end space-y-3 pt-3">

                {/* 附件按钮 */}
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
                      {(msg as any).attachments?.length ? (
                        <div className="flex flex-wrap gap-1.5 mt-1 mb-1">
                          {(msg as any).attachments.map((a: any, ai: number) => a?.type === 'image' && a?.url ? (
                            <img key={ai} src={(a.url || '').startsWith('/') ? 'https://ai-niuma.cc' + a.url : a.url} alt={a.name || '附件'} className="w-16 h-16 object-cover rounded-lg border border-white/10 bg-black/40" />
                          ) : (
                            <span key={ai} className="text-[10px] text-gray-400 px-1.5 py-0.5 rounded bg-white/5">📎 {a?.name || '附件'}</span>
                          ))}
                        </div>
                      ) : null}
                      <div className="text-gray-300 whitespace-pre-wrap">{renderContent(msg.content)}</div>
                      {renderTaskCard(msg.content)}
                      {(msg as any).videoUrl ? (
                        <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                          <p className="text-sm text-emerald-300 mb-2">视频已生成</p>
                          <button onClick={() => openVideoFromUrl((msg as any).videoUrl, '视频已生成')} className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium transition">▶ 点击播放</button>
                        </div>
                      ) : null}
                    {msg.scenes && msg.scenes.length > 1 && (
                      <div className="mt-2 flex flex-col gap-2">
                        {msg.scenes.map((sc: any, sci: number) => sc?.type === 'image' && sc.url ? (
                          <div key={sci} className="rounded-xl overflow-hidden border border-white/10 bg-black">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={sc.url} alt={sc.title || '图片'} className="w-full max-h-64 object-contain bg-black" />
                            {(sc.title || sc.desc) && <p className="px-2 py-1.5 text-[9px] text-gray-400 bg-black/60">{sc.title}{sc.desc ? ' — ' + sc.desc : ''}</p>}
                          </div>
                        ) : null)}
                      </div>
                    )}
                      {/* 阶段二·Scene 投影：AGENT 返回结构化卡片原生渲染 */}
                      {msg.role === 'assistant' && msg.scene && (
                                                <div className="mt-2 rounded-xl bg-white/[0.03] border border-white/[0.08] p-3 scene-in">
                          {msg.scene.type === 'template' && Array.isArray(msg.scene.items) && false ? (
                            <div className="flex flex-col gap-2">
                              <p className="text-[11px] text-emerald-300 font-medium">🎨 参考风格（选 1 个生成，或说「换一批」）</p>
                              {msg.scene.items.map((it: any, i: number) => it.type === 'video' ? (
                                <div key={i} className="rounded-lg bg-white/[0.04] border border-white/[0.08] p-2">
                                  <video src={it.url} controls preload="metadata" className="w-full max-h-44 rounded bg-black" />
                                  <div className="flex items-center justify-between mt-1.5 gap-2">
                                    <p className="text-[10px] text-gray-300 truncate">{it.title} <span className="text-purple-400/80">({it.model})</span></p>
                                    <button onClick={() => sendMessage(it.prompt || `用第 ${i + 1} 个风格生成：${it.title}`)}
                                      className="shrink-0 px-2.5 py-1 rounded bg-emerald-500/20 text-[10px] text-emerald-300 hover:bg-emerald-500/30">用这个生成</button>
                                  </div>
                                </div>
                              ) : (
                                <div key={i} className="flex items-center gap-2 rounded-lg bg-white/[0.04] border border-white/[0.08] p-2">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={it.url} alt={it.title} className="w-16 h-16 object-cover rounded bg-white/10" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[10px] text-gray-300 truncate">{it.title} <span className="text-purple-400/80">({it.model})</span></p>
                                    <button onClick={() => sendMessage(it.prompt || `用第 ${i + 1} 个风格生成：${it.title}`)}
                                      className="mt-1 px-2.5 py-1 rounded bg-emerald-500/20 text-[10px] text-emerald-300 hover:bg-emerald-500/30">用这个生成</button>
                                  </div>
                                </div>
                              ))}
                              <button onClick={() => sendMessage('换一批风格')}
                                className="self-end px-2.5 py-1 rounded bg-white/5 text-[10px] text-gray-400 hover:text-white hover:bg-white/10">🔄 换一批</button>
                            </div>
                          ) : msg.scene.type === 'video_frames' && Array.isArray(msg.scene.frames) ? (
                            <div className="flex flex-col gap-2">
                              <p className="text-[11px] text-amber-300 font-medium">🎬 {msg.scene.videoName || '视频'} — 选封面（3 种方式）</p>
                              <div className="grid grid-cols-2 gap-2">
                                {msg.scene.frames.map((f: string, fi: number) => (
                                  <button key={fi} onClick={() => sendMessage(`用第${fi + 1}帧`)}
                                    className="group relative rounded-lg overflow-hidden border border-white/10 hover:border-amber-400/60 bg-black">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={f} alt={`第${fi + 1}帧`} className="w-full aspect-video object-cover" />
                                    <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-[9px] text-amber-300">第{fi + 1}帧</span>
                                    {msg.scene.recommended === fi && <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-full bg-amber-500/90 text-[8px] text-black font-bold">✨AI推荐</span>}
                                  </button>
                                ))}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {msg.scene.grid && (
                                  <button onClick={() => sendMessage('用九宫格封面')}
                                    className="group relative rounded-lg overflow-hidden border border-white/10 hover:border-emerald-400/60 bg-black">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={msg.scene.grid} alt="九宫格封面" className="w-full aspect-video object-cover" />
                                    <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-[9px] text-emerald-300">🧩 九宫格</span>
                                  </button>
                                )}
                                <button onClick={() => sendMessage('用AI生成封面')}
                                  className="rounded-lg border border-dashed border-white/15 hover:border-violet-400/60 bg-white/[0.03] flex flex-col items-center justify-center gap-1 p-2 aspect-video">
                                  <span className="text-[18px]">🎨</span>
                                  <span className="text-[9px] text-violet-300">AI 生成封面</span>
                                  <span className="text-[8px] text-gray-500">标题+滤镜（12点）</span>
                                </button>
                              </div>
                              <p className="text-[9px] text-gray-500">选帧后 AI 识别画面、推荐标题并设计封面；九宫格/AI封面直接生成</p>
                            </div>
                          ) : msg.scene.type === 'image' ? (
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
                            <button onClick={() => { const u = msg.scene.link?.url || msg.scene.url || ''; if (!u) return; if ((window as any).electronAPI?.browserOpenUrl) { try { (window as any).electronAPI.browserOpenUrl(u) } catch {} } else if (/^https?:/.test(u)) window.open(u, '_blank') }}
                              className="flex flex-col gap-1 rounded-lg bg-white/[0.04] border border-white/[0.08] p-2.5 hover:border-emerald-400/40 transition text-left">
                              {msg.scene.title && <p className="text-[11px] text-emerald-300 font-medium">{msg.scene.title}</p>}
                              {msg.scene.desc && <p className="text-[10px] text-gray-400">{msg.scene.desc}</p>}
                              <span className="text-[9px] text-gray-500 mt-0.5">↗ 打开链接（系统 Chrome · 带登录态）</span>
                            </button>
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
                                      <a key={i} href={/^https?:/.test(a.href || '') ? a.href : '#'} target={/^https?:/.test(a.href || '') ? '_blank' : undefined} rel="noopener noreferrer"  // #14
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
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '120ms' }} />
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '240ms' }} />
                        <span className="text-[10px] text-gray-400 ml-1">{pendingLabel || '💭 正在处理…'}</span>
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
              {/* 2026-08-28: 常配快捷卡片（不再仅新开会话显示）——点击填入输入框；2026-09-06 自由模式不显示 */}
              {agentMode === 'standard' && (
              <div className="mb-2 flex gap-1.5 flex-wrap">
                  {FEATURE_TIPS.map((t, i) => (
                    <button key={i} onClick={() => { setInput(t); inputRef.current?.focus() }}
                      className="px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[10px] text-gray-400 hover:text-amber-300 transition">
                      {t}
                    </button>
                  ))}
                </div>
              )}
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
                    <div key={i} className="relative">
                      {a.type === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt={a.name} className="w-14 h-14 object-cover rounded-lg border border-white/10" />
                      ) : a.type === 'video' ? (
                        <video src={a.url} className="w-14 h-14 object-cover rounded-lg border border-white/10" muted />
                      ) : (
                        <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 text-[10px] text-gray-400">🎵 {a.name}</span>
                      )}
                      <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 text-[9px] text-red-400 hover:bg-black">×</button>
                    </div>
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
                <button onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-500 hover:text-gray-300 transition">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
                </button>
                                {/* 2026-08-21 日历键（输入框内，上传前，同风格）：只显示日期，点击开月历回档 */}
                <div className="relative shrink-0">
                  <button onClick={() => { setCalOpen(o => !o); if (!calOpen) loadCalendar() }}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition ${calOpen ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10'}`}
                    title="日历·历史会话">{new Date().getDate()}</button>
                  {calOpen && createPortal(
                    <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[80] w-[680px] max-w-[94vw] max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#14141c]/97 backdrop-blur-xl shadow-2xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <button onClick={() => setCalM(m => (m === 0 ? (setCalY(y => y - 1), 11) : m - 1))} className="px-2 py-1 rounded bg-white/5 text-gray-400 text-xs hover:bg-white/10">‹</button>
                        <span className="text-sm font-semibold text-gray-200">{calY} 年 {calM + 1} 月</span>
                        <button onClick={() => setCalM(m => (m === 11 ? (setCalY(y => y + 1), 0) : m + 1))} className="px-2 py-1 rounded bg-white/5 text-gray-400 text-xs hover:bg-white/10">›</button>
                      </div>
                      <div className="grid grid-cols-7 gap-1 text-center mb-1">
                        {['日', '一', '二', '三', '四', '五', '六'].map(d => <span key={d} className="text-[9px] text-gray-600">{d}</span>)}
                      </div>
                      <div className="grid grid-cols-7 gap-1">
                      {(() => {
                        const first = new Date(calY, calM, 1).getDay()
                        const days = new Date(calY, calM + 1, 0).getDate()
                        const cells = []
                        for (let i = 0; i < first; i++) cells.push(<div key={'b' + i} />)
                        for (let d = 1; d <= days; d++) {
                          const ds = calY + '-' + String(calM + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
                          const has = (calData[ds] || []).length
                          const isToday = ds === todayStr()
                          const dayFav = (calData[ds] || []).every((s: any) => s.favorite)
                          cells.push(
                            <div key={d} className={`relative rounded-lg border overflow-hidden transition-transform duration-150 hover:scale-105 ${isToday ? 'border-amber-500/50 bg-amber-500/10' : has ? 'border-white/15 bg-white/[0.06] hover:bg-white/10' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]'}`}>
                              <button onClick={() => openCalDay(ds)} className={`w-full h-8 flex items-center justify-center text-sm ${isToday ? 'text-amber-300 font-bold' : has ? 'text-gray-100 font-medium' : 'text-gray-500'}`}>{d}</button>
                              <button onClick={() => { const list = (calData[ds] || []); list.forEach((s: any) => toggleFav(s.id, !dayFav)) }}
                                className={`absolute top-0 right-0 text-[10px] px-1 ${dayFav && has ? 'text-amber-400' : 'text-gray-700 hover:text-amber-400'}`}>★</button>
                            </div>
                          )
                        }
                        return cells
                      })()}
                      </div>
                      {calDay && (
                        <div className="mt-2 border-t border-white/10 pt-2 max-h-40 overflow-y-auto space-y-1">
                          <p className="text-[10px] text-gray-500">{calDay} 会话（{((calData[calDay] || []).length)}）</p>
                          {(calData[calDay] || []).map((s: any) => (
                            <div key={s.id} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1.5">
                              <button onClick={() => loadSessionByDate(s.id)} className="flex-1 text-left text-[11px] text-gray-200 truncate hover:text-amber-300">{s.title || ('会话 #' + s.id)} <span className="text-gray-600">({s.msgCount}条)</span></button>
                              <button onClick={() => toggleFav(s.id, !s.favorite)} className={`text-xs ${s.favorite ? 'text-amber-400' : 'text-gray-600 hover:text-amber-400'}`}>★</button>
                            </div>
                          ))}
                          {!(calData[calDay] || []).length && <p className="text-[10px] text-gray-600">当天无会话</p>}
                        </div>
                      )}
                      <div className="mt-2 border-t border-white/10 pt-2">
                        <p className="text-[10px] text-gray-500 mb-1">⭐ 收藏的会话</p>
                        {calFavs.map((f: any) => (
                          <div key={f.id} className="flex items-center gap-2 py-1">
                            <button onClick={() => loadSessionByDate(f.id)} className="flex-1 text-left text-[11px] text-amber-300/90 truncate">{f.title || ('会话 #' + f.id)} <span className="text-gray-600">{f.date}</span></button>
                          </div>
                        ))}
                        {!calFavs.length && <p className="text-[10px] text-gray-600">暂无收藏</p>}
                      </div>
                    </div>, document.body)}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFilePick} multiple />
                {interimText && (
                  <div className="px-3 py-1.5 mb-1 text-sm text-emerald-300/90 bg-emerald-500/5 rounded-lg border border-emerald-500/20">
                    🎤 识别中：{interimText}
                  </div>
                )}
                <div className="flex flex-col items-center gap-1 shrink-0 mr-1">
                  <button onClick={() => setAgentMode(agentMode === 'standard' ? 'free' : 'standard')}
                    title={agentMode === 'standard' ? '标准模式（发布走状态机防编）——点击切自由' : '自由模式（AI 完全发挥）——点击切标准'}
                    className={`w-9 h-5 rounded-full relative transition ${agentMode === 'standard' ? 'bg-emerald-500/60' : 'bg-purple-500/60'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${agentMode === 'standard' ? 'left-0.5' : 'left-[18px]'}`} />
                  </button>
                  <span className={`text-[7px] leading-none ${agentMode === 'standard' ? 'text-emerald-400' : 'text-purple-400'}`}>{agentMode === 'standard' ? '标准' : '自由'}</span>
                </div>
                <button onClick={clearTodayTasks} title="清会话（清空聊天记录）"
                  className="shrink-0 w-6 h-6 rounded-md bg-white/5 hover:bg-red-500/20 text-gray-500 hover:text-red-400 flex items-center justify-center mr-0.5">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>                <textarea ref={inputRef} value={input}
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
              {clearMsg && <p className="text-[8px] text-emerald-400/90 text-center mt-0.5">{clearMsg}</p>}
              <p className="text-[8px] text-gray-700 text-center mt-1 hidden sm:block">Enter 发送 · Shift+Enter 换行 · / 命令 · 📎 图片/视频 · 🎤 点击声纹球说话</p>
            </div>
          </footer>
        </main>

        {/* 右侧常驻·思考步骤流面板（融合 BaiLongma 步骤流） */}
        <aside className="agent-thinking-aside hidden lg:flex w-72 backdrop-blur-xl flex-col shrink-0">
          {/* 右侧信息面板（2026-08-08：账号/订阅/点数/模型/记忆/自检，从左侧移来） */}
          <div className="p-3 border-b border-white/5 shrink-0">
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
              <div className="grid grid-cols-1 gap-y-1 text-[10px] text-gray-400">
                <span className="truncate">📅 {selfChecks.find(c => c.key === 'subscription')?.detail || '—'}</span>
                <span className="truncate">💎 {selfChecks.find(c => c.key === 'points')?.detail || '—'}</span>
                <span className="truncate">🧠 {selfModel?.brain || '—'} <span className="text-gray-600">· {selfChecks.find(c => c.key === 'memory')?.detail || ''}</span></span>
              </div>
              <div className="text-[9px] text-gray-600 border-t border-white/[0.05] pt-1.5 flex items-center justify-between">
                <span>💬 历史 {sessionCount} 会话</span>
                <span>本次 {sessionReqs} 次请求</span>
              </div>
            </div>
            {/* 2026-08-21: 浏览器账号（CDP 检测——发布通道已登录平台，不显示指纹） */}
            <div className="mt-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2">
              <button onClick={() => setBrowserOpen(o => !o)} className="w-full flex items-center justify-between text-[10px] text-gray-300">
                <span>🌐 浏览器登录登记</span>
                <span className="text-gray-600">{browserOpen ? '▾' : '▸'}</span>
              </button>
              {browserOpen && (
                <div className="mt-1.5 space-y-1">
                  <div className="mt-2 pt-2 border-t border-white/10">
                    <p className="text-[9px] text-gray-500 mb-1">登记平台（点击打开内置浏览器登录）</p>
                    {/* ★LOGIN_UNIFY_V1（2026-09-28）：一句话说清"现在到底是什么状态" ——
                        原来只有一句没有信息量的"未登录"，用户分不清是"从没登记过"还是"登录过期了"。 */}
                    {buAccounts.length > 0 && (
                      <p className="text-[9px] mb-1 leading-relaxed">
                        {(() => {
                          const CN: Record<string, string> = { douyin: '抖音', xiaohongshu: '小红书', weibo: '微博', bilibili: 'B站', shipinhao: '视频号', kuaishou: '快手', x: 'X', google: 'Google' }
                          const nm = (a: any) => CN[a.id] || a.name || a.id
                          const d = (t: number) => (t ? new Date(t).toLocaleDateString('zh-CN') : '')
                          const on = buAccounts.filter((a: any) => a.loggedIn)
                          const exp = buAccounts.filter((a: any) => !a.loggedIn && a.reason === 'expired')
                          const miss = buAccounts.filter((a: any) => !a.loggedIn && a.reason !== 'expired')
                          return (
                            <>
                              {on.length > 0 && <span className="text-emerald-400">已登录：{on.map((a: any) => nm(a) + (a.expireAt ? '（' + d(a.expireAt) + ' 到期）' : '')).join('、')}　</span>}
                              {exp.length > 0 && <span className="text-amber-400">登录已过期，请重登：{exp.map((a: any) => nm(a) + (a.expireAt ? '（' + d(a.expireAt) + '）' : '')).join('、')}　</span>}
                              {miss.length > 0 && <span className="text-gray-500">未登录：{miss.map((a: any) => nm(a)).join('、')}</span>}
                            </>
                          )
                        })()}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {[
                        { id: 'google', name: '🇬 Google', url: 'https://accounts.google.com', note: '连带YouTube' },
                        // 2026-09-13: 6 个发布平台取自 platforms.ts（图标 + 登录页 URL）
                        // ★LOGIN_UNIFY_V1：统一补 note: ''（否则数组是"有的有 note 有的没有"的联合类型，
                        //   下面读 pf.note 会报 TS2339 —— 顺手把类型问题也消掉）
                        ...PLATFORMS.map(p => ({ id: p.id, name: p.icon + p.name, url: p.loginUrl, note: '' })),
                        { id: 'twitter', name: '🐦X', url: 'https://x.com', note: '' },
                      ].map(pf => {
                        const hit = buAccounts.find(a => a.id === pf.id || (pf.id === 'twitter' && a.id === 'x'))
                        // ★LOGIN_UNIFY_V1：把"为什么显示未登录"写进悬停提示（含到期日）
                        const _exp = hit?.expireAt ? new Date(hit.expireAt).toLocaleDateString('zh-CN') : ''
                        const tip = hit?.loggedIn
                          ? ('已登录 ✓' + (_exp ? `（${_exp} 到期）` : '') + (pf.note ? ' ' + pf.note : ''))
                          : (hit?.reason === 'expired'
                            ? (`登录已过期${_exp ? `（${_exp} 到期）` : ''}——点这里重新登录`)
                            : '未登录——点这里打开登录页，登录后点「刷新检测」')
                        return (
                          <button key={pf.id} onClick={async () => {
                            // ★2026-09-22（用户实测"点了没反应"）：原来返回值被直接丢弃（try{…}catch{}）——
                            //   启动失败时**界面完全静默**，用户只能看到"点了没用"。
                            //   现在：失败明确弹出原因；在浏览器里打开时提示要用客户端。
                            try {
                              const api = (window as any).electronAPI
                              if (!api?.browserOpenUrl) { alert('打开登记浏览器需要用客户端（浏览器里不支持）'); return }
                              const r = await api.browserOpenUrl(pf.url)
                              if (!r || r.success !== true) alert('打开登记浏览器失败：' + ((r && r.error) || '未知原因') + '\n（可把 <安装目录>\\data\\bu_debug.log 发给开发）')
                            } catch (e: any) { alert('打开登记浏览器失败：' + (e?.message || e)) }
                          }}
                            className={`px-1.5 py-0.5 rounded border text-[9px] transition ${hit?.loggedIn
                              ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                              : (hit?.reason === 'expired'
                                ? 'border-amber-500/40 text-amber-300 bg-amber-500/10'
                                : 'border-white/10 text-gray-400 hover:border-white/30 hover:text-gray-200')}`}
                            title={tip}>
                            {pf.name}{hit?.loggedIn ? ' ✓' : (hit?.reason === 'expired' ? ' ⏰' : '')}
                          </button>
                        )
                      })}
                    </div>
                    {true && (<div className="mt-1.5 flex gap-1">
                      <input id="custom-reg-url" placeholder="自定义地址（如 https://xxx.com）"
                        className="flex-1 min-w-0 px-1.5 py-0.5 rounded border border-white/10 bg-black/30 text-[9px] text-gray-300 outline-none focus:border-emerald-500/40" />
                      <button onClick={async () => {
                        const u = (document.getElementById('custom-reg-url') as HTMLInputElement)?.value?.trim()
                        if (!u) return
                        try {
                          const api = (window as any).electronAPI
                          if (!api?.browserOpenUrl) { alert('打开登记浏览器需要用客户端（浏览器里不支持）'); return }
                          const r = await api.browserOpenUrl(u)
                          if (!r || r.success !== true) alert('打开浏览器失败：' + ((r && r.error) || '未知原因'))
                        } catch (e: any) { alert('打开浏览器失败：' + (e?.message || e)) }
                      }}
                        className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[9px] text-gray-300 hover:bg-emerald-500/15 hover:border-emerald-500/30 transition">打开登记</button>
                    </div>)}

                  </div>
                  {/* 2026-08-29: Browser Use 登记（系统 Chrome——bu_profile 登录） */}
                  <button onClick={async () => {
                    if (!(window as any).electronAPI?.buOpen) { alert('需客户端 v1.0.77+'); return }
                    const r = await (window as any).electronAPI.buOpen()
                    alert(r?.message || r?.error || '打开失败')
                  }} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-[9px] text-sky-300 hover:bg-sky-500/20" title="打开 Browser Use 专用浏览器（bu_profile）扫码登录——AI 发布用">
                    <span className="text-[12px] leading-none">🤖</span> Browser Use 登记
                  </button>
                </div>
              )}
            </div>
          </div>

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
            <button onClick={() => {
              const last = [...messages].reverse().find(m => m.role === 'assistant' && m.steps?.length)
              if (!last) return
              const txt = last.steps.map((s: any) => (s.label + ' [' + (s.tool || '') + ']' + (s.args ? ' args=' + s.args : ''))).join(String.fromCharCode(10))
              navigator.clipboard.writeText(txt).then(() => setRecordingTip('✅ 执行链已复制')).catch(() => setRecordingTip('复制失败'))
            }} className="shrink-0 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 text-[9px]">
              复制执行链
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {liveSteps.length === 0 && !loading ? (
              (() => {
                // 从对话历史取最新一条 assistant 的步骤，保证右栏始终有内容
                const last = [...messages].reverse().find(m => m.role === 'assistant')
                if (!last) return (
                  <p className="text-[10px] text-gray-700 px-1 py-4 text-center">
                    发一条消息，看助手怎么拆解执行
                  </p>
                )
                if (!last.steps?.length) {
                  // 2026-08-23: D 纯对话（无工具调用）也显示思考摘要
                  return (
                    <div className="flex flex-col gap-1.5">
                      {['分析用户意图', '组织回复'].map((t, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
                          <span className="mt-0.5 w-4 h-4 rounded-full bg-violet-500/20 text-violet-300 flex items-center justify-center text-[9px] shrink-0 font-semibold">⚡</span>
                          <div className="min-w-0">
                            <p className="text-[10px] text-gray-300 leading-snug">{t}</p>
                            <p className="text-[8px] text-violet-400/60 mt-0.5">快速响应（无工具调用）</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                }
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
                      {s.args && <p className="text-[8px] text-gray-600 mt-0.5 break-all">{s.args}</p>}
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
                      {s.args && <p className="text-[8px] text-gray-600 mt-0.5 break-all">{s.args}</p>}
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
              if (next) loadBrainMemories()
            }}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-[10px] transition ${showBrain ? 'bg-purple-500/20 text-purple-300' : 'bg-white/[0.03] hover:bg-white/[0.06] text-gray-400'}`}>
              {showBrain
                ? `画像 ${brainMemories.filter((m: any) => String(m.tags || '').includes('画像')).length} 条 · 点击收起`
                : `共 ${brainMemories.length} 条记忆 · 点击展开`}
            </button>
            {showBrain && (
              <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                {brainMemories.length === 0 ? (
                  <p className="text-[9px] text-gray-700 px-1">聊天中让助手「记住我的行业/偏好…」即生成画像</p>
                ) : (
                  <>
                    {/* ★PROFILE_FIX_V1 补：画像 / 未接入需求 分组显示（原来混在一起） */}
                    {brainMemories.filter((m: any) => String(m.tags || '').includes('画像')).map((m, i) => (
                      <div key={'p' + i} className="rounded-lg bg-purple-500/5 border border-purple-500/15 px-2 py-1.5">
                        <p className="text-[10px] text-gray-300 leading-snug">{m.content}</p>
                        {m.tags && <p className="text-[8px] text-purple-400/70 mt-0.5">#{m.tags}</p>}
                      </div>
                    ))}
                    {brainMemories.filter((m: any) => String(m.tags || '').includes('未接入')).length > 0 && (
                      <>
                        <p className="text-[9px] text-amber-500/70 px-1 pt-1.5">📝 未接入需求（产品改进反馈）</p>
                        {brainMemories.filter((m: any) => String(m.tags || '').includes('未接入')).map((m, i) => (
                          <div key={'n' + i} className="rounded-lg bg-amber-500/5 border border-amber-500/15 px-2 py-1.5">
                            <p className="text-[10px] text-gray-300 leading-snug">{m.content}</p>
                          </div>
                        ))}
                      </>
                    )}
                    {brainMemories.filter((m: any) => !String(m.tags || '').includes('画像') && !String(m.tags || '').includes('未接入')).length > 0 && (
                      <p className="text-[9px] text-gray-600 px-1 pt-1">
                        另有 {brainMemories.filter((m: any) => !String(m.tags || '').includes('画像') && !String(m.tags || '').includes('未接入')).length} 条其它记忆
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {/* 媒体舞台（阶段1：音乐库 + AI 生成记录） */}
          <div className="p-3 border-t border-white/5">
            <button onClick={toggleMedia}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-[10px] transition ${mediaOpen ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/[0.03] hover:bg-white/[0.06] text-gray-400'}`}>
              🎵 媒体舞台 {mediaOpen ? '· 收起' : mediaData ? `· ${mediaData.bgm.length}曲` : '· 音乐库'}
            </button>
            <a href="/music-library" onClick={(e) => { e.preventDefault(); openApp('/music-library') }}
              className="ml-1 px-2 py-1.5 rounded-lg text-[10px] bg-white/[0.03] hover:bg-white/[0.06] text-gray-400 hover:text-cyan-300 transition">🎵 音乐库</a>
            {mediaOpen && (
              <div className="mt-2 space-y-2 max-h-56 overflow-y-auto pr-1">
                {mediaLoading ? (
                  <p className="text-[9px] text-gray-700 px-1">加载中…</p>
                ) : (
                  <>
                    {/* 2026-08-14: AI 生成 BGM（Minimax） */}
                    <div className="rounded-lg border border-white/[0.06] p-2 bg-white/[0.02]">
                      <div className="flex gap-1.5">
                        <input value={musicPrompt} onChange={(e) => setMusicPrompt(e.target.value)}
                          placeholder="AI 生成背景乐：如 欢快的电子音乐"
                          className="flex-1 min-w-0 bg-black/30 border border-white/10 rounded-md px-2 py-1 text-[10px] text-gray-300 placeholder:text-gray-600 outline-none focus:border-cyan-500/40" />
                        <button onClick={genMusic} disabled={musicGenBusy}
                          className="shrink-0 px-2.5 py-1 rounded-md text-[10px] bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-50 disabled:cursor-wait">
                          {musicGenBusy ? '生成中…' : '🎼 生成'}
                        </button>
                      </div>
                      {musicGenMsg && <p className={`mt-1 text-[9px] ${musicGenNeedsPay ? 'text-amber-400' : 'text-gray-500'}`}>{musicGenMsg}</p>}
                      {musicGenUrl && (
                        <div className="mt-1.5 space-y-1">
                          <audio src={musicGenUrl} controls className="w-full h-8" />
                          <button onClick={addGenMusic}
                            className="w-full text-[9px] py-1 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25">✅ 用做背景乐</button>
                        </div>
                      )}
                    </div>
                    <p className="text-[9px] text-gray-500">🎶 音乐库</p>
                    {(mediaData?.bgm.length ? mediaData.bgm : []).map(b => (
                      <button key={b.id} onClick={() => toggleBgm(b)}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[10px] transition ${mediaPlayingId === b.id ? 'bg-cyan-500/15 text-cyan-300' : 'bg-white/[0.03] hover:bg-white/[0.06] text-gray-400'}`}>
                        <span className="truncate">{b.title}</span>
                        <span className="shrink-0 ml-2">{mediaPlayingId === b.id ? '⏸ 停止' : '▶ 试听'}</span>
                      </button>
                    ))}
                    {(!mediaData?.bgm.length) && (
                      <p className="text-[9px] text-gray-700 px-1">暂无音乐 · 用上方「🎼 生成」添加</p>
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
          // 2026-09-13: 数据时间（用户要求——一眼看出新旧，避免再被一年半前的数据骗）
          const hotLatestAt = hotTopics.reduce((m: number, s: any) => Math.max(m, Number(s.fetchedAt) || 0), 0)
          const hotTimeLabel = (() => {
            if (!hotLatestAt) return '—'
            const d = new Date(hotLatestAt)
            const hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
            const hours = (Date.now() - hotLatestAt) / 3600000
            const ago = hours < 1 ? '刚刚' : hours < 24 ? Math.round(hours) + '小时前' : Math.round(hours / 24) + '天前'
            return hhmm + '（' + ago + '）'
          })()
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
                ['数据时间', hotTimeLabel, '#ffd166'],
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
              {/* 2026-08-11 修正：移除 justify-end（此前误加导致所有卡片贴底）——恢复顶部正常排列 */}
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
        <TourGuide />
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
                      {/* 2026-08-12：发布次数竖柱图 */}
                      {publishRows.length > 0 ? (
                        <div className="flex items-end justify-between gap-1.5 pt-1" style={{ height: 64 }}>
                          {publishRows.slice(0, 6).map((r) => (
                            <div key={r.name} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                              <span className="text-[8px] text-[#6b7180]">{r.pct}</span>
                              <div className="w-full max-w-[26px] rounded-t bg-gradient-to-t from-[#4f8cff] to-[#88ccff] transition-all"
                                style={{ height: `${Math.max(4, (r.pct / regionMax) * 42)}px` }} />
                              <span className="text-[8px] text-[#aab2c2] truncate max-w-full">{r.name}</span>
                            </div>
                          ))}
                        </div>
                      ) : <span className="text-[9px] text-[#5a6072]">暂无数据</span>}
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
                {trendVideos.length === 0 && (
                  <p className="text-[10px] text-[#5a6072] text-center py-6">{trendVideosLoading ? '视频加载中…' : '未配置视频源（后台添加 SERPER key）'}</p>
                )}
                {trendVideos.map((v, i) => (
                  <button key={i} onClick={() => handlePlayVideo(v.url, v.title)}
                    className="group shrink-0 flex flex-col gap-1.5 rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.03] hover:border-[#ff6b4f]/40 hover:bg-white/[0.06] transition text-left">
                    <div className="relative w-full aspect-video bg-black/40">
                      {v.thumbnail ? (
                        <img src={v.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${v.platform.includes('TikTok') ? 'from-[#1e2a3a] to-[#111827]' : v.platform.includes('YouTube') ? 'from-[#2a1a1a] to-[#1a0f0f]' : 'from-[#1a2a1f] to-[#0f1a12]'}`}>
                          <span className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white text-xs border border-white/20">▶</span>
                        </div>
                      )}
                      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                        <span className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white text-xs">▶</span>
                      </span>
                    </div>
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
            {/* 2026-08-11：大屏底部版本号 */}
            <div className="shrink-0 h-6 flex items-center justify-between px-4 border-t border-white/[0.07] bg-[#0a0e16]/70 text-[9px] text-[#4a5162]">
              <span>AiMarketing 客户端</span>
              <span className="font-mono">v{appVersion}</span>
            </div>
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

export default function AgentPage() {
  return <AgentErrorBoundary><AgentPageInner /></AgentErrorBoundary>
}
