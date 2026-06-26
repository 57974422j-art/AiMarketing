'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface Plan {
  id: number; name: string; description: string | null
  price: number; discountPrice: number | null
  durationMonths: number
  deepseekTokens: number; llmTokens: number
  text2imgQuota: number; text2videoQuota: number
  digitalHumanMin: number; liveStreamMin: number; storageMb: number
  status: string; sortOrder: number
}

interface UsageStats { month: string; totals: any; users: any[] }

const fmtYuan = (fen: number) => '¥' + (fen / 100).toFixed(0)
const fmtDisk = (mb: number) => mb >= 1024 ? (mb / 1024).toFixed(1) + 'GB' : mb + 'MB'
const fmtQuota = (v: number) => v === -1 ? '∞' : v > 0 ? v.toLocaleString() : '—'

export default function SubscriptionAdminPage() {
  const { user, loading: authLoading } = useAuth()
  const [authorized, setAuthorized] = useState(false)
  const [plans, setPlans] = useState<Plan[]>([])
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [tab, setTab] = useState<'plans' | 'usage' | 'users'>('plans')
  const [editing, setEditing] = useState<Plan | null>(null)
  const [form, setForm] = useState<Partial<Plan>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (!authLoading) setAuthorized(user?.role === 'admin') }, [authLoading, user])
  useEffect(() => { if (authorized) loadPlans() }, [authorized])

  const loadPlans = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/subscription-plans')
      const d = await r.json()
      if (d.success) setPlans(d.data)
    } catch {}
    setLoading(false)
  }

  const loadStats = async () => {
    try {
      const r = await fetch('/api/admin/usage-stats')
      const d = await r.json()
      if (d.success) setStats(d.data)
    } catch {}
  }

  const savePlan = async () => {
    if (!form.name || !form.price) { showToast('请填写套餐名和价格', 'error'); return }
    try {
      const body = {
        ...form,
        price: Number(form.price),
        discountPrice: form.discountPrice ? Number(form.discountPrice) : null,
        durationMonths: Number(form.durationMonths) || 1,
        deepseekTokens: Number(form.deepseekTokens) ?? -1,
        llmTokens: Number(form.llmTokens) || 0,
        text2imgQuota: Number(form.text2imgQuota) || 0,
        text2videoQuota: Number(form.text2videoQuota) || 0,
        digitalHumanMin: Number(form.digitalHumanMin) || 0,
        liveStreamMin: Number(form.liveStreamMin) || 0,
        storageMb: Number(form.storageMb) || 100,
        sortOrder: Number(form.sortOrder) || 0,
      }
      const method = editing ? 'PUT' : 'POST'
      const url = editing ? `/api/admin/subscription-plans/${editing.id}` : '/api/admin/subscription-plans'
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      if (d.success) { showToast(editing ? '已更新' : '已创建', 'success'); setEditing(null); setForm({}); loadPlans() }
      else showToast(d.message, 'error')
    } catch { showToast('保存失败', 'error') }
  }

  const deletePlan = async (id: number) => {
    if (!confirm('确定删除该套餐？')) return
    await fetch(`/api/admin/subscription-plans/${id}`, { method: 'DELETE' })
    showToast('已删除', 'success')
    loadPlans()
  }

  const startEdit = (p: Plan) => { setEditing(p); setForm({ ...p }) }
  const startNew = () => { setEditing(null as any); setForm({ name: '', price: 2900, discountPrice: null, durationMonths: 1, deepseekTokens: -1, llmTokens: 50000, text2imgQuota: 200, text2videoQuota: 10, digitalHumanMin: 30, liveStreamMin: 60, storageMb: 100, status: 'active', sortOrder: plans.length }) }

  if (!authorized) return <div className="min-h-screen bg-gray-950 p-8 text-gray-400 text-sm">需要管理员权限</div>

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-label mb-1">管理中心 / 套餐与计费</p>
            <h1 className="text-mono-lg text-white">💳 收费系统管理</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setTab('plans'); loadPlans() }} className={`px-3 py-1.5 rounded-lg text-xs ${tab === 'plans' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-gray-400'}`}>📦 套餐</button>
            <button onClick={() => { setTab('usage'); loadStats() }} className={`px-3 py-1.5 rounded-lg text-xs ${tab === 'usage' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400'}`}>📊 用量</button>
          </div>
        </div>

        {tab === 'usage' && (
          <div className="card-glass p-6">
            <h3 className="text-sm text-white mb-4">📊 全平台用量统计 ({stats?.month || '—'})</h3>
            {stats ? (
              <div>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {[
                    { label: 'LLM Token', value: stats.totals.llmTokens.toLocaleString() },
                    { label: '文生图(次)', value: stats.totals.text2img },
                    { label: '文生视频(次)', value: stats.totals.text2video },
                  ].map(item => (
                    <div key={item.label} className="bg-white/5 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">{item.label}</p>
                      <p className="text-lg text-white font-mono">{item.value}</p>
                    </div>
                  ))}
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-500 border-b border-white/10">
                    <th className="text-left py-2">用户</th><th className="text-right">LLM Token</th><th className="text-right">文生图</th><th className="text-right">文生视频</th>
                  </tr></thead>
                  <tbody>
                    {stats.users.slice(0, 20).map((u: any) => (
                      <tr key={u.userId} className="border-b border-white/5 text-gray-300">
                        <td className="py-1.5">{u.username || u.email}</td>
                        <td className="text-right font-mono">{u.llmTokens.toLocaleString()}</td>
                        <td className="text-right">{u.text2img}</td>
                        <td className="text-right">{u.text2video}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-gray-500 text-xs">加载中...</p>}
          </div>
        )}

        {tab === 'plans' && (
          <div className="space-y-4">
            {/* 套餐列表 */}
            <div className="card-glass p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm text-white">📦 套餐列表 ({plans.length})</h3>
                <div className="flex gap-2">
                  {plans.length === 0 && (
                    <button onClick={async () => {
                      const r = await fetch('/api/admin/seed-plans', { method: 'POST' })
                      const d = await r.json()
                      showToast(d.message, d.success ? 'success' : 'error')
                      if (d.success) loadPlans()
                    }} className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-xs hover:bg-emerald-500/30">🌱 初始化套餐</button>
                  )}
                  <button onClick={startNew} className="px-3 py-1.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs hover:bg-blue-500/30">+ 新建套餐</button>
                </div>
              </div>
              {loading ? <p className="text-gray-500 text-xs">加载...</p> : plans.length === 0 ? <p className="text-gray-500 text-xs">暂无套餐</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-500 border-b border-white/10">
                      <th className="text-left py-2">名称</th><th className="text-right">原价</th><th className="text-right">折扣</th><th className="text-center">时长</th>
                      <th className="text-right">文生图</th><th className="text-right">文生视频</th><th className="text-center">状态</th><th className="text-center">操作</th>
                    </tr></thead>
                    <tbody>
                      {plans.map(p => (
                        <tr key={p.id} className="border-b border-white/5 text-gray-300">
                          <td className="py-1.5 font-medium">{p.name}</td>
                          <td className="text-right font-mono">{fmtYuan(p.price)}</td>
                          <td className="text-right font-mono text-emerald-400">{p.discountPrice ? fmtYuan(p.discountPrice) : '—'}</td>
                          <td className="text-center">{p.durationMonths}月</td>
                          <td className="text-right">{fmtQuota(p.text2imgQuota)}</td>
                          <td className="text-right">{fmtQuota(p.text2videoQuota)}</td>
                          <td className="text-center"><span className={p.status === 'active' ? 'text-emerald-400' : 'text-gray-600'}>{p.status}</span></td>
                          <td className="text-center">
                            <button onClick={() => startEdit(p)} className="text-blue-400 hover:text-blue-300 mr-2">编辑</button>
                            <button onClick={() => deletePlan(p.id)} className="text-red-400 hover:text-red-300">删除</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 编辑/新建表单 */}
            {(editing !== null || form.name !== undefined) && (
              <div className="card-glass p-4 border border-blue-500/20">
                <h3 className="text-sm text-blue-400 mb-3">{editing ? `编辑: ${editing.name}` : '新建套餐'}</h3>
                <div className="grid grid-cols-3 md:grid-cols-4 gap-3 text-xs">
                  {[
                    { key: 'name', label: '套餐名', type: 'text', placeholder: '基础月卡' },
                    { key: 'price', label: '原价(分)', type: 'number', placeholder: '2900(¥29)' },
                    { key: 'discountPrice', label: '折扣价(分)', type: 'number', placeholder: '1900(¥19)' },
                    { key: 'durationMonths', label: '月数', type: 'number', placeholder: '1' },
                    { key: 'deepseekTokens', label: 'DeepSeek Token', type: 'number', placeholder: '-1(无限)' },
                    { key: 'llmTokens', label: 'LLM Token', type: 'number', placeholder: '50000' },
                    { key: 'text2imgQuota', label: '文生图(次)', type: 'number', placeholder: '200' },
                    { key: 'text2videoQuota', label: '文生视频(次)', type: 'number', placeholder: '10' },
                    { key: 'sortOrder', label: '排序', type: 'number', placeholder: '0' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="text-gray-500 text-[9px] block mb-0.5">{f.label}</label>
                      <input type={f.type} className="input-dark w-full" placeholder={f.placeholder}
                        value={(form as any)[f.key] ?? ''}
                        onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value }))} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={savePlan} className="px-4 py-1.5 bg-blue-500 text-white rounded text-xs">保存</button>
                  <button onClick={() => { setEditing(null); setForm({}) }} className="px-4 py-1.5 bg-white/5 text-gray-400 rounded text-xs">取消</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
