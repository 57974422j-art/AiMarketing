'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface OrderUser { username: string | null; email: string | null }
interface OrderPlan { name: string | null }
interface OrderCard { name: string | null; points: number | null }
interface Order {
  id: number
  orderNo: string
  userId: number
  planId?: number
  channel: string
  amount: number
  subject: string
  status: string
  tradeNo: string | null
  payUrl: string | null
  expireAt: string | null
  paidAt: string | null
  raw: string | null
  createdAt: string
  updatedAt: string
  user: OrderUser
  plan?: OrderPlan
  card?: OrderCard
  type?: string        // 'subscription' | 'pointcard'
  productName?: string // 归一化商品名
  points?: number | null
}

const fmtYuan = (fen: number) => '¥' + (fen / 100).toFixed(2)
const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '待支付', cls: 'text-amber-400' },
  paid: { label: '已支付', cls: 'text-emerald-400' },
  closed: { label: '已关闭', cls: 'text-gray-500' },
  failed: { label: '支付失败', cls: 'text-red-400' },
}
const CHANNEL_LABEL: Record<string, string> = { alipay: '支付宝', wechat: '微信' }
const fmtTime = (t: string | null) => (t ? new Date(t).toLocaleString('zh-CN') : '—')

export default function AdminOrdersPage() {
  const { user, loading: authLoading } = useAuth()
  const [authorized, setAuthorized] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [summary, setSummary] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('all')
  const [channel, setChannel] = useState('all')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<Order | null>(null)

  useEffect(() => { if (!authLoading) setAuthorized(user?.role === 'admin') }, [authLoading, user])

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 400)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    if (!authorized) return
    setLoading(true)
    const params = new URLSearchParams({ status, channel, q: debouncedQ, page: String(page), pageSize: String(pageSize) })
    fetch(`/api/admin/orders?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setOrders(d.data.orders); setTotal(d.data.total); setSummary(d.data.summary || {})
        } else showToast(d.message, 'error')
      })
      .catch(() => showToast('加载失败', 'error'))
      .finally(() => setLoading(false))
  }, [authorized, status, channel, debouncedQ, page, pageSize])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  if (!authorized) return <div className="min-h-screen bg-gray-950 p-8 text-gray-400 text-sm">需要管理员权限</div>

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <p className="text-label mb-1">管理中心 / 订单管理</p>
          <h1 className="text-mono-lg text-white">🧾 支付订单</h1>
        </div>

        {/* 状态汇总 tabs */}
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            { key: 'all', label: '全部' },
            { key: 'pending', label: '待支付' },
            { key: 'paid', label: '已支付' },
            { key: 'closed', label: '已关闭' },
            { key: 'failed', label: '支付失败' },
          ].map(t => (
            <button key={t.key} onClick={() => { setStatus(t.key); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-xs ${status === t.key ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-gray-400'}`}>
              {t.label} <span className="opacity-60">{summary[t.key] || 0}</span>
            </button>
          ))}
        </div>

        {/* 筛选/搜索栏 */}
        <div className="flex flex-wrap gap-2 mb-4">
          <select value={channel} onChange={e => { setChannel(e.target.value); setPage(1) }}
            className="input-dark text-xs px-2 py-1.5 rounded">
            <option value="all">全部渠道</option>
            <option value="alipay">支付宝</option>
            <option value="wechat">微信</option>
          </select>
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="搜索订单号 / 用户名 / 邮箱"
            className="input-dark text-xs px-3 py-1.5 rounded flex-1 min-w-[200px]" />
        </div>

        {/* 列表 */}
        <div className="card-glass p-4">
          {loading ? <p className="text-gray-500 text-xs">加载中...</p> : orders.length === 0 ? <p className="text-gray-500 text-xs">暂无订单</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-2">订单号</th>
                  <th className="text-left">用户</th>
                  <th className="text-left">商品</th>
                  <th className="text-right">金额</th>
                  <th className="text-center">渠道</th>
                  <th className="text-center">状态</th>
                  <th className="text-left">创建时间</th>
                  <th className="text-center">操作</th>
                </tr></thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.type + '-' + o.id} className="border-b border-white/5 text-gray-300 hover:bg-white/5">
                      <td className="py-2 font-mono text-[11px]">{o.orderNo}</td>
                      <td>{o.user?.username || o.user?.email || '—'}</td>
                      <td>
                        <span className={`mr-1 text-[10px] px-1.5 py-0.5 rounded ${o.type === 'pointcard' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'}`}>{o.type === 'pointcard' ? '点卡' : '套餐'}</span>
                        <span>{o.productName || o.plan?.name || o.card?.name || '—'}</span>
                      </td>
                      <td className="text-right font-mono">{fmtYuan(o.amount)}</td>
                      <td className="text-center">{CHANNEL_LABEL[o.channel] || o.channel}</td>
                      <td className="text-center"><span className={STATUS_META[o.status]?.cls || 'text-gray-400'}>{STATUS_META[o.status]?.label || o.status}</span></td>
                      <td className="text-gray-500">{fmtTime(o.createdAt)}</td>
                      <td className="text-center"><button onClick={() => setDetail(o)} className="text-blue-400 hover:text-blue-300">详情</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 分页 */}
          {total > 0 && (
            <div className="flex items-center justify-between mt-4 text-xs text-gray-400">
              <span>共 {total} 条</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="px-3 py-1 rounded bg-white/5 disabled:opacity-40">上一页</button>
                <span className="px-2 py-1">{page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="px-3 py-1 rounded bg-white/5 disabled:opacity-40">下一页</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setDetail(null)}>
          <div className="card-glass max-w-lg w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">订单详情</h3>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <dl className="space-y-2 text-xs">
              {[
                ['订单号', detail.orderNo],
                ['类型', detail.type === 'pointcard' ? '点卡（永久点数）' : '会员套餐'],
                ['标题', detail.subject],
                ['用户', detail.user?.username || detail.user?.email || '—'],
                ['商品', detail.type === 'pointcard' ? (detail.card?.name || detail.subject || '—') : (detail.plan?.name || '—')],
                detail.type === 'pointcard' ? ['到账点数', `${detail.points?.toLocaleString() || 0} 点`] as [string, string] : ['套餐', detail.plan?.name || '—'],
                ['金额', fmtYuan(detail.amount)],
                ['渠道', CHANNEL_LABEL[detail.channel] || detail.channel],
                ['状态', STATUS_META[detail.status]?.label || detail.status],
                ['第三方交易号', detail.tradeNo || '—'],
                ['过期时间', fmtTime(detail.expireAt)],
                ['支付时间', fmtTime(detail.paidAt)],
                ['创建时间', fmtTime(detail.createdAt)],
                ['更新时间', fmtTime(detail.updatedAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-white/5 pb-1">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-gray-200 text-right max-w-[60%] break-all">{v}</dd>
                </div>
              ))}
            </dl>
            {detail.payUrl && (
              <div className="mt-3">
                <p className="text-gray-500 text-[11px] mb-1">支付链接</p>
                <a href={detail.payUrl} target="_blank" rel="noreferrer" className="text-blue-400 text-[11px] break-all hover:underline">{detail.payUrl}</a>
              </div>
            )}
            {detail.raw && (
              <div className="mt-3">
                <p className="text-gray-500 text-[11px] mb-1">回调原始数据</p>
                <pre className="text-[10px] text-gray-400 bg-black/30 rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">{detail.raw}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
