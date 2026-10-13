'use client'
/**
 * ★VF_HTMLVIEW_V1（2026-10-13 用户实测「▶ 打开预览 打不开报错，**可能是不支持HTML格式**；
 *   个人仓库也打不开」）：**站内预览页** —— 不依赖操作系统浏览器/外链，直接在应用自己的
 *   webview 里渲染生成物。
 *
 * 为什么需要它：
 *   交付卡原来的"打开预览"指向 `/f/<uid>/<名>?t=…`（302 到 OSS）。浏览器里能渲染，
 *   但**桌面客户端**里点外链会被拦成"不支持HTML格式"；个人仓库点文件名走
 *   `/api/storage/file`（那条路由原来给 .html 发 `application/octet-stream` ⇒ 只能下载）。
 *   本页 + 修好的 `/api/storage/file`（HTML 流式 inline 直出）是**同源**的 ⇒ 一定渲染得出来。
 *
 * 用法：`/preview/repo?userId=<uid>&name=<文件名>[&dl=1]`
 *   · iframe 用 `sandbox="allow-scripts"`（**不给** allow-same-origin）：
 *     动效脚本照常跑，但页面拿不到宿主应用的 DOM/Storage（AI 自写段也不越界）。
 *   · 顶部给"下载 / 复制直链 / 打开原图（裸文件）"三个出口 —— 老板要拿文件去用时不用回聊天里翻。
 */
import { useEffect, useState } from 'react'

export default function RepoPreviewPage() {
  const [uid, setUid] = useState('')
  const [name, setName] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      setUid(String(sp.get('userId') || '').replace(/\D/g, ''))
      setName(String(sp.get('name') || ''))
    } catch { /* ignore */ }
    setReady(true)
  }, [])

  const viewUrl = ready && uid && name
    ? `/api/storage/file?userId=${uid}&name=${encodeURIComponent(name)}`
    : ''
  const dlUrl = viewUrl ? viewUrl + '&download=1' : ''
  // ★与交付卡同一口径：**父页 fetch + srcDoc**（不靠 iframe 自己带 cookie），
  //   并如实显示失败原因（不然用户只看到一片空白，无从判断是"没登录"还是"文件坏了"）。
  const [html, setHtml] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!viewUrl) return
    let dead = false
    ;(async () => {
      try {
        const r = await fetch(viewUrl, { credentials: 'include' })
        if (!r.ok) { if (!dead) setErr('读取失败（HTTP ' + r.status + (r.status === 401 ? ' · 未登录' : '') + '）'); return }
        const t = await r.text()
        if (dead) return
        if (!t || t.length < 40) setErr('文件内容是空的')
        else setHtml(t)
      } catch (e: any) { if (!dead) setErr('读取失败：' + String(e?.message || e)) }
    })()
    return () => { dead = true }
  }, [viewUrl])

  return (
    <div className="min-h-screen bg-black/95 text-gray-200 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0">
        <span className="text-xs text-gray-400 truncate flex-1" title={name}>
          📄 {name || '（缺文件名）'}
        </span>
        {viewUrl && (
          <>
            <a href={viewUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs px-2 py-1 rounded border border-white/15 hover:bg-white/[0.08]">
              裸文件
            </a>
            <a href={dlUrl}
              className="text-xs px-2 py-1 rounded border border-white/15 hover:bg-white/[0.08]">
              ⬇ 下载
            </a>
            <button
              onClick={() => { try { navigator.clipboard.writeText(window.location.origin + viewUrl) } catch { /* ignore */ } }}
              className="text-xs px-2 py-1 rounded border border-white/15 hover:bg-white/[0.08]">
              复制直链
            </button>
          </>
        )}
      </div>
      {viewUrl ? (
        err ? (
          <div className="flex-1 flex items-center justify-center text-sm text-amber-300 px-6 text-center">
            ⚠️ 打不开：{err}
            <br />（若提示未登录：说明这个页面是在**外部浏览器**里打开的 —— 回应用内用交付卡的「▶ 在卡里预览」，
            或点上面的「⬇ 下载」把文件拿走。）
          </div>
        ) : html ? (
          <iframe
            sandbox="allow-scripts"
            srcDoc={html}
            className="flex-1 w-full bg-white"
            title="repo-preview"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">加载中…</div>
        )
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          {ready ? '缺少参数：请从「日报落地页」交付卡里的「新窗口打开」进入' : '加载中…'}
        </div>
      )}
    </div>
  )
}
