'use client'

/**
 * ★LAB2 页面（2026-11-02）
 *
 * 和老 lab 的差别：
 *   ① 只有 1 个分类（内容类型 8 选 1），不再有"引擎/手法卡/视觉类型"三层
 *   ② **重做 + 修改意见**（P0：用户和 AI 沟通的入口）
 *   ③ **完成复制**（P0：一键复制本单要求 + trace + 指标 + prompt）
 *   ④ 生成完直接显示 `__trace` 和 技术指标（不用读源码）
 */

import { useEffect, useRef, useState } from 'react'

type Item = { name?: string; key?: string; url?: string }

type Trace = Record<string, unknown> | null

type Metrics = {
  sections: number
  svg: number
  text: number
  canvas: number
  lineHeightMin: number | null
  lineHeightBad: number
  letterSpacingNeg: number
  letterSpacingMin: number | null
  darkCount: number
  darkMin: number | null
  hasSticker: boolean
  hasTrace: boolean
  hasAutoplay?: boolean
  hasImgs?: number
  cssVarP?: number
  svgCount?: number
  svgText?: number
  paintOrder?: number
  canvasCount?: number
}

type Seg = { start: number; duration: number }

type Review = {
  rounds: number
  issues: string[]
  changes: string[]
  shotOk: boolean
  shotErr?: string
}

type Result = {
  url: string
  name: string
  repoId?: string
  savedTo?: string
  review?: Review | null
  imgSent?: number
  imgEmbedded?: number
  imgErrs?: string[]
  ossKeys?: string[]
  elapsed: number
  totalSeconds?: number
  segments?: Seg[]
  trace: Trace
  metrics: Metrics
  prompt: string
  memoriesUsed: string[]
  html: string
}

const CONTENTS: [string, string][] = [
  ['', '不指定'],
  ['food', '餐饮探店'],
  ['product', '产品科技'],
  ['knowledge', '知识科普'],
  ['talking', '老板口播'],
  ['promo', '活动促销'],
  ['tutorial', '教程演示'],
  ['brand', '品牌落版'],
  ['mood', '情绪空镜'],
]

const CT_HINT: Record<string, string> = {
  food: '暖色特写（不压暗）+ 花字三层描边 + 贴纸化 + 超大数字 + 满幅诱惑图｜撞色：暖素材配冷底',
  product: '磨砂玻璃卡（1px内描边）+ 镀铬字 + 爆炸视图 + 精确图表 + WOW 时刻｜深底亮斑',
  knowledge: '贴纸化照片（9px白边）+ 引线标签 + 精确图表 + 数字滚动 + 连续镜头｜蓝灰克制',
  talking: '数字人窗口（5种位置）+ 大字幕三层描边 + 关键句压屏｜深底，人物区不加装饰',
  promo: '超大数字 + 放射线条纹 + 胶囊徽章 + 印章 + 爆点帧｜高饱和撞色',
  tutorial: '步骤编号 + 高亮框箭头 + 分屏对照 + 进度条｜每步等长',
  brand: '镀铬字/超大logo + 细线展开 + slogan｜收尾不加新元素',
  mood: '大图满幅 + 极简文字 + 慢推镜 + 颗粒暗角｜不加装饰',
}

