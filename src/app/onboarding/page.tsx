'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Step = 1 | 2 | 3 | 4

const INDUSTRIES = [
  { id: 'tea', label: '茶叶', icon: '🍵', desc: '茶文化推广与销售', img: 'https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?w=400&h=300&fit=crop' },
  { id: 'fashion', label: '服装', icon: '👗', desc: '时尚穿搭与品牌', img: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=400&h=300&fit=crop' },
  { id: 'food', label: '餐饮', icon: '🍜', desc: '美食探店与外卖', img: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=300&fit=crop' },
  { id: 'beauty', label: '美妆', icon: '💄', desc: '美妆护肤教程', img: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=300&fit=crop' },
  { id: 'edu', label: '教育', icon: '📚', desc: '知识付费与培训', img: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=400&h=300&fit=crop' },
  { id: 'home', label: '家居', icon: '🏠', desc: '家居生活与装修', img: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=400&h=300&fit=crop' },
  { id: 'tech', label: '数码', icon: '📱', desc: '科技数码评测', img: 'https://images.unsplash.com/photo-1468495244123-6c6c332eeece?w=400&h=300&fit=crop' },
  { id: 'other', label: '其他', icon: '🔧', desc: '更多行业', img: 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=400&h=300&fit=crop' },
]

const GOALS = [
  { id: 'short_video', label: '短视频推广', icon: '🎬', desc: '通过创意短视频展示产品卖点与使用场景', img: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=400&h=300&fit=crop' },
  { id: 'live', label: '直播引流', icon: '🔴', desc: '实时直播互动带货与粉丝粘性培养', img: 'https://images.unsplash.com/photo-1598387993441-a364f854c3e1?w=400&h=300&fit=crop' },
  { id: 'private', label: '私域转化', icon: '💬', desc: '将公域流量导入私域社群深度运营', img: 'https://images.unsplash.com/photo-1556155092-490a1ba16284?w=400&h=300&fit=crop' },
  { id: 'brand', label: '品牌宣传', icon: '🌟', desc: '打造品牌IP形象提升知名度与信任感', img: 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=400&h=300&fit=crop' },
]

const PLATFORMS = [
  { id: 'douyin', label: '抖音', icon: '🎵', desc: '日活 8 亿+，泛娱乐流量池，算法推荐强', img: 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=400&h=300&fit=crop' },
  { id: 'xiaohongshu', label: '小红书', icon: '📕', desc: '高净值女性用户，种草社区，搜索流量稳定', img: 'https://images.unsplash.com/photo-1522771739017-7d3e7e1b0e8a?w=400&h=300&fit=crop' },
  { id: 'kuaishou', label: '快手', icon: '📷', desc: '下沉市场用户，老铁经济，社交信任度高', img: 'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=400&h=300&fit=crop' },
  { id: 'shipinhao', label: '视频号', icon: '💚', desc: '微信生态内循环，社交裂变，私域无缝衔接', img: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&h=300&fit=crop' },
]

const STEP_TITLES: Record<Step, string> = { 1: '你从事哪个行业？', 2: '你的营销目标是什么？', 3: 'AI 为你生成的策略', 4: '你计划在哪些平台发布？' }
const STEP_SUBTITLES: Record<Step, string> = { 1: '选择你的行业，我们将为你定制营销方案', 2: '可多选，我们将根据目标推荐内容方向', 3: '基于你的选择，AI 智能生成的专属策略', 4: '选择目标平台，创建你的专属项目' }

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [industry, setIndustry] = useState('')
  const [goals, setGoals] = useState<string[]>([])
  const [platforms, setPlatforms] = useState<string[]>([])
  const [strategy, setStrategy] = useState('')
  const [loadingStrategy, setLoadingStrategy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showRegister, setShowRegister] = useState(false)

  const nextStep = () => { if (step < 4) setStep((step + 1) as Step) }
  const prevStep = () => { if (step > 1) setStep((step - 1) as Step) }

  const toggleGoal = (id: string) => setGoals(p => p.includes(id) ? p.filter(g => g !== id) : [...p, id])
  const togglePlatform = (id: string) => setPlatforms(p => p.includes(id) ? p.filter(pl => pl !== id) : [...p, id])

  // 步骤1 → 2 检查
  const handleIndustryNext = () => {
    if (!industry) return
    nextStep()
  }

  // 步骤2 → 3 生成策略
  const handleGoalNext = async () => {
    if (goals.length === 0) return
    setLoadingStrategy(true)
    nextStep()

    const indLabel = INDUSTRIES.find(i => i.id === industry)?.label || industry
    const goalLabels = GOALS.filter(g => goals.includes(g.id)).map(g => g.label)

    try {
      const res = await fetch('/api/ai-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-strategy', industry: indLabel, goals: goalLabels }),
      })
      const data = await res.json()
      setStrategy(data.strategy || '策略生成失败，请重试')
    } catch {
      setStrategy('网络错误，请稍后重试')
    } finally {
      setLoadingStrategy(false)
    }
  }

  // 步骤4 → 创建 / 注册提示
  const handleFinish = async () => {
    if (platforms.length === 0) return
    try {
      const authRes = await fetch('/api/auth/login', { credentials: 'include' })
      const authData = await authRes.json()
      if (!authData.authenticated) {
        setShowRegister(true)
        return
      }
    } catch {
      setShowRegister(true)
      return
    }

    setCreating(true)
    try {
      const indLabel = INDUSTRIES.find(i => i.id === industry)?.label || industry
      const goalLabels = GOALS.filter(g => goals.includes(g.id)).map(g => g.label)
      const platformLabels = PLATFORMS.filter(p => platforms.includes(p.id)).map(p => p.label)

      const res = await fetch('/api/projects/create-with-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: `${indLabel}营销方案`, description: strategy, industry: indLabel, goals: goalLabels, platforms: platformLabels }),
      })
      const data = await res.json()
      if (data.success) {
        router.push('/dashboard')
      }
    } catch {}
    setCreating(false)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* 顶部导航 */}
      <header className="border-b border-white/10 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-white text-sm font-bold">AI</div>
            <span className="text-white font-semibold text-sm">AI 营销引导</span>
          </div>
          <div className="flex items-center gap-4">
            {/* 步骤指示器 */}
            <div className="flex gap-1.5">
              {([1, 2, 3, 4] as Step[]).map(s => (
                <div key={s} className="flex items-center gap-1">
                  <div className={`w-8 h-1 rounded-full transition-all ${step >= s ? 'bg-emerald-500' : 'bg-white/10'}`} />
                </div>
              ))}
            </div>
            <span className="text-[10px] text-gray-600 font-mono w-8 text-right">{step}/4</span>
            <button onClick={() => router.push('/')} className="text-gray-500 hover:text-white transition-colors text-sm">跳过</button>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="flex-1 flex flex-col">
        <div className="max-w-6xl mx-auto w-full px-6 py-8 flex-1 flex flex-col">
          {/* 步骤标题 */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white">{STEP_TITLES[step]}</h1>
            <p className="text-sm text-gray-500 mt-1">{STEP_SUBTITLES[step]}</p>
          </div>

          {/* ===== 步骤 1: 行业 ===== */}
          {step === 1 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1">
              {INDUSTRIES.map(ind => (
                <button key={ind.id} onClick={() => setIndustry(ind.id)}
                  className={`group relative rounded-2xl overflow-hidden border-2 transition-all ${
                    industry === ind.id ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="aspect-[4/3] bg-gray-800">
                    <img src={ind.img} alt={ind.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{ind.icon}</span>
                      <span className="text-white font-bold text-sm">{ind.label}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">{ind.desc}</p>
                  </div>
                  {industry === ind.id && (
                    <div className="absolute top-2 right-2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* ===== 步骤 2: 目标 ===== */}
          {step === 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
              {GOALS.map(g => (
                <button key={g.id} onClick={() => toggleGoal(g.id)}
                  className={`group relative rounded-2xl overflow-hidden border-2 transition-all ${
                    goals.includes(g.id) ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="aspect-[16/6] bg-gray-800">
                    <img src={g.img} alt={g.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{g.icon}</span>
                        <div>
                          <span className="text-white font-bold text-sm">{g.label}</span>
                          <p className="text-[10px] text-gray-400">{g.desc}</p>
                        </div>
                      </div>
                      <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all shrink-0 ${
                        goals.includes(g.id) ? 'bg-emerald-500 border-emerald-500' : 'border-white/30'
                      }`}>
                        {goals.includes(g.id) && <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ===== 步骤 3: 策略 ===== */}
          {step === 3 && (
            <div className="flex-1">
              {loadingStrategy ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <svg className="w-12 h-12 animate-spin text-emerald-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  <p className="text-gray-300 text-lg font-medium">AI 正在为你生成策略...</p>
                  <p className="text-gray-600 text-sm mt-2">正在分析你的行业和目标，定制专属方案</p>
                </div>
              ) : (
                <div className="bg-white/5 rounded-2xl border border-white/10 p-8 max-w-3xl mx-auto">
                  <div className="prose prose-invert prose-sm max-w-none text-gray-200 leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: strategy
                        .replace(/\n/g, '<br>')
                        .replace(/## (.+)/g, '<h3 class="text-emerald-400 text-base font-bold mt-6 mb-3">$1</h3>')
                        .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
                        .replace(/• (.+)/g, '<span class="block ml-2 text-gray-300">• $1</span>'),
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* ===== 步骤 4: 平台 ===== */}
          {step === 4 && (
            <div className="flex-1">
              {showRegister ? (
                <div className="max-w-md mx-auto mt-12 text-center">
                  <div className="text-5xl mb-4">🚀</div>
                  <h2 className="text-xl font-bold text-white mb-2">注册即可创建项目</h2>
                  <p className="text-gray-400 text-sm mb-6">注册后所有功能均可免费体验</p>
                  <button onClick={() => router.push('/register')} className="w-full px-6 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-medium text-sm mb-3">
                    免费注册
                  </button>
                  <button onClick={() => router.push('/login')} className="w-full px-6 py-3 bg-white/5 text-gray-300 rounded-xl hover:bg-white/10 text-sm border border-white/10">
                    已有账号？登录
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {PLATFORMS.map(p => (
                    <button key={p.id} onClick={() => togglePlatform(p.id)}
                      className={`group relative rounded-2xl overflow-hidden border-2 transition-all ${
                        platforms.includes(p.id) ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="aspect-[16/6] bg-gray-800">
                        <img src={p.img} alt={p.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{p.icon}</span>
                            <div>
                              <span className="text-white font-bold text-sm">{p.label}</span>
                              <p className="text-[10px] text-gray-400">{p.desc}</p>
                            </div>
                          </div>
                          <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all shrink-0 ${
                            platforms.includes(p.id) ? 'bg-emerald-500 border-emerald-500' : 'border-white/30'
                          }`}>
                            {platforms.includes(p.id) && <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="border-t border-white/10 bg-gray-950">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <div>
              {step > 1 && (
                <button onClick={prevStep} className="px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm">
                  上一步
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {step === 1 && (
                <button onClick={handleIndustryNext} disabled={!industry}
                  className="px-8 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-colors text-sm"
                >
                  下一步
                </button>
              )}
              {step === 2 && (
                <button onClick={handleGoalNext} disabled={goals.length === 0}
                  className="px-8 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-colors text-sm"
                >
                  AI 生成策略
                </button>
              )}
              {step === 3 && !loadingStrategy && (
                <button onClick={nextStep}
                  className="px-8 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-medium transition-colors text-sm"
                >
                  下一步 — 选择平台
                </button>
              )}
              {step === 4 && !showRegister && (
                <button onClick={handleFinish} disabled={platforms.length === 0 || creating}
                  className="px-8 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-colors text-sm"
                >
                  {creating ? '创建中...' : `完成并创建项目 (${platforms.length})`}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
