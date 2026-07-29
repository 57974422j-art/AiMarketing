'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface Plan {
  id: number; name: string; description: string | null
  price: number; discountPrice: number | null
  durationMonths: number
  monthlyTokens: number | null
  text2imgQuota: number; text2videoQuota: number
  digitalHumanMin: number; liveStreamMin: number; storageMb: number
  status: string
}
interface MyUsage { month: string; llmTokens: number; text2img: number; text2video: number }
interface Wallet { hasSubscription: boolean; planName: string | null; allowance: number; spent: number; remaining: number }

const fmtYuan = (f: number) => '¥' + (f / 100).toFixed(0)
const FREE_TRIAL_POINTS = 500
/** 套餐月度点数额度（手填 monthlyTokens 优先；否则按原价/月数自动，与后端 planMonthlyTokens 一致；0元套餐=固定试用额度） */
const planTokens = (p: Plan) => {
  if (p.monthlyTokens !== null && p.monthlyTokens !== undefined) return p.monthlyTokens
  const effective = p.price // 取原价
  if (effective <= 0) return FREE_TRIAL_POINTS
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

  // 点卡下单（新开支付宝标签页，支付后轮询到账）
  const buyCard = async (card: any) => {
    if (!user?.id) { showToast('请先登录', 'error'); return }
    setBuyingId(card.id)
    try {
      const r = await fetch('/api/point-cards/checkout', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: card.id, channel: 'alipay' }),
      })
      const d = await r.json()
      if (d.success && d.data?.payUrl) {
        window.open(d.data.payUrl, '_blank')
        showToast('已打开支付宝，支付成功后本页自动刷新', 'success')
        pollPointCardOrder(d.data.orderNo)
        return
      }
      showToast(d.message || '发起支付失败', 'error')
    } catch { showToast('发起支付失败', 'error') }
    setBuyingId(null)
  }

  // 点卡订单支付后轮询到账
  const pollPointCardOrder = (orderNo: string) => {
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/point-cards/order/${orderNo}`, { credentials: 'include' })
        const d = await r.json()
        if (d.success && d.data.status === 'paid') {
          clearInterval(timer)
          setBuyingId(null)
          showToast('🎉 点卡已到账，余额已更新！', 'success')
          loadData()
        }
      } catch {}
    }, 3000)
    setTimeout(() => { clearInterval(timer); setBuyingId(null) }, 120000)
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

        {/* 点数钱包（月额度 + 点卡永久余额） */}
        {wallet && (
          <div className="card-glass p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs text-gray-400">🪙 点数钱包</h3>
              <span className="text-[10px] text-gray-600">1 点 ≈ ¥0.01</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-2">
              {[
                { label: '套餐剩余', value: wallet.subRemaining.toLocaleString(), color: 'text-white' },
                { label: '已消耗', value: wallet.spent.toLocaleString(), color: 'text-amber-400' },
                { label: '点卡余额', value: wallet.pointBalance.toLocaleString(), color: 'text-emerald-400' },
              ].map(i => (
                <div key={i.label} className="bg-white/5 rounded-lg p-2.5 text-center">
                  <p className="text-[10px] text-gray-500">{i.label}</p>
                  <p className={`text-sm font-mono mt-0.5 ${i.color}`}>{i.value}</p>
                </div>
              ))}
            </div>
            {wallet.allowance > 0 && (
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (wallet.subRemaining / wallet.allowance) * 100)}%` }} />
              </div>
            )}
            <p className="text-[10px] text-gray-600 mt-2">扣费顺序：先扣当月套餐额度，额度用完再扣点卡余额（永不过期）。</p>
          </div>
        )}

        {/* 点卡补充（永久点数） */}
        <div className="card-glass p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm text-white">🎫 点卡补充（永久点数，永不过期）</h3>
              <p className="text-[10px] text-gray-500 mt-1">适合额度用完的用户补充点数；购买后直接累加到上方「点卡余额」。</p>
            </div>
          </div>
          {cards.length === 0 ? (
            <p className="text-gray-500 text-xs">暂无可售点卡</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {cards.map(c => (
                <div key={c.id} className="border border-white/10 rounded-lg p-4 bg-white/5">
                  <div className="text-white text-sm font-medium">{c.name}</div>
                  {c.description && <div className="text-gray-500 text-[10px] mt-1 h-8 overflow-hidden">{c.description}</div>}
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-amber-400 font-mono text-lg">{c.points.toLocaleString()}</span>
                    <span className="text-gray-500 text-[10px]">点</span>
                  </div>
                  <div className="mt-1 text-emerald-400 font-mono text-sm">¥{(c.price / 100).toFixed(2)}</div>
                  <button onClick={() => buyCard(c)} disabled={buyingId === c.id}
                    className="mt-3 w-full px-3 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs hover:bg-blue-500/30 disabled:opacity-50">
                    {buyingId === c.id ? '处理中…' : '购买'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 用量 */}
        {usage && (
          <div className="card-glass p-4 mb-6">
            <h3 className="text-xs text-gray-400 mb-3">📊 本月用量 ({usage.month})</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'LLM Token', value: usage.llmTokens.toLocaleString() },
                { label: '已用点数', value: (wallet?.spent ?? 0).toLocaleString() },
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
                <p>🪙 {isFreePlan(p) ? '体验额度' : '每月额度'} <span className="text-emerald-400 font-mono">{planTokens(p).toLocaleString()}</span> 点</p>
                <p className="text-gray-600">1 点 ≈ ¥0.01 · 生图/生视频/对话/看片通用</p>
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
