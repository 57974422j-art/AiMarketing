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
interface Wallet { hasSubscription: boolean; planName: string | null; allowance: number; spent: number; remaining: number }

const fmtYuan = (f: number) => '¥' + (f / 100).toFixed(0)
const FREE_TRIAL_TOKENS = 500
/** 套餐月度 TOKEN 额度（1 TOKEN = ¥0.01，按实付价折算；0元套餐=固定试用额度） */
const planTokens = (p: Plan) => {
  const effective = p.discountPrice ?? p.price
  if (effective <= 0) return FREE_TRIAL_TOKENS
  return Math.round(effective / Math.max(1, p.durationMonths || 1))
}
const isFreePlan = (p: Plan) => (p.discountPrice ?? p.price) <= 0

export default function MySubscriptionPage() {
  const { user } = useAuth()
  const [plans, setPlans] = useState<Plan[]>([])
  const [usage, setUsage] = useState<MyUsage | null>(null)
  const [myPlan, setMyPlan] = useState<any>(null)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState(false)

  useEffect(() => { loadData() }, [user])
  useEffect(() => {
    const on = new URLSearchParams(window.location.search).get('out_trade_no')
    if (on) pollOrder(on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      // 先确保免费周卡套餐已种下（GET 自动创建），再拉套餐列表
      await fetch('/api/subscription/claim-weekly', { credentials: 'include' }).catch(() => {})
      const [pr, ur] = await Promise.all([
        fetch('/api/admin/subscription-plans').then(r => r.json()),
        fetch('/api/subscription/my-usage').then(r => r.json()),
      ])
      if (pr.success) setPlans(pr.data)
      if (ur.success) { setUsage(ur.data.usage); setMyPlan(ur.data.subscription); setWallet(ur.data.wallet || null) }
    } catch {}
    setLoading(false)
  }

  // 免费周卡领取（每账号一次）
  const claimWeekly = async () => {
    if (!user?.id) { showToast('请先登录', 'error'); return }
    setBuying(true)
    try {
      const r = await fetch('/api/subscription/claim-weekly', { method: 'POST', credentials: 'include' })
      const d = await r.json()
      if (d.success) { showToast(d.message || '🎉 领取成功！', 'success'); loadData() }
      else showToast(d.message || '领取失败', 'error')
    } catch { showToast('领取失败', 'error') }
    setBuying(false)
  }

  const buyPlan = async (planId: number) => {
    if (!user?.id) { showToast('请先登录', 'error'); return }
    setBuying(true)
    try {
      const r = await fetch('/api/subscription/checkout', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, channel: 'alipay' }),
      })
      const d = await r.json()
      if (d.success && d.data?.payUrl) {
        // 跳转支付宝收银台，支付完成后由 return_url 跳回本页
        window.location.href = d.data.payUrl
        return
      }
      showToast(d.message || '发起支付失败', 'error')
    } catch { showToast('发起支付失败', 'error') }
    setBuying(false)
  }

  // 支付宝回跳后（return_url 带 out_trade_no），轮询订单状态确认开通
  const pollOrder = async (orderNo: string) => {
    for (let i = 0; i < 6; i++) {
      await new Promise(res => setTimeout(res, 1500))
      try {
        const r = await fetch(`/api/subscription/order/${orderNo}`, { credentials: 'include' })
        const d = await r.json()
        if (d.success && d.data.status === 'paid') {
          showToast('🎉 订阅成功！', 'success')
          loadData()
          return
        }
      } catch {}
    }
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
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-lg">{myPlan.plan?.name || '—'}</span>
              <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">{myPlan.status === 'active' ? '生效中' : myPlan.status}</span>
              <span className="text-xs text-gray-500">到期: {new Date(myPlan.endDate).toLocaleDateString()}</span>
            </div>
          ) : (
            <p className="text-sm text-gray-500">尚未订阅任何套餐，请选择下方套餐开通</p>
          )}
        </div>

        {/* TOKEN 余额 */}
        {wallet && wallet.hasSubscription && (
          <div className="card-glass p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs text-gray-400">🪙 本月 TOKEN 额度</h3>
              <span className="text-[10px] text-gray-600">1 TOKEN ≈ ¥0.01（按国内阿里成本估算）</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-2">
              {[
                { label: '总额度', value: wallet.allowance.toLocaleString(), color: 'text-white' },
                { label: '已消耗', value: wallet.spent.toLocaleString(), color: 'text-amber-400' },
                { label: '剩余', value: wallet.remaining.toLocaleString(), color: 'text-emerald-400' },
              ].map(i => (
                <div key={i.label} className="bg-white/5 rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-gray-500">{i.label}</p>
                  <p className={`text-sm font-mono mt-0.5 ${i.color}`}>{i.value}</p>
                </div>
              ))}
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full transition-all"
                style={{ width: `${wallet.allowance > 0 ? Math.min(100, (wallet.remaining / wallet.allowance) * 100) : 0}%` }} />
            </div>
          </div>
        )}

        {/* 用量 */}
        {usage && (
          <div className="card-glass p-4 mb-6">
            <h3 className="text-xs text-gray-400 mb-3">📊 本月用量 ({usage.month})</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'LLM Token', value: usage.llmTokens.toLocaleString() },
                { label: '已用 TOKEN', value: (wallet?.spent ?? 0).toLocaleString() },
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
                {isFreePlan(p) ? (
                  <span className="text-2xl font-bold text-amber-400">免费</span>
                ) : p.discountPrice ? (
                  <>
                    <span className="text-2xl font-bold text-emerald-400">{fmtYuan(p.discountPrice)}</span>
                    <span className="text-xs text-gray-600 line-through ml-1">{fmtYuan(p.price)}</span>
                  </>
                ) : (
                  <span className="text-2xl font-bold text-white">{fmtYuan(p.price)}</span>
                )}
              </div>
              <div className="text-[10px] text-gray-500 space-y-1 mb-4">
                <p>🪙 {isFreePlan(p) ? '体验额度' : '每月额度'} <span className="text-emerald-400 font-mono">{planTokens(p).toLocaleString()}</span> TOKEN</p>
                <p className="text-gray-600">1 TOKEN ≈ ¥0.01 · 生图/生视频/对话通用</p>
                <p>💾 存储 {p.storageMb >= 1024 ? (p.storageMb/1024).toFixed(1)+'GB' : p.storageMb+'MB'}</p>
              </div>
              {isFreePlan(p) ? (
                <button onClick={claimWeekly} disabled={buying}
                  className={`w-full py-2 rounded-lg text-xs font-bold transition ${myPlan?.planId === p.id ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500 text-white hover:bg-amber-600'}`}>
                  {myPlan?.planId === p.id ? '✓ 当前方案' : buying ? '领取中...' : '🎁 免费领取（每账号限一次）'}
                </button>
              ) : (
                <button onClick={() => buyPlan(p.id)} disabled={buying}
                  className={`w-full py-2 rounded-lg text-xs font-bold transition ${myPlan?.planId === p.id ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-blue-500 text-white hover:bg-blue-600'}`}>
                  {myPlan?.planId === p.id ? '✓ 当前方案' : buying ? '购买中...' : '立即订阅'}
                </button>
              )}
            </div>
          ))}
        </div>
        {plans.length === 0 && <p className="text-gray-500 text-sm text-center py-8">暂无可用套餐，请联系管理员</p>}
      </div>
    </div>
  )
}
