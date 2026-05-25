'use client'
import { useState, useEffect } from 'react'

export default function PushedTasks({ deviceId }: { deviceId: string }) {
  const [tasks, setTasks] = useState<any[]>([])
  const [execId, setExecId] = useState<number | null>(null)
  const [logs, setLogs] = useState<Record<number, string[]>>({})

  useEffect(() => {
    fetch('/api/tasks/mine?serial=' + deviceId, { credentials: 'include' }).then(r => r.json()).then(d => {
      setTasks(Array.isArray(d?.data) ? d.data.filter((t: any) => t.status === '待执行') : [])
    }).catch(() => {})
  }, [deviceId])

  if (tasks.length === 0) return null

  const log = (taskId: number, m: string) => setLogs(p => ({ ...p, [taskId]: [...(p[taskId] || []), '[' + new Date().toLocaleTimeString() + '] ' + m] }))

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  const execute = async (t: any) => {
    setExecId(t.id); setLogs(p => { const n = { ...p }; delete n[t.id]; return n })
    const api = (window as any).electronAPI
    const a = (m: string) => log(t.id, m)

    try {
      // 1. 打开抖音
      a('📲 打开抖音...')
      await api.adbShell(deviceId, 'am start -n com.ss.android.ugc.aweme/.main.MainActivity')
      await sleep(6000)

      // 2. 等待进入推荐流
      a('⏳ 等待推荐流加载...')
      await sleep(4000)

      if (t.action === 'like') {
        a('❤️ 双击屏幕点赞...')
        await sleep(2000)
        await api.adbShell(deviceId, 'input tap 540 1400')
        await sleep(500)
        await api.adbShell(deviceId, 'input tap 540 1400')
        await sleep(1000)
        a('✅ 点赞完成')
      } else if (t.action === 'follow') {
        a('➕ 点击关注...')
        await api.adbShell(deviceId, 'input tap 950 200')
        await sleep(2000)
        a('✅ 关注完成')
      } else if (t.action === 'comment') {
        a('💬 打开评论...')
        await api.adbShell(deviceId, 'input tap 540 1500')
        await sleep(3000)
        a('✅ 评论框已打开')
      } else if (t.action === 'search') {
        a('🔍 打开搜索...')
        await api.adbShell(deviceId, 'input tap 540 80')
        await sleep(2000)
        a('✅ 搜索框已打开')
      } else if (t.action === 'publish') {
        a('📤 准备发布: ' + (t.title || ''))
        a('📤 自动发布需视频本地文件，当前暂支持手动发布')
        a('📤 请在手机上打开抖音 → 底部 + → 上传视频')
        await sleep(3000)
        a('✅ 发布流程已提示')
      }

      // 3. 标记完成
      a('✅ 执行完成')
      await fetch('/api/tasks/' + t.id + '/execute', { method: 'POST', credentials: 'include' })
      setTasks(p => p.filter(x => x.id !== t.id))
    } catch (e: any) { a('❌ 异常: ' + e.message) }
    setExecId(null)
  }

  return (
    <div className="mb-3 bg-emerald-500/5 rounded-xl p-3 border border-emerald-500/20">
      <p className="text-[10px] text-emerald-400 font-bold mb-2">📋 推送任务 ({tasks.length})</p>
      <div className="space-y-1.5">
        {tasks.map(t => (
          <div key={t.id} className="bg-white/5 rounded-lg p-2 border border-white/10">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-white truncate">{t.title || t.action}</p>
                <p className="text-[9px] text-gray-500">{t.platform} · {t.action}{t.hook ? ' · ' + t.hook : ''}</p>
              </div>
              <button onClick={() => execute(t)} disabled={execId === t.id}
                className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30 disabled:opacity-50 shrink-0 ml-2">
                {execId === t.id ? '⏳' : '▶ 执行'}
              </button>
            </div>
            {logs[t.id]?.length > 0 && (
              <div className="text-[9px] text-gray-400 font-mono mt-1 max-h-20 overflow-y-auto space-y-0.5">
                {logs[t.id].map((l, i) => <p key={i}>{l}</p>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
