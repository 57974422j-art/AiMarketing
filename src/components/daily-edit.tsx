'use client'
/**
 * 两个共用件（交付卡 / 独立预览页都引这一份）：
 *   ① `DailyEditPanel` —— 卡片上的「✏️ 编辑」：**改画面上的字**。
 *   ② `DailyPreviewBox` —— 画幅切换预览：竖屏 9:16 / 横屏 16:9 / 横屏 4:3。
 *
 * ★VF_EDIT_ALLTEXT_V1（2026-10-24 用户「能让所有字都能改吗」）：
 *   以前这个面板改的是 `d.plan`（标题/信息点/版式…），再把改动翻译成命令串发给服务端。
 *   但 AI 自由档的出片产物是**一整页 HTML**，`d.plan` 只是从 HTML 反推出来的影子
 *   ⇒ **改了画面不变**（用户实测"改了没反应"）。
 *   现在改成：**列出这一段里所有文字节点 → 逐条改 → 写回 HTML**（`daily-edit-html`）
 *   ⇒ 重新出片就真的变了。版式/文字层/字号/拖拽那些旋钮一并删掉（没人看得懂，也改不动 HTML）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'

/** ★编辑面板：改画面上的每一句字（写回 HTML） */
export function DailyEditPanel({ segs, name, singleName, onClose }: {
  segs: any[]
  /** 配图版（分享 / 短链用，几十 KB） */
  name?: string
  /** 单文件版（**出片渲染读这份**）—— 必须一起改，否则改了不出现在成片里 */
  singleName?: string
  onClose: () => void
}) {
  const base = useMemo(() => (Array.isArray(segs) ? segs : []).map((s: any) => ({
    i: Number(s?.i || 0),
    texts: (Array.isArray(s?.texts) ? s.texts : []).map((x: any) => ({
      t: String(x?.t || ''),
      s: Number(x?.s || 0),
    })),
  })), [segs])

  const [rows, setRows] = useState(() => base.map((r) => ({ ...r, texts: r.texts.map((x) => ({ ...x, v: x.t })) })))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // 内容指纹：父组件每次渲染都会新建数组 ⇒ 直接依赖 base 会把用户正在输入的内容冲掉
  useEffect(() => {
    setRows(base.map((r) => ({ ...r, texts: r.texts.map((x) => ({ ...x, v: x.t })) })))
  }, [base.map((r) => r.i + ':' + r.texts.map((x) => x.t).join('|')).join('~')])

  const setText = (seg: number, idx: number, v: string) => setRows((rs) => rs.map((r) => (
    r.i === seg ? { ...r, texts: r.texts.map((x, k) => (k === idx ? { ...x, v } : x)) } : r
  )))

  const changes = useMemo(() => {
    const out: Array<{ seg: number; idx: number; from: string; to: string }> = []
    rows.forEach((r) => r.texts.forEach((x, idx) => {
      const v = String(x.v || '').trim()
      if (v && v !== x.t) out.push({ seg: r.i, idx, from: x.t, to: v })
    }))
    return out
  }, [rows])

  const save = async () => {
    if (!changes.length || busy) return
    if (!name) { setMsg('找不到产物名，改不了（请重新出一单）'); return }
    setBusy(true)
    setMsg('')
    try {
      const r = await fetch('/api/agent/daily-edit-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, singleName, edits: changes }),
      })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        const n = Number(j?.data?.changed || 0)
        const sk = Array.isArray(j?.data?.skipped) ? j.data.skipped.length : 0
        const nf = Array.isArray(j?.data?.files) ? j.data.files.length : 0
        setMsg('已改 ' + n + ' 处' + (nf > 1 ? '（分享版 + 出片版都改了）' : '') + (sk ? '，' + sk + ' 处没改成' : '') + ' —— 出片后生效')
      } else {
        setMsg('没改成：' + String(j?.message || '未知').slice(0, 100))
      }
    } catch (e: any) {
      setMsg('没改成：' + String(e?.message || e).slice(0, 100))
    } finally {
      setBusy(false)
    }
  }

  const cls = 'bg-black/30 border border-white/15 rounded px-2 py-1 text-[11px] text-gray-100 w-full'
  const tag = (s: number) => (s >= 80 ? '大字' : s >= 22 ? '正文' : s > 0 ? '小字' : '')

  return (
    <div className="mb-2 p-2 rounded-lg border border-emerald-400/30 bg-black/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-emerald-200">✏️ 改画面上的字（每段列出全部文字，改完点「保存修改」）</span>
        <button onClick={onClose} className="text-[10px] text-gray-400 hover:text-gray-200">收起</button>
      </div>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {rows.map((r) => (
          <div key={r.i} className="p-2 rounded border border-white/10">
            <div className="text-[10px] text-gray-400 mb-1">第 {r.i} 段</div>
            {r.texts.length ? r.texts.map((x, idx) => (
              <div key={idx} className="mb-1">
                <span className="text-[9px] text-gray-600 mr-1">{tag(x.s)}{x.s ? ' · ' + x.s + 'px' : ''}</span>
                <input value={x.v} onChange={(e) => setText(r.i, idx, e.target.value)} className={cls} />
              </div>
            )) : <div className="text-[10px] text-gray-600">（这段没提取到文字）</div>}
          </div>
        ))}
      </div>
      {msg ? <div className="text-[10px] text-amber-400 mt-2">{msg}</div> : null}
      <div className="flex items-center gap-2 mt-2">
        <button disabled={!changes.length || busy} onClick={save}
          className={`px-3 py-1.5 rounded-lg text-xs border ${changes.length && !busy
            ? 'border-emerald-400/40 bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/40'
            : 'border-white/10 text-gray-500 cursor-not-allowed'}`}>
          {busy ? '保存中…' : '保存修改' + (changes.length ? '（' + changes.length + ' 处）' : '')}
        </button>
        <span className="text-[10px] text-gray-500">保存后要重新出片才会生效（画面是出片时渲染的）。</span>
      </div>
    </div>
  )
}

