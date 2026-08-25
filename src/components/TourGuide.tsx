'use client'
import { useEffect, useState } from 'react'

// 2026-08-22: 引导二 v2——全自动演示（不真执行），每步 5 秒自动进下一个
// 读取 sessionStorage 'tour-step'（1-5）；无则返回 null（正常页面）
const TOUR_STEPS = [
  { step: 1, name: '📦 素材库', path: '/storage', desc: '这是你的个人仓库：上传视频/图片，AI 成片和发布都用这里的素材。' },
  { step: 2, name: '🎞 一键成片', path: '/auto-compile', desc: '选素材或 5 张演示图 → 免费模式 → 自动配音字幕 BGM。看右上角「一键合成」按钮，点了就出片。' },
  { step: 3, name: '🖼 AI 生图', path: '/image-generator', desc: '输入描述或选演示图 → 点「生成」出海报（12 点/张）。' },
  { step: 4, name: '🎬 AI 视频', path: '/text-to-video', desc: '一句话描述 → 点「生成」出视频（按秒计费）。' },
  { step: 5, name: '🌐 发布通道', path: '/', desc: '最后一步：点左侧「🌐 浏览器账号」→「＋打开浏览器登记」→ 在打开的浏览器登录你要发布的平台（抖音/小红书/微博…）。登录一次长期有效。' },
]

export default function TourGuide() {
  const [step, setStep] = useState<number | null>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    const s = parseInt(sessionStorage.getItem('tour-step') || '0')
    if (s >= 1 && s <= 5) { setStep(s); setShow(true) }
  }, [])

  // 语音解说：每步播报说明（浏览器 SpeechSynthesis 中文；用户点过「开始体验」满足自动播放策略）
  useEffect(() => {
    if (!show || step === null) return
    const cur = TOUR_STEPS.find(t => t.step === step)!
    const say = () => {
      try {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(cur.desc.replace(/[【】（）()·]/g, ''))
        u.lang = 'zh-CN'; u.rate = 1.02
        const voices = window.speechSynthesis.getVoices()
        const zh = voices.find(v => v.lang && v.lang.startsWith('zh'))
        if (zh) u.voice = zh
        window.speechSynthesis.speak(u)
      } catch {}
    }
    const t = setTimeout(say, 1400)  // 切换页面后读（等页面加载完成）
    return () => { clearTimeout(t); try { window.speechSynthesis.cancel() } catch {} }
  }, [show, step])

  useEffect(() => {
    if (!show || step === null) return
    const timer = setTimeout(() => {
      if (step < 5) {
        sessionStorage.setItem('tour-step', String(step + 1))
        window.location.href = TOUR_STEPS[step].path
      } else {
        sessionStorage.removeItem('tour-step')
        window.location.href = '/'
      }
    }, 15000)  // 2026-08-23: 每页 15 秒（用户要求节奏放慢），语音播完停留展示
    return () => clearTimeout(timer)
  }, [show, step])

  if (!show || step === null) return null
  const cur = TOUR_STEPS.find(t => t.step === step)!

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] w-[420px] max-w-[92vw] rounded-2xl border border-amber-500/40 bg-[#0d0d14]/95 backdrop-blur-xl shadow-2xl p-4 pointer-events-none">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-amber-300">{cur.name}</span>
        <span className="text-[9px] text-gray-500">引导 {step}/5 · 15 秒后自动下一步</span>
      </div>
      <p className="text-[11px] text-gray-200 leading-relaxed mb-3">{cur.desc}</p>
      <div className="flex gap-1">
        {TOUR_STEPS.map(t => (
          <div key={t.step} className={`h-1 flex-1 rounded-full ${t.step <= step ? 'bg-amber-400/70' : 'bg-white/10'}`} />
        ))}
      </div>
    </div>
  )
}
