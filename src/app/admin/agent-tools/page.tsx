'use client'
import { useEffect, useState } from 'react'

type Tool = { id: number; name: string; title: string; description: string; enabled: boolean; roles: string; endpoint: string }

export default function AgentToolsPage() {
  const [tools, setTools] = useState<Tool[]>([])
  const [msg, setMsg] = useState('')
  const [name, setName] = useState(''); const [title, setTitle] = useState(''); const [desc, setDesc] = useState(''); const [roles, setRoles] = useState('all')

  const load = async () => {
    const r = await fetch('/api/admin/agent-tools', { credentials: 'include' }).then(r => r.json())
    if (r.success) setTools(r.data)
  }
  useEffect(() => { load() }, [])

  const toggle = async (t: Tool) => {
    const r = await fetch(`/api/admin/agent-tools/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ enabled: !t.enabled }) }).then(r => r.json())
    setMsg(r.message || (r.success ? '已切换' : '')); load()
  }
  const del = async (t: Tool) => {
    if (!confirm(`删除工具 ${t.name}？`)) return
    const r = await fetch(`/api/admin/agent-tools/${t.id}`, { method: 'DELETE', credentials: 'include' }).then(r => r.json())
    setMsg(r.message || '已删除'); load()
  }
  const add = async () => {
    if (!name.trim()) { setMsg('填工具名'); return }
    const r = await fetch('/api/admin/agent-tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name, title, description: desc, roles }) }).then(r => r.json())
    setMsg(r.message || (r.success ? '已添加（编辑参数请直接改库/后续扩展）' : '')); load(); setName(''); setTitle(''); setDesc('')
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-200 p-6">
      <h1 className="text-xl mb-4">🔧 AGENT 工具箱（注册工具管理）</h1>
      {msg && <p className="text-emerald-400 text-sm mb-3">{msg}</p>}
      <div className="mb-4 p-4 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-gray-400 leading-relaxed">
        <p className="text-sm text-gray-200 mb-2">📘 说明</p>
        <p>• 内置工具（生图/视频/文案等 33 个）在代码里——不在本页显示（本页只管理【动态注册工具】）</p>
        <p>• browser_use_execute = 动态注册的第一个（AI 浏览器操作）——点「已启用/已关闭」切换；点「编辑」改描述/角色</p>
        <p>• 添加工具：填 name/显示名/描述/角色 → 注册后 AGENT 自动看到；但【执行端点】需代码实现（见下方说明）</p>
        <p className="text-amber-300 mt-1">⚠️ 添加的工具能注入 AGENT（模型可见可调）——但真正执行需代码有对应处理（endpoint）——目前 browser_use_execute 有执行；新增工具的执行逻辑需开发接入（下一步）</p>
      </div>
      <div className="mb-6 p-4 rounded-lg border border-white/10 bg-white/[0.03]">
        <p className="text-sm mb-3">添加工具（注册后 AGENT 自动看到并调用；关闭=模型不可见）</p>
        <div className="flex gap-2 flex-wrap">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="工具名(英文小写)" className="px-3 py-1.5 rounded bg-black/40 border border-white/10 text-sm" />
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="显示名" className="px-3 py-1.5 rounded bg-black/40 border border-white/10 text-sm" />
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="给模型的描述(触发词/功能)" className="px-3 py-1.5 rounded bg-black/40 border border-white/10 text-sm flex-1 min-w-[300px]" />
          <select value={roles} onChange={e => setRoles(e.target.value)} className="px-3 py-1.5 rounded bg-black/40 border border-white/10 text-sm">
            <option value="all">全部角色</option><option value="admin">仅admin</option><option value="editor">仅editor</option>
          </select>
          <button onClick={add} className="px-4 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-sm">添加</button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {tools.map(t => (
          <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-white/[0.03]">
            <button onClick={() => toggle(t)} className={`px-3 py-1 rounded text-xs ${t.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>{t.enabled ? '已启用' : '已关闭'}</button>
            <div className="flex-1">
              <p className="text-sm font-medium">{t.title} <span className="text-gray-500 text-xs">({t.name} · {t.roles} · {t.endpoint || '无端点'})</span></p>
              <p className="text-xs text-gray-400 line-clamp-1">{t.description}</p>
            </div>
            <button onClick={() => { const nt = prompt('显示名', t.title); const nd = prompt('描述', t.description); const nr = prompt('角色 all/admin/editor', t.roles); if (nt || nd || nr) fetch(`/api/admin/agent-tools/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ title: nt || t.title, description: nd ?? t.description, roles: nr || t.roles }) }).then(r => r.json()).then(() => load()) }} className="px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/10 rounded">编辑</button>
            <button onClick={() => del(t)} className="px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 rounded">删除</button>
          </div>
        ))}
        {!tools.length && <p className="text-gray-500 text-sm">暂无注册工具——browser_use_execute 已预置（admin 可见）</p>}
      </div>
    </div>
  )
}
