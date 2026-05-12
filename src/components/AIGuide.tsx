'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'

type Step = 0 | 1 | 2 | 3 | 4

const INDUSTRIES = [
  { id: 'tea', label: '茶叶', icon: '🍵', desc: '茶文化推广与销售' },
  { id: 'fashion', label: '服装', icon: '👗', desc: '时尚穿搭与品牌' },
  { id: 'food', label: '餐饮', icon: '🍜', desc: '美食探店与外卖' },
  { id: 'beauty', label: '美妆', icon: '💄', desc: '美妆护肤教程' },
  { id: 'edu', label: '教育', icon: '📚', desc: '知识付费与培训' },
  { id: 'home', label: '家居', icon: '🏠', desc: '家居生活与装修' },
  { id: 'tech', label: '数码', icon: '📱', desc: '科技数码评测' },
  { id: 'other', label: '其他', icon: '🔧', desc: '更多行业' },
]

const GOALS = [
  { id: 'short_video', label: '短视频推广', icon: '🎬', desc: '通过短视频展示产品' },
  { id: 'live', label: '直播引流', icon: '🔴', desc: '直播带货与互动' },
  { id: 'private', label: '私域转化', icon: '💬', desc: '导流到社群/私域' },
  { id: 'brand', label: '品牌宣传', icon: '🌟', desc: '打造品牌知名度' },
]

const PLATFORMS = [
  { id: 'douyin', label: '抖音', icon: '🎵', desc: '日活 8 亿+，泛娱乐流量池' },
  { id: 'xiaohongshu', label: '小红书', icon: '📕', desc: '高净值女性用户，种草社区' },
  { id: 'kuaishou', label: '快手', icon: '📷', desc: '下沉市场，老铁经济' },
  { id: 'shipinhao', label: '视频号', icon: '💚', desc: '微信生态，社交裂变' },
]

const STEP_LABELS: Record<Step, string> = {
  0: '',
  1: '选择行业',
  2: '营销目标',
  3: '策略预览',
  4: '发布平台',
}

const DAILY_LIMIT_KEY = 'ai_guide_daily_count'
const DAILY_LIMIT_MAX = 5

