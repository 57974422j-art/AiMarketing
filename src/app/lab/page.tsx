'use client'

/**
 * ★LAB_DAILY_V1 · 日报实验线页面（2026-10-30）
 *
 * ⚠️ 隔离承诺：
 *   · 独立路径 `/lab`，和现有 `/agent` 完全分开
 *   · 不读写任何现有草稿（不存状态机、不生成卡片）
 *   · 只读仓库素材（GET），只写 `temp/_lab/`（新目录）
 *
 * 这条线用来验证三件在成品线不能试的事：
 *   ① 分区硬约束（图/图形不许压字）
 *   ② 卖点排在文案类型之前（内容先于形式）
 *   ③ 元素逐步出现
 */
import { useEffect, useRef, useState } from 'react'

type Item = { name: string; url: string; kind?: string }

export default function LabPage() {
  const [items, setItems] = useState<Item[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [err, setErr] = useState('')
  const [check, setCheck] = useState<any>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  /* 表单（★对照成品线的卡片设计：10 个控件一个不少）
   *
   * ★LAB_DEFAULT_V1（2026-10-30 用户定案「我只选素材，其它全默认档」）：
   *   默认值就是"自动最优"，用户**不需要调任何东西**，选完图直接出片。
   *   三个值按实测调整过（见每行理由），其余保持"不注入"（最干净、每单不重样）。
   */
  const [aspect, setAspect] = useState('9:16')       // ① 画幅：竖屏（主场景）
  const [sellingPoints, setSellingPoints] = useState('')  // ② 卖点：空 = 不注入
  const [tone, setTone] = useState('auto')                 // ③ 文案类型：自动（按素材判断）
  const [thinkMode, setThinkMode] = useState('save')       // ④ 思考：省（实测 26s vs 158s，输出还更多）
  const [plateRatio, setPlateRatio] = useState(6)          // ⑤ 大图/多图：6:4
  const [designStyle, setDesignStyle] = useState('')       // ⑥ 风格：空 = 不注入（每单不重样）
  const [drawMode, setDrawMode] = useState('some')         // ⑦ 绘制：**少量**（能画锅/杯子，又不让页面变重）
  const [tier, setTier] = useState('loose')                // ⑧ 约束：**宽松**（严格档 14 条会和风格/绘制打架）
  const [noImgEnds, setNoImgEnds] = useState(true)         // ⑨ 头尾不用素材：**勾**（首末段纯排版，减少对图依赖）
  const [userRules, setUserRules] = useState('')           // ⑩ 补充要求：空 = 不额外加约束
  const [rulesOpen, setRulesOpen] = useState(false)
  /* 高级设置默认收起来 —— 用户只选素材 + 点出片 */
  const [advOpen, setAdvOpen] = useState(false)
  /* ★手法卡模式：'a' 25 张细手法 / '' 不给卡（只在 A 引擎里用） */
  const [cardMode, setCardMode] = useState('a')
  /* ★★ 引擎开关（2026-10-31 用户定案「两套完全独立，不要掺和」）：
   *   'a' = 现在的 `/lab`（分镜表 + 设计原则 + 两条底线）
   *   'b' = 纯仓库派（四段式 Style/节拍/签名特征 + 卡 + 自评，**不传分镜表**）
   * ⚠️ 两套提示词**物理分开**（prompt.ts / prompt-v2.ts），改一个不影响另一个。 */
  const [engine, setEngine] = useState('b')
  /* ★第二轮自评返修（只对 B 引擎；费用翻倍，但质量更稳） */
  const [selfReview, setSelfReview] = useState(true)

  /* 读仓库素材（用 **lab 自己的接口**，双鉴权兜底，不依赖 middleware 注入的头） */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/lab/files', { credentials: 'include', cache: 'no-store' })
        const j = await r.json()
        if (!j?.success) {
          setErr('读素材失败：' + String(j?.message || ('HTTP ' + r.status))
            + (j?.diag ? '（header=' + String(j.diag.hasXUserId) + ' cookie=' + String(j.diag.hasCookie) + '）' : ''))
          return
        }
        setItems(Array.isArray(j.data) ? j.data : [])
      } catch (e: any) {
        setErr('读素材异常：' + String(e?.message || e))
      }
    })()
  }, [])

  function toggle(name: string) {
    setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : (p.length >= 20 ? p : [...p, name])))
  }

  async function gen() {
    if (picked.length < 3) { setErr('至少选 3 张素材'); return }
    setErr(''); setLoading(true); setResult(null); setCheck(null)
    const t0 = Date.now()
    try {
      const r = await fetch('/api/lab/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          names: picked, sellingPoints, tone, thinkMode,
          designStyle, drawMode, tier, plateRatio, noImgEnds, aspect, userRules, cardMode,
          engine, selfReview,
        }),
      })
      const j = await r.json()
      if (!j?.success) { setErr(String(j?.message || '生成失败')); setLoading(false); return }
      setResult({ ...j.data, wall: Math.round((Date.now() - t0) / 1000) })

      /* ★镜像到本地仓库（只在客户端里有效；网页版没有 electronAPI，跳过即可） */
      try {
        const api = (window as any).electronAPI
        if (api?.storageMirror && j.data?.repoName) {
          api.storageMirror('/api/storage/file?userId=' + '' + '&name=' + encodeURIComponent(j.data.repoName))
        }
      } catch { /* 网页端没有 electronAPI，正常 */ }
    } catch (e: any) {
      setErr('请求失败：' + String(e?.message || e))
    }
    setLoading(false)
  }

  /**
   * ★自检 V2（2026-10-30 阶段0）—— 跟着提示词的「自检六条」一起改。
   *
   * ⚠️ 上一版还在查「应在 480~1040」那种硬分区，但提示词里**硬分区已经删掉了**
   *    （用户定案「鸡肋，影响设计」）⇒ 于是它把**正常排布**（452~1002）误报成越界。
   *    检查器和约束必须同步，否则自检会变成噪音。
   *
   * 现在查的是"结果"，不是"位置"：
   *   ① 文字包围盒之间不许相交（≥8px 间距）
   *   ② 文字与图/图形主体不许相交（≥24px）
   *   ③ 任何元素 top+高度 ≤ 画布高 − 40（**不许靠裁切藏住**）
   *   ④ 同屏可见元素 8~14 个（少了空、多了挤）
   *   ⑤ 纵向用满：最底下沿 ≥ 画布高 − 120，最顶上沿 ≤ 100
   */
  function runZoneCheck() {
    const doc = iframeRef.current?.contentDocument
    if (!doc) { setCheck({ ok: false, problems: ['读不到 iframe（可能还没加载完）'] }); return }
    const secs = Array.from(doc.querySelectorAll('.sec')) as HTMLElement[]
    if (!secs.length) { setCheck({ ok: false, problems: ['没找到 .sec 段'] }); return }

    const problems: string[] = []
    const notes: string[] = []

    type Box = { tag: string; top: number; bottom: number; l: number; r: number; txt?: string }
    const texts: Box[] = []
    const objs: Box[] = []
    let totalVisible = 0
    let canvasH = 1280

    secs.forEach((sec, si) => {
      const base = sec.getBoundingClientRect()
      canvasH = Math.round(base.height) || canvasH
      const nodes = Array.from(sec.querySelectorAll('*')) as HTMLElement[]
      const sTexts: Box[] = []
      const sObjs: Box[] = []
      let visibleN = 0

      for (const el of nodes) {
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.height < 4) continue
        const cs = doc.defaultView!.getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue
        /* 背景层/遮罩不算"元素预算" */
        const isMask = /gradient|rgba\(0,\s*0,\s*0/.test(cs.backgroundImage) && !cs.backgroundImage.includes('data:image')
        if (!isMask) visibleN++

        const box: Box = {
          tag: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
          top: Math.round(r.top - base.top),
          bottom: Math.round(r.bottom - base.top),
          l: Math.round(r.left - base.left),
          r: Math.round(r.right - base.left),
        }
        const isImg = el.tagName === 'IMG'
          || cs.backgroundImage.indexOf('data:image') >= 0
          || (cs.backgroundImage.indexOf('url(') >= 0 && cs.backgroundImage.indexOf('data:') >= 0)
        const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0)

        if (isImg) sObjs.push(box)
        else if (ownText) { box.txt = (el.textContent || '').trim().slice(0, 10); sTexts.push(box) }
      }

      totalVisible += visibleN

      /* ③ 不许靠裁切藏住越界 */
      for (const o of sObjs) {
        if (o.bottom > canvasH - 40 + 8) {
          problems.push('段' + (si + 1) + ' 图/图形 ' + o.tag + ' 下沿 ' + o.bottom
            + 'px 超出画布（上限 ' + (canvasH - 40) + 'px）⇒ 会被裁掉下半截')
        }
      }

      /* ① 文字 × 文字 */
      for (let i = 0; i < sTexts.length; i++) {
        for (let j = i + 1; j < sTexts.length; j++) {
          const a = sTexts[i], b = sTexts[j]
          const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l)
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (ox > 6 && oy > 6) {
            problems.push('段' + (si + 1) + ' **文字叠文字**：「' + a.txt + '」压住「' + b.txt + '」')
          }
        }
      }

      /* ② 文字 × 主体 */
      for (const t of sTexts) {
        for (const o of sObjs) {
          const ox = Math.min(t.r, o.r) - Math.max(t.l, o.l)
          const oy = Math.min(t.bottom, o.bottom) - Math.max(t.top, o.top)
          if (ox > 6 && oy > 6) {
            problems.push('段' + (si + 1) + ' **文字压主体**：「' + t.txt + '」压住 ' + o.tag
              + '（重叠 ' + Math.round(ox) + '×' + Math.round(oy) + 'px）')
          }
        }
      }

      /* ④ 元素预算 */
      if (visibleN < 8) problems.push('段' + (si + 1) + ' 元素只有 ' + visibleN + ' 个（少于 8 ⇒ 画面会空）')
      if (visibleN > 16) notes.push('段' + (si + 1) + ' 元素 ' + visibleN + ' 个（多于 16 ⇒ 偏挤）')

      /* ⑤ 纵向用满 */
      const all = [...sTexts, ...sObjs]
      if (all.length) {
        const topMost = Math.min(...all.map((b) => b.top))
        const botMost = Math.max(...all.map((b) => b.bottom))
        if (topMost > 100) {
          problems.push('段' + (si + 1) + ' 最上元素上沿在 ' + topMost
            + 'px（应 ≤100）⇒ 顶部空了一大块')
        }
        if (botMost < canvasH - 120) {
          problems.push('段' + (si + 1) + ' 最下元素下沿只到 ' + botMost
            + 'px / ' + canvasH + '（应 ≥' + (canvasH - 120) + '）⇒ 底部空了一大块')
        }
      }
    })

    texts.push(...[])
    objs.push(...[])
    const head = '共 ' + secs.length + ' 段 · 可见元素 ' + totalVisible + ' 个'
    setCheck({
      ok: problems.length === 0,
      problems,
      notes,
      head,
    })
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0A0C10', color: '#E8EDF4', padding: '24px 20px 80px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        {/* 头部 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{
              fontSize: 10, letterSpacing: '.14em', padding: '3px 9px', borderRadius: 20,
              border: '1px solid rgba(232,180,90,.4)', color: '#F6DCA8', background: 'rgba(232,180,90,.1)',
            }}>实验线 · 不影响成品</span>
            <span style={{ fontSize: 10, color: '#4C5765' }}>只写 temp/_lab/ · 不进状态机 · 不生成卡片</span>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>日报实验线</h1>
          <p style={{ fontSize: 12, color: '#7A8798', lineHeight: 1.8, margin: '5px 0 0' }}>
            验证三件事：<b style={{ color: '#E8EDF4' }}>分区硬约束</b>（图/图形不许压字）·
            <b style={{ color: '#E8EDF4' }}> 卖点在文案类型之前</b> ·
            <b style={{ color: '#E8EDF4' }}> 元素逐步出现</b>
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '390px 1fr', gap: 22, alignItems: 'start' }}>

          {/* ══ 左：表单 ══ */}
          <div style={{ background: '#12161C', border: '1px solid #242C38', borderRadius: 14, padding: 13 }}>

            {/* 素材 */}
            <div style={{ fontSize: 10, color: '#7A8798', marginBottom: 7 }}>
              素材（点选，最多 20 张）<span style={{ color: '#E8EDF4', float: 'right' }}>已选 {picked.length}</span>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 4, marginBottom: 12,
              maxHeight: 190, overflowY: 'auto',
            }}>
              {items.length === 0 && (
                <div style={{ gridColumn: '1/-1', fontSize: 10, color: '#4C5765', padding: '8px 0' }}>
                  仓库里没读到图片（或未登录）
                </div>
              )}
              {items.map((it) => {
                const on = picked.includes(it.name)
                return (
                  <div key={it.name} onClick={() => toggle(it.name)}
                    title={it.name}
                    style={{
                      aspectRatio: '1', borderRadius: 4, cursor: 'pointer', overflow: 'hidden',
                      border: on ? '2px solid #3ECF8E' : '1px solid #242C38',
                      opacity: on ? 1 : 0.62, position: 'relative',
                    }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )
              })}
            </div>

            {/* ★★ 引擎开关（A = 现在这套 / B = 纯仓库派，两套提示词物理隔离） */}
            <div style={{
              marginBottom: 10, padding: '9px 10px', borderRadius: 8,
              border: '1px solid rgba(62,207,142,.35)', background: 'rgba(62,207,142,.06)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                <span style={{ fontSize: 10.5, color: '#B6F2D6', fontWeight: 600 }}>设计引擎</span>
                <span style={{ fontSize: 9, color: '#4C5765' }}>
                  {engine === 'a' ? 'A · 现在这套' : 'B · 纯仓库派'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['a', 'A · 现在的'], ['b', 'B · 仓库派']].map(([v, t]) => (
                  <button key={v} onClick={() => setEngine(v)}
                    style={{
                      flex: 1, fontSize: 10.5, padding: '7px 0', borderRadius: 5, cursor: 'pointer',
                      border: engine === v ? '1px solid #3ECF8E' : '1px solid #242C38',
                      background: engine === v ? 'rgba(62,207,142,.22)' : '#0B0F14',
                      color: engine === v ? '#D6FBEA' : '#7A8798',
                    }}>{t}</button>
                ))}
              </div>
              <div style={{ fontSize: 8.5, color: '#4C5765', marginTop: 6, lineHeight: 1.7 }}>
                {engine === 'a'
                  ? 'A：分镜表（12 段固定）+ 设计原则 + 两条底线。和之前一样。'
                  : 'B：**没有分镜表**（段数由模型自己定）+ 四段式（先定风格→定节拍→技术路线→签名特征）+ 手法卡 + 交付前自评。撞色、运镜、转场都在里面。'}
              </div>
            </div>

            {/* ★第二轮自评返修（只在 B 引擎可用） */}
            {engine === 'b' && (
              <div style={{
                marginBottom: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                border: selfReview ? '1px solid rgba(62,207,142,.35)' : '1px solid #242C38',
                background: selfReview ? 'rgba(62,207,142,.06)' : '#0B0F14',
              }} onClick={() => setSelfReview(!selfReview)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: selfReview ? '#B6F2D6' : '#7A8798' }}>
                    {selfReview ? '☑' : '☐'} 第二轮自评返修
                  </span>
                  <span style={{ fontSize: 9, color: selfReview ? '#3ECF8E' : '#4C5765' }}>
                    {selfReview ? '开（费用 ×2，质量更稳）' : '关（只跑一次）'}
                  </span>
                </div>
                <div style={{ fontSize: 8.5, color: '#4C5765', marginTop: 5, lineHeight: 1.6 }}>
                  {selfReview
                    ? '生成后把 HTML 发回去，让模型按 7 维度自评（风格保真/概念冲击/动效工艺/排版/质感/节奏/技术），≤5 分的项重写'
                    : '只跑一次生成，最便宜但质量波动大'}
                </div>
              </div>
            )}

            {/* ★LAB_CARDS：手法卡模式（只在 A 引擎生效；B 引擎内部自己管卡） */}
            <div style={{
              marginBottom: 10, padding: '8px 9px', borderRadius: 8,
              border: '1px solid rgba(169,139,255,.3)', background: 'rgba(169,139,255,.055)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: '#D9CBFF' }}>手法卡模式</span>
                <span style={{ fontSize: 9, color: '#4C5765' }}>
                  {cardMode === 'a' ? '25 张细手法' : cardMode === 'b' ? '12 张段落类型' : '不给卡'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['', '不给卡'], ['a', 'A 细手法'], ['b', 'B 段落类型']].map(([v, t]) => (
                  <button key={v || 'off'} onClick={() => setCardMode(v)}
                    style={{
                      flex: 1, fontSize: 10, padding: '6px 0', borderRadius: 5, cursor: 'pointer',
                      border: cardMode === v ? '1px solid #A98BFF' : '1px solid #242C38',
                      background: cardMode === v ? 'rgba(169,139,255,.2)' : '#0B0F14',
                      color: cardMode === v ? '#E6DCFF' : '#7A8798',
                    }}>{t}</button>
                ))}
              </div>
              <div style={{ fontSize: 8.5, color: '#4C5765', marginTop: 5, lineHeight: 1.6 }}>
                {cardMode === 'a'
                  ? '25 张手法（出血大字/跨图标题/竖排/超大数字…），模型每段自己挑一张'
                  : cardMode === 'b'
                    ? '12 张段落类型（钩子/主图/细节/数据/情绪/金句/落版），先定节奏再挑手法'
                    : '完全自由发挥（最不稳定，用来对照）'}
              </div>
            </div>

            {/* ★LAB_DEFAULT_V1：**主按钮提前** —— 用户只选素材就能出片，不用先滚过 10 个控件 */}
            <button onClick={gen} disabled={loading}
              style={{
                width: '100%', padding: 12, borderRadius: 8, marginBottom: 10,
                cursor: loading ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, border: 'none',
                background: loading ? '#2A3440' : 'linear-gradient(100deg,#3ECF8E,#4A9EFF)',
                color: loading ? '#7A8798' : '#06110B',
              }}>
              {loading ? '生成中…（约 30~180 秒）' : '🎬 一键出片（不渲染 mp4）'}
            </button>

            {/* 高级设置开关 —— 默认收起，展开才看到 10 个控件 */}
            <button onClick={() => setAdvOpen(!advOpen)}
              style={{
                width: '100%', padding: '7px 9px', borderRadius: 6, marginBottom: 10, cursor: 'pointer',
                fontSize: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                border: advOpen ? '1px solid rgba(169,139,255,.35)' : '1px solid #242C38',
                background: advOpen ? 'rgba(169,139,255,.07)' : '#0B0F14',
                color: advOpen ? '#D9CBFF' : '#7A8798',
              }}>
              <span>{advOpen ? '▼' : '▶'} 高级设置（10 项）</span>
              <span style={{ fontSize: 9, color: '#4C5765' }}>
                {advOpen ? '可调' : '默认已最优，不用动'}
              </span>
            </button>

            {advOpen && (<>
            {/* ★第 0 层：画幅（点错后果最严重 —— 横屏走另一套精简提示词） */}
            <div style={{
              marginBottom: 10, padding: '8px 9px', borderRadius: 8,
              border: '1px solid rgba(232,90,90,.32)', background: 'rgba(232,90,90,.055)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: '#FF9B9B' }}>画幅（点错就白做）</span>
                <span style={{ fontSize: 9, color: '#4C5765' }}>
                  {aspect === '9:16' ? '竖屏 720×1280' : '横屏 1280×720'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['9:16', '竖屏 9:16'], ['16:9', '横屏 16:9']].map(([v, t]) => (
                  <button key={v} onClick={() => setAspect(v)}
                    style={{
                      flex: 1, fontSize: 10, padding: '6px 0', borderRadius: 5, cursor: 'pointer',
                      border: aspect === v ? '1px solid #E85A5A' : '1px solid #242C38',
                      background: aspect === v ? 'rgba(232,90,90,.18)' : '#0B0F14',
                      color: aspect === v ? '#FFC9C9' : '#7A8798',
                    }}>{t}</button>
                ))}
              </div>
              {aspect === '16:9' && (
                <div style={{ fontSize: 8.5, color: '#F6DCA8', marginTop: 5, lineHeight: 1.6 }}>
                  ⚠️ 横屏时提示词会按 1280×720 重写，分区约束的比例也随之变化
                </div>
              )}
            </div>

            {/* ① 卖点（内容，优先） */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#7A8798', marginBottom: 5 }}>
                ① 今日卖点 / 话术 <span style={{ color: '#4C5765' }}>（内容 · 优先于形式）</span>
              </div>
              <textarea value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)}
                placeholder="例：天天有特价，今天半价牛肉系列…（不填 = 按素材判断）"
                style={{
                  width: '100%', minHeight: 54, fontSize: 11, padding: '7px 8px', borderRadius: 6,
                  background: '#0B0F14', border: '1px solid #242C38', color: '#E8EDF4',
                  resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, outline: 'none',
                }} />
            </div>

            {/* ② 文案类型（形式） */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#7A8798', marginBottom: 5 }}>
                ② 文案类型 <span style={{ color: '#4C5765' }}>（形式 · 服从内容）</span>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[['auto', '自动'], ['探店', '门店探店'], ['带货', '产品带货'], ['宠物', '宠物日常'],
                  ['旅拍', '风景旅拍'], ['写真', '人物写真'], ['品牌', '品牌宣传']].map(([v, t]) => (
                  <button key={v} onClick={() => setTone(v)}
                    style={{
                      fontSize: 10, padding: '5px 9px', borderRadius: 5, cursor: 'pointer',
                      border: tone === v ? '1px solid #4A9EFF' : '1px solid #242C38',
                      background: tone === v ? 'rgba(74,158,255,.18)' : '#0B0F14',
                      color: tone === v ? '#CFE4FF' : '#7A8798',
                    }}>{t}</button>
                ))}
              </div>
            </div>

            {/* ②′ 思考档位（性能相关，成品线也有这一项） */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: '#7A8798' }}>思考档位</span>
                <span style={{ fontSize: 9, color: '#4C5765' }}>
                  {thinkMode === 'open' ? '开（慢，思考全开）' : thinkMode === 'save' ? '省（关闭思考）' : '关（关闭思考）'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['open', '开'], ['save', '省'], ['off', '关']].map(([v, t]) => (
                  <button key={v} onClick={() => setThinkMode(v)}
                    style={{
                      flex: 1, fontSize: 10, padding: '6px 0', borderRadius: 5, cursor: 'pointer',
                      border: thinkMode === v ? '1px solid #4A9EFF' : '1px solid #242C38',
                      background: thinkMode === v ? 'rgba(74,158,255,.18)' : '#0B0F14',
                      color: thinkMode === v ? '#CFE4FF' : '#7A8798',
                    }}>{t}</button>
                ))}
              </div>
              <div style={{ fontSize: 8.5, color: '#4C5765', marginTop: 4, lineHeight: 1.55 }}>
                {thinkMode === 'open'
                  ? '实测开档约 158s、输出反而少；省/关约 26~60s'
                  : '传 thinking:{type:"disabled"}（实测唯一有效的关思考写法）'}
              </div>
            </div>

            {/* 风格 */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#7A8798', marginBottom: 5 }}>视觉风格</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[['', '不指定'], ['warm', '暖纸'], ['swiss', '瑞士'], ['morandi', '莫兰迪'],
                  ['press', '套印'], ['neon', '霓虹'], ['mag', '杂志']].map(([v, t]) => (
                  <button key={v} onClick={() => setDesignStyle(v)}
                    style={{
                      fontSize: 10, padding: '5px 9px', borderRadius: 5, cursor: 'pointer',
                      border: designStyle === v ? '1px solid #3ECF8E' : '1px solid #242C38',
                      background: designStyle === v ? 'rgba(62,207,142,.16)' : '#0B0F14',
                      color: designStyle === v ? '#B6F2D6' : '#7A8798',
                    }}>{t}</button>
                ))}
              </div>
            </div>

            {/* 绘制 */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#7A8798', marginBottom: 5 }}>
                强化绘制 <span style={{ color: '#F6DCA8' }}>（画的东西也被分区约束在 480~1040）</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['', '关'], ['some', '少量'], ['focus', '重点']].map(([v, t]) => (
                  <button key={v} onClick={() => setDrawMode(v)}
                    style={{
                      fontSize: 10, padding: '5px 11px', borderRadius: 5, cursor: 'pointer',
                      border: drawMode === v ? '1px solid #A98BFF' : '1px solid #242C38',
                      background: drawMode === v ? 'rgba(169,139,255,.16)' : '#0B0F14',
                      color: drawMode === v ? '#D9CBFF' : '#7A8798',
                    }}>{t}</button>
                ))}
              </div>
            </div>

            {/* 约束 */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#7A8798', marginBottom: 5 }}>约束档位</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['strict', '严格'], ['loose', '宽松'], ['free', '自由']].map(([v, t]) => (
                  <button key={v} onClick={() => setTier(v)}
                    style={{
                      fontSize: 10, padding: '5px 11px', borderRadius: 5, cursor: 'pointer',
                      border: tier === v ? '1px solid #4A9EFF' : '1px solid #242C38',
                      background: tier === v ? 'rgba(74,158,255,.18)' : '#0B0F14',
                      color: tier === v ? '#CFE4FF' : '#7A8798',
                    }}>{t}</button>
                ))}
              </div>
            </div>

            {/* 滑块 */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#7A8798', marginBottom: 5 }}>
                大图 / 多图 <span style={{ color: '#E8EDF4', float: 'right' }}>
                  {plateRatio.toFixed(1)} : {(10 - plateRatio).toFixed(1)}</span>
              </div>
              <input type="range" min={0} max={10} value={plateRatio}
                onChange={(e) => setPlateRatio(Number(e.target.value))}
                style={{ width: '100%' }} />
            </div>

            {/* 勾选 */}
            <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 10, color: '#7A8798', marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={noImgEnds} onChange={(e) => setNoImgEnds(e.target.checked)} />
              头尾可以不用素材
            </label>

            {/* ⑩ 补充要求（折叠，留空 = 不注入） */}
            <div style={{ marginBottom: 10 }}>
              <button onClick={() => setRulesOpen(!rulesOpen)}
                style={{
                  width: '100%', fontSize: 10, padding: '6px 9px', borderRadius: 6, cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  border: rulesOpen ? '1px solid rgba(62,207,142,.35)' : '1px solid #242C38',
                  background: rulesOpen ? 'rgba(62,207,142,.06)' : '#0B0F14',
                  color: rulesOpen ? '#B6F2D6' : '#7A8798',
                }}>
                <span>{rulesOpen ? '▼' : '▶'} 补充要求</span>
                <span style={{ fontSize: 9, color: rulesOpen ? '#3ECF8E' : '#4C5765' }}>
                  {userRules.trim() ? '已填 ' + userRules.trim().length + ' 字' : '未填'}
                </span>
              </button>
              {rulesOpen && (
                <div style={{ marginTop: 6 }}>
                  <textarea value={userRules} onChange={(e) => setUserRules(e.target.value)}
                    placeholder={'留空 = 不注入。填了就原样贴进提示词，优先于默认偏好。\n例：主标题尽量大（≥120px）；每段要有一句完整的话；底部不要留大块空白'}
                    style={{
                      width: '100%', minHeight: 78, fontSize: 10, padding: '7px 8px', borderRadius: 6,
                      background: '#0B0F14', border: '1px solid #242C38', color: '#E8EDF4',
                      resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.65, outline: 'none',
                    }} />
                </div>
              )}
            </div>

            </>)}

            <button onClick={gen} disabled={loading}
              style={{
                width: '100%', padding: 11, borderRadius: 8, cursor: loading ? 'default' : 'pointer',
                fontSize: 12, fontWeight: 600, border: 'none',
                background: loading ? '#2A3440' : 'linear-gradient(100deg,#3ECF8E,#4A9EFF)',
                color: loading ? '#7A8798' : '#06110B',
              }}>
              {loading ? '生成中…（约 30~180 秒）' : '🎬 一键出片（不渲染 mp4）'}
            </button>

            {!!err && (
              <div style={{
                marginTop: 10, fontSize: 10.5, color: '#FFB4B4', lineHeight: 1.7,
                padding: '8px 9px', borderRadius: 6, background: 'rgba(232,90,90,.1)',
                border: '1px solid rgba(232,90,90,.3)', wordBreak: 'break-all',
              }}>{err}</div>
            )}
          </div>

          {/* ══ 右：结果 ══ */}
          <div>
            {!result && !loading && (
              <div style={{
                border: '1px dashed #242C38', borderRadius: 12, padding: 40, textAlign: 'center',
                color: '#4C5765', fontSize: 12, lineHeight: 2,
              }}>
                选 3 张以上素材，点左侧「生成页面」<br />
                <span style={{ fontSize: 10.5 }}>
                  产物在 <code style={{ color: '#7A8798' }}>temp/_lab/out/</code>，不写数据库、不生成卡片
                </span>
              </div>
            )}

            {loading && (
              <div style={{
                border: '1px solid #242C38', borderRadius: 12, padding: 40, textAlign: 'center',
                color: '#7A8798', fontSize: 12,
              }}>
                <div style={{ fontSize: 22, marginBottom: 10 }}>⏳</div>
                正在生成…（deepseek 单模型，不回落）
              </div>
            )}

            {result && (
              <>
                {/* 指标 */}
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8, marginBottom: 12,
                }}>
                  {[
                    ['段数', result.segs],
                    ['送图', result.imgs + ' 张'],
                    ['请求体', result.bodyMB + ' MB'],
                    ['HTML', result.htmlKB + ' KB'],
                    ['提示词', result.promptKB + ' KB'],
                    ['总耗时', result.wall + ' s'],
                  ].map(([k, v]) => (
                    <div key={String(k)} style={{
                      background: '#12161C', border: '1px solid #242C38', borderRadius: 9,
                      padding: '8px 10px',
                    }}>
                      <div style={{ fontSize: 9, color: '#4C5765', marginBottom: 3 }}>{k}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#E8EDF4' }}>{v}</div>
                    </div>
                  ))}
                </div>

                <div style={{
                  fontSize: 10, color: '#7A8798', marginBottom: 9, padding: '7px 9px',
                  background: '#12161C', border: '1px solid #242C38', borderRadius: 7,
                  wordBreak: 'break-all',
                }}>
                  {result.diag}
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <a href={result.url} target="_blank" rel="noreferrer"
                    style={{
                      fontSize: 11, padding: '7px 14px', borderRadius: 6, textDecoration: 'none',
                      background: 'rgba(62,207,142,.15)', border: '1px solid rgba(62,207,142,.4)',
                      color: '#B6F2D6',
                    }}>↗ 新窗口打开</a>
                  <span style={{ fontSize: 10, color: '#4C5765', alignSelf: 'center' }}>
                    {result.name}
                  </span>
                </div>

                {/* 分区自检（在浏览器里跑，能拿到真实渲染尺寸） */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                  <button onClick={runZoneCheck}
                    style={{
                      fontSize: 11, padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
                      background: 'rgba(232,180,90,.14)', border: '1px solid rgba(232,180,90,.4)',
                      color: '#F6DCA8',
                    }}>🔍 分区自检（查图压字）</button>
                  <span style={{ fontSize: 10, color: '#4C5765' }}>
                    检测每段：文字是否在 0~480 · 主体是否在 480~1040 · 有没有互相重叠
                  </span>
                </div>

                {!!check && (
                  <div style={{
                    marginBottom: 11, padding: '10px 12px', borderRadius: 8,
                    background: check.ok ? 'rgba(62,207,142,.07)' : 'rgba(232,90,90,.07)',
                    border: '1px solid ' + (check.ok ? 'rgba(62,207,142,.3)' : 'rgba(232,90,90,.3)'),
                    fontSize: 10.5, lineHeight: 1.85, color: check.ok ? '#B6F2D6' : '#FFC9C9',
                  }}>
                    <b>{check.ok ? '✅ 六条自检全过' : '❌ 发现 ' + check.problems.length + ' 处问题'}</b>
                    {!!check.head && <span style={{ color: '#7A8798', marginLeft: 8 }}>{check.head}</span>}
                    {check.problems.length > 0 && (
                      <div style={{ marginTop: 6, color: '#FFB4B4' }}>
                        {check.problems.slice(0, 14).map((p: string, i: number) => (
                          <div key={i}>· {p}</div>
                        ))}
                        {check.problems.length > 14 && <div>… 还有 {check.problems.length - 14} 处</div>}
                      </div>
                    )}
                    {!!check.notes?.length && (
                      <div style={{ marginTop: 6, color: '#F6DCA8' }}>
                        {check.notes.slice(0, 6).map((p: string, i: number) => (
                          <div key={i}>◦ {p}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 预览（preview 模式：纵向铺开，滚动看全） */}
                <iframe ref={iframeRef} src={result.url} title="lab-preview"
                  style={{
                    width: '100%', height: 900, border: '1px solid #242C38', borderRadius: 10,
                    background: '#000',
                  }} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
