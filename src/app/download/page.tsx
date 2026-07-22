'use client'
import { useState, useEffect } from 'react'

interface ClientInfo {
  version: string
  buildDate: string
  channel: string
  minSupportedVersion: string
  downloadUrl: string
  changelog: { version: string; date: string; title: string; changes: string[] }[]
}

export default function DownloadPage() {
  const [info, setInfo] = useState<ClientInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])
  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/client-info')
      const j = await r.json()
      if (j.success) setInfo(j.data)
    } catch {}
    setLoading(false)
  }

  const latest = info?.changelog?.[0]
  const history = info?.changelog?.slice(1) || []

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">AiMarketing 桌面客户端</h1>
        <p className="text-slate-300 mb-8">下载客户端，获得更流畅的本地体验与自动更新提醒。</p>

        {loading && <div className="text-slate-400">加载中…</div>}

        {info && (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-8">
              <span className="px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-sm">当前版本 v{info.version}</span>
              <span className="px-3 py-1 rounded-full bg-slate-700/60 text-slate-300 text-sm">渠道 {info.channel}</span>
              <span className="px-3 py-1 rounded-full bg-slate-700/60 text-slate-300 text-sm">发布 {info.buildDate}</span>
            </div>

            <a
              href={info.downloadUrl}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition font-semibold"
            >
              ⬇️ 下载客户端（Windows）
            </a>
            <p className="text-xs text-slate-400 mt-2">下载地址：{info.downloadUrl}</p>

            {/* 更新日志（最新） */}
            <section className="mt-12">
              <h2 className="text-xl font-semibold mb-4 border-l-4 border-indigo-400 pl-3">更新日志</h2>
              {latest ? (
                <div className="bg-slate-800/60 rounded-xl p-5 border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-indigo-300">v{latest.version} · {latest.title}</span>
                    <span className="text-xs text-slate-400">{latest.date}</span>
                  </div>
                  <ul className="list-decimal list-inside space-y-1 text-slate-200 text-sm">
                    {latest.changes?.map((c: string, i: number) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              ) : <p className="text-slate-400">暂无更新日志</p>}
            </section>

            {/* 历史日志 */}
            {history.length > 0 && (
              <section className="mt-10">
                <h2 className="text-lg font-semibold mb-4 text-slate-300">历史日志</h2>
                <div className="space-y-4">
                  {history.map((h, i) => (
                    <div key={i} className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/60">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-slate-200">v{h.version} · {h.title}</span>
                        <span className="text-xs text-slate-500">{h.date}</span>
                      </div>
                      <ul className="list-decimal list-inside space-y-1 text-slate-400 text-sm">
                        {h.changes?.map((c: string, j: number) => <li key={j}>{c}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
