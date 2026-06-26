'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface Plan {
  id: number; name: string; description: string | null
  price: number; discountPrice: number | null
  durationMonths: number
  text2imgQuota: number; text2videoQuota: number
  digitalHumanMin: number; liveStreamMin: number; storageMb: number
  status: string
}
interface MyUsage { month: string; llmTokens: number; text2img: number; text2video: number }

const fmtYuan = (f: number) => '¥' + (f / 100).toFixed(0)
const fmtPrice = (p: Plan) => p.discountPrice ? `¥${(p.discountPrice / 100).toFixed(0)}/月` : `¥${(p.price / 100).toFixed(0)}/月`

export default function MySubscriptionPage() {
  const { user } = useAuth()
  const [plans, setPlans] = useState<Plan[]>([])
  const [usage, setUsage] = useState<MyUsage | null>(null)
  const [myPlan, setMyPlan] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState(false)

  useEffect(() => { loadData() }, [user])

  const loadData = async () => {
    setLoading(true)
    try {
      const [pr, ur] = await Promise.all([
        fetch('/api/admin/subscription-plans').then(r => r.json()),
        fetch('/api/subscription/my-usage').then(r => r.json()),
      ])
      if (pr.success) setPlans(pr.data)
      if (ur.success) { setUsage(ur.data.usage); setMyPlan(ur.data.subscription) }
    } catch {}
    setLoading(false)
  }

  const buyPlan = async (planId: number) => {
    if (!user?.id) { showToast('请先登录', 'error'); return }
    setBuying(true)
    try {
      const r = await fetch('/api/subscription/buy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, planId }),
      })
      const d = await r.json()
      if (d.success) { showToast('🎉 订阅成功！', 'success'); loadData() }
      else showToast(d.message, 'error')
    } catch { showToast('购买失败', 'error') }
    setBuying(false)
  }

  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400 text-sm">加载中...</div>

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <p className="text-label mb-1">个人中心 / 我的套餐</p>
          <h1 className="text-mono-lg text-white">💳 我的套餐</h1>
        </div>

        {/* 当前套餐 */}
        <div className="card-glass p-4 mb-6">
          <h3 className="text-xs text-gray-400 mb-2">📌 当前订阅</h3>
          {myPlan ? (
            <div className="flex items-center gap-3">
              <span className="text-lg">{myPlan.plan?.name || '—'}</span>
              <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">{myPlan.status === 'active' ? '生效中' : myPlan.status}</span>
              <span className="text-xs text-gray-500">到期: {new Date(myPlan.endDate).toLocaleDateString()}</span>
            </div>
          ) : (
            <p className="text-sm text-gray-500">尚未订阅任何套餐，请选择下方套餐开通</p>
          )}
        </div>

        {/* 用量 */}
        {usage && (
          <div className="card-glass p-4 mb-6">
            <h3 className="text-xs text-gray-400 mb-3">📊 本月用量 ({usage.month})</h3>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'LLM Token', value: usage.llmTokens.toLocaleString() },
                { label: '文生图', value: usage.text2img + '次' },
                { label: '文生视频', value: usage.text2video + '次' },
              ].map(i => (
                <div key={i.label} className="bg-white/5 rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-gray-500">{i.label}</p>
                  <p className="text-sm text-white font-mono mt-0.5">{i.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 套餐选择 */}
        <h3 className="text-sm text-white mb-3">🎁 选择套餐</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.filter(p => p.status === 'active').map(p => (
            <div key={p.id} className={`card-glass p-5 border-2 rounded-xl text-center ${myPlan?.planId === p.id ? 'border-emerald-400' : 'border-white/10 hover:border-blue-400/30'}`}>
              <p className="text-lg font-bold text-white mb-1">{p.name}</p>
              <p className="text-xs text-gray-500 mb-3">{p.description || `${p.durationMonths}个月`}</p>
              <div className="mb-3">
                {p.discountPrice ? (
                  <>
                    <span className="text-2xl font-bold text-emerald-400">{fmtYuan(p.discountPrice)}</span>
                    <span className="text-xs text-gray-600 line-through ml-1">{fmtYuan(p.price)}</span>
                  </>
                ) : (
                  <span className="text-2xl font-bold text-white">{fmtYuan(p.price)}</span>
                )}
              </div>
              <div className="text-[10px] text-gray-500 space-y-1 mb-4">
                <p>🖼 文生图 {p.text2imgQuota === -1 ? '无限' : p.text2imgQuota + '次'}</p>
                <p>🎬 文生视频 {p.text2videoQuota === -1 ? '无限' : p.text2videoQuota + '次'}</p>
                <p>💾 存储 {p.storageMb >= 1024 ? (p.storageMb/1024).toFixed(1)+'GB' : p.storageMb+'MB'}</p>
              </div>
              <button onClick={() => buyPlan(p.id)} disabled={buying}
                className={`w-full py-2 rounded-lg text-xs font-bold transition ${myPlan?.planId === p.id ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-blue-500 text-white hover:bg-blue-600'}`}>
                {myPlan?.planId === p.id ? '✓ 当前方案' : buying ? '购买中...' : '立即订阅'}
              </button>
            </div>
          ))}
        </div>
        {plans.length === 0 && <p className="text-gray-500 text-sm text-center py-8">暂无可用套餐，请联系管理员</p>}
      </div>
    </div>
  )
}
