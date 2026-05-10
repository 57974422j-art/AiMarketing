'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { showToast } from '@/components/Toast'

interface TaskLogItem {
  id: number; taskId: number; action: string; result: string; errorMessage: string | null; createdAt: string
}

interface AutomationTaskItem {
  id: number; type: string; status: string; params: string; assignedDeviceId: number | null
  createdBy: number; createdAt: string
  creator: { id: number; username: string; name: string | null }
  device: { id: number; name: string } | null
  taskLogs: TaskLogItem[]
}

interface AccountGroupOption {
  id: number; name: string; items: { accountId: number }[]
}
interface MediaAsset { id: number; ossUrl: string; title: string }
interface TemplateItem { id: number; name: string; type: string; params: string }

export default function AdminAutomationPage() {
  const { user, loading: authLoading } = useAuth()
  const [tasks, setTasks] = useState<AutomationTaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState<number | null>(null)
  const [cancelling, setCancelling] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [groups, setGroups] = useState<AccountGroupOption[]>([])

  const [taskType, setTaskType] = useState('互关')
  const [taskParamsJson, setTaskParamsJson] = useState('{}')
  const [taskDeviceId, setTaskDeviceId] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [mediaList, setMediaList] = useState<MediaAsset[]>([])
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [selectedMediaId, setSelectedMediaId] = useState('')
  const [selectedTmplId, setSelectedTmplId] = useState('')

  const taskTypes = ['互关', '点赞', '评论', '转发', '发布视频']

  const typeParamExamples: Record<string, string> = {
    '互关': JSON.stringify({ targetAccounts: ['user1', 'user2'] }, null, 2),
    '点赞': JSON.stringify({ targetUrls: ['https://example.com/post/1'] }, null, 2),
    '评论': JSON.stringify({ targetUrl: 'https://example.com/post/1', comment: '好内容！' }, null, 2),
    '转发': JSON.stringify({ targetUrl: 'https://example.com/post/1' }, null, 2),
    '发布视频': JSON.stringify({ videoUrl: 'https://oss.example.com/video.mp4', caption: '视频标题', platform: '抖音' }, null, 2),
  }

  useEffect(() => {
    if (!authLoading && user && user.role !== 'end-user') { loadTasks(); loadGroups(); loadMedia(); loadTemplates() }
    else if (!authLoading) setLoading(false)
  }, [authLoading, user])

  useEffect(() => { setTaskParamsJson(typeParamExamples[taskType] || '{}') }, [taskType])

  const loadTasks = async () => {
    try { const r = await fetch('/api/automation-tasks', { credentials: 'include' }); if (r.ok) setTasks((await r.json()).data || []) }
    catch {} finally { setLoading(false) }
  }

  const loadGroups = async () => {
    try { const r = await fetch('/api/account-groups', { credentials: 'include' }); if (r.ok) setGroups((await r.json()).data || []) }
    catch {}
  }

  const loadMedia = async () => {
    try { const r = await fetch('/api/media-library', { credentials: 'include' }); if (r.ok) setMediaList((await r.json()).data || []) }
    catch {}
  }
  const loadTemplates = async () => {
    try { const r = await fetch('/api/automation-templates', { credentials: 'include' }); if (r.ok) setTemplates((await r.json()).data || []) }
    catch {}
  }

  const handleToggleTemplate = (tmplId: string) => {
    if (!tmplId) return
    const tmpl = templates.find(t => t.id === parseInt(tmplId))
    if (tmpl) {
      setTaskType(tmpl.type)
      setTaskParamsJson(tmpl.params)
    }
  }

  const handleCreate = async () => {
    try {
      let params
      try { params = JSON.parse(taskParamsJson) } catch { alert('参数格式错误'); return }
      // 发布视频必须提供 videoUrl
      if (taskType === '发布视频' && !selectedMediaId && !params.videoUrl) {
        alert('发布视频任务必须填写 videoUrl 参数或从素材库选择视频')
        return
      }
      // 评论任务必须提供 comment
      if (taskType === '评论' && !params.comment) {
        alert('评论任务必须填写 comment 参数')
        return
      }
      const body: Record<string, unknown> = { type: taskType, params }
      if (taskDeviceId) body.assignedDeviceId = parseInt(taskDeviceId, 10)
      if (selectedGroupId) {
        const group = groups.find(g => g.id === parseInt(selectedGroupId))
        if (group) body.params = { ...params, accountGroupId: group.id, accountIds: group.items.map(i => i.accountId) }
      }
      // 发布视频时自动填充选中的素材
      if (selectedMediaId && taskType === '发布视频') {
        const asset = mediaList.find(m => m.id === parseInt(selectedMediaId))
        if (asset) body.params = { ...(body.params as Record<string, unknown>), videoUrl: asset.ossUrl, caption: asset.title }
      }
      const res = await fetch('/api/automation-tasks', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) { setShowCreate(false); setTaskParamsJson('{}'); setTaskDeviceId(''); setSelectedGroupId(''); setSelectedMediaId(''); setSelectedTmplId(''); loadTasks(); showToast('任务创建成功') }
      else { const d = await res.json(); showToast(d.message || '创建失败', 'error') }
    } catch { showToast('创建失败', 'error') }
  }

  const handleExecute = async (taskId: number) => {
    if (!confirm('确认手动触发此任务？')) return
    setExecuting(taskId)
    try {
      const res = await fetch(`/api/automation-tasks/${taskId}/execute`, { method: 'POST', credentials: 'include' })
      const d = await res.json()
      showToast(d.message || (d.success ? '执行成功' : '执行失败'), d.success ? 'success' : 'error')
      loadTasks()
    } catch { showToast('执行失败', 'error') }
    finally { setExecuting(null) }
  }

  const handleCancel = async (taskId: number) => {
    if (!confirm('确定取消此任务？')) return
    setCancelling(taskId)
    try {
      const res = await fetch(`/api/automation-tasks/${taskId}/cancel`, { method: 'POST', credentials: 'include' })
      const d = await res.json()
      showToast(d.message || '操作失败', 'error')
      loadTasks()
    } catch { showToast('取消失败', 'error') }
    finally { setCancelling(null) }
  }

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      '等待中': 'bg-gray-500/20 text-gray-400',
      '执行中': 'bg-blue-500/20 text-blue-400',
      '已完成': 'bg-emerald-500/20 text-emerald-400',
      '失败': 'bg-red-500/20 text-red-400',
    }
    return map[s] || 'bg-gray-500/20 text-gray-400'
  }

  if (authLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  if (!user || user.role === 'end-user') return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-400 text-center"><p className="text-xl mb-2">无权限访问</p></div></div>

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-label mb-2">管理后台 / ADMIN</p>
            <h1 className="text-mono-lg text-white">任务中心 / AUTOMATION</h1>
            <p className="text-gray-400 text-sm mt-2">
              任务总数：<span className="text-emerald-400 font-bold">{tasks.length}</span>
              {' | '}待执行：<span className="text-gray-400 font-bold">{tasks.filter(t => t.status === '等待中').length}</span>
              {' | '}失败：<span className="text-red-400 font-bold">{tasks.filter(t => t.status === '失败').length}</span>
            </p>
          </div>
          <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
            {showCreate ? '取消' : '+ 新建任务'}
          </button>
        </div>

        {showCreate && (
          <div className="card-glass p-6 mb-6">
            <h3 className="text-white font-bold mb-4">新建自动化任务</h3>

            {/* 任务模板一键加载 */}
            {templates.length > 0 && (
              <div className="mb-4 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                <label className="text-gray-500 text-xs block mb-1">从模板加载参数</label>
                <select className="input-dark" value={selectedTmplId} onChange={e => { setSelectedTmplId(e.target.value); handleToggleTemplate(e.target.value) }}>
                  <option value="" className="bg-gray-900">选择模板...</option>
                  {templates.map(t => <option key={t.id} value={t.id} className="bg-gray-900">{t.name} ({t.type})</option>)}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <label className="text-gray-500 text-xs block mb-1">任务类型</label>
                <select className="input-dark" value={taskType} onChange={e => setTaskType(e.target.value)}>
                  {taskTypes.map(t => <option key={t} value={t} className="bg-gray-900">{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">设备ID（可选）</label>
                <input className="input-dark" type="number" placeholder="关联设备ID" value={taskDeviceId} onChange={e => setTaskDeviceId(e.target.value)} />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">账号分组（可选）</label>
                <select className="input-dark" value={selectedGroupId} onChange={e => setSelectedGroupId(e.target.value)}>
                  <option value="" className="bg-gray-900">不限分组</option>
                  {groups.map(g => <option key={g.id} value={g.id} className="bg-gray-900">{g.name} ({g.items?.length || 0} 账号)</option>)}
                </select>
              </div>
              {taskType === '发布视频' && mediaList.length > 0 && (
                <div>
                  <label className="text-gray-500 text-xs block mb-1">选择素材库视频</label>
                  <select className="input-dark" value={selectedMediaId} onChange={e => setSelectedMediaId(e.target.value)}>
                    <option value="" className="bg-gray-900">手动输入URL</option>
                    {mediaList.map(m => <option key={m.id} value={m.id} className="bg-gray-900">{m.title}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="mb-4">
              <label className="text-gray-500 text-xs block mb-1">参数（JSON）</label>
              <textarea className="input-dark font-mono text-xs" rows={5} value={taskParamsJson} onChange={e => setTaskParamsJson(e.target.value)} />
            </div>
            <button onClick={handleCreate} className="btn-primary">确认创建</button>
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-400 py-12">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="card-glass p-12 text-center"><p className="text-gray-400">暂无任务</p></div>
        ) : (
          <div className="space-y-4">
            {tasks.map(t => (
              <div key={t.id} className="card-glass p-6">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-white font-bold">{t.type}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge(t.status)}`}>{t.status}</span>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      <span>ID: {t.id}</span>
                      <span>创建者: {t.creator?.username || '未知'}</span>
                      <span>设备: {t.device?.name || '未分配'}</span>
                      <span>{new Date(t.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {t.status === '等待中' && (
                      <>
                        <button onClick={() => handleExecute(t.id)} disabled={executing === t.id}
                          className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs hover:bg-emerald-500/30 disabled:opacity-50 transition-colors">
                          {executing === t.id ? '执行中...' : '▶ 执行'}
                        </button>
                        <button onClick={() => handleCancel(t.id)} disabled={cancelling === t.id}
                          className="px-3 py-1.5 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg text-xs hover:bg-red-500/30 disabled:opacity-50 transition-colors">
                          {cancelling === t.id ? '取消中...' : '✕ 取消'}
                        </button>
                      </>
                    )}
                    {t.status === '执行中' && (
                      <button onClick={() => handleCancel(t.id)} disabled={cancelling === t.id}
                        className="px-3 py-1.5 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg text-xs hover:bg-red-500/30 disabled:opacity-50 transition-colors">
                        {cancelling === t.id ? '取消中...' : '✕ 取消'}
                      </button>
                    )}
                    {t.status === '失败' && (
                      <button onClick={() => handleExecute(t.id)} disabled={executing === t.id}
                        className="px-3 py-1.5 bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 rounded-lg text-xs hover:bg-yellow-500/30 disabled:opacity-50 transition-colors">
                        {executing === t.id ? '重试中...' : '↻ 重试'}
                      </button>
                    )}
                  </div>
                </div>

                <details className="mt-2">
                  <summary className="text-gray-500 text-xs cursor-pointer hover:text-gray-300">查看参数</summary>
                  <pre className="mt-2 bg-black/30 rounded-lg p-3 text-xs text-gray-400 overflow-x-auto">
                    {JSON.stringify(JSON.parse(t.params || '{}'), null, 2)}
                  </pre>
                </details>

                {t.taskLogs && t.taskLogs.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-gray-500 text-xs cursor-pointer hover:text-gray-300">执行日志 ({t.taskLogs.length})</summary>
                    <div className="mt-2 space-y-1">
                      {t.taskLogs.map(log => (
                        <div key={log.id} className="bg-black/30 rounded px-3 py-2 text-xs">
                          <div className="flex justify-between text-gray-500 mb-1">
                            <span>{log.action}</span>
                            <span>{new Date(log.createdAt).toLocaleString()}</span>
                          </div>
                          <div className={log.errorMessage ? 'text-red-400' : 'text-emerald-400'}>
                            {log.errorMessage || log.result}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
