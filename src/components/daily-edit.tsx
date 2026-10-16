'use client'
/**
 * ★VF_DAILY_V20（2026-10-13 用户原话「加一个编辑键，可以点了以后可编辑文字，可以删除，但卡片可以做到吗？」
 *   + 「这个是否能加 2 个横屏视频模式按键」）：
 *   两个共用件（方案卡 / 交付卡 / 独立预览页都引这一份，免得三处各写一套）：
 *     ① `DailyEditPanel` —— 卡片上的「✏️ 编辑」：就地改标题/信息点/版式/类型，或删段。
 *        提交时把改动翻译成**已有的命令串**（`改 <n> 字段=值` / `删 <n>`），一次发多条。
 *        为什么不做富文本编辑器：服务端 `applyDailyEdit` 早就有这套命令（含校验与人话报错），
 *        复用它 ⇒ 服务端零改动、口径只有一处；富文本所见即所得是另一档工程量。
 *     ② `DailyPreviewBox` —— 画幅切换预览：竖屏 9:16 / 横屏 16:9 / 横屏 4:3。
 *        做法：iframe 按**真实像素**排版（如 1280×720），再用 transform 等比缩到卡片宽度 ——
 *        这样触发的是页面真正的响应式断点（而不是把 1280 宽的版硬塞进小框）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { cmdDel, cmdOf, PLAN_TEXT_TYPES, PLAN_TSCALES } from '@/lib/agent/daily-plan'

const KIND_CN: Record<string, string> = { cover: '封面', feature: '正片', end: '结尾' }
const LAYOUT_CN: Array<{ id: string; name: string }> = [
  { id: 'hero', name: '满幅压字' },
  { id: 'sticker', name: '贴纸标题' },
  { id: 'vertical', name: '竖排标题' },
  { id: 'split', name: '图文左右' },
  { id: 'stack2', name: '上下双图' },
  { id: 'grid3', name: '三图拼版' },
  { id: 'grid4', name: '四宫格' },
  { id: 'quote', name: '引文页' },
]
const layoutNameOf = (id: string) => (LAYOUT_CN.find((x) => x.id === id)?.name || '')

/** ★编辑面板：就地改文字/删段 —— 提交的是既有命令串（见文件头） */
export function DailyEditPanel({ segs, onSend, onClose }: {
  segs: any[]
  onSend: (m: string) => void
  onClose: () => void
}) {
  const base = useMemo(() => (Array.isArray(segs) ? segs : []).map((s: any) => ({
    i: Number(s?.i || 0),
    t1: String((Array.isArray(s?.title) ? s.title[0] : s?.title) || ''),
    t2: String((Array.isArray(s?.title) ? s.title[1] : '') || ''),
    // 卡片里的信息点是 "大字·小字"（用 · 连的）⇒ 命令口径是 "大字,小字;大字,小字"
    pts: (Array.isArray(s?.points) ? s.points : []).map((p: any) => String(p || '').replace(/·/g, ',')).join(';'),
    imgs: (Array.isArray(s?.imgs) ? s.imgs : []).join(','),
    layout: String(s?.layout || ''),
    kind: String(s?.kind || ''),
    // ★V21：文字层 + 字号档（治"同质化"的两个旋钮）
    type: String(s?.type || 'band'),
    scale: Number(s?.scale) || 1,
  })), [segs])
  const [rows, setRows] = useState(() => base.map((r) => ({ ...r, del: false })))
  const [drag, setDrag] = useState<number | null>(null)
  useEffect(() => {
    // ⚠️ 依赖必须是**内容指纹**（而不是 base 本身）—— 父组件每次渲染都会新建数组，用 base 会把用户的拖拽顺序冲掉。
    // ★VF_DAILY_V29（2026-10-16 用户定案「7」：编辑面板"看着没生效"）：
    //   老写法只拼**段号序列**（`r.i`）⇒ 段号没变时（**只改了文字 / 版式 / 用图**）这个 effect 根本不重跑
    //   ⇒ 面板里显示的还是**上一次**的内容 ⇒ 用户保存后再打开面板看，以为"根本没改上"。
    //   现口径：把每段的**实际内容**都拼进指纹 ⇒ 任何一次真实改动都会让它变 ⇒ 面板回填到最新。
    //   拖拽顺序仍不受影响（顺序只存在本组件的 `rows` 里，不进这里的指纹）。
    setRows(base.map((r) => ({ ...r, del: false })))
  }, [base.map((r) => [r.i, r.t1, r.t2, r.pts, r.imgs, r.layout, r.kind, r.type, r.scale].join('~')).join('|')])

  const set = (i: number, patch: any) => setRows((rs) => rs.map((r) => (r.i === i ? { ...r, ...patch } : r)))
  /** 拖拽/上下移：只动**本地面板里的行序**，提交时翻译成 `排序=` 一条命令 */
  const move = (from: number, to: number) => setRows((rs) => {
    if (to < 0 || to >= rs.length || from === to) return rs
    const next = rs.slice()
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    return next
  })
  const cmds = useMemo(() => {
    const edits: string[] = []
    const dels: number[] = []
    const typeCn = (id: string) => (PLAN_TEXT_TYPES.find((t) => t.id === id)?.name || '')
    rows.forEach((r) => {
      const o = base.find((x) => x.i === r.i)
      if (!o) return
      if (r.del) { dels.push(r.i); return }
      const t = [r.t1, r.t2].map((x) => String(x || '').trim()).filter(Boolean)
      const t0 = [o.t1, o.t2].map((x) => String(x || '').trim()).filter(Boolean)
      if (t.length && t.join('/') !== t0.join('/')) edits.push(cmdOf(r.i, '标题', t.join('/')))
      if (String(r.pts || '').trim() !== String(o.pts || '').trim() && String(r.pts || '').trim()) edits.push(cmdOf(r.i, '信息点', r.pts))
      if (String(r.imgs || '').trim() && String(r.imgs || '').trim() !== String(o.imgs || '').trim()) edits.push(cmdOf(r.i, '用图', String(r.imgs)))
      if (r.kind && r.kind !== o.kind) edits.push(cmdOf(r.i, '类型', KIND_CN[r.kind] || r.kind))
      if (r.layout && r.layout !== o.layout) edits.push(cmdOf(r.i, '版式', layoutNameOf(r.layout) || r.layout))
      if (r.type && r.type !== o.type) edits.push(cmdOf(r.i, '文字层', typeCn(r.type) || r.type))
      if (Number(r.scale) !== Number(o.scale)) edits.push(cmdOf(r.i, '字号', String(r.scale)))
    })
    // ⚠️ 顺序：**先改后删**，且删除按段号**从大到小** —— 否则删掉一段会把后面的段号整体前移，改错对象
    dels.sort((a, b) => b - a).forEach((n) => edits.push(cmdDel(n)))
    // ★V21 拖拽排序：**放在最后一条**（改/删都做完之后再排）。
    //   值必须是"执行到这条时"的段号 —— 即**删完之后**的序号，所以这里把存活行的原始段号
    //   映射成它们删后位置（存活顺序 = 原始顺序），再按用户拖出来的顺序列出来。
    const alive = rows.filter((r) => !r.del)
    const posAfterDel = new Map<number, number>()
    alive.slice().sort((a, b) => a.i - b.i).forEach((r, k) => posAfterDel.set(r.i, k + 1))
    const want = alive.map((r) => posAfterDel.get(r.i) || 0)
    const isIdentity = want.every((v, k) => v === k + 1)
    if (!isIdentity && want.length >= 2 && want.every((v) => v > 0)) edits.push('排序=' + want.join(','))
    return edits
  }, [rows, base])

  const cls = 'bg-black/30 border border-white/15 rounded px-2 py-1 text-[11px] text-gray-100 w-full'
  return (
    <div className="mb-2 p-2 rounded-lg border border-emerald-400/30 bg-black/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-emerald-200">✏️ 编辑（改文字/版式/文字层/字号、删段、拖拽调顺序 —— 改完点「保存修改」）</span>
        <button onClick={onClose} className="text-[10px] text-gray-400 hover:text-gray-200">收起</button>
      </div>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {rows.map((r, idx) => (
          <div key={r.i}
            draggable
            onDragStart={() => setDrag(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (drag !== null) { move(drag, idx); setDrag(null) } }}
            onDragEnd={() => setDrag(null)}
            className={`p-2 rounded border ${r.del ? 'border-red-400/40 opacity-50' : (drag === idx ? 'border-emerald-400/50' : 'border-white/10')}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] text-gray-500 cursor-grab" title="按住拖动可调整段顺序">⠿</span>
              <span className="text-[10px] text-gray-400">第 {r.i} 段</span>
              {layoutNameOf(r.layout) ? <span className="text-[10px] text-gray-500">· {layoutNameOf(r.layout)}</span> : null}
              {KIND_CN[r.kind] ? <span className="text-[10px] text-gray-500">· {KIND_CN[r.kind]}</span> : null}
              <button onClick={() => move(idx, idx - 1)} disabled={idx === 0}
                className="text-[10px] px-1 rounded border border-white/15 text-gray-300 disabled:opacity-30">↑</button>
              <button onClick={() => move(idx, idx + 1)} disabled={idx === rows.length - 1}
                className="text-[10px] px-1 rounded border border-white/15 text-gray-300 disabled:opacity-30">↓</button>
              <label className="ml-auto text-[10px] text-red-300 flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={r.del} onChange={(e) => set(r.i, { del: e.target.checked })} />
                删这段
              </label>
            </div>
            <div className="grid grid-cols-2 gap-1 mb-1">
              <input value={r.t1} disabled={r.del} onChange={(e) => set(r.i, { t1: e.target.value })} className={cls} placeholder="标题第一行" />
              <input value={r.t2} disabled={r.del} onChange={(e) => set(r.i, { t2: e.target.value })} className={cls} placeholder="标题第二行（可空）" />
            </div>
            <input value={r.pts} disabled={r.del} onChange={(e) => set(r.i, { pts: e.target.value })} className={cls + ' mb-1'}
              placeholder="信息点：大字,小字;大字,小字（分号分组，可清空）" />
            <div className="grid grid-cols-2 gap-1 mb-1">
              <select value={r.layout} disabled={r.del} onChange={(e) => set(r.i, { layout: e.target.value })} className={cls}>
                <option value="">版式（不改）</option>
                {LAYOUT_CN.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <select value={r.kind} disabled={r.del} onChange={(e) => set(r.i, { kind: e.target.value })} className={cls}>
                <option value="">类型（不改）</option>
                <option value="cover">封面</option>
                <option value="feature">正片</option>
                <option value="end">结尾</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {/* ★V21：文字层（治"同质化"）与字号档（逐段大小） */}
              <select value={r.type} disabled={r.del} onChange={(e) => set(r.i, { type: e.target.value })} className={cls}
                title="文字层：同一结构换文字层 = 完全不同的观感">
                {PLAN_TEXT_TYPES.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <select value={String(r.scale)} disabled={r.del} onChange={(e) => set(r.i, { scale: Number(e.target.value) })} className={cls}
                title="字号档：只影响这一段标题/数字的大小">
                {PLAN_TSCALES.map((v) => <option key={v} value={String(v)}>{v === 1 ? '字号 默认' : '字号 ×' + v}</option>)}
              </select>
              <input value={r.imgs} disabled={r.del} onChange={(e) => set(r.i, { imgs: e.target.value })} className={cls}
                placeholder="用图号 如 2,4" title="图片槽位：换这一段用哪几张图（逗号分隔）" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button disabled={!cmds.length} onClick={() => { onSend(cmds.join('\n')); onClose() }}
          className={`px-3 py-1.5 rounded-lg text-xs border ${cmds.length
            ? 'border-emerald-400/40 bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/40'
            : 'border-white/10 text-gray-500 cursor-not-allowed'}`}>
          保存修改{cmds.length ? `（${cmds.length} 处）` : ''}
        </button>
        <span className="text-[10px] text-gray-500">
          拖 ⠿ 或点 ↑↓ 调段顺序；改完我先回方案卡，你点「✅ 生成 HTML」再重出文件。
        </span>
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
