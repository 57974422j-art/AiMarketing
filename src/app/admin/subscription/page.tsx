'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface Plan {
  id: number; name: string; description: string | null
  price: number; discountPrice: number | null
  durationMonths: number
  monthlyTokens: number | null
  storageMb: number
  status: string; sortOrder: number
}

interface UsageStats { month: string; totals: any; users: any[] }

const fmtYuan = (fen: number) => '¥' + (fen / 100).toFixed(0)
const fmtDisk = (mb: number) => mb >= 1024 ? (mb / 1024).toFixed(1) + 'GB' : mb + 'MB'
/** 月点数额度：手填的 monthlyTokens 优先；否则按【原价】/月数自动算（与 token-wallet.planMonthlyTokens 完全一致，1 点≈¥0.01） */
const planTokens = (p: Plan) => {
  if (p.monthlyTokens !== null && p.monthlyTokens !== undefined) return p.monthlyTokens
  const effective = p.price
  if (effective <= 0) return 500
  return Math.round(effective / Math.max(1, p.durationMonths || 1))
}
/** 由点数额度反推「可约生图/生视频」：生图 12 点/张、生视频 100 点/秒（见 token-wallet.TOKEN_COSTS），按实际用量扣点而非固定配额 */
const planImageEst = (pts: number) => Math.floor(pts / 12)
const planVideoEst = (pts: number) => Math.floor(pts / 100)

