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
import { useEffect, useState } from 'react'

type Item = { name: string; url: string; kind?: string }

export default function LabPage() {
  const [items, setItems] = useState<Item[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [err, setErr] = useState('')

  /* 表单 */
  const [sellingPoints, setSellingPoints] = useState('')
  const [tone, setTone] = useState('auto')
  const [designStyle, setDesignStyle] = useState('')
  const [drawMode, setDrawMode] = useState('')
  const [tier, setTier] = useState('strict')
  const [plateRatio, setPlateRatio] = useState(6)
  const [noImgEnds, setNoImgEnds] = useState(false)

  /* 读仓库素材（只读） */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/storage/files', { credentials: 'include' })
        const j = await r.json()
        const all: Item[] = Array.isArray(j?.data) ? j.data : (j?.data?.items || [])
        setItems(all.filter((x) => /\.(jpg|jpeg|png|webp)$/i.test(x.name)).slice(0, 60))
      } catch { /* ignore */ }
    })()
  }, [])

  function toggle(name: string) {
    setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : (p.length >= 20 ? p : [...p, name])))
  }

  async function gen() {
    if (picked.length < 3) { setErr('至少选 3 张素材'); return }
    setErr(''); setLoading(true); setResult(null)
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
    } catch (e: any) {
      setErr('请求失败：' + String(e?.message || e))
    }
    setLoading(false)
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

                {/* 预览（preview 模式：纵向铺开，滚动看全） */}
                <iframe src={result.url} title="lab-preview"
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