export default function Lab2Page() {
  const [items, setItems] = useState<Item[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  /* ★★ 画幅（2026-11-03 用户："横屏竖屏加到实验2，作为最高级设置"）
     之前写死 9:16，用户选不了；prompt 里也没有"竖屏/横屏"字样 */
  const [aspect, setAspect] = useState('9:16')

  const [contentType, setContentType] = useState('food')
  const [copyMode, setCopyMode] = useState('sell')
  const [decoDensity, setDecoDensity] = useState('mid')
  const [motion, setMotion] = useState('on')
  /* ★★ 2026-11-03 用户要求加的两个：
     ① 自审开关（开 = 多一次调用，能自己看截图改；关 = 只生成一次）
     ② 大图比（让它都设计大图，容易发现问题）*/
  const [selfReviewOn, setSelfReviewOn] = useState(true)
  const [bigImg, setBigImg] = useState(100)
  const [selfReview, setSelfReview] = useState(true)
  const [userRules, setUserRules] = useState('')

  /* 重做 */
  const [feedback, setFeedback] = useState('')
  const [retrying, setRetrying] = useState(false)
  /* ★反馈截图（最多 4 张，转 base64 发给模型看） */
  const [fbImages, setFbImages] = useState<{ name: string; data: string }[]>([])

  /* ★★★ 对话改片（2026-11-04）：长期会话 + 记忆 */
  const [chatMsgs, setChatMsgs] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const [chatText, setChatText] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [sessionId] = useState('main')
  /* ★对话截图（2026-11-04 用户："它看不到图就瞎改，加一个上传图片"） */
  const [chatImgs, setChatImgs] = useState<{ name: string; data: string }[]>([])

  /* ★段落删除（2026-11-04）：标记 → 代码删段 + 重排时间轴（不经过 AI） */
  const [delSel, setDelSel] = useState<number[]>([])
  const [secBusy, setSecBusy] = useState(false)

  function toggleDel(n: number) {
    setDelSel((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]))
  }

  async function applyDelete() {
    if (!delSel.length || secBusy || !result) return
    setSecBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/lab2/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId, name: result.name, delete: delSel }),
      })
      const j = await r.json()
      if (!j?.ok) { setErr(String(j?.error || '删除失败')); return }
      setResult((prev) => (prev
        ? {
          ...prev,
          url: j.url,
          name: j.name,
          savedTo: j.savedTo,
          segments: j.segments,
          totalSeconds: j.totalSeconds,
        }
        : prev))
      setChatMsgs((p) => [...p, { role: 'assistant', text: j.savedTo ? ('已删掉第 ' + delSel.join('、') + ' 段，时间轴重排完成') : '' }])
      setDelSel([])
      setSeekT(0)
    } catch (e) {
      setErr('删除异常：' + String((e as Error)?.message || e))
    } finally {
      setSecBusy(false)
    }
  }

  const [copied, setCopied] = useState('')
  const [seekT, setSeekT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const rafRef = useRef<number>(0)
  const playStartRef = useRef<number>(0)
  const playFromRef = useRef<number>(0)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  /**
   * ★★ 2026-11-02 用户："暂停也暂停不住 点帧也停不下来"
   *   根因：页面内有自己的 rAF 自动播放，我在外层又起一个 rAF ⇒ 两个打架
   *   修法：**不自己推 rAF**，只控制页面内的 window.__lab2Paused + window.__seek
   */
  function setPausedInFrame(p: boolean) {
    try {
      const w = iframeRef.current?.contentWindow as (Window & { __lab2Paused?: boolean }) | null
      if (w) w.__lab2Paused = p
    } catch { /* ignore */ }
  }

  function togglePlay() {
    if (playing) {
      setPlaying(false)
      setPausedInFrame(true)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }
    /* 让页面内自己播；这里只**读**它的真实时间，不自己累加
       ★2026-11-03 修：之前是 prev + 0.05/帧 ⇒ 每秒 3 秒 ⇒ 进度条和画面对不上 */
    setPausedInFrame(false)
    setPlaying(true)
    const sync = () => {
      try {
        const w = iframeRef.current?.contentWindow as
          (Window & { __lab2Paused?: boolean; __lab2Total?: number; __lab2Time?: number }) | null
        if (w && typeof w.__lab2Time === 'number') {
          setSeekT(w.__lab2Time)     /* ← 读真实时间 */
        }
      } catch { /* ignore */ }
      rafRef.current = requestAnimationFrame(sync)
    }
    rafRef.current = requestAnimationFrame(sync)
  }

  /* 卸载时停掉 */
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setPausedInFrame(true)
  }, [])

  /* ★2026-11-02 用户反馈"图片都堆在一个页面上，看不到效果"
     ⇒ 加"全屏"+"新标签"+"时间轴"三件，直接把单屏效果看出来 */
  function seekTo(t: number, quiet = false) {
    /* ★拖时间轴/点段号 = 先暂停，否则页面内 rAF 立刻盖回来 */
    const w = iframeRef.current?.contentWindow as
      (Window & { __seek?: (t: number) => void; __lab2Paused?: boolean }) | null
    try {
      if (w) w.__lab2Paused = true
      setPlaying(false)
      if (w?.__seek) w.__seek(t)
      else if (!quiet) setErr('这一版没有 __seek（模型漏了播放接口）')
    } catch { if (!quiet) setErr('跨域读不到 iframe（用「↗ 新标签」打开）') }
  }

  function openFullscreen() {
    const el = iframeRef.current
    if (!el) return
    if (el.requestFullscreen) el.requestFullscreen().catch(() => setErr('全屏被浏览器拒绝'))
    else setErr('浏览器不支持全屏')
  }

  /* 读素材（复用旧 lab 的只读接口） */
  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/lab/files', { credentials: 'include', cache: 'no-store' })
        const j = await r.json()
        if (j?.success && Array.isArray(j.data)) setItems(j.data)
      } catch { /* 静默 */ }
    })()
  }, [])

  /* ★★★ 2026-11-04 打开页面就恢复「上一次聊到哪」
     —— 用户："不是这份做完了下次它连自己干什么都忘记" */
  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/lab2/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action: 'history', sessionId: 'main' }),
        })
        const j = await r.json()
        if (j?.ok && Array.isArray(j.messages) && j.messages.length) {
          setChatMsgs(j.messages.map((m: { role: 'user' | 'assistant'; text: string }) => ({ role: m.role, text: m.text })))
          /* 自动把预览切回它上次那一版 */
          if (j.url) {
            setResult((prev) => (prev ? { ...prev, url: j.url, name: j.currentHtmlName || prev.name } : prev))
          }
        }
      } catch { /* 静默 */ }
    })()
  }, [])

  /** 发一句，让它改当前版本 */
  async function sendChat() {
    const t = chatText.trim()
    if (!t || chatBusy) return
    if (!result) { setErr('先在左边点「生成」做一版，再聊着改'); return }
    setErr('')
    setChatText('')
    const sentImgs = chatImgs.map((x) => x.data)
    setChatMsgs((p) => [...p, {
      role: 'user',
      text: t + (sentImgs.length ? `（附 ${sentImgs.length} 张截图）` : ''),
    }])
    setChatImgs([])
    setChatBusy(true)
    try {
      const r = await fetch('/api/lab2/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId, text: t, images: sentImgs }),
      })
      const j = await r.json()
      if (!j?.ok) {
        setChatMsgs((p) => [...p, { role: 'assistant', text: '❌ ' + (j?.error || '改失败') }])
        return
      }
      setChatMsgs((p) => [...p, { role: 'assistant', text: j.reply || '已改好' }])
      /* 换新版本预览（指标基于上一版，不重算） */
      setResult((prev) => (prev ? { ...prev, url: j.url, name: j.name, savedTo: j.savedTo } : prev))
      setSeekT(0)
    } catch (e) {
      setChatMsgs((p) => [...p, { role: 'assistant', text: '❌ ' + String((e as Error)?.message || e) }])
    } finally {
      setChatBusy(false)
    }
  }

  function toggle(name: string) {
    /* ★2026-11-04 用户："我没有张数限制，准备传几十张做长视频" ⇒ 上限从 20 提到 60 */
    setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : p.length >= 60 ? p : [...p, name]))
  }

  /**
   * ★2026-11-02 用户："图还是进不去"
   *   最可靠的路：**前端 fetch signedUrl → canvas 压缩 → base64**
   *   （后端 getObject 一直读不到，前端能拿到 signedUrl 就一定能转）
   */
  async function toB64(url: string, maxW = 1100, q = 0.78): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const scale = Math.min(1, maxW / img.width)
          const c = document.createElement('canvas')
          c.width = Math.max(1, Math.round(img.width * scale))
          c.height = Math.max(1, Math.round(img.height * scale))
          const ctx = c.getContext('2d')
          if (!ctx) { resolve(''); return }
          ctx.drawImage(img, 0, 0, c.width, c.height)
          resolve(c.toDataURL('image/jpeg', q))
        } catch { resolve('') }
      }
      img.onerror = () => resolve('')
      img.src = url
    })
  }

  async function gen(isRetry = false) {
    if (picked.length < 1) { setErr('至少选 1 张素材'); return }
    if (isRetry && !feedback.trim()) { setErr('重做请先写「哪里不对」'); return }
    setErr(''); setLoading(true)
    if (!isRetry) setResult(null)
    try {
      /* 先把选中的图转成 base64（自包含，不依赖后端读 OSS） */
      const pickedUrls = picked.map((n) => (items.find((it) => String(it.name) === n)?.url) || '')
      const b64s: string[] = []
      for (const u of pickedUrls) {
        b64s.push(u ? await toB64(u) : '')
      }
      const imgData = b64s.filter(Boolean)

      const r = await fetch('/api/lab2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          images: picked,
          imageData: imgData,          /* ★base64 数组（前端压缩好的） */
          imageUrls: pickedUrls,
          contentType,
          copyMode,
          decoDensity,
          motion,
          selfReview: selfReviewOn,
          bigImg,
          userRules,
          maxSeconds: 45,
          aspect,
          /* 重做：带上上次 HTML + 意见 */
          prevHtml: isRetry ? result?.html : '',
          feedback: isRetry ? feedback : '',
          feedbackImages: isRetry ? fbImages.map((x) => x.data) : [],
          sessionId,                 /* ★首版写进这个会话，之后对话改片继续用 */
        }),
      })
      const j = await r.json()
      if (!j?.ok) { setErr(String(j?.error || '生成失败')); return }
      setResult(j as Result)
      if (isRetry) setFeedback('')
      /* ★首版也记进对话（后端已写 session，这里只补前端显示） */
      setChatMsgs((p) => [
        ...p,
        {
          role: 'assistant',
          text: (isRetry ? '已按你的意见重做一版' : '首版已生成')
            + '（' + (j?.name || '') + '）\n接下来可以在这里直接说要改哪里。',
        },
      ])
    } catch (e) {
      setErr('异常：' + String((e as Error)?.message || e))
    } finally {
      setLoading(false); setRetrying(false)
    }
  }

  /* ── 完成复制 ── */
  async function copyAll(tag: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(tag)
      setTimeout(() => setCopied(''), 1600)
    } catch { setErr('复制失败（浏览器权限）') }
  }

  function buildReport(): string {
    if (!result) return ''
    const m = result.metrics
    return [
      '══════ 本单要求 ══════',
      '内容类型：' + (CONTENTS.find((c) => c[0] === contentType)?.[1] || '不指定'),
      '文案模式：' + copyMode + ' · 装饰密度：' + decoDensity + ' · 动效：' + motion,
      '素材：' + picked.length + ' 张',
      result.memoriesUsed.length ? '注入的历史教训：\n' + result.memoriesUsed.map((s, i) => `  ${i + 1}. ${s}`).join('\n') : '（无历史教训）',
      '',
      '══════ AI 思考日志 ══════',
      JSON.stringify(result.trace, null, 2),
      '',
      '══════ 技术扫描 ══════',
      '段数：' + m.sections + ' · <svg>：' + m.svg + ' · <text>：' + m.text + ' · <canvas>：' + m.canvas,
      'line-height 最低：' + m.lineHeightMin + '（违规 ' + m.lineHeightBad + ' 处）',
      '负 letter-spacing：' + m.letterSpacingNeg + ' 处（最小 ' + m.letterSpacingMin + '）',
      '压暗(<0.95)：' + m.darkCount + ' 处' + (m.darkMin ? '（最低 ' + m.darkMin + '）' : ''),
      '贴纸白边：' + (m.hasSticker ? '有' : '无'),
      '思考日志：' + (m.hasTrace ? '有' : '无'),
      '',
      '══════ 文件名 ══════',
      result.name + ' · 耗时 ' + result.elapsed + 's',
    ].join('\n')
  }

  const box: React.CSSProperties = {
    background: '#0B0F14', border: '1px solid #242C38', borderRadius: 10, padding: 12, marginBottom: 12,
  }
  const label: React.CSSProperties = { fontSize: 10.5, color: '#7A8798', marginBottom: 6, display: 'block' }
  const btn = (active: boolean): React.CSSProperties => ({
    fontSize: 11, padding: '6px 11px', borderRadius: 6, cursor: 'pointer',
    border: active ? '1px solid #3ECF8E' : '1px solid #242C38',
    background: active ? 'rgba(62,207,142,.2)' : '#0B0F14',
    color: active ? '#D6FBEA' : '#7A8798',
  })

  return (
    <div style={{ minHeight: '100vh', background: '#06080B', color: '#D8E2EC', padding: 16, fontFamily: 'system-ui' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16 }}>
        {/* 左栏 */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>LAB2 · 新实验线</div>
          <div style={{ fontSize: 10, color: '#4C5765', marginBottom: 12 }}>
            导演宣言 + 硬底线 + 1 个分类维度 · 老 lab 不动
          </div>

          {/* ★★ 画幅（最高级设置 · 2026-11-03 用户要求） */}
          <div style={{
            ...box,
            border: '1px solid rgba(255,179,71,.55)',
            background: 'rgba(255,179,71,.07)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
              <span style={{ fontSize: 11, color: '#FFD9A0', fontWeight: 700 }}>画幅（最优先）</span>
              <span style={{ fontSize: 9, color: '#8A7A5C' }}>
                {aspect === '16:9' ? '1280 × 720 横屏' : '720 × 1280 竖屏'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['9:16', '📱 竖屏 9:16'], ['16:9', '🖥 横屏 16:9']].map(([v, t]) => (
                <button key={v} onClick={() => setAspect(v)}
                  style={{
                    flex: 1, fontSize: 11.5, padding: '9px 0', borderRadius: 6, cursor: 'pointer',
                    border: aspect === v ? '2px solid #FFB347' : '1px solid #242C38',
                    background: aspect === v ? 'rgba(255,179,71,.24)' : '#0B0F14',
                    color: aspect === v ? '#FFE9C8' : '#7A8798',
                    fontWeight: aspect === v ? 700 : 400,
                  }}>{t}</button>
              ))}
            </div>
            <div style={{ fontSize: 9, color: '#6B5C42', marginTop: 7, lineHeight: 1.7 }}>
              画幅决定：画布尺寸 · 安全边距 · 单行字数上限 · 主体占比
              <br />⚠️ 这个选了会直接写进 prompt，AI 按对应画幅构图
            </div>
          </div>

          {/* 内容类型 */}
          <div style={box}>
            <span style={label}>内容类型（唯一的分类）</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {CONTENTS.map(([v, t]) => (
                <button key={v || 'auto'} onClick={() => setContentType(v)} style={btn(contentType === v)}>{t}</button>
              ))}
            </div>
            {contentType && (
              <div style={{ fontSize: 9, color: '#4C5765', marginTop: 8, lineHeight: 1.7 }}>{CT_HINT[contentType]}</div>
            )}
          </div>

          {/* 3 个开关 */}
          <div style={box}>
            <span style={label}>文案模式</span>
            <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
              {[['desc', '说明'], ['sell', '卖点'], ['poem', '短句']].map(([v, t]) => (
                <button key={v} onClick={() => setCopyMode(v)} style={btn(copyMode === v)}>{t}</button>
              ))}
            </div>
            <span style={label}>装饰密度</span>
            <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
              {[['low', '少'], ['mid', '中'], ['high', '多']].map(([v, t]) => (
                <button key={v} onClick={() => setDecoDensity(v)} style={btn(decoDensity === v)}>{t}</button>
              ))}
            </div>
            <span style={label}>动效</span>
            <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
              {[['off', '关'], ['on', '开']].map(([v, t]) => (
                <button key={v} onClick={() => setMotion(v)} style={btn(motion === v)}>{t}</button>
              ))}
            </div>

            {/* ★大图比（2026-11-03 用户："加一个大图比，我准备让它都设计大图，这比较容易发现问题"） */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 10.5, color: '#7A8798' }}>大图比</span>
              <span style={{ fontSize: 10, color: bigImg >= 80 ? '#FFB347' : '#7CF', fontWeight: 700 }}>
                {bigImg}%
              </span>
            </div>
            <input type="range" min={0} max={100} step={10} value={bigImg}
              onChange={(e) => setBigImg(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#FFB347', marginBottom: 4 }} />
            <div style={{ fontSize: 8.5, color: '#4C5765', marginBottom: 10, lineHeight: 1.6 }}>
              {bigImg === 0 && '不做满幅图（全用贴纸/局部）'}
              {bigImg > 0 && bigImg < 60 && '少量满幅图（偏贴纸化）'}
              {bigImg >= 60 && bigImg < 100 && '大部分段落用满幅大图'}
              {bigImg === 100 && '★ 每段都用满幅大图（最容易看清问题）'}
            </div>

            {/* ★自审开关 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10.5, color: '#7A8798' }}>自审（让它看自己的成片）</span>
              <span style={{ fontSize: 9, color: '#4C5765' }}>
                {selfReviewOn ? '多 4~5 分钱' : '省 4~5 分钱'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {[[true, '开 · 截图自审'], [false, '关 · 只生成']].map(([v, t]) => (
                <button key={String(v)} onClick={() => setSelfReviewOn(v as boolean)}
                  style={{ ...btn(selfReviewOn === v), flex: 1, fontSize: 10 }}>{t as string}</button>
              ))}
            </div>
          </div>

          {/* 素材：★带缩略图（用户："只显示序号根本看不出是哪张"） */}
          <div style={box}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10.5, color: '#7A8798' }}>素材（已选 {picked.length} 张）</span>
              <span style={{ fontSize: 9, color: '#4C5765' }}>共 {items.length} 张 · 点图选择</span>
            </div>

            {items.length === 0 && (
              <div style={{ fontSize: 10, color: '#FF6B6B', lineHeight: 1.7 }}>
                读不到素材（检查 /api/lab/files 是否登录）
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5, maxHeight: 300, overflow: 'auto' }}>
              {items.map((it, i) => {
                const n = String(it.name || it.key || i)
                const on = picked.includes(n)
                return (
                  <button key={n} onClick={() => toggle(n)} title={n}
                    style={{
                      position: 'relative', padding: 0, aspectRatio: '1 / 1', cursor: 'pointer',
                      border: on ? '2px solid #3ECF8E' : '1px solid #242C38',
                      borderRadius: 6, overflow: 'hidden',
                      background: on ? 'rgba(62,207,142,.15)' : '#0B0F14',
                    }}>
                    {it.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.url} alt={n} loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <span style={{ fontSize: 9, color: '#7A8798' }}>{i + 1}</span>
                    )}
                    {on && (
                      <span style={{
                        position: 'absolute', right: 2, top: 2, width: 14, height: 14,
                        borderRadius: '50%', background: '#3ECF8E', color: '#06110B',
                        fontSize: 9, lineHeight: '14px', textAlign: 'center', fontWeight: 900,
                      }}>✓</span>
                    )}
                  </button>
                )
              })}
            </div>

            {picked.length > 0 && (
              <div style={{ fontSize: 9, color: '#7A8798', marginTop: 7, lineHeight: 1.6 }}>
                已选：{picked.slice(0, 6).map((p) => p.replace(/\.[^.]+$/, '')).join(' · ')}
                {picked.length > 6 ? ` 等 ${picked.length} 张` : ''}
              </div>
            )}
          </div>

          {/* 补充要求 */}
          <div style={box}>
            <span style={label}>补充要求（可选）</span>
            <textarea value={userRules} onChange={(e) => setUserRules(e.target.value)}
              placeholder="例如：结尾要有品牌名" rows={2}
              style={{ width: '100%', background: '#06080B', border: '1px solid #242C38', borderRadius: 6, color: '#D8E2EC', fontSize: 11, padding: 8, resize: 'vertical' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#7A8798', marginTop: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={selfReview} onChange={(e) => setSelfReview(e.target.checked)} />
              交付前自评（7 维打分，≤5 分先改再输出）
            </label>
          </div>

          <button onClick={() => gen(false)} disabled={loading}
            style={{
              width: '100%', padding: 13, borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 700,
              cursor: loading ? 'default' : 'pointer',
              background: loading ? '#2A3440' : 'linear-gradient(100deg,#3ECF8E,#4A9EFF)',
              color: loading ? '#7A8798' : '#06110B',
            }}>{loading ? '生成中…（30~180s）' : '生成'}</button>

          {err && <div style={{ marginTop: 10, fontSize: 11, color: '#FF6B6B' }}>{err}</div>}
        </div>

        {/* 右栏 */}
        <div>
          {!result && (
            <div style={{ ...box, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4C5765', fontSize: 12 }}>
              生成后这里显示预览 + AI 思考日志 + 技术指标
            </div>
          )}

          {result && (
            <>
              {/* 完成复制 */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button onClick={() => copyAll('all', buildReport())}
                  style={{ ...btn(copied === 'all'), flex: 1, padding: '9px 0', fontWeight: 700 }}>
                  {copied === 'all' ? '✓ 已复制' : '📋 完成复制（要求 + 思考 + 指标）'}
                </button>
                <button onClick={() => copyAll('prompt', result.prompt)}
                  style={{ ...btn(copied === 'prompt'), flex: 1, padding: '9px 0' }}>
                  {copied === 'prompt' ? '✓ 已复制' : '📋 复制完整 prompt'}
                </button>
                {/* ★🔗 分享（2026-11-04 用户："我想知道这个分享出去什么样"）
                    链接打开就是黑底全屏播放，不用登录、没有工具栏 */}
                <button onClick={() => {
                  const u = location.origin + '/w/' + encodeURIComponent(result.repoId || '1')
                    + '/' + encodeURIComponent(result.name)
                  try { navigator.clipboard.writeText(u) } catch { /* ignore */ }
                  setCopied('share')
                  setTimeout(() => setCopied(''), 2500)
                  window.open(u, '_blank')
                }}
                  style={{ ...btn(copied === 'share'), padding: '9px 12px' }}>
                  {copied === 'share' ? '✓ 链接已复制' : '🔗 分享'}
                </button>
                <button onClick={() => { confirm('满意吗？点确定=标记这条记忆有效'); fetch('/api/lab2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm' }) }) }}
                  style={{ ...btn(false), padding: '9px 12px' }}>👍 满意</button>
              </div>

              {/* 预览 + 全屏 + 时间轴 */}
              <div style={{ position: 'relative' }}>
                {/* ★2026-11-02 用户："竖屏只看到上半截" ⇒ 按可用高度定尺寸，保证完整可见 */}
                <iframe ref={iframeRef} src={result.url} title="lab2-preview"
                  style={{
                    display: 'block', margin: '0 auto',
                    height: 'min(76vh, 96vw * 16 / 9)',
                    aspectRatio: '9 / 16',
                    border: '1px solid #242C38', borderRadius: 10, background: '#000',
                  }} />

                {/* 右上角：全屏 */}
                <button onClick={openFullscreen}
                  title="全屏播放"
                  style={{ position: 'absolute', right: 10, top: 10, zIndex: 5, padding: '5px 10px',
                    background: 'rgba(10,14,20,.8)', color: '#BFE3FF', border: '1px solid rgba(58,124,184,.7)',
                    borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>⛶ 全屏</button>

                {/* 右下角：原样打开（单独新标签，不经过 iframe） */}
                <a href={result.url} target="_blank" rel="noreferrer"
                  title="在新标签打开（不受网站容器影响）"
                  style={{ position: 'absolute', right: 10, top: 46, zIndex: 5, padding: '5px 10px',
                    background: 'rgba(10,14,20,.8)', color: '#BFE3FF', border: '1px solid rgba(58,124,184,.7)',
                    borderRadius: 6, fontSize: 11, textDecoration: 'none' }}>↗ 新标签</a>
              </div>

              {/* ★播放器：▶播放 / ⏸暂停 / 时间轴 / 下载 */}
              <div style={{ ...box, marginTop: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={togglePlay}
                    style={{ fontSize: 14, padding: '6px 14px', minWidth: 74, cursor: 'pointer',
                      background: playing ? 'rgba(255,179,71,.22)' : 'rgba(62,207,142,.22)',
                      border: '1px solid ' + (playing ? '#FFB347' : '#3ECF8E'),
                      borderRadius: 7, color: playing ? '#FFE9C8' : '#D6FBEA', fontWeight: 700 }}>
                    {playing ? '⏸ 暂停' : '▶ 播放'}
                  </button>
                  <input type="range" min={0} max={result.totalSeconds || 45} step={0.05} value={seekT}
                    onChange={(e) => { const v = Number(e.target.value); setSeekT(v); seekTo(v) }}
                    style={{ flex: 1, accentColor: '#3ECF8E' }} />
                  <span style={{ fontSize: 10, color: '#BFE3FF', minWidth: 62, textAlign: 'right' }}>
                    {seekT.toFixed(1)}s / {result.totalSeconds || 45}s
                  </span>
                  <button onClick={() => { setPlaying(false); setSeekT(0); seekTo(0) }}
                    style={{ ...btn(false), fontSize: 10, padding: '4px 8px' }}>⏮</button>
                  <a href={result.url + '&download=1'} download={result.name}
                    style={{ ...btn(false), fontSize: 11, padding: '5px 11px', textDecoration: 'none',
                      background: 'rgba(74,158,255,.2)', borderColor: '#4A9EFF', color: '#BFE3FF' }}>
                    ⬇ 下载 HTML
                  </a>
                </div>

                {/* 段导航 + 勾选删除
                    ★2026-11-04 用户："生成 30 段不合适我命令全部切掉"
                      ⇒ 点段号跳转；点段号右边的 ✕ 标记待删；「删除选中」由**代码重排时间轴**
                        （不让 AI 算 —— 它算 data-start 必错） */}
                {(result.segments || []).length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                    {(result.segments || []).map((s, i) => {
                      const active = seekT >= s.start && seekT < s.start + (s.duration || 3)
                      const marked = delSel.includes(i + 1)
                      return (
                        <span key={i} style={{ display: 'inline-flex' }}>
                          <button onClick={() => { setPlaying(false); const t = s.start + Math.min(0.3, (s.duration || 3) / 3); setSeekT(t); seekTo(t) }}
                            title={(s.start.toFixed(1)) + 's ~ ' + (s.start + (s.duration || 3)).toFixed(1) + 's'}
                            style={{
                              ...btn(active), fontSize: 9.5, padding: '3px 8px',
                              borderRadius: '5px 0 0 5px',
                              opacity: marked ? 0.45 : 1,
                              textDecoration: marked ? 'line-through' : 'none',
                            }}>
                            段 {i + 1}
                          </button>
                          <button onClick={() => toggleDel(i + 1)}
                            title={marked ? '取消删除' : '标记删除（不会立刻删）'}
                            style={{
                              fontSize: 9, padding: '3px 6px', cursor: 'pointer',
                              borderRadius: '0 5px 5px 0',
                              border: '1px solid ' + (marked ? '#FF6B6B' : '#242C38'),
                              borderLeft: 'none',
                              background: marked ? 'rgba(255,107,107,.25)' : '#0B0F14',
                              color: marked ? '#FF9B9B' : '#4C5765',
                            }}>
                            ✕
                          </button>
                        </span>
                      )
                    })}
                  </div>
                )}
                {delSel.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                    <span style={{ fontSize: 10, color: '#FF9B9B' }}>
                      已标记删除 {delSel.length} 段（第 {[...delSel].sort((a, b) => a - b).join('、')} 段）
                    </span>
                    <button onClick={applyDelete} disabled={secBusy}
                      style={{
                        fontSize: 10, padding: '5px 12px', borderRadius: 6, cursor: secBusy ? 'default' : 'pointer',
                        border: '1px solid #FF6B6B', background: secBusy ? '#2A3440' : 'rgba(255,107,107,.2)',
                        color: secBusy ? '#7A8798' : '#FFC8C8', fontWeight: 700,
                      }}>
                      {secBusy ? '删除中…' : '删除并重排时间轴'}
                    </button>
                    <button onClick={() => setDelSel([])}
                      style={{ ...btn(false), fontSize: 10, padding: '5px 10px' }}>
                      取消
                    </button>
                  </div>
                )}

                <div style={{ fontSize: 9, color: '#4C5765', marginTop: 6, lineHeight: 1.6 }}>
                  点「▶ 播放」自动播完；也可以拖时间轴 / 点段号直接跳。
                  {!playing && seekT === 0 && '（现在停在 0s，点播放就开始）'}
                </div>
              </div>

              {/* ★★★ 对话改片（2026-11-04 用户："要能跟我实现长期会话，自己有记忆"）
                  首轮用「生成」，之后在这里聊着改；每轮都带「历史 + 当前 HTML」⇒ 它知道在改哪一版 */}
              <div style={{ ...box, marginTop: 12, border: '1px solid rgba(74,158,255,.4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#BFE3FF', fontWeight: 700 }}>💬 对话改片</span>
                  <span style={{ fontSize: 9, color: '#4C5765' }}>它记得这条片子的上下文</span>
                </div>

                <div style={{
                  maxHeight: 200, overflow: 'auto', background: '#06080B', border: '1px solid #1A2028',
                  borderRadius: 6, padding: 8, marginBottom: 8, lineHeight: 1.65,
                }}>
                  {chatMsgs.length === 0 && (
                    <div style={{ fontSize: 10, color: '#4C5765' }}>
                      先在上面点「生成」做一版，然后在这里说：
                      <br />「第 3 段的字太大」「把最后一段换成另一个结尾」「整体慢一点」…
                    </div>
                  )}
                  {chatMsgs.map((m, i) => (
                    <div key={i} style={{ marginBottom: 7 }}>
                      <span style={{ fontSize: 9, color: m.role === 'user' ? '#7CF' : '#FFB347' }}>
                        {m.role === 'user' ? '你' : '导演'}：
                      </span>
                      <span style={{ fontSize: 10.5, color: m.role === 'user' ? '#D8E2EC' : '#A8D8C0', whiteSpace: 'pre-wrap' }}>
                        {m.text}
                      </span>
                    </div>
                  ))}
                  {chatBusy && <div style={{ fontSize: 10, color: '#7A8798' }}>导演正在改…（20~60s）</div>}
                </div>

                {/* ★上传截图：把它看不见/看错的地方直接给它看 */}
                <div style={{ marginBottom: 8 }}>
                  <label style={{
                    display: 'inline-block', fontSize: 10, padding: '5px 11px', borderRadius: 6, cursor: 'pointer',
                    background: 'rgba(74,158,255,.16)', border: '1px solid #4A9EFF', color: '#BFE3FF',
                  }}>
                    📎 上传截图（把它看错的地方给它看）
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || [])
                        if (!files.length) return
                        const arr: { name: string; data: string }[] = []
                        for (const f of files.slice(0, 4)) {
                          const d = await new Promise<string>((res) => {
                            const fr = new FileReader()
                            fr.onload = () => res(String(fr.result))
                            fr.onerror = () => res('')
                            fr.readAsDataURL(f)
                          })
                          if (d) arr.push({ name: f.name, data: d })
                        }
                        setChatImgs((p) => [...p, ...arr].slice(0, 4))
                        e.target.value = ''
                      }} />
                  </label>
                  {chatImgs.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {chatImgs.map((im, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={im.data} alt={im.name} style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 5, border: '1px solid #242C38' }} />
                          <button onClick={() => setChatImgs((p) => p.filter((_, j) => j !== i))}
                            style={{ position: 'absolute', right: -4, top: -4, width: 15, height: 15, borderRadius: '50%', background: '#FF6B6B', color: '#fff', border: 'none', fontSize: 9, cursor: 'pointer', lineHeight: '15px', padding: 0 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendChat() }}
                    placeholder="例：第 3 段的字小一点；结尾换成品牌名"
                    style={{
                      flex: 1, background: '#06080B', border: '1px solid #242C38', borderRadius: 6,
                      color: '#D8E2EC', fontSize: 11, padding: '8px 10px',
                    }}
                  />
                  <button onClick={sendChat} disabled={chatBusy || !chatText.trim()}
                    style={{
                      padding: '8px 16px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 700,
                      cursor: (chatBusy || !chatText.trim()) ? 'default' : 'pointer',
                      background: (chatBusy || !chatText.trim()) ? '#2A3440' : 'linear-gradient(100deg,#4A9EFF,#3ECF8E)',
                      color: (chatBusy || !chatText.trim()) ? '#7A8798' : '#06110B',
                    }}>
                    {chatBusy ? '改…' : '发送'}
                  </button>
                </div>
              </div>

              {/* 重做 */}
              <div style={{ ...box, marginTop: 12 }}>
                <span style={label}>不满意？写「哪里不对」再重做（会带上次 HTML 一起喂回去）</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {['字粘在一起', '图片被压暗', '小字被大字压住', '每段都一样', '太像模板', '没有质感'].map((t) => (
                    <button key={t} onClick={() => setFeedback((f) => (f ? f + '；' + t : t))}
                      style={{ ...btn(false), fontSize: 10, padding: '4px 8px' }}>+ {t}</button>
                  ))}
                </div>
                <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)}
                  placeholder="例：第 2 段字粘在一起，line-height 太小；第 4 段图被压暗了" rows={2}
                  style={{ width: '100%', background: '#06080B', border: '1px solid #242C38', borderRadius: 6, color: '#D8E2EC', fontSize: 11, padding: 8, resize: 'vertical' }} />

                {/* ★2026-11-03 用户要求：反馈可以上传图片（模型能看图，比文字准 10 倍） */}
                <div style={{ marginTop: 8 }}>
                  <label style={{
                    display: 'inline-block', fontSize: 10, padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
                    background: 'rgba(74,158,255,.18)', border: '1px solid #4A9EFF', color: '#BFE3FF',
                  }}>
                    📎 上传截图（说明问题）
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || [])
                        if (!files.length) return
                        const arr: { name: string; data: string }[] = []
                        for (const f of files.slice(0, 4)) {
                          const d = await new Promise<string>((res) => {
                            const fr = new FileReader()
                            fr.onload = () => res(String(fr.result))
                            fr.onerror = () => res('')
                            fr.readAsDataURL(f)
                          })
                          if (d) arr.push({ name: f.name, data: d })
                        }
                        setFbImages((p) => [...p, ...arr].slice(0, 4))
                        e.target.value = ''
                      }} />
                  </label>
                  {fbImages.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {fbImages.map((im, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={im.data} alt={im.name} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid #242C38' }} />
                          <button onClick={() => setFbImages((p) => p.filter((_, j) => j !== i))}
                            style={{ position: 'absolute', right: -4, top: -4, width: 16, height: 16, borderRadius: '50%', background: '#FF6B6B', color: '#fff', border: 'none', fontSize: 10, cursor: 'pointer', lineHeight: '16px', padding: 0 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => { setRetrying(true); gen(true) }} disabled={loading || !feedback.trim()}
                  style={{ ...btn(false), marginTop: 8, padding: '8px 16px', fontWeight: 700, background: feedback.trim() ? 'rgba(255,179,71,.2)' : '#0B0F14', borderColor: feedback.trim() ? '#FFB347' : '#242C38', color: feedback.trim() ? '#FFE9C8' : '#4C5765' }}>
                  {retrying ? '重做中…' : '↻ 按意见重做'}
                </button>
              </div>

              {/* AI 思考 */}
              <div style={{ ...box, marginTop: 12 }}>
                <span style={label}>AI 思考日志（__trace）</span>
                {result.trace ? (
                  <pre style={{ fontSize: 9.5, lineHeight: 1.6, color: '#A8C0D8', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, maxHeight: 320, overflow: 'auto' }}>
                    {JSON.stringify(result.trace, null, 1)}
                  </pre>
                ) : (
                  <div style={{ fontSize: 11, color: '#FF6B6B' }}>❌ 这一版没写 __trace（模型漏了）</div>
                )}
              </div>

              {/* 技术指标 */}
              <div style={{ ...box, marginTop: 12 }}>
                <span style={label}>技术扫描</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', fontSize: 10.5 }}>
                  <div>段数：{result.metrics.sections}</div>
                  <div>耗时：{result.elapsed}s</div>
                  <div style={{ gridColumn: '1 / -1', fontSize: 9.5, color: '#7A8798' }}>
                    存到：{result.savedTo || result.name}
                  </div>
                  {/* ★★ 自审记录（2026-11-03）：它自己看了截图，改了几轮、为什么改 */}
                  <div style={{ gridColumn: '1 / -1', marginTop: 2, marginBottom: 4 }}>
                    <div style={{
                      fontWeight: 700, marginBottom: 6,
                      color: result.review?.shotOk ? '#7CF' : '#FF6B6B',
                    }}>
                      自审 {result.review?.shotOk ? '✓' : '✗'}
                      {result.review?.shotOk
                        ? `（改了 ${result.review.rounds} 轮）`
                        : `（截图失败：${result.review?.shotErr || '未执行'}）`}
                    </div>

                    {result.review?.shotOk && (
                      <div style={{ fontSize: 9.5, lineHeight: 1.75 }}>
                        <div style={{ color: '#FFB347', marginBottom: 3 }}>
                          发现的问题（{result.review.issues.length}）：
                        </div>
                        {result.review.issues.length === 0
                          ? <div style={{ color: '#7CF' }}>　无（它认为合格）</div>
                          : result.review.issues.map((s, i) => (
                            <div key={i} style={{ color: '#E8C88A' }}>　{i + 1}. {s}</div>
                          ))}

                        <div style={{ color: '#FFB347', marginTop: 6, marginBottom: 3 }}>
                          改了什么（{result.review.changes.length}）：
                        </div>
                        {result.review.changes.length === 0
                          ? <div style={{ color: '#7CF' }}>　没改（它认为没问题）</div>
                          : result.review.changes.map((s, i) => (
                            <div key={i} style={{ color: '#A8D8C0' }}>　{i + 1}. {s}</div>
                          ))}
                      </div>
                    )}
                  </div>

                  <div style={{ gridColumn: '1 / -1', fontSize: 9.5,
                    color: (result.imgEmbedded || 0) > 0 ? '#7CF' : '#FF6B6B' }}>
                    AI 看到图：{result.imgSent ?? '?'} 张 · 内联进 HTML：{result.imgEmbedded ?? '?'} 张
                    {(result.imgEmbedded || 0) === 0 ? '（0 张 = 图没进去）' : ''}
                  </div>
                  {(result.ossKeys || []).length > 0 && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 9, color: '#4C5765', wordBreak: 'break-all' }}>
                      OSS 路径：{(result.ossKeys || []).join(' | ')}
                    </div>
                  )}
                  {(result.imgErrs || []).length > 0 && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 9, color: '#FF6B6B', wordBreak: 'break-all', lineHeight: 1.6 }}>
                      读图失败：{(result.imgErrs || []).join(' ｜ ')}
                    </div>
                  )}
                  <div style={{ color: result.metrics.text > 0 ? '#7CF' : '#FF6B6B' }}>
                    &lt;text&gt;：{result.metrics.text} {result.metrics.text === 0 ? '（围边必错）' : ''}
                  </div>
                  <div>&lt;svg&gt;：{result.metrics.svg} · canvas：{result.metrics.canvas}</div>
                  <div style={{ color: result.metrics.lineHeightBad > 0 ? '#FFB347' : '#7CF' }}>
                    line-height 最低：{result.metrics.lineHeightMin ?? '-'}（违规 {result.metrics.lineHeightBad}）
                  </div>
                  <div style={{ color: result.metrics.letterSpacingNeg > 0 ? '#FFB347' : '#7CF' }}>
                    负字距：{result.metrics.letterSpacingNeg} 处
                  </div>
                  <div style={{ color: result.metrics.darkCount > 0 ? '#FF6B6B' : '#7CF' }}>
                    压暗：{result.metrics.darkCount} 处{darkTip(result.metrics)}
                  </div>
                  <div style={{ color: result.metrics.hasSticker ? '#7CF' : '#7B8798' }}>
                    贴纸白边：{result.metrics.hasSticker ? '有' : '无'}
                  </div>
                  <div style={{ color: result.metrics.hasAutoplay ? '#7CF' : '#FF6B6B' }}>
                    自动播放：{result.metrics.hasAutoplay ? '有' : '无（打开只有第一帧）'}
                  </div>
                  <div style={{ color: (result.metrics.hasImgs || 0) > 0 ? '#7CF' : '#FF6B6B' }}>
                    内联图：{result.metrics.hasImgs ?? 0} 张
                  </div>
                  <div style={{ color: (result.metrics.cssVarP || 0) > 20 ? '#7CF' : '#FFB347' }}>
                    CSS var(--p)：{result.metrics.cssVarP ?? 0} 处
                    {(result.metrics.cssVarP || 0) < 5 ? '（≈0 ⇒ 动效全靠 JS，一崩就静止）' : ''}
                  </div>
                  <div style={{ color: (result.metrics.svgText || 0) > 0 ? '#7CF' : '#FFB347' }}>
                    SVG：{result.metrics.svgCount ?? 0} 个 / text {result.metrics.svgText ?? 0} / paint-order {result.metrics.paintOrder ?? 0}
                  </div>
                  <div style={{ color: (result.metrics.canvasCount || 0) > 0 ? '#7CF' : '#7B8798' }}>
                    canvas：{result.metrics.canvasCount ?? 0} 个
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function darkTip(m: Metrics) {
  return m.darkMin ? '（最低 ' + m.darkMin + '）' : ''
}
