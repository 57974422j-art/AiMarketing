'use client'
import { useEffect, useState } from 'react'

/**
 * ★VF_STUDIOADMIN_V1（2026-10-08 用户定案）：后台「风格库 / 实验室」
 *
 * 用户口径（原话）：
 *   · 「把你新作的 2 个页可以加到 admin 权限下的后台页面中去，方便我们使用」
 *   · 「admin 账号可见标签就行了」（⇒ 本页只对 admin 可见：菜单项 roles=['admin']）
 *   · 「只允许 admin 本地用，现在用户机器没有 ffmpeg，用户也不参与试片」
 *   · 「名字可以 风格库 / 实验室 就行，不要素材片」
 *
 * 做法：本页**不重复实现**界面 —— 它探活本机小服务（studio-server，127.0.0.1:7788），
 * 在线就把两个既有面板（风格库 / 实验室）**内嵌**进来；离线就给出启动命令。
 * 这样"建库 / 试片 / 出片"三个重活都只在**管理员本机**跑，生产服务器与普通用户都不受影响。
 *
 * 落盘（引擎侧，见 studio-server.mjs ★VF_STUDIORUNTIME_V1 + 记忆「风格库 / 实验室」）：
 *   · 风格包 → `storage/_studio/styles/`（**运行时库**；内置库 html-deck/styles 只读，
 *     要固化进内置库由 AI 提交进仓库，避免在生产上写代码目录造成 git 冲突）
 *   · 试片/成片/抽帧 → `storage/_studio/out/`
 */
export default function VfStudioPage() {
  const [st, setSt] = useState<any>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'lib' | 'lab'>('lib')
  const [copied, setCopied] = useState(false)

  const check = async () => {
    try {
      const r = await fetch('/api/admin/vf-studio', { credentials: 'include' }).then((x) => x.json())
      if (!r?.success) { setErr(r?.message || '无权访问（仅管理员）'); return }
      setSt(r.data); setErr('')
    } catch (e: any) { setErr(String(e?.message || e)) }
  }
  useEffect(() => { check() }, [])

  const url: string = String(st?.url || 'http://127.0.0.1:7788')
  const online = !!st?.online
  const cmd = 'node scripts/video-factory/html-deck/tools/studio-server.mjs'
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-200 p-6">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-xl">🎨 风格库 / 实验室</h1>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${online ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-amber-300 border-amber-500/40 bg-amber-500/10'}`}>
          {online ? '本机服务在线' : '本机服务未启动'}
        </span>
        <button onClick={check} className="text-[11px] px-2 py-0.5 rounded border border-white/15 hover:bg-white/[0.06]">重新检测</button>
        {st?.info?.runtimeN != null ? (
          <span className="text-[11px] text-gray-400">库：内置 {st.info.builtinN} 套 / 运行时 {st.info.runtimeN} 套</span>
        ) : null}
      </div>
      <p className="text-[11px] text-gray-500 mb-4">
        只在**管理员本机**跑（抽帧 / 试片 / 出片都要 ffmpeg + 超帧引擎）。风格包写运行时库
        <code className="mx-1 px-1 rounded bg-white/[0.06]">storage/_studio/styles</code>
        ，产物落
        <code className="mx-1 px-1 rounded bg-white/[0.06]">storage/_studio/out</code>
        ；内置库只读，要固化进内置库由 AI 提交进仓库。
      </p>

      {err ? <div className="mb-4 text-sm text-rose-300">{err}</div> : null}

      {!err && !st ? <div className="text-sm text-gray-400">检测中…</div> : null}

      {!err && st && !online ? (
        <div className="max-w-2xl p-4 rounded-lg border border-white/10 bg-white/[0.03]">
          <p className="text-sm text-amber-300 mb-2">先在本机把服务启起来（只监听 127.0.0.1，不对外）</p>
          <div className="flex items-center gap-2 mb-3">
            <code className="flex-1 px-3 py-2 rounded bg-black/50 border border-white/10 text-[12px] text-emerald-200 overflow-x-auto whitespace-pre">{cmd}</code>
            <button onClick={copy} className="text-[11px] px-3 py-2 rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-200">
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 whitespace-pre-wrap leading-relaxed">{String(st?.hint || '')}</p>
          <p className="text-[11px] text-gray-500 mt-3">
            地址：<code className="px-1 rounded bg-white/[0.06]">{url}</code>
            （可用环境变量 <code className="px-1 rounded bg-white/[0.06]">VF_STUDIO_URL</code> 改）
          </p>
        </div>
      ) : null}

      {!err && online ? (
        <>
          <div className="flex gap-1.5 mb-2">
            <button onClick={() => setTab('lib')}
              className={`px-3 py-1 rounded text-[12px] border ${tab === 'lib' ? 'bg-white/[0.10] border-white/20 text-white' : 'border-white/10 text-gray-400 hover:bg-white/[0.06]'}`}>
              风格库（建库 / 试片）
            </button>
            <button onClick={() => setTab('lab')}
              className={`px-3 py-1 rounded text-[12px] border ${tab === 'lab' ? 'bg-white/[0.10] border-white/20 text-white' : 'border-white/10 text-gray-400 hover:bg-white/[0.06]'}`}>
              实验室（素材 → 出片）
            </button>
            <a href={`${url}${tab === 'lab' ? '/lab' : '/'}`} target="_blank" rel="noreferrer"
              className="px-3 py-1 rounded text-[12px] border border-white/10 text-gray-300 hover:bg-white/[0.06]">↗ 新窗口打开</a>
          </div>
          <div className="rounded-lg overflow-hidden border border-white/10 bg-black/40">
            {/* 两个既有面板原样内嵌（它们本就调本机服务的 /api/*；同机同源，无需 CORS） */}
            <iframe
              key={tab}
              src={`${url}${tab === 'lab' ? '/lab' : '/'}`}
              className="w-full"
              style={{ height: '78vh' }}
              title={tab === 'lab' ? '实验室' : '风格库'}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
