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
      /* ★VF_EDIT_SIMPLIFY_V1（2026-10-24 用户定案「版式/文字层/字号/拖拽 我都看不明白，没人能看明白，删掉」）：
         这里不再生成 `类型=` / `版式=` / `文字层=` / `字号=` / `排序=` 这些命令。
         原因不只是"看不懂"：AI 自由档的出片产物是**整页 HTML**，这些参数改的是 `d.plan`
         —— 而 `d.plan` 只是从 HTML 反推出来的影子，改了**不影响画面**（用户实测"改了没反应"）。
         现在面板只做两件事：**改文字**（标题/信息点/用图）+ **删段**。 */
    })
    // ⚠️ 顺序：**先改后删**，且删除按段号**从大到小** —— 否则删掉一段会把后面的段号整体前移，改错对象
    dels.sort((a, b) => b - a).forEach((n) => edits.push(cmdDel(n)))
    return edits
  }, [rows, base])

  const cls = 'bg-black/30 border border-white/15 rounded px-2 py-1 text-[11px] text-gray-100 w-full'
  return (
    <div className="mb-2 p-2 rounded-lg border border-emerald-400/30 bg-black/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-emerald-200">✏️ 编辑（改文字 / 删段 —— 改完点「保存修改」）</span>
        <button onClick={onClose} className="text-[10px] text-gray-400 hover:text-gray-200">收起</button>
      </div>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {rows.map((r, idx) => (
          <div key={r.i}
            /* ★VF_EDIT_SIMPLIFY_V1：拖拽/↑↓/版式/类型标签全部去掉（改了要么没用、要么要重排时间轴） */
            className={`p-2 rounded border ${r.del ? 'border-red-400/40 opacity-50' : 'border-white/10'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] text-gray-400">第 {r.i} 段</span>
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
            {/* ★VF_EDIT_SIMPLIFY_V1：版式 / 类型 / 文字层 / 字号档 四个下拉全删（用户看不懂，而且改了不影响 AI 出的 HTML）。
                只留「用图号」—— 换图是能看得懂、也用得上的。 */}
            <input value={r.imgs} disabled={r.del} onChange={(e) => set(r.i, { imgs: e.target.value })} className={cls}
              placeholder="用图号 如 2,4" title="换这一段用哪几张图（逗号分隔）" />
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
        {/* ★VF_EDIT_SIMPLIFY_V1：原来写"改完我先回方案卡，你点「✅ 生成 HTML」"—— 方案卡已经删了，这句会骗人 */}
        <span className="text-[10px] text-gray-500">
          改完点「保存修改」，再重新出片才会生效（画面是出片时渲染的）。
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
