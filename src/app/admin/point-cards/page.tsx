'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface PointCard {
  id: number
  name: string
  description: string | null
  points: number
  price: number
  status: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

const fmtYuan = (fen: number) => '¥' + (fen / 100).toFixed(2)
const fmtPoints = (pts: number) => pts.toLocaleString() + ' 点'
// 1 点 = ¥0.01，反推性价比描述
const pointsToYuan = (pts: number) => '¥' + (pts / 100).toFixed(2)

export default function PointCardAdminPage() {
  const { user, loading: authLoading } = useAuth()
  const [authorized, setAuthorized] = useState(false)
  const [cards, setCards] = useState<PointCard[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PointCard | null>(null)
  const [form, setForm] = useState<Partial<PointCard>>({})

  useEffect(() => { if (!authLoading) setAuthorized(user?.role === 'admin') }, [authLoading, user])
  useEffect(() => { if (authorized) loadCards() }, [authorized])

  const loadCards = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/point-cards')
      const d = await r.json()
      if (d.success) setCards(d.data)
      else showToast(d.message, 'error')
    } catch { showToast('加载失败', 'error') }
    setLoading(false)
  }

  const saveCard = async () => {
    if (!form.name || form.points === undefined || form.price === undefined) {
      showToast('请填写点卡名、点数、售价', 'error'); return
    }
    try {
      const body = {
        name: form.name,
        description: form.description || null,
        points: Number(form.points),
        price: Number(form.price),
        status: form.status || 'active',
        sortOrder: Number(form.sortOrder) || 0,
      }
      const method = editing ? 'PUT' : 'POST'
      const url = editing ? `/api/admin/point-cards/${editing.id}` : '/api/admin/point-cards'
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      if (d.success) { showToast(editing ? '已更新' : '已创建', 'success'); setEditing(null); setForm({}); loadCards() }
      else showToast(d.message, 'error')
    } catch { showToast('保存失败', 'error') }
  }

  const toggleStatus = async (c: PointCard) => {
    const next = c.status === 'active' ? 'disabled' : 'active'
    try {
      const r = await fetch(`/api/admin/point-cards/${c.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const d = await r.json()
      if (d.success) { showToast(next === 'active' ? '已上架' : '已下架', 'success'); loadCards() }
      else showToast(d.message, 'error')
    } catch { showToast('操作失败', 'error') }
  }

  const deleteCard = async (id: number) => {
    if (!confirm('确定删除该点卡？已售订单不受影响')) return
    try {
      const r = await fetch(`/api/admin/point-cards/${id}`, { method: 'DELETE' })
      const d = await r.json()
      if (d.success) { showToast('已删除', 'success'); loadCards() }
      else showToast(d.message, 'error')
    } catch { showToast('删除失败', 'error') }
  }

  const startEdit = (c: PointCard) => { setEditing(c); setForm({ ...c }) }
  const startNew = () => { setEditing(null as any); setForm({ name: '', description: '', points: 1000, price: 990, status: 'active', sortOrder: cards.length }) }

  if (!authorized) return <div className="min-h-screen bg-gray-950 p-8 text-gray-400 text-sm">需要管理员权限</div>

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <p className="text-label mb-1">管理中心 / 点卡管理</p>
          <h1 className="text-mono-lg text-white">🎫 点卡（永久点数）管理</h1>
          <p className="text-gray-500 text-xs mt-2">
            点卡 ≠ 套餐：无时长概念，购买后点数直接累加到用户永久余额（User.pointBalance），永不过期、不按月清零。
            扣费顺序：先扣当月套餐额度，额度用完再扣点卡余额（1 点 = ¥0.01）。
          </p>
        </div>

        <div className="card-glass p-4 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm text-white">🎫 点卡列表 ({cards.length})</h3>
            <button onClick={startNew} className="px-3 py-1.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs hover:bg-blue-500/30">+ 新建点卡</button>
          </div>
          {loading ? <p className="text-gray-500 text-xs">加载...</p> : cards.length === 0 ? <p className="text-gray-500 text-xs">暂无点卡，点击右上角新建</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-2">名称</th>
                  <th className="text-left">描述</th>
                  <th className="text-right">点数</th>
                  <th className="text-right">售价</th>
                  <th className="text-right">等值</th>
                  <th className="text-center">状态</th>
                  <th className="text-center">操作</th>
                </tr></thead>
                <tbody>
                  {cards.map(c => (
                    <tr key={c.id} className="border-b border-white/5 text-gray-300">
                      <td className="py-1.5 font-medium">{c.name}</td>
                      <td className="max-w-[200px] truncate text-gray-500">{c.description || '—'}</td>
                      <td className="text-right font-mono text-amber-400">{fmtPoints(c.points)}</td>
                      <td className="text-right font-mono">{fmtYuan(c.price)}</td>
                      <td className="text-right font-mono text-emerald-400">{pointsToYuan(c.points)}</td>
                      <td className="text-center"><span className={c.status === 'active' ? 'text-emerald-400' : 'text-gray-600'}>{c.status === 'active' ? '上架' : '已下架'}</span></td>
                      <td className="text-center">
                        <button onClick={() => toggleStatus(c)} className={`mr-2 ${c.status === 'active' ? 'text-amber-400 hover:text-amber-300' : 'text-emerald-400 hover:text-emerald-300'}`}>{c.status === 'active' ? '下架' : '上架'}</button>
                        <button onClick={() => startEdit(c)} className="text-blue-400 hover:text-blue-300 mr-2">编辑</button>
                        <button onClick={() => deleteCard(c.id)} className="text-red-400 hover:text-red-300">删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {(editing !== null || form.name !== undefined) && (
          <div className="card-glass p-4 border border-blue-500/20">
            <h3 className="text-sm text-blue-400 mb-3">{editing ? `编辑: ${editing.name}` : '新建点卡'}</h3>
            <p className="text-[10px] text-gray-500 mb-3">
              点数体系：1 点 = ¥0.01。用户购买后，点数累加到永久余额 User.pointBalance，永不过期；扣费时先扣月套餐额度、再扣此余额。
              「等值」= 点数 ÷ 100，方便对比售价看性价比（例如 990 元可卖 99000 点 = ¥990，即 1:1 平价；也可打折促销）。
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="text-gray-500 text-[9px] block mb-0.5">点卡名</label>
                <input className="input-dark w-full" placeholder="1000点补充包" value={form.name ?? ''}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} />
              </div>
              <div>
                <label className="text-gray-500 text-[9px] block mb-0.5">点数(1点=¥0.01)</label>
                <input type="number" className="input-dark w-full" placeholder="1000" value={form.points ?? ''}
                  onChange={e => setForm(prev => ({ ...prev, points: e.target.value === '' ? '' as any : Number(e.target.value) }))} />
              </div>
              <div>
                <label className="text-gray-500 text-[9px] block mb-0.5">售价(分)</label>
                <input type="number" className="input-dark w-full" placeholder="990" value={form.price ?? ''}
                  onChange={e => setForm(prev => ({ ...prev, price: e.target.value === '' ? '' as any : Number(e.target.value) }))} />
              </div>
              <div>
                <label className="text-gray-500 text-[9px] block mb-0.5">排序</label>
                <input type="number" className="input-dark w-full" placeholder="0" value={form.sortOrder ?? 0}
                  onChange={e => setForm(prev => ({ ...prev, sortOrder: e.target.value === '' ? 0 : Number(e.target.value) }))} />
              </div>
              <div className="md:col-span-3">
                <label className="text-gray-500 text-[9px] block mb-0.5">描述（可选）</label>
                <input className="input-dark w-full" placeholder="适合额度用完的用户补充点数" value={form.description ?? ''}
                  onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={saveCard} className="px-4 py-1.5 bg-blue-500 text-white rounded text-xs">保存</button>
              <button onClick={() => { setEditing(null); setForm({}) }} className="px-4 py-1.5 bg-white/5 text-gray-400 rounded text-xs">取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
