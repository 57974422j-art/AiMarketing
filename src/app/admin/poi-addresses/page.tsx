'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface PoiItem {
  id: number
  name: string
  address: string
  lat: number
  lng: number
  platform: string
  ownerId: number
  owner?: { id: number; username: string }
}

export default function AdminPoiAddressesPage() {
  const { user, loading: authLoading } = useAuth()
  const [items, setItems] = useState<PoiItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<PoiItem | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 表单
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [platform, setPlatform] = useState('抖音')

  const platforms = ['抖音', '快手', '小红书', '视频号', '微博', 'B站']

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadItems()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadItems = async () => {
    try {
      const res = await fetch('/api/poi-addresses', { credentials: 'include' })
      if (res.ok) { const d = await res.json(); setItems(d.data || []) }
    } catch { console.error('加载失败') }
    finally { setLoading(false) }
  }

  const resetForm = () => { setName(''); setAddress(''); setLat(''); setLng(''); setPlatform('抖音') }

  const openCreate = () => { resetForm(); setEditItem(null); setShowForm(true) }
  const openEdit = (item: PoiItem) => {
    setEditItem(item); setName(item.name); setAddress(item.address)
    setLat(item.lat.toString()); setLng(item.lng.toString()); setPlatform(item.platform); setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!name || !address || !lat || !lng) { showToast('请填写完整', 'error'); return }
    const latNum = parseFloat(lat); const lngNum = parseFloat(lng)
    if (isNaN(latNum) || latNum < -90 || latNum > 90) { showToast('纬度无效（范围 -90 ~ 90）', 'error'); return }
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) { showToast('经度无效（范围 -180 ~ 180）', 'error'); return }
    setSubmitting(true)
    try {
      const url = '/api/poi-addresses'
      const method = editItem ? 'PUT' : 'POST'
      const body = editItem ? { id: editItem.id, name, address, lat, lng, platform } : { name, address, lat, lng, platform }
      const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (res.ok) { setShowForm(false); loadItems(); showToast(editItem ? '地址已更新' : '地址已添加') }
      else { const d = await res.json(); showToast(d.message || '操作失败', 'error') }
    } catch { showToast('操作失败', 'error') }
    finally { setSubmitting(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此地址？')) return
    const res = await fetch(`/api/poi-addresses?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) loadItems(); else showToast('删除失败', 'error')
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2">无权限访问</p></div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">管理后台 / ADMIN</p>
            <h1 className="text-mono-lg text-white">POI 地址库 / POI ADDRESSES</h1>
            <p className="text-gray-400 text-sm mt-2">总数：<span className="text-emerald-400 font-bold">{items.length}</span></p>
          </div>
          <button onClick={openCreate} className="btn-primary">+ 新增地址</button>
        </div>

        {showForm && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4">{editItem ? '编辑地址' : '新增地址'}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <input className="input-dark" placeholder="名称 *" value={name} onChange={e => setName(e.target.value)} />
              <input className="input-dark" placeholder="详细地址 *" value={address} onChange={e => setAddress(e.target.value)} />
              <input className="input-dark" type="number" step="0.000001" placeholder="纬度 lat *" value={lat} onChange={e => setLat(e.target.value)} />
              <input className="input-dark" type="number" step="0.000001" placeholder="经度 lng *" value={lng} onChange={e => setLng(e.target.value)} />
              <select className="input-dark" value={platform} onChange={e => setPlatform(e.target.value)}>
                {platforms.map(p => <option key={p} value={p} className="bg-gray-900">{p}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary disabled:opacity-50">{submitting ? '保存中...' : '保存'}</button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">取消</button>
            </div>
          </div>
        )}

        {loading ? <div className="text-center text-gray-400 py-12">加载中...</div>
        : items.length === 0 ? <div className="card-glass p-12 text-center"><p className="text-gray-400">暂无地址</p></div>
        : <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-gray-500 text-mono-sm">
                  <th className="pb-3 pr-4">ID</th>
                  <th className="pb-3 pr-4">名称</th>
                  <th className="pb-3 pr-4">地址</th>
                  <th className="pb-3 pr-4">坐标</th>
                  <th className="pb-3 pr-4">平台</th>
                  <th className="pb-3 pr-4">所属</th>
                  <th className="pb-3 pr-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-3 pr-4 text-gray-400">{item.id}</td>
                    <td className="py-3 pr-4 text-white font-medium">{item.name}</td>
                    <td className="py-3 pr-4 text-gray-400 max-w-[200px] truncate">{item.address}</td>
                    <td className="py-3 pr-4 text-gray-400">{item.lat.toFixed(4)},{item.lng.toFixed(4)}</td>
                    <td className="py-3 pr-4"><span className="bg-white/5 px-2 py-0.5 rounded text-xs">{item.platform}</span></td>
                    <td className="py-3 pr-4 text-gray-400">{item.owner?.username || '-'}</td>
                    <td className="py-3 pr-4 flex gap-2">
                      <button onClick={() => openEdit(item)} className="px-2 py-1 text-xs bg-white/10 text-gray-300 rounded hover:bg-white/20">编辑</button>
                      <button onClick={() => handleDelete(item.id)} className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30">删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>
    </div>
  )
}
