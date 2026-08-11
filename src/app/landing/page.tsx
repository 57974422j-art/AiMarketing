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
    // 2026-08-11：landing 独立风格——隐藏全局顶部导航
    const navs = document.querySelectorAll('nav')
    navs.forEach(n => { (n as HTMLElement).style.display = 'none' })
    return () => { navs.forEach(n => { (n as HTMLElement).style.display = '' }) }
  }, [])

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
      <style>{`
        @keyframes landingFloat { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-14px) } }
        .animate-float { animation: landingFloat 4s ease-in-out infinite }
      `}</style>
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
  return (
    <div className="absolute inset-0">
      {SCENES.map((s, i) => {
        // 2026-08-11 v2：全屏场景交叉切换（无 3D 飞行，大小恒定不会黑屏/变形）
        const t = Math.min(1, Math.max(0, progress * SCENES.length - i)) // 本幕进度 0→1
        const fadeIn = Math.min(1, t / 0.22)
        const fadeOut = Math.min(1, (1.18 - t) / 0.18)
        // 2026-08-11：第一幕初始可见（页面加载 progress=0 时 t=0，原逻辑 opacity=0 导致首屏空白）
        const opacity = i === 0 ? Math.max(0.92, fadeIn * fadeOut) : fadeIn * fadeOut
        const activeNow = i === active
        // 受控 3D 飞行感：卡片随 t 从远处放大到近处（幅度小，不会大小失控）
        const flyScale = 0.86 + t * 0.14
        return (
          <div key={i} className="absolute inset-0 flex items-center justify-center" style={{ opacity, pointerEvents: activeNow ? 'auto' : 'none' }}>
            {/* 场景卡：方形框（匹配 1280x1280 图，完整显示不裁剪）+ 框内推进动画 */}
            <div className="relative w-[min(88vw,680px)] aspect-square rounded-3xl overflow-hidden border border-white/20 shadow-2xl"
              style={{ boxShadow: `0 0 120px -20px ${s.glow}`, transform: `scale(${flyScale})`, transition: 'transform 0.2s ease-out' }}>
              <img src={s.image} alt={s.title} className="w-full h-full object-cover"
                style={{ transform: `scale(${1.0 + (activeNow ? 0.14 : 0.0)})`, transition: 'transform 4s ease-out' }} />
              {/* 顶部光晕 + 底部渐变 */}
              <div className="absolute inset-0 pointer-events-none"
                style={{ background: `radial-gradient(circle at 50% 30%, ${s.glow}22, transparent 55%), linear-gradient(to top, rgba(0,0,0,0.55), transparent 40%)` }} />
              {/* 浮动粒子（动态感） */}
              {activeNow && (
                <div className="absolute inset-0 pointer-events-none">
                  {[...Array(14)].map((_, k) => (
                    <span key={k} className="absolute rounded-full bg-white/70 animate-float"
                      style={{
                        left: `${(k * 137) % 100}%`, top: `${(k * 61) % 100}%`,
                        width: 3 + (k % 4), height: 3 + (k % 4),
                        animationDelay: `${(k % 7) * 0.6}s`, animationDuration: `${3 + (k % 5)}s`,
                        boxShadow: `0 0 8px ${s.glow}`,
                      }} />
                  ))}
                </div>
              )}
              {/* 文字叠加（底部） */}
              <div className="absolute inset-x-0 bottom-0 p-6 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="text-2xl sm:text-3xl drop-shadow">{s.icon}</span>
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight drop-shadow">{s.title}</h2>
                </div>
                <p className="text-xs sm:text-sm mb-1.5 font-medium drop-shadow" style={{ color: `${s.glow}` }}>{s.sub}</p>
                <p className="text-[11px] sm:text-sm text-white/90 max-w-md mx-auto leading-relaxed drop-shadow hidden sm:block">{s.desc}</p>
                <div className="mt-3 flex justify-center gap-1.5">
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
