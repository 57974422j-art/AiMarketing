'use client'

import { useEffect, useRef, useState } from 'react'

// /landing 滚动穿越落地页（2026-08-11，纯 CSS 3D 视差，零依赖）
// 效果：滚动时镜头从每个场景外部飞入内部，无缝流向下一场景（scroll-world 式）
const SCENES = [
  { icon: '🎯', title: 'AI 热点雷达', sub: '实时捕捉全网热点 · 抖音 / 微博 / 小红书 / 知乎', desc: '语音一句「今天有什么热点」，AI 立刻拉取全网热榜并为你匹配行业内容方向。', image: '/landing/hotspot.png', glow: '#22d3ee' },
  { icon: '✍️', title: '爆款文案生成', sub: '10 秒产出一条带货/引流文案 · 自动适配平台风格', desc: '结合你的行业与热点，AI 生成标题、正文、话题标签，还可以直接朗读给你听。', image: '/landing/copy.png', glow: '#34d399' },
  { icon: '🎬', title: 'AI 文生视频', sub: '一句话生成视频 · wan2.7 / 分镜脚本 / 首尾帧接力', desc: '「做一个 30 秒的咖啡店视频」——AI 自动分镜、逐镜生成、无缝拼接成完整成片。', image: '/landing/video.png', glow: '#a78bfa' },
  { icon: '🎞️', title: '一键成片', sub: '素材 · 配音 · 字幕 · BGM 全自动合成', desc: '上传素材或从素材库挑选，AI 自动剪辑、配音、加字幕、配音乐，几分钟出片。', image: '/landing/compile.png', glow: '#fbbf24' },
  { icon: '🚀', title: '自动发布', sub: '指纹浏览器多平台发布 · 抖音 / 小红书 / 视频号 / 快手', desc: '成片确认后，一键推送到各大平台，批量任务队列自动执行，省去人工操作。', image: '/landing/publish.png', glow: '#fb7185' },
]

export default function LandingPage() {
  const [progress, setProgress] = useState(0)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => {
      const el = wrapRef.current
      if (!el) return
      const total = el.scrollHeight - window.innerHeight
      const p = total > 0 ? Math.min(1, Math.max(0, window.scrollY / total)) : 0
      setProgress(p)
      const idx = Math.min(SCENES.length - 1, Math.floor(window.scrollY / window.innerHeight))
      setActive(idx)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 滚动进度条
  const bar = progress * 100

  return (
    <div ref={wrapRef} className="relative bg-[#05070d] text-white" style={{ height: `${SCENES.length * 100}vh` }}>
      {/* 固定视口：3D 穿越舞台 */}
      <div className="fixed inset-0 overflow-hidden" style={{ perspective: '1300px' }}>
        {/* 星尘背景 */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(30,60,120,0.25),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(120,40,200,0.15),transparent_60%)]" />
        {/* 网格地面（随镜头移动） */}
        <div className="absolute left-1/2 bottom-0 w-[200vw] h-[120vh] -translate-x-1/2 opacity-20"
          style={{
            transform: `translateX(-50%) translateY(${progress * 30}px) rotateX(72deg)`,
            transformStyle: 'preserve-3d',
            backgroundImage: 'linear-gradient(rgba(60,120,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(60,120,255,0.35) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }} />

        <SceneLayers progress={progress} active={active} />
      </div>

      {/* 滚动进度条 */}
      <div className="fixed top-0 left-0 h-1 z-50 bg-gradient-to-r from-cyan-400 via-violet-400 to-rose-400 transition-[width] duration-150" style={{ width: `${bar}%` }} />

      {/* 左侧场景导航 */}
      <div className="fixed left-4 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-3">
        {SCENES.map((s, i) => (
          <button key={i} onClick={() => window.scrollTo({ top: i * window.innerHeight, behavior: 'smooth' })}
            className={`w-2.5 h-2.5 rounded-full transition-all ${active === i ? 'scale-125 bg-white' : 'bg-white/30 hover:bg-white/60'}`} title={s.title} />
        ))}
      </div>

      {/* 底部 CTA */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex gap-3">
        <a href="/login" className="px-6 py-2.5 rounded-full bg-white/10 border border-white/20 text-sm text-white backdrop-blur hover:bg-white/20 transition">登录体验</a>
        <a href="/register" className="px-6 py-2.5 rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 hover:brightness-110 transition">免费注册</a>
      </div>
    </div>
  )
}

// 3D 场景层：镜头随 progress（0-1）依次飞过 5 个场景，从远到近、无剪切
function SceneLayers({ progress, active }: { progress: number; active: number }) {
  const DEPTH = 4200 // 起点深度
  return (
    <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
      {SCENES.map((s, i) => {
        const t = Math.min(1, Math.max(0, progress * SCENES.length - i)) // 本场景飞行进度 0→1
        const z = DEPTH * (1 - t) - 200 // 远 → 近
        const opacity = t < 0.15 ? t / 0.15 : 1 - Math.max(0, t - 0.82) / 0.18
        const scale = 0.72 + t * 0.28
        return (
          <div key={i} className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `translateZ(${z}px) scale(${scale})`,
              opacity: Math.max(0, Math.min(1, opacity)),
              transition: 'transform 0.1s linear',
            }}>
            <div className="relative w-[min(94vw,860px)] h-[min(70vh,560px)] rounded-3xl border border-white/15 overflow-hidden shadow-2xl"
              style={{ boxShadow: `0 0 140px -30px ${s.glow}` }}>
              {/* diorama 场景图（镜头推近感） */}
              <img src={s.image} alt={s.title} className="w-full h-full object-cover"
                style={{ transform: `scale(${1.06 + t * 0.12})`, transition: 'transform 0.15s linear' }} />
              {/* 底部文字叠加 */}
              <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8 bg-gradient-to-t from-black/85 via-black/40 to-transparent">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-3xl sm:text-4xl drop-shadow">{s.icon}</span>
                  <h2 className="text-2xl sm:text-4xl font-bold tracking-tight drop-shadow">{s.title}</h2>
                </div>
                <p className="text-xs sm:text-sm mb-2 font-medium" style={{ color: `${s.glow}` }}>{s.sub}</p>
                <p className="text-xs sm:text-sm text-white/85 max-w-xl leading-relaxed drop-shadow">{s.desc}</p>
                <div className="mt-3 flex justify-start gap-1.5">
                  {SCENES.map((_, j) => (
                    <span key={j} className={`h-1.5 rounded-full transition-all ${j === i ? 'w-8 bg-white' : 'w-1.5 bg-white/40'}`} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