export default function AIGuide() {
  const { user, isLoggedIn, loading } = useAuth()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>(1)
  const [industry, setIndustry] = useState('')
  const [goals, setGoals] = useState<string[]>([])
  const [strategy, setStrategy] = useState('')
  const [platforms, setPlatforms] = useState<string[]>([])
  const [loadingStrategy, setLoadingStrategy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(false)
  const [dailyUsed, setDailyUsed] = useState(0)
  const [toast, setToast] = useState('')

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t) } }, [toast])

  // 自动弹出逻辑（同之前）
  useEffect(() => {
    if (loading) return
    const dismissed = localStorage.getItem('ai_guide_dismissed')
    if (dismissed === new Date().toDateString()) return
    const welcomed = localStorage.getItem('ai_guide_welcomed')
    if (isLoggedIn && user) {
      fetch('/api/ai-copy', { credentials: 'include' })
        .then(r => r.json()).catch(() => ({ data: [] }))
        .then((d: any) => {
          const hasData = Array.isArray(d.data) ? d.data.length > 0 : Array.isArray(d) ? d.length > 0 : false
          if (!hasData && !welcomed) {
            setTimeout(() => { setOpen(true); localStorage.setItem('ai_guide_welcomed', '1') }, 1500)
          }
        })
    } else if (!welcomed) {
      setTimeout(() => { setOpen(true); localStorage.setItem('ai_guide_welcomed', '1') }, 2000)
    }
  }, [loading, isLoggedIn, user])

  // 每日使用次数
  useEffect(() => {
    const raw = localStorage.getItem(DAILY_LIMIT_KEY)
    const saved = raw ? JSON.parse(raw) : {}
    if (saved.date === new Date().toDateString()) {
      setDailyUsed(saved.count || 0)
    } else {
      setDailyUsed(0)
    }
  }, [])

  const incrementDaily = useCallback(() => {
    const newCount = dailyUsed + 1
    setDailyUsed(newCount)
    localStorage.setItem(DAILY_LIMIT_KEY, JSON.stringify({ date: new Date().toDateString(), count: newCount }))
  }, [dailyUsed])

  // 关闭
  const handleClose = useCallback(() => {
    setOpen(false)
    localStorage.setItem('ai_guide_dismissed', new Date().toDateString())
    setTimeout(() => {
      setStep(1)
      setIndustry('')
      setGoals([])
      setStrategy('')
      setPlatforms([])
      setCreated(false)
    }, 300)
  }, [])

  // 步骤 1→2
  const nextToGoals = () => {
    if (!industry) { setToast('请选择一个行业'); return }
    setStep(2)
  }

  // 步骤 2→3（生成策略）
  const generateStrategy = async () => {
    if (goals.length === 0) { setToast('请至少选择一个营销目标'); return }

    // 未登录用户检查每日限额
    if (!isLoggedIn && dailyUsed >= DAILY_LIMIT_MAX) {
      setToast(`今日免费次数已达上限 (${DAILY_LIMIT_MAX} 次)`)
      return
    }

    setLoadingStrategy(true)
    setStep(3)

    // 用行业中文标签
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
      if (!isLoggedIn) incrementDaily()
    } catch {
      setStrategy('网络错误，请重试')
    } finally {
      setLoadingStrategy(false)
    }
  }

  // 步骤 4 → 创建项目
  const handleCreateProject = async () => {
    if (platforms.length === 0) { setToast('请至少选择一个发布平台'); return }
    if (!isLoggedIn) { setToast('请先登录再创建项目'); return }

    setCreating(true)
    const indLabel = INDUSTRIES.find(i => i.id === industry)?.label || industry
    const goalLabels = GOALS.filter(g => goals.includes(g.id)).map(g => g.label)
    const platformLabels = PLATFORMS.filter(p => platforms.includes(p.id)).map(p => p.label)

    try {
      const res = await fetch('/api/projects/create-with-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: `${indLabel}营销方案`,
          description: strategy,
          industry: indLabel,
          goals: goalLabels,
          platforms: platformLabels,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setCreated(true)
        setToast('🎉 项目创建成功！')
      } else {
        setToast(data.message || '创建失败')
      }
    } catch {
      setToast('网络错误，请重试')
    } finally {
      setCreating(false)
    }
  }

  const toggleGoal = (id: string) => {
    setGoals(prev => prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id])
  }

  const togglePlatform = (id: string) => {
    setPlatforms(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])
  }

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[100] bg-gray-900 border border-gray-700 text-white px-4 py-3 rounded-xl shadow-2xl font-mono text-sm max-w-sm">
          {toast}
        </div>
      )}

      {/* 浮窗按钮 */}
      <button
        onClick={() => { setOpen(v => !v); if (!v) { setStep(1); setIndustry(''); setGoals([]); setStrategy(''); setPlatforms([]); setCreated(false) } }}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 text-white shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
        title="AI 引导助手"
      >
        {open ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        )}
      </button>

      {/* 全屏引导遮罩 */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-12 pb-6 overflow-y-auto">
          <div className="w-full max-w-4xl mx-4 bg-gray-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            {/* 头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-white text-sm font-bold">AI</div>
                <div>
                  <div className="text-white font-semibold text-sm">AI 营销引导</div>
                  <div className="text-[10px] text-gray-500 font-mono">快速搭建你的营销方案</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {/* 步骤指示器 */}
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4].map(s => (
                    <div key={s} className={`w-6 h-1 rounded-full transition-colors ${step >= s ? 'bg-emerald-500' : 'bg-white/10'}`} />
                  ))}
                </div>
                <button onClick={handleClose} className="text-gray-500 hover:text-white transition-colors p-1">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* 内容区 */}
            <div className="p-6">
              {/* 步骤标题 */}
              <div className="mb-5">
                <span className="text-[10px] text-emerald-400 font-mono">STEP {step}/4</span>
                <h2 className="text-lg font-bold text-white mt-0.5">{STEP_LABELS[step]}</h2>
              </div>

              {/* ===== 步骤 1: 行业选择 ===== */}
              {step === 1 && (
                <div>
                  <p className="text-sm text-gray-400 mb-4">你从事哪个行业？</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {INDUSTRIES.map(ind => (
                      <button
                        key={ind.id}
                        onClick={() => setIndustry(ind.id)}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${
                          industry === ind.id
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-white/10 bg-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className="text-2xl mb-2">{ind.icon}</div>
                        <div className="text-sm font-bold text-white">{ind.label}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">{ind.desc}</div>
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-end mt-6">
                    <button onClick={nextToGoals} className="px-6 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-medium transition-colors text-sm">
                      下一步
                    </button>
                  </div>
                </div>
              )}

              {/* ===== 步骤 2: 营销目标 ===== */}
              {step === 2 && (
                <div>
                  <p className="text-sm text-gray-400 mb-4">你的营销目标是什么？（可多选）</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {GOALS.map(g => (
                      <button
                        key={g.id}
                        onClick={() => toggleGoal(g.id)}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${
                          goals.includes(g.id)
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-white/10 bg-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="text-2xl">{g.icon}</div>
                          <div>
                            <div className="text-sm font-bold text-white">{g.label}</div>
                            <div className="text-[10px] text-gray-500">{g.desc}</div>
                          </div>
                          <div className={`ml-auto w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                            goals.includes(g.id) ? 'bg-emerald-500 border-emerald-500' : 'border-white/20'
                          }`}>
                            {goals.includes(g.id) && (
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between mt-6">
                    <button onClick={() => setStep(1)} className="px-4 py-2.5 text-gray-400 hover:text-white transition-colors text-sm">上一步</button>
                    <button onClick={generateStrategy} className="px-6 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-medium transition-colors text-sm">
                      AI 生成策略
                    </button>
                  </div>
                </div>
              )}

              {/* ===== 步骤 3: 策略预览 ===== */}
              {step === 3 && (
                <div>
                  {loadingStrategy ? (
                    <div className="flex flex-col items-center justify-center py-16">
                      <svg className="w-10 h-10 animate-spin text-emerald-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      <p className="text-gray-400 text-sm">AI 正在为你生成策略...</p>
                      <p className="text-gray-600 text-xs mt-1">根据你的行业和目标智能分析</p>
                    </div>
                  ) : (
                    <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                      <div
                        className="prose prose-invert prose-sm max-w-none text-gray-200 leading-relaxed whitespace-pre-wrap"
                        dangerouslySetInnerHTML={{
                          __html: strategy
                            .replace(/\n/g, '<br>')
                            .replace(/## (.+)/g, '<h3 class="text-emerald-400 text-sm font-bold mt-4 mb-2">$1</h3>')
                            .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
                            .replace(/- (.+)/g, '• $1<br>')
                            .replace(/\d\.\s(.+)/g, '<span class="block ml-2">• $1</span>'),
                        }}
                      />
                    </div>
                  )}
                  {!loadingStrategy && (
                    <div className="flex justify-between mt-6">
                      <button onClick={() => setStep(2)} className="px-4 py-2.5 text-gray-400 hover:text-white transition-colors text-sm">上一步</button>
                      <button onClick={() => setStep(4)} className="px-6 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-medium transition-colors text-sm">
                        下一步 — 选择平台
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ===== 步骤 4: 发布平台 ===== */}
              {step === 4 && (
                <div>
                  <p className="text-sm text-gray-400 mb-4">你计划在哪些平台发布内容？（可多选）</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {PLATFORMS.map(p => (
                      <button
                        key={p.id}
                        onClick={() => togglePlatform(p.id)}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${
                          platforms.includes(p.id)
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-white/10 bg-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="text-2xl">{p.icon}</div>
                          <div>
                            <div className="text-sm font-bold text-white">{p.label}</div>
                            <div className="text-[10px] text-gray-500">{p.desc}</div>
                          </div>
                          <div className={`ml-auto w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                            platforms.includes(p.id) ? 'bg-emerald-500 border-emerald-500' : 'border-white/20'
                          }`}>
                            {platforms.includes(p.id) && (
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-6 p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/20">
                    <p className="text-xs text-gray-400 font-mono">项目名称将自动生成为：<span className="text-emerald-400">{INDUSTRIES.find(i => i.id === industry)?.label || ''}营销方案</span></p>
                  </div>

                  {created ? (
                    <div className="mt-4 p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-center">
                      <div className="text-2xl mb-1">🎉</div>
                      <p className="text-emerald-400 font-bold text-sm">项目创建成功！</p>
                      <p className="text-xs text-gray-400 mt-1">现在可以开始使用 AI 工具创作内容了</p>
                      <button onClick={handleClose} className="mt-3 px-6 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 text-sm">
                        开始使用
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-between mt-6">
                      <button onClick={() => setStep(3)} className="px-4 py-2.5 text-gray-400 hover:text-white transition-colors text-sm">上一步</button>
                      <button
                        onClick={handleCreateProject}
                        disabled={creating || !isLoggedIn}
                        className="px-6 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-colors text-sm"
                      >
                        {creating ? '创建中...' : `一键创建项目 (${platforms.length} 平台)`}
                      </button>
                    </div>
                  )}

                  {!isLoggedIn && !created && (
                    <div className="mt-3 text-center">
                      <p className="text-xs text-gray-500">请先登录以创建项目</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 底部 */}
            <div className="px-6 py-3 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
              <span className="text-[10px] text-gray-600 font-mono">
                {step}/4 · {!isLoggedIn && `未登录 (今日剩余 ${DAILY_LIMIT_MAX - dailyUsed} 次) `}
                {isLoggedIn && '已登录'}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
