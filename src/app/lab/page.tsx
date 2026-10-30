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

  /* 表单 */
  const [sellingPoints, setSellingPoints] = useState('')
  const [tone, setTone] = useState('auto')
  const [designStyle, setDesignStyle] = useState('')
  const [drawMode, setDrawMode] = useState('')
  const [tier, setTier] = useState('strict')
  const [plateRatio, setPlateRatio] = useState(6)
  const [noImgEnds, setNoImgEnds] = useState(false)

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
          names: picked, sellingPoints, tone,
          designStyle, drawMode, tier, plateRatio, noImgEnds, aspect: '9:16',
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
   * ★分区自检 —— 在浏览器里跑，读 iframe 的真实渲染尺寸。
   *
   * 检测三件事（就是提示词里那三条铁律）：
   *   ① 文字元素的 [top, top+height] 是否整段落在 0~480 或 1040~1220
   *   ② 图 / 图形是否整段落在 480~1040
   *   ③ 文字元素之间、文字与图之间有没有实际重叠
   *
   * 为什么必须在前端跑：CSS 的最终位置只有浏览器算得准，服务端静态分析不可靠。
   */
  function runZoneCheck() {
    const doc = iframeRef.current?.contentDocument
    if (!doc) { setCheck({ ok: false, problems: ['读不到 iframe（可能还没加载完）'] }); return }
    const secs = Array.from(doc.querySelectorAll('.sec')) as HTMLElement[]
    if (!secs.length) { setCheck({ ok: false, problems: ['没找到 .sec 段'] }); return }

    const problems: string[] = []
    const TOP_END = 480
    const MID_END = 1040
    const BOT_START = 1040
    const BOT_END = 1220

    secs.forEach((sec, si) => {
      const base = sec.getBoundingClientRect()
      /* 该段内的所有可见元素 */
      const nodes = Array.from(sec.querySelectorAll('*')) as HTMLElement[]
      const texts: Array<{ tag: string; top: number; bottom: number; l: number; r: number; txt: string }> = []
      const objs: Array<{ tag: string; top: number; bottom: number; l: number; r: number }> = []

      for (const el of nodes) {
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.height < 4) continue
        const cs = doc.defaultView!.getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue

        const top = Math.round(r.top - base.top)
        const bottom = Math.round(r.bottom - base.top)
        const isImg = el.tagName === 'IMG' || cs.backgroundImage.indexOf('data:image') >= 0
          || cs.backgroundImage.indexOf('url(') >= 0
        const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0)

        if (isImg) {
          objs.push({ tag: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''), top, bottom, l: Math.round(r.left - base.left), r: Math.round(r.right - base.left) })
        } else if (ownText) {
          texts.push({ tag: el.tagName.toLowerCase(), top, bottom, l: Math.round(r.left - base.left), r: Math.round(r.right - base.left), txt: (el.textContent || '').trim().slice(0, 10) })
        }
      }

      /* ① 文字越界（允许在 0~480 或 1040~1220；中间区域放文字算越界） */
      for (const t of texts) {
        const inTop = t.bottom <= TOP_END + 8
        const inBot = t.top >= BOT_START - 8 && t.bottom <= BOT_END + 60
        if (!inTop && !inBot) {
          problems.push('段' + (si + 1) + ' 文字「' + t.txt + '」位置 ' + t.top + '~' + t.bottom
            + ' 越界（应在 0~480 或 1040~1220）')
        }
      }

      /* ② 主体越界（应在 480~1040） */
      for (const o of objs) {
        if (o.top < MID_END && o.bottom > TOP_END && (o.top < 460 || o.bottom > 1060)) {
          problems.push('段' + (si + 1) + ' 主体 ' + o.tag + ' 位置 ' + o.top + '~' + o.bottom
            + ' 越界（应在 480~1040）')
        }
      }

      /* ③ 文字压主体 / 文字互相压 */
      for (const t of texts) {
        for (const o of objs) {
          const ox = Math.min(t.r, o.r) - Math.max(t.l, o.l)
          const oy = Math.min(t.bottom, o.bottom) - Math.max(t.top, o.top)
          if (ox > 6 && oy > 6) {
            problems.push('段' + (si + 1) + ' **文字压主体**：「' + t.txt + '」压住 ' + o.tag
              + '（重叠 ' + Math.round(ox) + '×' + Math.round(oy) + 'px）')
          }
        }
      }
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          const a = texts[i], b = texts[j]
          const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l)
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (ox > 6 && oy > 6) {
            problems.push('段' + (si + 1) + ' **文字叠文字**：「' + a.txt + '」压住「' + b.txt + '」')
          }
        }
      }
    })

    setCheck({ ok: problems.length === 0, problems })
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

            <button onClick={gen} disabled={loading}
              style={{
                width: '100%', padding: 11, borderRadius: 8, cursor: loading ? 'default' : 'pointer',
                fontSize: 12, fontWeight: 600, border: 'none',
                background: loading ? '#2A3440' : 'linear-gradient(100deg,#3ECF8E,#4A9EFF)',
                color: loading ? '#7A8798' : '#06110B',
              }}>
              {loading ? '生成中…（约 30~180 秒）' : '🎬 生成页面（不渲染 mp4）'}
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
                    <b>{check.ok ? '✅ 全部分区合格' : '❌ 发现 ' + check.problems.length + ' 处越界/重叠'}</b>
                    {check.problems.length > 0 && (
                      <div style={{ marginTop: 6, color: '#FFB4B4' }}>
                        {check.problems.slice(0, 12).map((p: string, i: number) => (
                          <div key={i}>· {p}</div>
                        ))}
                        {check.problems.length > 12 && <div>… 还有 {check.problems.length - 12} 处</div>}
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
