'use client'

import { useState, useEffect } from 'react'

interface Report {
  id: number
  app: string
  step: string
  errorLog: string
  screenshot: string | null
  diagnosis: string
  severity: string
  resolved: boolean
  createdAt: string
}

export default function DiagnosisReportsPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [filterApp, setFilterApp] = useState('')
  const [filterResolved, setFilterResolved] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    const params = new URLSearchParams({ limit: '50' })
    if (filterApp) params.set('app', filterApp)
    if (filterResolved) params.set('resolved', filterResolved)
    const res = await fetch(`/api/admin/diagnosis-reports?${params}`)
    const data = await res.json()
    setReports(data.items || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filterApp, filterResolved])

  const markResolved = async (id: number) => {
    await fetch('/api/admin/diagnosis-reports', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    load()
  }

  const sevColor = (s: string) => s === 'critical' ? 'bg-red-600' : s === 'error' ? 'bg-orange-500' : 'bg-yellow-500'
  const sevLabel = (s: string) => s === 'critical' ? '严重' : s === 'error' ? '错误' : '警告'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-6">
      {/* 顶栏 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">脚本诊断报告</h1>
          <p className="text-slate-400 text-sm mt-1">DeepSeek AI 实时分析运行日志 · 截图永久保存</p>
        </div>
        <div className="flex gap-3">
          <select value={filterApp} onChange={e => setFilterApp(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm">
            <option value="">全部 APP</option>
            <option value="抖音">抖音</option>
          </select>
          <select value={filterResolved} onChange={e => setFilterResolved(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm">
            <option value="">全部状态</option>
            <option value="false">未解决</option>
            <option value="true">已解决</option>
          </select>
          <button onClick={load} className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm transition">
            🔄 刷新
          </button>
        </div>
      </div>

      {/* 卡片列表 */}
      {loading ? (
        <div className="text-slate-500 text-center py-20">加载中...</div>
      ) : reports.length === 0 ? (
        <div className="text-slate-500 text-center py-20">
          <p className="text-4xl mb-4">📋</p>
          <p>暂无诊断报告</p>
          <p className="text-xs mt-2">脚本正常运行，或 DeepSeek 分析进程尚未启动</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {reports.map(r => (
            <div
              key={r.id}
              className={`bg-slate-900 border rounded-xl overflow-hidden transition-all ${
                r.resolved ? 'border-slate-700 opacity-60' : 'border-slate-700 hover:border-slate-600'
              }`}
            >
              {/* 卡片头 */}
              <div
                className="flex items-center gap-3 px-5 py-3 cursor-pointer"
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              >
                {/* 严重级别标签 */}
                <span className={`${sevColor(r.severity)} text-white text-xs px-2 py-0.5 rounded-full font-bold shrink-0`}>
                  {sevLabel(r.severity)}
                </span>

                {/* APP + 步骤 */}
                <span className="text-xs bg-purple-600/30 text-purple-300 px-2 py-0.5 rounded">
                  {r.app}
                </span>
                <span className="text-xs text-slate-400 font-mono">{r.step}</span>

                {/* 错误摘要 */}
                <span className="text-sm text-slate-300 truncate flex-1">
                  {r.errorLog.substring(0, 80)}
                </span>

                {/* 时间 */}
                <span className="text-xs text-slate-500 shrink-0">
                  {new Date(r.createdAt).toLocaleString('zh-CN', {
                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                  })}
                </span>

                {/* 展开图标 */}
                <span className="text-slate-500 text-sm shrink-0">
                  {expandedId === r.id ? '▲' : '▼'}
                </span>
              </div>

              {/* 展开详情 */}
              {expandedId === r.id && (
                <div className="border-t border-slate-800 px-5 py-4 space-y-4">
                  {/* 截图 */}
                  {r.screenshot && (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">📸 故障截图</p>
                      <p className="text-xs text-cyan-400 font-mono">{r.screenshot}</p>
                    </div>
                  )}

                  {/* 错误日志 */}
                  <div>
                    <p className="text-xs text-slate-500 mb-1">📄 原始日志片段</p>
                    <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-400 font-mono max-h-32 overflow-auto whitespace-pre-wrap">
                      {r.errorLog}
                    </pre>
                  </div>

                  {/* DeepSeek 诊断 */}
                  <div>
                    <p className="text-xs text-slate-500 mb-1">🧠 DeepSeek 分析</p>
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                      {r.diagnosis}
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  {!r.resolved && (
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); markResolved(r.id) }}
                        className="bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs px-3 py-1.5 rounded-lg transition"
                      >
                        ✅ 标记已解决
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 底部统计 */}
      {reports.length > 0 && (
        <div className="mt-4 text-xs text-slate-600 text-center">
          共 {reports.length} 条报告 · 
          未解决 {reports.filter(r => !r.resolved).length} · 
          严重 {reports.filter(r => r.severity === 'critical').length}
        </div>
      )}
    </div>
  )
}