/** 画幅：竖屏 9:16 / 横屏 16:9 / 横屏 4:3（iframe 按**真实像素**排版后再等比缩小） */
const VP: Record<string, { w: number; h: number; name: string }> = {
  v: { w: 720, h: 1280, name: '竖屏 9:16' },
  h169: { w: 1280, h: 720, name: '横屏 16:9' },
  h43: { w: 1280, h: 960, name: '横屏 4:3' },
}

export function DailyPreviewBox({ html, err, title = 'daily-preview' }: {
  html: string
  err?: string
  title?: string
}) {
  const [vp, setVp] = useState('v')
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [k, setK] = useState(0.5)
  const { w, h } = VP[vp] || VP.v
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => { const cw = el.clientWidth || w; setK(Math.min(1, cw / w)) }
    update()
    let ro: ResizeObserver | null = null
    try { ro = new ResizeObserver(update); ro.observe(el) } catch { /* 老浏览器没有就算了 */ }
    window.addEventListener('resize', update)
    return () => {
      try { ro?.disconnect() } catch { /* ignore */ }
      window.removeEventListener('resize', update)
    }
  }, [w])
  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-center gap-1 mb-1">
        {Object.keys(VP).map((id) => (
          <button key={id} onClick={() => setVp(id)}
            className={`text-[10px] px-2 py-1 rounded border ${vp === id
              ? 'border-emerald-400/50 bg-emerald-500/25 text-emerald-100'
              : 'border-white/15 text-gray-300 hover:bg-white/[0.08]'}`}>
            {VP[id].name}
          </button>
        ))}
        <span className="text-[10px] text-gray-500 ml-1">（按 {w}×{h} 真实排版后缩放显示 —— 就是这块画幅下的样子）</span>
      </div>
      {err
        ? <div className="text-[10px] text-amber-300">⚠️ 预览加载不了：{err}（可以点「↗ 新窗口打开」或下载）</div>
        : (html
          ? (
            <div ref={boxRef} className="relative w-full overflow-hidden rounded-lg border border-white/15 bg-white"
              style={{ height: Math.max(60, Math.round(h * (k || 0.5))) }}>
              <iframe sandbox="allow-scripts" srcDoc={html} title={title} style={{
                width: w, height: h, border: 0,
                transform: `scale(${k || 0.5})`, transformOrigin: 'top left',
              }} />
            </div>
          )
          : <div className="text-[10px] text-gray-400 py-6 text-center">预览加载中…（图走签名短链，通常 1~2 秒）</div>)}
    </div>
  )
}
