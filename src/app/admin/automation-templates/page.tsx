'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface TemplateItem {
  id: number; name: string; type: string; params: string; createdAt: string
}

export default function AdminAutomationTemplatesPage() {
  const { user, loading: authLoading } = useAuth()
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('互关')
  const [paramsJson, setParamsJson] = useState('{}')

  const taskTypes = ['互关', '点赞', '评论', '转发', '发布视频']

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') loadTemplates()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  const loadTemplates = async () => {
    try { const r = await fetch('/api/automation-templates', { credentials: 'include' }); if (r.ok) setTemplates((await r.json()).data || []) }
    catch {} finally { setLoading(false) }
  }

  const handleCreate = async () => {
    if (!name.trim()) { showToast('请输入模板名称', 'error'); return }
    let params
    try { params = JSON.parse(paramsJson) } catch { showToast('参数 JSON 格式错误', 'error'); return }
    setCreating(true)
    const r = await fetch('/api/automation-templates', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type, params }) })
    if (r.ok) { setShowForm(false); setName(''); setParamsJson('{}'); loadTemplates() }
    else { const d = await r.json(); showToast(d.message || '创建失败', 'error') }
    setCreating(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此模板？')) return
    const r = await fetch(`/api/automation-templates?id=${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) loadTemplates(); else showToast('删除失败', 'error')
  }

  const previewParams = (json: string) => {
    try { return JSON.stringify(JSON.parse(json), null, 2) } catch { return json }
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2">无权限</p></div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">管理后台 / ADMIN</p>
            <h1 className="text-mono-lg text-white">任务模板 / AUTOMATION TEMPLATES</h1>
            <p className="text-gray-400 text-sm mt-2">总数：<span className="text-emerald-400 font-bold">{templates.length}</span></p>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">{showForm ? '取消' : '+ 新建模板'}</button>
        </div>

        {showForm && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4">新建任务模板</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <input className="input-dark" placeholder="模板名称 *" value={name} onChange={e => setName(e.target.value)} />
              <select className="input-dark" value={type} onChange={e => setType(e.target.value)}>
                {taskTypes.map(t => <option key={t} value={t} className="bg-gray-900">{t}</option>)}
              </select>
            </div>
            <div className="mb-4">
              <label className="text-gray-500 text-xs block mb-1">默认参数（JSON）</label>
              <textarea className="input-dark font-mono text-xs" rows={4} value={paramsJson} onChange={e => setParamsJson(e.target.value)} />
            </div>
            <button onClick={handleCreate} disabled={creating} className="btn-primary disabled:opacity-50">{creating ? '创建中...' : '创建'}</button>
          </div>
        )}

        {loading ? <div className="text-center text-gray-400 py-12">加载中...</div>
        : templates.length === 0 ? <div className="card-glass p-12 text-center"><p className="text-gray-400">暂无模板</p></div>
        : <div className="space-y-4">
            {templates.map(t => (
              <div key={t.id} className="card-glass p-5">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="text-white font-bold">{t.name}</h3>
                    <div className="flex gap-2 mt-1">
                      <span className="bg-white/5 px-2 py-0.5 rounded text-xs text-gray-400">{t.type}</span>
                      <span className="text-gray-500 text-xs">{new Date(t.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(t.id)} className="px-3 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30">删除</button>
                </div>
                <details className="mt-2">
                  <summary className="text-gray-500 text-xs cursor-pointer hover:text-gray-300">查看参数</summary>
                  <pre className="mt-2 bg-black/30 rounded p-3 text-xs text-gray-400 overflow-x-auto">{previewParams(t.params)}</pre>
                </details>
              </div>
            ))}
          </div>}
      </div>
    </div>
  )
}
