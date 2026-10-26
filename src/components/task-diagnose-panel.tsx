'use client'
/* ═══════════════════════════════════════════════════════════════════════════
 * ★VF_TASK_TRACE_V1-D4（2026-10-26 用户定案）【🩺 这次怎么了】
 *
 * 用户原话：「看不到 AI 回复，每次要去服务器找很烦」「几万字人看不懂」
 *          「这个是否给 AI 看，人只看原因」
 * ⇒ 点一下：**上半 = 3~5 条人话结论**（what / why / fix，admin 还带日志原文 evidence）；
 *          **下半 = 「原始日志」折叠**（默认收起，可复制，给开发用）。
 *
 * 数据来源：`GET /api/agent/task-trace?taskId=…&diag=1`
 *   · 服务端只读**自己**目录、文件名白名单、400KB 上限（见该路由文件头）；
 *   · 普通用户的 `evidence` 由**服务端**抹掉（不是这里隐藏）⇒ 前端不判断权限，只按返回渲染。
 * ⚠️ 这里**不编**：接口没结论就显示「这一单没有可读的日志」/「没有结论」，绝不用假数据兜底。
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useState } from 'react'

interface DiagItem { what?: string; why?: string; evidence?: string; fix?: string }

export default function TaskDiagnoseButton({ taskId, className = '' }: { taskId: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [items, setItems] = useState<DiagItem[]>([])
  const [log, setLog] = useState('')
  const [role, setRole] = useState('')
  const [size, setSize] = useState(0)
  const [logOpen, setLogOpen] = useState(false)   // 原始日志默认收起
  const [copied, setCopied] = useState(false)

  const id = String(taskId || '').trim()

  const run = async () => {
    if (!id) { setErr('这条消息没有任务号'); setOpen(true); return }
    setOpen(true)
    setLoading(true)
    setErr('')
    setItems([])
    setLog('')
    try {
      const r = await fetch('/api/agent/task-trace?taskId=' + encodeURIComponent(id) + '&diag=1', { credentials: 'include' })
        .then((x) => x.json())
      if (r?.message && !r?.text) setErr(String(r.message))
      const dg: DiagItem[] = Array.isArray(r?.diagnosis) ? r.diagnosis : []
      setItems(dg)
      setLog(String(r?.text || ''))
      setRole(String(r?.diagRole || ''))
      setSize(Number(r?.size) || 0)
      if (!dg.length && r?.text) setErr('AI 这一次没有给出结论（日志见下方）')
    } catch (e: any) {
      setErr('读取失败：' + String(e?.message || e).slice(0, 120))
    } finally {
      setLoading(false)
    }
  }

  const copyLog = () => {
    try {
      navigator.clipboard.writeText(log || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <>
      <button
        onClick={run}
        title="AI 读这一单的日志，给 3~5 条人话结论（原始日志可展开）"
        className={'px-2 py-1 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-300 text-[10px] hover:bg-violet-500/20 transition ' + className}
      >
        🩺 这次怎么了
      </button>

      {open && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-2xl max-h-[86vh] flex flex-col rounded-xl border border-white/10 bg-[#0d1117] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头 */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
              <span className="text-[12px] text-violet-300 font-medium">🩺 这次怎么了</span>
              <span className="text-[9px] text-gray-600 truncate">任务 {id || '（无）'}</span>
              <button onClick={() => setOpen(false)} className="ml-auto px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 text-[10px]">关闭</button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {/* 上半：结论 */}
              {loading && <p className="text-[11px] text-gray-400 animate-pulse">正在读日志出结论…（几秒）</p>}
              {!loading && err && <p className="text-[11px] text-amber-400">{err}</p>}
              {!loading && !items.length && !err && <p className="text-[11px] text-gray-500">没有结论。</p>}
              {!loading && items.map((it, i) => (
                <div key={i} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-[11px] text-gray-200 leading-snug">
                    <span className="text-violet-300 mr-1">{i + 1}.</span>
                    {it.what || '（未说明）'}
                  </p>
                  {it.why ? <p className="text-[10px] text-gray-400 mt-1 leading-snug">原因：{it.why}</p> : null}
                  {it.fix ? <p className="text-[10px] text-emerald-300/90 mt-1 leading-snug">怎么办：{it.fix}</p> : null}
                  {it.evidence ? (
                    <p className="text-[9px] text-gray-600 mt-1 font-mono break-all leading-snug">日志原文：{it.evidence}</p>
                  ) : null}
                </div>
              ))}
              {!loading && items.length > 0 && (
                <p className="text-[9px] text-gray-600">
                  结论只依据日志里**真实记录**的内容；日志里没有的不会写。
                  {role === 'admin' ? '' : '（日志原文仅管理员可见）'}
                </p>
              )}

              {/* 下半：原始日志（默认收起） */}
              <div className="rounded-lg border border-white/10 overflow-hidden">
                <button
                  onClick={() => setLogOpen((v) => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-[10px] text-gray-400"
                >
                  <span>{logOpen ? '▾' : '▸'} 原始日志</span>
                  <span className="text-gray-600">
                    {log ? `${Math.round((size || log.length) / 1024)}KB` : '（没有）'}
                  </span>
                  {log ? (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); copyLog() }}
                      className="ml-auto px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-300"
                    >{copied ? '已复制' : '复制'}</span>
                  ) : null}
                </button>
                {logOpen && (
                  <pre className="max-h-72 overflow-auto px-3 py-2 text-[9px] leading-relaxed text-gray-500 font-mono whitespace-pre-wrap break-all bg-black/40">
{log || '（这一单没有日志 —— 只给新任务写，老任务本来就不留）'}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
