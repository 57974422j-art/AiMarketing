'use client'
import { useState, useEffect } from 'react'

export default function RunTaskPage({ searchParams }: { searchParams: { serial?: string; name?: string } }) {
  const serial = searchParams.serial || ''
  const name = searchParams.name || serial

  const [tasks, setTasks] = useState<any[]>([])
  const [execTaskId, setExecTaskId] = useState<number | null>(null)
  const [logs, setLogs] = useState<Record<number, string[]>>({})

  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron

  useEffect(() => {
    if (!serial) return
    fetch('/api/tasks/mine?serial=' + serial, { credentials: 'include' }).then(r => r.json()).then(d => {
      setTasks(Array.isArray(d?.data) ? d.data.filter((t: any) => t.status === '待执行') : [])
    }).catch(() => {})
  }, [serial])

  const addLog = (taskId: number, msg: string) => {
    setLogs(p => ({ ...p, [taskId]: [...(p[taskId] || []), '[' + new Date().toLocaleTimeString() + '] ' + msg] }))
  }

  const executeTask = async (task: any) => {
    setExecTaskId(task.id)
    const api = (window as any).electronAPI
    const log = (m: string) => addLog(task.id, m)
    try {
      const pkg: Record<string, string> = { douyin: 'com.ss.android.ugc.aweme/.main.MainActivity', kuaishou: 'com.smile.gifmaker/.MainActivity', xiaohongshu: 'com.xingin.xhs/.activity.SplashActivity' }
      log('🚀 ' + task.action + ' on ' + task.platform)
      log('📲 打开应用...')
      const r = await api.adbShell(serial, 'am start -n ' + (pkg[task.platform] || task.platform))
      log(r.success ? '✅ 打开成功' : '⚠️ ' + (r.error || ''))
      await new Promise(r => setTimeout(r, 3000))
      if (task.action === 'publish') {
        log('📤 发布: ' + (task.title || ''))
        log('📤 勾子: ' + (task.hook || ''))
        await new Promise(r => setTimeout(r, 5000))
        log('✅ 发布完成')
      } else if (task.action === 'like') {
        await new Promise(r => setTimeout(r, 5000))
        await api.adbShell(serial, 'input tap 540 1400')
      } else if (task.action === 'follow') {
        await api.adbShell(serial, 'input tap 900 200')
      }
      log('✅ 完成')
      await fetch('/api/tasks/' + task.id + '/execute', { method: 'POST', credentials: 'include' })
      setTasks(p => p.filter(x => x.id !== task.id))
    } catch (e: any) { log('❌ ' + e.message) }
    setExecTaskId(null)
  }

  const runQuick = async (cmd: string, label: string) => {
    const api = (window as any).electronAPI
    const r = await api.adbShell(serial, cmd)
    setLogs(p => ({ ...p, [-1]: [...(p[-1] || []), '[' + new Date().toLocaleTimeString() + '] ' + label + ': ' + (r.success ? '✅' : '❌ ' + (r.error || ''))] }))
  }

  if (!isElectron) return <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center text-sm">请在 Electron 客户端中打开</div>

  return (
    <div className="min-h-screen bg-gray-950 p-4">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-white font-bold text-lg">📱 {name}</h1>
            <p className="text-[10px] text-gray-500">{serial}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {[
            { label: '📲 抖音', cmd: 'am start -n com.ss.android.ugc.aweme/.main.MainActivity' },
            { label: '🏠 桌面', cmd: 'input keyevent 3' },
            { label: '⬆️ 上滑', cmd: 'input swipe 540 1500 540 500' },
          ].map(b => (
            <button key={b.label} onClick={() => runQuick(b.cmd, b.label)} className="text-[10px] px-2.5 py-1.5 bg-white/5 text-gray-400 border border-white/10 rounded-lg hover:bg-white/10">{b.label}</button>
          ))}
        </div>

        <h2 className="text-xs text-gray-500 mb-2">📋 推送任务 ({tasks.length})</h2>
        {tasks.length === 0 ? (
          <div className="text-center text-gray-500 text-xs py-8 bg-white/5 rounded-xl">
            <p>暂无推送任务</p>
            <p className="mt-1">请在「本地自动化」创建并推送</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((t: any) => (
              <div key={t.id} className="bg-white/5 rounded-xl p-3 border border-white/10">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-xs font-medium">{t.title || t.action}</p>
                    <p className="text-[10px] text-gray-500">{t.platform} · {t.action}{t.hook ? ' · ' + t.hook : ''}</p>
                  </div>
                  <button onClick={() => executeTask(t)} disabled={execTaskId === t.id}
                    className="text-[10px] px-2.5 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 disabled:opacity-50">
                    {execTaskId === t.id ? '⏳' : '▶ 执行'}
                  </button>
                </div>
                {logs[t.id] && logs[t.id].length > 0 && (
                  <div className="bg-black/30 rounded p-2 mt-2 text-[10px] text-gray-400 font-mono space-y-0.5 max-h-32 overflow-y-auto">
                    {logs[t.id].map((l, i) => <p key={i}>{l}</p>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 日志汇总 */}
        {logs[-1] && logs[-1].length > 0 && (
          <div className="bg-black/30 rounded p-2 mt-4 text-[10px] text-gray-400 font-mono space-y-0.5 max-h-32 overflow-y-auto">
            {logs[-1].map((l, i) => <p key={i}>{l}</p>)}
          </div>
        )}
      </div>
    </div>
  )
}