export default function SubscriptionAdminPage() {
  const { user, loading: authLoading } = useAuth()
  const [authorized, setAuthorized] = useState(false)
  const [plans, setPlans] = useState<Plan[]>([])
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [tab, setTab] = useState<'plans' | 'usage' | 'users'>('plans')
  const [editing, setEditing] = useState<Plan | null>(null)
  const [form, setForm] = useState<Partial<Plan>>({})
  const [loading, setLoading] = useState(true)
  /* ★VF_ADMIN_GRANT_V1：给用户开卡/加点（users tab） */
  const [grantUsers, setGrantUsers] = useState<any[]>([])
  const [grantPlans, setGrantPlans] = useState<any[]>([])
  const [grantLoading, setGrantLoading] = useState(false)
  const [grantBusy, setGrantBusy] = useState('')
  const [grantKw, setGrantKw] = useState('')
  const [grantPlanId, setGrantPlanId] = useState('')
  const [grantDays, setGrantDays] = useState('')
  const [grantPoints, setGrantPoints] = useState('')
  const [grantReason, setGrantReason] = useState('')
  /* ★VF_GRANT_MSG_V1：操作结果**留在页面上**（toast 一闪而过，用户回头看不到失败原因） */
  const [grantMsg, setGrantMsg] = useState<{ ok: boolean; text: string } | null>(null)

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

  /* ★VF_ADMIN_GRANT_V1（2026-10-28 用户「后台给用户加时间点数年卡，我找了没找到」
                      + 「以前都是让你们给我命令加时间，太烦了」）：
     把 `users` tab 真正做出来 —— 查用户 → 看当前套餐/余额 → 加天数 / 加点数。
     后端：`/api/admin/user-grant`（续费是**在 endDate 上累加**，加点数**必造流水**）。 */
  const loadGrant = async (kw?: string) => {
    setGrantLoading(true)
    try {
      const r = await fetch('/api/admin/user-grant' + (kw ? '?q=' + encodeURIComponent(kw) : ''), { credentials: 'include' })
      const d = await r.json()
      if (d.success) { setGrantUsers(d.data.users || []); setGrantPlans(d.data.plans || []) }
      else showToast(d.message || '查询失败', 'error')
    } catch { showToast('查询失败', 'error') }
    setGrantLoading(false)
  }

  const doGrant = async (u: any, action: 'plan' | 'points') => {
    const isPlan = action === 'plan'
    const payload: any = { userId: u.id, action }
    if (isPlan) {
      if (!grantPlanId) { showToast('先选一个套餐', 'error'); return }
      payload.planId = Number(grantPlanId)
      if (grantDays !== '') payload.days = Number(grantDays)
      payload.reason = '后台手动开通' + (grantReason ? '：' + grantReason : '')
    } else {
      if (!grantPoints || !Number(grantPoints)) { showToast('填一个点数（负数=扣）', 'error'); return }
      payload.points = Number(grantPoints)
      payload.reason = '后台手动加点' + (grantReason ? '：' + grantReason : '')
    }
    setGrantBusy(u.id + action)
    setGrantMsg(null)
    try {
      const r = await fetch('/api/admin/user-grant', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json()
      if (d.success) {
        showToast(d.message || '已发放', 'success')
        setGrantMsg({ ok: true, text: (u.name || u.username) + '：' + (d.message || '已发放') })
        loadGrant(grantKw)
      } else {
        const msg = String(d.message || ('HTTP ' + r.status))
        showToast(msg, 'error')
        setGrantMsg({ ok: false, text: (u.name || u.username) + '：' + msg })
      }
    } catch (e: any) {
      const msg = String((e && e.message) || e)
      showToast('失败', 'error')
      setGrantMsg({ ok: false, text: '请求异常：' + msg })
    }
    setGrantBusy('')
  }

  const savePlan = async () => {
    if (!form.name || form.price === undefined || form.price === ('' as any)) { showToast('请填写套餐名和价格', 'error'); return }
    try {
      const body = {
        ...form,
        price: Number(form.price),
        discountPrice: form.discountPrice ? Number(form.discountPrice) : null,
        durationMonths: Number(form.durationMonths) || 1,
        monthlyTokens: (form.monthlyTokens === undefined || form.monthlyTokens === null) ? null : Number(form.monthlyTokens),
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

  // 上/下架切换（下架后前台不显示、免费周卡不可领取）
  const toggleStatus = async (p: Plan) => {
    const next = p.status === 'active' ? 'disabled' : 'active'
    try {
      const r = await fetch(`/api/admin/subscription-plans/${p.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const d = await r.json()
      if (d.success) { showToast(next === 'active' ? '已上架' : '已下架', 'success'); loadPlans() }
      else showToast(d.message, 'error')
    } catch { showToast('操作失败', 'error') }
  }

  const deletePlan = async (id: number) => {
    if (!confirm('确定删除该套餐？')) return
    await fetch(`/api/admin/subscription-plans/${id}`, { method: 'DELETE' })
    showToast('已删除', 'success')
    loadPlans()
  }

  const startEdit = (p: Plan) => { setEditing(p); setForm({ ...p }) }
  const startNew = () => { setEditing(null as any); setForm({ name: '', price: 2900, discountPrice: null, durationMonths: 1, monthlyTokens: null, storageMb: 100, status: 'active', sortOrder: plans.length }) }

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
            {/* ★VF_ADMIN_GRANT_V1：这个 tab 以前只在 useState 里定义、**页面里没渲染**（空壳）⇒ 现在补上 */}
            <button onClick={() => { setTab('users'); loadGrant() }} className={`px-3 py-1.5 rounded-lg text-xs ${tab === 'users' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-white/5 text-gray-400'}`}>🎁 给用户开卡/加点</button>
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

        {tab === 'users' && (
          <div className="space-y-4">
            {/* 搜索 + 发放参数 */}
            <div className="card-glass p-4">
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-[10px] text-gray-400 block mb-1">搜用户（ID / 用户名 / 邮箱 / 姓名，留空看最近 20 个）</label>
                  <input value={grantKw} onChange={(e) => setGrantKw(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') loadGrant(grantKw.trim()) }}
                    placeholder="例如：1 或 admin"
                    className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-gray-100" />
                </div>
                <button onClick={() => loadGrant(grantKw.trim())} disabled={grantLoading}
                  className="px-4 py-2 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs">
                  {grantLoading ? '查询中…' : '🔍 查询'}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-gray-400 block mb-1">套餐</label>
                  <select value={grantPlanId} onChange={(e) => setGrantPlanId(e.target.value)}
                    className="w-full px-2 py-2 rounded-lg bg-black/30 border border-white/10 text-xs text-gray-100">
                    <option value="">（选套餐）</option>
                    {grantPlans.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}（{p.durationMonths} 个月）</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 block mb-1">加多少天（留空=按套餐月数）</label>
                  <input value={grantDays} onChange={(e) => setGrantDays(e.target.value)} placeholder="例如 30 / 365"
                    className="w-full px-2 py-2 rounded-lg bg-black/30 border border-white/10 text-xs text-gray-100" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 block mb-1">加点数（负数=扣）</label>
                  <input value={grantPoints} onChange={(e) => setGrantPoints(e.target.value)} placeholder="例如 5000"
                    className="w-full px-2 py-2 rounded-lg bg-black/30 border border-white/10 text-xs text-gray-100" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 block mb-1">备注（写进流水，方便对账）</label>
                  <input value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="例如 老客户补偿"
                    className="w-full px-2 py-2 rounded-lg bg-black/30 border border-white/10 text-xs text-gray-100" />
                </div>
              </div>
              <p className="text-[10px] text-gray-500 mt-2">
                续费**同一套餐**会在原到期日上累加（不会多开一条）；<b>加点数会写一条流水</b>（`manual`，0 元）。
              </p>
              {/* ★VF_GRANT_MSG_V1：上一次操作的结果（失败时把原因留在这儿，不用回头翻 toast） */}
              {grantMsg && (
                <div className={'mt-2 px-3 py-2 rounded-lg text-[11px] ' + (grantMsg.ok
                  ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-200'
                  : 'bg-rose-500/15 border border-rose-500/30 text-rose-200')}>
                  {grantMsg.ok ? '✅ ' : '❌ '}{grantMsg.text}
                </div>
              )}
            </div>

            {/* 用户列表 */}
            <div className="card-glass p-4">
              <h3 className="text-sm text-white mb-3">🎁 用户权益（{grantUsers.length}）</h3>
              {grantUsers.length === 0 ? (
                <p className="text-gray-500 text-xs">（还没有查询结果 —— 点上面的「🔍 查询」）</p>
              ) : (
                <div className="space-y-2">
                  {grantUsers.map((u: any) => (
                    <div key={u.id} className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/10">
                      <div className="min-w-[180px]">
                        <div className="text-sm text-gray-100">
                          {u.name || u.username}
                          <span className="text-gray-500 text-[10px] ml-2">#{u.id} · {u.username}</span>
                          {u.role === 'admin' && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">管理员</span>}
                        </div>
                        <div className="text-[10px] text-gray-500">{u.email || '（无邮箱）'}</div>
                      </div>
                      <div className="min-w-[200px]">
                        <div className="text-[11px] text-gray-300">
                          套餐：<b className={u.planName ? 'text-emerald-300' : 'text-gray-500'}>{u.planName || '无'}</b>
                          {u.endDate && <span className="text-gray-500 ml-1">（{String(u.endDate).slice(0, 10)} 到期，剩 {u.daysLeft} 天）</span>}
                        </div>
                        {/* ★VF_GRANT_QUOTA_V1（2026-10-28 用户「年卡月卡季卡周卡自带点数的」）：
                            两笔钱必须分开显示，否则"开了年卡却显示点数 0"会让人以为没生效：
                              · 套餐月额度 = 套餐自带（按月刷新，不累积）
                              · 点卡余额   = 永久点数（我在这里加的就是它，不清零） */}
                        <div className="text-[11px] text-gray-300">
                          套餐额度：<b className="text-sky-300">{u.planQuota ? u.planQuota.toLocaleString() : '—'}</b>
                          <span className="text-gray-500 ml-1">点/月（随套餐，按月刷新）</span>
                        </div>
                        <div className="text-[11px] text-gray-300">
                          点卡余额：<b className="text-amber-300">{(u.pointBalance || 0).toLocaleString()}</b>
                          <span className="text-gray-500 ml-1">点（永久，不按月清零）</span>
                          {u.payMethod && <span className="text-gray-500 ml-1">· 来源 {u.payMethod}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-auto">
                        <button onClick={() => doGrant(u, 'plan')} disabled={!!grantBusy}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px]">
                          {grantBusy === u.id + 'plan' ? '处理中…' : '📅 开/续时长'}
                        </button>
                        <button onClick={() => doGrant(u, 'points')} disabled={!!grantBusy}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px]">
                          {grantBusy === u.id + 'points' ? '处理中…' : '💎 加点数'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                      <th className="text-right">月点数</th><th className="text-right">可约生图</th><th className="text-right">可约生视频</th><th className="text-center">状态</th><th className="text-center">操作</th>
                    </tr></thead>
                    <tbody>
                      {plans.map(p => (
                        <tr key={p.id} className="border-b border-white/5 text-gray-300">
                          <td className="py-1.5 font-medium">{p.name}</td>
                          <td className="text-right font-mono">{fmtYuan(p.price)}</td>
                          <td className="text-right font-mono text-emerald-400">{p.discountPrice ? fmtYuan(p.discountPrice) : '—'}</td>
                          <td className="text-center">{p.durationMonths}月</td>
                          <td className="text-right font-mono text-amber-400">{planTokens(p).toLocaleString()}</td>
                          <td className="text-right font-mono text-sky-400">{planImageEst(planTokens(p))}张</td>
                          <td className="text-right font-mono text-rose-400">{planVideoEst(planTokens(p))}秒</td>
                          <td className="text-center"><span className={p.status === 'active' ? 'text-emerald-400' : 'text-gray-600'}>{p.status === 'active' ? '上架' : '已下架'}</span></td>
                          <td className="text-center">
                            <button onClick={() => toggleStatus(p)} className={`mr-2 ${p.status === 'active' ? 'text-amber-400 hover:text-amber-300' : 'text-emerald-400 hover:text-emerald-300'}`}>{p.status === 'active' ? '下架' : '上架'}</button>
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
                <p className="text-[10px] text-gray-500 mb-3">点数体系：月点数 = 原价(分) / 月数（1 点≈¥0.01）。生图 12 点/张、生视频 100 点/秒、对话 1 点/条，<span className="text-gray-400">按实际用量扣点，无需单独设"多少张/多少条"配额</span>。表单中「月点数」**留空=按原价/月数自动算**；**填了即按你填的值生效**（可故意少给，如季卡 89 元只给 6900 点）。</p>
                <div className="grid grid-cols-3 md:grid-cols-4 gap-3 text-xs">
                  {[
                    { key: 'name', label: '套餐名', type: 'text', placeholder: '基础月卡' },
                    { key: 'price', label: '原价(分)', type: 'number', placeholder: '2900(¥29)' },
                    { key: 'discountPrice', label: '折扣价(分)', type: 'number', placeholder: '1900(¥19)' },
                    { key: 'durationMonths', label: '月数', type: 'number', placeholder: '1' },
                    { key: 'monthlyTokens', label: '月点数(可留空)', type: 'number', placeholder: '留空=原价/月数自动' },
                    { key: 'storageMb', label: '存储空间(MB)', type: 'number', placeholder: '100' },
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
