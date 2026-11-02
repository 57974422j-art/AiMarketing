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
}

type Seg = { start: number; duration: number }

type Result = {
  url: string
  name: string
  savedTo?: string
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

  const [contentType, setContentType] = useState('food')
  const [copyMode, setCopyMode] = useState('sell')
  const [decoDensity, setDecoDensity] = useState('mid')
  const [motion, setMotion] = useState('on')
  const [selfReview, setSelfReview] = useState(true)
  const [userRules, setUserRules] = useState('')

  /* 重做 */
  const [feedback, setFeedback] = useState('')
  const [retrying, setRetrying] = useState(false)

  const [copied, setCopied] = useState('')
  const [seekT, setSeekT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const rafRef = useRef<number>(0)
  const playStartRef = useRef<number>(0)
  const playFromRef = useRef<number>(0)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  /* ★播放器：用 requestAnimationFrame 推 __seek(t)，和真实播放一样 */
  function togglePlay() {
    if (playing) {
      setPlaying(false)
      cancelAnimationFrame(rafRef.current)
      return
    }
    const total = result?.totalSeconds || 45
    const from = seekT >= total - 0.05 ? 0 : seekT
    setSeekT(from)
    playFromRef.current = from
    playStartRef.current = performance.now()
    setPlaying(true)

    const tick = () => {
      const el = (performance.now() - playStartRef.current) / 1000
      let t = playFromRef.current + el
      if (t >= total) t = total
      setSeekT(t)
      seekTo(t, true)
      if (t < total) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setPlaying(false)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  /* 卸载时停掉 */
  useEffect(() => () => { cancelAnimationFrame(rafRef.current) }, [])

  /* ★2026-11-02 用户反馈"图片都堆在一个页面上，看不到效果"
     ⇒ 加"全屏"+"新标签"+"时间轴"三件，直接把单屏效果看出来 */
  function seekTo(t: number, quiet = false) {
    try {
      const w = iframeRef.current?.contentWindow as (Window & { __seek?: (t: number) => void }) | null
      if (w?.__seek) w.__seek(t)
      else if (!quiet) {
        setErr('这一版没有 __seek（模型漏了播放接口）')
      }
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

  function toggle(name: string) {
    setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : p.length >= 20 ? p : [...p, name]))
  }

  async function gen(isRetry = false) {
    if (picked.length < 1) { setErr('至少选 1 张素材'); return }
    if (isRetry && !feedback.trim()) { setErr('重做请先写「哪里不对」'); return }
    setErr(''); setLoading(true)
    if (!isRetry) setResult(null)
    try {
      const r = await fetch('/api/lab2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          images: picked,
          contentType,
          copyMode,
          decoDensity,
          motion,
          selfReview,
          userRules,
          maxSeconds: 45,
          aspect: '9:16',
          /* 重做：带上上次 HTML + 意见 */
          prevHtml: isRetry ? result?.html : '',
          feedback: isRetry ? feedback : '',
        }),
      })
      const j = await r.json()
      if (!j?.ok) { setErr(String(j?.error || '生成失败')); return }
      setResult(j as Result)
      if (isRetry) setFeedback('')
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
            <div style={{ display: 'flex', gap: 5 }}>
              {[['off', '关'], ['on', '开']].map(([v, t]) => (
                <button key={v} onClick={() => setMotion(v)} style={btn(motion === v)}>{t}</button>
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
                <button onClick={() => { confirm('满意吗？点确定=标记这条记忆有效'); fetch('/api/lab2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm' }) }) }}
                  style={{ ...btn(false), padding: '9px 12px' }}>👍 满意</button>
              </div>

              {/* 预览 + 全屏 + 时间轴 */}
              <div style={{ position: 'relative' }}>
                <iframe ref={iframeRef} src={result.url} title="lab2-preview"
                  style={{ width: '100%', aspectRatio: '9 / 16', maxHeight: '78vh', border: '1px solid #242C38', borderRadius: 10, background: '#000', display: 'block' }} />

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

                {/* 段导航：直接跳到每段开头 */}
                {(result.segments || []).length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                    {(result.segments || []).map((s, i) => (
                      <button key={i} onClick={() => { setPlaying(false); setSeekT(s.start + 0.3); seekTo(s.start + 0.3) }}
                        style={{ ...btn(Math.abs(seekT - s.start) < (s.duration || 3)), fontSize: 9.5, padding: '3px 8px' }}>
                        {i + 1}. {s.start}s
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ fontSize: 9, color: '#4C5765', marginTop: 6, lineHeight: 1.6 }}>
                  点「▶ 播放」自动播完；也可以拖时间轴 / 点段号直接跳。
                  {!playing && seekT === 0 && '（现在停在 0s，点播放就开始）'}
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
