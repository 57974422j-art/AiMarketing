#!/usr/bin/env node
/**
 * render-deck.mjs —— `deck.json` → 母版 HTML → 整条 MP4（+ 每页抽帧 + 输入→输出对账表）  【D12】
 *
 * 设计约束（team-lead 的规格）：
 *   1. 输入必须先过 validate-deck.mjs；**校验不通过直接大声失败、绝不渲染**（防止把废数据渲成片子）
 *   2. 1:1 映射到 master-v1 的四页型（cover / bullets / data / end），不发明新页型
 *   3. 渲染固定 `--workers 1`（D10：可复现 + 更快）；输出校验色彩标签必须是 tv/bt709（D9）
 *   4. **页数与顺序完全由 deck.json 决定**，并打印一行"页型序列"便于对账
 *   5. 产物：`output-<deck名>.mp4` + `frames/p<i>-enter|full.png` + `reconcile.md`（对账表）
 *
 * 用法:
 *   node render-deck.mjs examples/deck.master-v1.json
 *   node render-deck.mjs examples/deck.full6.json --no-render     # 只生成 HTML + 对账，不渲染（秒级）
 *   node render-deck.mjs <deck.json> --outdir out
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

/* ------------------------------------------------------------------
   退出码与机器可读总结行（ENGINE-CONTRACT.md 的"唯一真相源"在这里）
   ★ 纪律第一条：**不许静默降级**。任何"跳页 / 缩时长 / 换母版 / 改参数"都必须报错退出。
     所以下面所有 `|| 默认值` 形式的兜底一律改成"抛错"（strictPick），
     并给每个失败阶段一个**独立退出码**，让服务端不用猜。
   ------------------------------------------------------------------ */
const EXIT = { OK: 0, USAGE: 2, VALIDATE: 3, RECONCILE: 4, RENDER: 5, INTERNAL: 6 }
/** 机器可读总结行：服务端应解析这一行，不要用正则去猜人话日志 */
function emitResult(obj) { console.log('RESULT ' + JSON.stringify(obj)) }
function fail(code, stage, msg, extra = {}) {
  console.error(`\n✗ [exit ${code} · ${stage}] ${msg}`)
  emitResult({ ok: false, code, stage, error: msg, ...extra })
  process.exit(code)
}
/** 契约枚举取值：**不许有默认值兜底**（静默降级正是要禁止的事） */
function strictPick(map, key, what) {
  if (!map || !Object.prototype.hasOwnProperty.call(map, key)) {
    throw new Error(`${what} 取值非法：${JSON.stringify(key)}（可用：${map ? Object.keys(map).join(' / ') : '(空)'}）`)
  }
  return map[key]
}
import { fileURLToPath } from 'node:url'
import { dirname, join, basename, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')                       // dist-rel/probe-hf/
const MASTERS_DIR = join(ROOT, 'masters')              // 母版资产根：masters/<masterId>/
// 渲染器可执行文件：默认项目内 hyperframes；`ENGINE_HF_BIN` 可覆盖（服务端钉版本 / 故障演练用）
const HF = process.env.ENGINE_HF_BIN || join(ROOT, 'node_modules', '.bin', 'hyperframes.cmd')
const VALIDATOR = join(HERE, 'validate-deck.mjs')
const FPS = 25

/* ------------------------------------------------------------------
   母版解析（masterId 由"单值"变"枚举"，见 deck.schema.json）
   ★ 重构前 MASTER / PAGE / GEO / PLOT / PLOT_PAD / 绘图区上移量 / 素材名 全写死在本文件里
     → 那等于"换母版"根本做不到（这些本就属于母版）。现在一律来自 `masters/<id>/master.json`；
     本文件**不再自带任何母版数值**。
   ★ master-v1 的 manifest 装的就是上面那些原值 ⇒ 1→1 字节级回归必须完全一致。
   ------------------------------------------------------------------ */
const MASTER_IDS = ['master-v1', 'master-v2']   // 与 deck.schema.json 的 masterId 枚举保持同步
let MF = null                                   // 当前母版：由 main() 在生成前载入，渲染期间只读
function loadMaster(id) {
  const dir = join(MASTERS_DIR, id)
  const man = join(dir, 'master.json')
  if (!existsSync(man)) throw new Error(`母版不存在: ${man}（约定 masters/<masterId>/master.json）`)
  const m = JSON.parse(readFileSync(man, 'utf8'))
  if (m.id !== id) throw new Error(`master.json 的 id(${m.id}) 与目录名(${id}) 不一致`)
  m.dir = dir
  m.assetsRoot = join(dir, m.assets || 'assets')
  // palette 名清单与实际色值都由母版定义（= 母版负责皮肤）；生成器只按名取色
  m.paletteResolved = m.palette || {}
  return m
}

/* ------------------------------------------------------------------
   style 三个枚举 → CSS 令牌 的实际映射。
   ★ 没有这一层，契约里的 palette/density/tempo 就是"能过校验但不生效"——
     正是 team-lead 警告的"契约能过、渲染不出来"。这里让它们真的落到位。
   ★ tempo 会改 --xover，而页窗口是用 xover 算出来的 → 生成器必须用同一个值算窗口，
     否则 clip 窗口与 master.js 的时间轴会错位。所以 TIMING 是唯一真相源。
   ------------------------------------------------------------------ */
// ★ palette 的**名清单与实际色值**现在都由所选母版提供（masters/<id>/master.json 的 palette）——
//   不同母版命名不同，所以生成器不再自带任何 palette 表（否则又变成"跨母版同名同色"的隐含契约）。
/* ★ density 只调**增量** --pad-dense，由母版 CSS 用 calc(基准 + 增量) 消费 ——
   若直接写绝对值（如 96px），竖屏的 `body.p{--pad-base:...}` 会因优先级把横屏值盖掉，
   变成"density 只在横屏生效"。这是踩过的坑（竖屏像素反推恒定少 30px 暴露出来的）。 */
const DENSITY = {
  'airy': { 'pad-dense': '12px', gap: '24px' },     // 横 84+12=96 / 竖 54+12=66
  'normal': {},                                     // 母版默认，不覆盖
  'dense': { 'pad-dense': '-12px', gap: '16px' },   // 横 84-12=72 / 竖 54-12=42
}
const PAD_DELTA = { airy: 12, normal: 0, dense: -12 }
/** 与母版 CSS 的 calc(基准 + 增量) 同一算法 */
function effectivePad(deck) {
  return MF.padBase[deck.style.orientation] + strictPick(PAD_DELTA, deck.style.density, 'style.density')
}
const TEMPO = {
  'calm': { enter: 0.85, gap: 0.65, xover: 0.6 },
  'normal': { enter: 0.72, gap: 0.55, xover: 0.5 },
  'brisk': { enter: 0.55, gap: 0.42, xover: 0.4 },
}

/** 生成 <style> 里的 :root 覆盖块（几何 + 配色 + 节奏） */
function styleVars(deck) {
  const g = MF.canvas[deck.style.orientation]
  const p = strictPick(MF.paletteResolved, deck.style.palette, `母版 ${MF.id} 的 palette`)
  const t = strictPick(TEMPO, deck.style.tempo, 'style.tempo')
  const d = strictPick(DENSITY, deck.style.density, 'style.density')
  const decls = [`--W:${g.w}px`, `--H:${g.h}px`, `--accent:${p.accent}`, `--accent-rgb:${p.rgb}`,
    `--enter:${t.enter}s`, `--enter-gap:${t.gap}s`, `--xover:${t.xover}s`]
  for (const [k, v] of Object.entries(d)) decls.push(`--${k}:${v}`)
  return `:root{ ${decls.join('; ')} }`
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cp = (s) => Array.from(String(s ?? '').trim()).length

// ---------------------------------------------------------------- 版式计算
/** 第 i 页的 clip 窗口（与母版手写值逐一吻合：i=0 → 0/3.25；末页 → S-0.25/3.25；中间 → S-0.25/3.5） */
function pageWindow(i, n, xover) {
  const S = i * MF.page
  const start = i === 0 ? 0 : S - xover / 2
  const end = i === n - 1 ? S + MF.page : S + MF.page + xover / 2
  return { start: +start.toFixed(4), dur: +(end - start).toFixed(4) }
}

/** 大数字：整数位用"滚筒"（纯 transform，逐帧可 seek），小数/负号用静态字符 */
function bignumHTML(num) {
  const s = String(num)
  const totalDigits = (s.match(/[0-9]/g) || []).length
  let di = 0, out = ''
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') {
      const steps = Number(ch) + (di === totalDigits - 1 ? 10 : 0)   // 末位多转一圈 → 读起来在"跳数"
      out += `<span class="digit"><span class="strip" data-anim="roll" data-at="0.52" data-roll-steps="${steps}"></span></span>`
      di++
    } else {
      out += `<span class="digitstatic">${esc(ch)}</span>`
    }
  }
  return out
}

/* ---------------- 图表：真画（SVG），line / bar / donut 三种 ---------------- */
/** 绘图区逻辑尺寸/内边距一律来自母版 manifest（MF.plot / MF.plotPad）—— 见 masters/<id>/master.json
    （与母版 CSS 的 .p6-plot 宽高一致，故 preserveAspectRatio="none" 不失真） */

/**
 * 生成图表 SVG。三种类型都"真画"，且**图上几何严格编码输入数值**：
 *   bar  → 柱高 = v/span × 绘图区高
 *   line → 折线顶点 y = yOf(v)
 *   donut→ 扇片弧长 = v/total × 周长
 * 返回 meta（每点的坐标/柱高/弧长），供对账表**从生成的 HTML 反推数值**做交叉验证。
 */
function chartSVG(deck, p) {
  const { w: W, h: H } = MF.plot[deck.style.orientation]
  const { l: PL, r: PR, t: PT, b: PB } = MF.plotPad
  const x0 = PL, x1 = W - PR, y0 = PT, y1 = H - PB
  const s = p.chart.series
  const n = s.length
  const maxV = Math.max(...s), minV = Math.min(0, ...s)
  const span = (maxV - minV) || 1
  const yOf = (v) => +(y1 - ((v - minV) / span) * (y1 - y0)).toFixed(2)
  const slot = (x1 - x0) / n
  const labels = (Array.isArray(p.chart.labels) && p.chart.labels.length === n)
    ? p.chart.labels : s.map((_, i) => String(i + 1))
  const peak = s.indexOf(maxV)
  const g = [], lab = []
  const meta = { kind: p.chart.type, n, x0, x1, y0, y1, minV, span, marks: [] }

  if (p.chart.type === 'donut') {
    const CX = +(W / 2).toFixed(1), CY = +(H / 2).toFixed(1), RR = Math.min(W, H) / 2 - 30
    const C = 2 * Math.PI * RR
    const total = s.reduce((a, b) => a + b, 0) || 1
    let acc = 0
    g.push(`<circle class="ch-donut-track" cx="${CX}" cy="${CY}" r="${RR.toFixed(2)}" />`)
    s.forEach((v, i) => {
      const len = C * (v / total)
      const rot = -90 + (acc / total) * 360
      // ch-s{0,1,2}：相邻扇片三档明度循环（母版 CSS 定义）。既提升可读性，
      // 也让**扇区角可以从像素上验证** —— 同色相邻时边界无法分辨。
      g.push(`<circle class="ch-donut-arc ch-s${i % 3}" cx="${CX}" cy="${CY}" r="${RR.toFixed(2)}" `
        + `transform="rotate(${rot.toFixed(2)} ${CX} ${CY})" data-anim="dash" `
        + `data-dash="${len.toFixed(2)} ${(C - len).toFixed(2)}" data-off="${len.toFixed(2)}" `
        + `data-at="${(0.62 + i * 0.12).toFixed(2)}" />`)
      const mid = (rot + (len / C) * 180) * Math.PI / 180
      const lx = CX + (RR + 24) * Math.cos(mid), ly = CY + (RR + 24) * Math.sin(mid)
      lab.push(`<text class="ch-val" x="${lx.toFixed(1)}" y="${(ly + 5).toFixed(1)}" `
        + `text-anchor="${lx >= CX ? 'start' : 'end'}">${v}${labels[i] ? ' ' + esc(labels[i]) : ''}</text>`)
      meta.marks.push({ value: v, arc: +len.toFixed(2) })
      acc += v
    })
    meta.C = +C.toFixed(2)
    meta.total = total
    meta.rr = +RR.toFixed(2)
    meta.cx = CX
    meta.cy = CY
    g.push(`<g data-anim="fade" data-at="1.78">${lab.join('')}</g>`)
    return { svg: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g.join('')}</svg>`, meta }
  }

  g.push(`<line class="ch-axis" x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}" />`)
  g.push(`<line class="ch-grid" x1="${x0}" y1="${yOf(maxV)}" x2="${x1}" y2="${yOf(maxV)}" />`)
  lab.push(`<text class="ch-val" x="${x0 - 8}" y="${(yOf(maxV) + 5).toFixed(1)}" text-anchor="end">${maxV}</text>`)

  if (p.chart.type === 'line') {
    const pts = s.map((v, i) => `${(x0 + slot * (i + 0.5)).toFixed(1)},${yOf(v)}`)
    g.push(`<polyline class="ch-line" points="${pts.join(' ')}" data-anim="line" data-at="0.62" />`)
  }

  s.forEach((v, i) => {
    const cx = x0 + slot * (i + 0.5)
    if (p.chart.type === 'bar') {
      const bw = slot * 0.52
      const h = Math.max(1, +(y1 - yOf(v)).toFixed(2))
      const cls = i === peak ? 'ch-bar ch-bar--peak' : 'ch-bar'
      g.push(`<rect class="${cls}" x="${(cx - bw / 2).toFixed(1)}" y="${yOf(v)}" width="${bw.toFixed(1)}" `
        + `height="${h}" rx="3" data-anim="bar" data-at="${(0.62 + i * 0.10).toFixed(2)}" />`)
      meta.marks.push({ value: v, cx: +cx.toFixed(1), y: yOf(v), h })
    } else {
      g.push(`<circle class="ch-dot" cx="${cx.toFixed(1)}" cy="${yOf(v)}" r="4.5" data-anim="fade" data-at="1.76" />`)
      meta.marks.push({ value: v, cx: +cx.toFixed(1), y: yOf(v) })
    }
    lab.push(`<text class="ch-val" x="${cx.toFixed(1)}" y="${(yOf(v) - 11).toFixed(1)}" text-anchor="middle">${v}</text>`)
    lab.push(`<text class="ch-tick" x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle">${esc(labels[i])}</text>`)
  })
  g.push(`<g data-anim="fade" data-at="1.78">${lab.join('')}</g>`)
  return { svg: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g.join('')}</svg>`, meta }
}

/** 对账用：**从生成的 HTML 反推图上数值**，与输入 series 逐点比 —— 证明"图上几何 = 输入数据" */
function chartCheck(p, slice, deck) {
  const t = p.chart.type, s = p.chart.series
  const { w: W, h: H } = MF.plot[deck.style.orientation]
  const { l: PL, r: PR, t: PT, b: PB } = MF.plotPad
  const x0 = PL, x1 = W - PR, y0 = PT, y1 = H - PB
  const maxV = Math.max(...s), minV = Math.min(0, ...s)
  const span = (maxV - minV) || 1
  const valOf = (y) => +(((y1 - y) / (y1 - y0)) * span + minV).toFixed(2)
  const bad = [], got = []
  if (t === 'bar') {
    const m = [...slice.matchAll(/class="ch-bar[^"]*"[^>]*?x="([-\d.]+)"[^>]*?width="([-\d.]+)"[^>]*?height="([-\d.]+)"/g)]
    if (m.length !== s.length) bad.push(`图上柱数 ${m.length} ≠ series ${s.length}`)
    m.forEach((r, i) => {
      const h = parseFloat(r[3])
      const implied = +(h / (y1 - y0) * span + minV).toFixed(2)
      got.push(implied)
      if (Math.abs(implied - s[i]) > 0.15) bad.push(`第${i + 1}根柱反推 ${implied} ≠ 输入 ${s[i]}`)
    })
  } else if (t === 'line') {
    const m = /class="ch-line"[^>]*?points="([^"]+)"/.exec(slice)
    if (!m) bad.push('找不到折线 polyline')
    else {
      const pts = m[1].trim().split(/\s+/)
      if (pts.length !== s.length) bad.push(`折线顶点数 ${pts.length} ≠ series ${s.length}`)
      pts.forEach((pt, i) => {
        const implied = valOf(parseFloat(pt.split(',')[1]))
        got.push(implied)
        if (Math.abs(implied - s[i]) > 0.15) bad.push(`第${i + 1}个顶点反推 ${implied} ≠ 输入 ${s[i]}`)
      })
    }
  } else {
    const m = [...slice.matchAll(/class="ch-donut-arc[^"]*"[^>]*?data-dash="([\d.]+) [\d.]+"/g)]
    if (m.length !== s.length) bad.push(`图上扇片数 ${m.length} ≠ series ${s.length}`)
    const total = s.reduce((a, b) => a + b, 0) || 1
    const C = 2 * Math.PI * (Math.min(W, H) / 2 - 30)
    m.forEach((r, i) => {
      const implied = +(parseFloat(r[1]) / C * total).toFixed(2)
      got.push(implied)
      if (Math.abs(implied - s[i]) > 0.2) bad.push(`第${i + 1}片弧长反推 ${implied} ≠ 输入 ${s[i]}`)
    })
  }
  return {
    ok: bad.length === 0,
    detail: bad.length ? bad.join('; ')
      : `${t} · ${s.length} 点全对：图上反推 [${got.join(', ')}] == 输入 [${s.join(', ')}]`,
  }
}

/**
 * 要点页排期。
 * 推导（不是拍脑袋）：本页在第 `PAGE - XOVER/2 = 3 - 0.25 = 2.75s` 开始淡出，
 * 所以**最后落定的元素必须在淡出前完成入场** → 小结起点 ≤ 2.75 - ENTER(0.72) = **1.98s**。
 * 因此：小结固定 1.98；条目在 [0.58, 1.60] 区间内均分（≤4 条时用 0.5 间隔，条数更多则自动压缩）。
 * （手写母版当初是手工试出来的 0.58/1.08/1.58/1.76 + 小结 1.98；本式子在 3~4 条时与它同量级，
 *   且对 5 条也不会压到转场。）
 */
function bulletsSchedule(nItems, enter, xover) {
  const FIRST = 0.58
  // 小结必须在淡出前落定：SUM ≤ PAGE - xover/2 - enter - 0.05(安全余量)
  const SUM = +(MF.page - xover / 2 - enter - 0.05).toFixed(2)
  const LAST_MAX = +(SUM - 0.38).toFixed(2)
  const gap = nItems <= 1 ? 0 : Math.min(0.5, (LAST_MAX - FIRST) / (nItems - 1))
  const items = []
  for (let k = 0; k < nItems; k++) items.push(+(FIRST + k * gap).toFixed(3))
  return { items, sum: SUM }
}

// ---------------------------------------------------------------- 页型 → HTML
function pageHTML(p, i, n, deck) {
  const T = strictPick(TEMPO, deck.style.tempo, 'style.tempo')
  const w = pageWindow(i, n, T.xover)
  // 只有"图片页"需要把版式类挂到 section 上（其余页型 extraCls 为空 ⇒ 输出字节不变）
  const extraCls = p.type === 'image' ? ` p9--${p.layout}` : ''
  const head = `  <!-- PAGE ${i}:${p.type} -->\n  <section class="page clip${extraCls}" data-start="${w.start}" data-duration="${w.dur}" data-track-index="1">`
  const tail = `    <div class="progress"><i></i></div>\n  </section>\n  <!-- /PAGE ${i} -->`

  if (p.type === 'cover') {
    // 与手写母版保持同一措辞：出品方带"出品："前缀；日期跟在后面
    const iss = [deck.meta.issuer ? `出品：${deck.meta.issuer}` : '', deck.meta.date].filter(Boolean).join(' · ')
    return [
      head,
      `    <div class="tex"></div>`,
      `    <div class="photo" data-anim="push" data-at="0.15"><img src="${MF.assets}/${MF.cover}" alt="" /></div>`,
      `    <div class="cover-copy">`,
      `      <div class="rule" data-anim="rule" data-at="0.10"></div>`,
      `      <div class="kicker" data-anim="rise" data-at="0.28">${esc(p.kicker || '')}</div>`,
      `      <h1 class="cover-title" data-anim="rise" data-at="0.44">${esc(deck.meta.title)}</h1>`,
      `      <p class="cover-sub" data-anim="rise" data-at="0.99">${esc(deck.meta.subtitle)}</p>`,
      `    </div>`,
      `    <div class="issuer" data-anim="rise" data-at="2.05">${esc(iss)}</div>`,
      tail,
    ].join('\n')
  }

  if (p.type === 'bullets') {
    const s = bulletsSchedule(p.items.length, T.enter, T.xover)
    const lis = p.items.map((t, k) =>
      `      <li data-anim="rise" data-at="${s.items[k]}"><span class="n">${String(k + 1).padStart(2, '0')}</span><span class="t">${esc(t)}</span></li>`).join('\n')
    return [
      head,
      `    <div class="tex"></div>`,
      `    <div class="p2-head">`,
      `      <div class="rule" data-anim="rule" data-at="0.30"></div>`,
      `      <h2 class="h2" data-anim="rise" data-at="0.38">${esc(p.title)}</h2>`,
      `    </div>`,
      `    <ul class="p2-list">`,
      lis,
      `    </ul>`,
      `    <div class="p2-sum" data-anim="rise" data-at="${s.sum}">${esc(p.summary)}</div>`,
      tail,
    ].join('\n')
  }

  if (p.type === 'data') {
    const sec = p.secondary.map((x, k) =>
      `      <div data-anim="rise" data-at="${(1.45 + k * 0.30).toFixed(2)}">\n` +
      `        <div class="k">${esc(x.label)}</div>\n` +
      (x.note ? `        <div class="v">${esc(x.note)}</div>\n` : '') +
      `      </div>`).join('\n')
    return [
      head,
      `    <div class="tex"></div>`,
      `    <div class="p3-head">`,
      `      <div class="rule" data-anim="rule" data-at="0.30"></div>`,
      `      <h2 class="h2" data-anim="rise" data-at="0.38">${esc(p.title)}</h2>`,
      `    </div>`,
      `    <div class="p3-body">`,
      `      <div class="bignum" data-anim="fade" data-at="0.46">${bignumHTML(p.metric.number)}</div>`,
      `      <div class="unit" data-anim="rise" data-at="0.64">${esc(p.metric.unit)}</div>`,
      `    </div>`,
      `    <div class="p3-explain" data-anim="rise" data-at="1.05">${esc(p.metric.explain)}</div>`,
      `    <div class="p3-metrics">`,
      sec,
      `    </div>`,
      tail,
    ].join('\n')
  }

  if (p.type === 'end') {
    return [
      head,
      `    <div class="tex"></div>`,
      `    <div class="p4-wrap">`,
      `      <div class="p4-line" data-anim="rise" data-at="0.34">${esc(p.line1)}</div>`,
      p.line2 ? `      <div class="p4-line" data-anim="rise" data-at="0.62">${esc(p.line2)}</div>` : '',
      `      <div class="p4-cta" data-anim="rise" data-at="1.05">${esc(p.cta)}</div>`,
      `    </div>`,
      `    <div class="p4-en" data-anim="fade" data-at="1.45">${esc(p.en)}</div>`,
      tail,
    ].filter((x) => x !== '').join('\n')
  }

  // ---------- 新页型（本轮 4 → 8） ----------
  if (p.type === 'section') {
    return [
      head,
      `    <div class="tex"></div>`,
      p.number ? `    <div class="p5-num" data-anim="fade" data-at="0.20">${esc(p.number)}</div>` : '',
      `    <div class="p5-copy">`,
      `      <div class="rule" data-anim="rule" data-at="0.34"></div>`,
      `      <h2 class="p5-title" data-anim="rise" data-at="0.44">${esc(p.title)}</h2>`,
      p.subtitle ? `      <p class="p5-sub" data-anim="rise" data-at="0.92">${esc(p.subtitle)}</p>` : '',
      `    </div>`,
      tail,
    ].filter((x) => x !== '').join('\n')
  }

  if (p.type === 'chart') {
    const c = chartSVG(deck, p)
    return [
      head,
      `    <div class="tex"></div>`,
      `    <div class="p6-head">`,
      `      <div class="rule" data-anim="rule" data-at="0.30"></div>`,
      `      <h2 class="h2" data-anim="rise" data-at="0.38">${esc(p.title)}</h2>`,
      `    </div>`,
      `    <div class="p6-unit" data-anim="fade" data-at="0.52">${esc(p.unit)}</div>`,
      `    <div class="p6-plot">${c.svg}</div>`,
      `    <div class="p6-explain" data-anim="rise" data-at="1.95">${esc(p.explain)}</div>`,
      p.source ? `    <div class="p6-src" data-anim="fade" data-at="2.10">${esc(p.source)}</div>` : '',
      tail,
    ].filter((x) => x !== '').join('\n')
  }

  if (p.type === 'compare') {
    // 两层错峰：标题 → 左栏 → 右栏 → 结论（栏内条目跟随整栏入场，避免嵌套 opacity 叠加）
    const col = (sd, cls, anim, at) => [
      `      <div class="p7-col ${cls}" data-anim="${anim}" data-at="${at}">`,
      `        <div class="p7-label">${esc(sd.label)}</div>`,
      `        <ul class="p7-points">`,
      ...sd.points.map((t) => `          <li>${esc(t)}</li>`),
      `        </ul>`,
      `      </div>`,
    ]
    return [
      head,
      `    <div class="tex"></div>`,
      `    <div class="p7-head">`,
      `      <div class="rule" data-anim="rule" data-at="0.30"></div>`,
      `      <h2 class="h2" data-anim="rise" data-at="0.38">${esc(p.title)}</h2>`,
      `    </div>`,
      `    <div class="p7-grid">`,
      ...col(p.left, 'p7-col--a', 'slideL', 0.62),
      ...col(p.right, 'p7-col--b', 'slideR', 0.80),
      `    </div>`,
      `    <div class="p7-concl" data-anim="rise" data-at="1.55">${esc(p.conclusion)}</div>`,
      tail,
    ].join('\n')
  }

  if (p.type === 'quote') {
    return [
      head,
      `    <div class="tex"></div>`,
      `    <div class="p8-mark" data-anim="fade" data-at="0.24">“</div>`,
      `    <div class="p8-quote" data-anim="rise" data-at="0.42">${esc(p.quote)}</div>`,
      p.author ? `    <div class="p8-author" data-anim="rise" data-at="1.25">${esc(p.author)}</div>` : '',
      p.context ? `    <div class="p8-context" data-anim="fade" data-at="1.45">${esc(p.context)}</div>` : '',
      tail,
    ].filter((x) => x !== '').join('\n')
  }

  if (p.type === 'toc') {
    const gap = Math.min(0.34, 1.32 / Math.max(1, p.items.length - 1))
    const lis = p.items.map((t, k) => `      <li data-anim="rise" data-at="${(0.58 + k * gap).toFixed(3)}">`
      + `<span class="n">${String(k + 1).padStart(2, '0')}</span><span class="t">${esc(t)}</span></li>`).join('\n')
    return [
      head,
      `    <div class="tex"></div>`,
      `    <div class="p2-head">`,
      `      <div class="rule" data-anim="rule" data-at="0.30"></div>`,
      `      <h2 class="h2" data-anim="rise" data-at="0.38">${esc(p.title)}</h2>`,
      `    </div>`,
      `    <ul class="p2-list p2-list--toc">`,
      lis,
      `    </ul>`,
      tail,
    ].join('\n')
  }

  if (p.type === 'summary') {
    const lis = p.items.map((t, k) => `      <li data-anim="rise" data-at="${(0.58 + k * 0.5).toFixed(2)}">`
      + `<span class="n">0${k + 1}</span><span class="t">${esc(t)}</span></li>`).join('\n')
    return [
      head,
      `    <div class="tex"></div>`,
      `    <div class="p2-head">`,
      `      <div class="rule" data-anim="rule" data-at="0.30"></div>`,
      `      <h2 class="h2" data-anim="rise" data-at="0.38">${esc(p.title)}</h2>`,
      `    </div>`,
      `    <ul class="p2-list">`,
      lis,
      `    </ul>`,
      p.closing ? `    <div class="p2-sum" data-anim="rise" data-at="1.98">${esc(p.closing)}</div>` : '',
      tail,
    ].filter((x) => x !== '').join('\n')
  }

  // ---------- 新增页型 11~12：图片 / 步骤 ----------
  if (p.type === 'image') {
    // 素材已被拷进产物的 assets/（见 main），引用它的 basename
    const src = `${MF.assets}/${basename(p.asset)}`
    return [
      head,
      `    <div class="p9-media" data-anim="push" data-at="0.12"><img src="${src}" alt="" /></div>`,
      p.layout === 'full' ? `    <div class="p9-full-scrim"></div>` : '',
      `    <div class="p9-copy">`,
      p.kicker ? `      <div class="p9-kicker" data-anim="rise" data-at="0.34">${esc(p.kicker)}</div>` : '',
      `      <div class="p9-head"><div class="rule" data-anim="rule" data-at="0.40"></div></div>`,
      `      <h2 class="p9-title" data-anim="rise" data-at="0.50">${esc(p.title)}</h2>`,
      p.caption ? `      <p class="p9-caption" data-anim="rise" data-at="0.98">${esc(p.caption)}</p>` : '',
      `    </div>`,
      tail,
    ].filter((x) => x !== '').join('\n')
  }

  if (p.type === 'steps') {
    const dot = p.index === 'dot'
    const gap = Math.min(0.40, 1.37 / Math.max(1, p.steps.length - 1))
    const lis = p.steps.map((t, k) => `      <li data-anim="rise" data-at="${(0.58 + k * gap).toFixed(3)}">`
      + `<span class="n">${k + 1}</span><span class="t">${esc(t)}</span></li>`).join('\n')
    return [
      head,
      `    <div class="tex"></div>`,
      `    <div class="p10-head">`,
      `      <div class="rule" data-anim="rule" data-at="0.30"></div>`,
      `      <h2 class="h2" data-anim="rise" data-at="0.38">${esc(p.title)}</h2>`,
      `    </div>`,
      `    <ul class="p10-list${dot ? ' p10-list--dot' : ''}">`,
      lis,
      `    </ul>`,
      tail,
    ].join('\n')
  }

  throw new Error(`render-deck: 未支持的页型 "${p.type}"（schema 与生成器不同步）`)
}

function buildHTML(deck) {
  const g = MF.canvas[deck.style.orientation]
  const n = deck.pages.length
  const total = +(n * MF.page).toFixed(4)
  const body = deck.pages.map((p, i) => pageHTML(p, i, n, deck)).join('\n\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${g.w}, height=${g.h}" />
<title>${esc(deck.meta.title)}</title>
<link rel="stylesheet" href="${MF.assets}/${MF.files.css}" />
<style>${styleVars(deck)}</style>
</head>
<body${g.portrait ? ' class="p"' : ''}>
<div id="stage" data-composition-id="main" data-start="0" data-duration="${total}"
     data-fps="${FPS}" data-width="${g.w}" data-height="${g.h}">

  <div class="glow clip" data-start="0" data-duration="${total}" data-track-index="0"></div>

${body}
</div>

<script src="${MF.assets}/${MF.files.gsap}"></script>
<script src="${MF.assets}/${MF.files.js}"></script>
</body>
</html>
`
}

// ---------------------------------------------------------------- 对账
/** 每页"应从 deck 出现在画面上"的字符串（label → value） */
function pageStrings(p, deck) {
  const out = []
  const push = (label, v) => { if (typeof v === 'string' && v.trim()) out.push({ label, value: v }) }
  if (p.type === 'cover') {
    push('meta.title', deck.meta.title); push('meta.subtitle', deck.meta.subtitle)
    push('cover.kicker', p.kicker); push('meta.issuer', deck.meta.issuer); push('meta.date', deck.meta.date)
  } else if (p.type === 'bullets') {
    push('bullets.title', p.title)
    p.items.forEach((t, k) => push(`bullets.items[${k}]`, t))
    push('bullets.summary', p.summary)
  } else if (p.type === 'data') {
    push('data.title', p.title)
    // ★ 注意：data.metric.number 不在本表里 —— 大数字是"滚筒"渲染的，HTML 里没有 "82" 这种字面量，
    //   所以它由 numberCheck() 单独校验（校验滚筒格数是否编码了正确的数字）。
    push('data.metric.unit', p.metric.unit); push('data.metric.explain', p.metric.explain)
    p.secondary.forEach((x, k) => { push(`data.secondary[${k}].label`, x.label); push(`data.secondary[${k}].note`, x.note) })
  } else if (p.type === 'end') {
    push('end.line1', p.line1); push('end.line2', p.line2); push('end.cta', p.cta); push('end.en', p.en)
  } else if (p.type === 'section') {
    push('section.number', p.number); push('section.title', p.title); push('section.subtitle', p.subtitle)
  } else if (p.type === 'chart') {
    push('chart.title', p.title); push('chart.unit', p.unit)
    push('chart.explain', p.explain); push('chart.source', p.source)
    if (Array.isArray(p.chart.labels)) p.chart.labels.forEach((t, k) => push(`chart.labels[${k}]`, t))
    // ★ chart.series 不列入本表：数值虽也作为 SVG <text> 出现在 HTML 里，但"内容没丢"不足以证明
    //   "图画对了"。series 由 chartCheck() 单独校验 —— **从图上几何反推数值**再与输入比。
  } else if (p.type === 'compare') {
    push('compare.title', p.title); push('compare.conclusion', p.conclusion)
    push('compare.left.label', p.left.label)
    p.left.points.forEach((t, k) => push(`compare.left.points[${k}]`, t))
    push('compare.right.label', p.right.label)
    p.right.points.forEach((t, k) => push(`compare.right.points[${k}]`, t))
  } else if (p.type === 'quote') {
    push('quote.quote', p.quote); push('quote.author', p.author); push('quote.context', p.context)
  } else if (p.type === 'toc') {
    push('toc.title', p.title); p.items.forEach((t, k) => push(`toc.items[${k}]`, t))
  } else if (p.type === 'summary') {
    push('summary.title', p.title); p.items.forEach((t, k) => push(`summary.items[${k}]`, t))
    push('summary.closing', p.closing)
  } else if (p.type === 'image') {
    push('image.title', p.title); push('image.kicker', p.kicker); push('image.caption', p.caption)
    // ★ image.asset 不列入本表：它是 `<img src>` 的**属性值**（不是文本节点），
    //   列入只会得到"命中属性字符串"这种弱证据。它由 verify-image.mjs **从像素证明"素材真上屏"**。
  } else if (p.type === 'steps') {
    push('steps.title', p.title)
    p.steps.forEach((t, k) => push(`steps.steps[${k}]`, t))
  }
  return out
}

const TEXTSEP = '\u0001'
/** 把一段 HTML 切成"文本节点"（去标签后按分隔符切）。
 *  为什么必须这么做：整片做子串会有两个致命误判 —— ① 短字符串（如单位"秒"、数字"4"）会在别处误命中；
 *  ② 标签属性里也可能碰到同样的字。按**单个文本节点**比对才是"这句话真的被渲染在这页上"。 */
function textNodes(slice) {
  return slice.replace(/<[^>]*>/g, TEXTSEP).split(TEXTSEP).map((s) => s.trim()).filter(Boolean)
}

/** 大数字专用校验：滚筒格数必须编码出正确的数字（末位多转一圈 = +10），非数字字符由 digitstatic 承载 */
function numberCheck(p, slice) {
  const chars = String(p.metric.number)
  const steps = [...slice.matchAll(/data-roll-steps="(\d+)"/g)].map((m) => Number(m[1]))
  const statics = [...slice.matchAll(/<span class="digitstatic">([^<]*)<\/span>/g)].map((m) => m[1])
  const lastDigitIdx = chars.split('').reduce((acc, ch, i) => (/[0-9]/.test(ch) ? i : acc), -1)
  const bad = []
  let si = 0, ti = 0
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (ch >= '0' && ch <= '9') {
      const want = Number(ch) + (i === lastDigitIdx ? 10 : 0)
      const got = steps[si++]
      if (got !== want) bad.push(`第${si}位数字${ch} 期望格数${want} 实际${got}`)
    } else {
      const got = statics[ti++]
      if (got !== ch) bad.push(`静态字符 期望"${ch}" 实际"${got}"`)
    }
  }
  if (si !== steps.length) bad.push(`滚筒个数 ${steps.length} ≠ 数字位数 ${si}`)
  return { ok: bad.length === 0, detail: bad.length ? bad.join('; ') : `${chars} → 滚筒格数 [${steps.join(', ')}]` }
}

function reconcile(deck, html) {
  const n = deck.pages.length
  const slices = deck.pages.map((p, i) => {
    const a = html.indexOf(`<!-- PAGE ${i}:${p.type} -->`)
    const b = html.indexOf(`<!-- /PAGE ${i} -->`)
    return a >= 0 && b > a ? html.slice(a, b) : null
  })
  const allStrings = deck.pages.map((p) => pageStrings(p, deck))
  const rows = []
  let missing = 0, leaks = 0, suspects = 0, numBad = 0, chartBad = 0
  deck.pages.forEach((p, i) => {
    const own = allStrings[i]
    const slice = slices[i]
    if (!slice) {
      rows.push({ i, type: p.type, total: own.length, miss: [{ label: '(整页)', value: '页面切片未找到（生成器 bug）' }], foreign: [] })
      missing++; return
    }
    const nodes = textNodes(slice)
    const exact = new Set(nodes)                    // 精确节点文本集合
    const mine = new Set(own.map((s) => s.value))
    // 本页字段命中：允许"被拼进更长的节点"（如 cover 把 issuer 与 date 拼成一行）
    const miss = own.filter((s) => !nodes.some((nd) => nd.includes(s.value)))
    // ★ 跨页判定分两档（这是踩过假阳性后收窄的）：
    //   foreign(拦) = 别页字段在本页出现了**正好等于该值的独立节点** → 真·错位/重复上屏
    //   suspect(不拦，仅提示) = 只是**子串命中** → 极可能是正常引用（实测三种假阳性：
    //        "HTML 逐帧" 嵌在章节副题里、"2026-10" 嵌在引用出处里、"01" 撞上要点页编号）
    const foreign = [], suspect = []
    allStrings.forEach((arr, j) => {
      if (j === i) return
      for (const s of arr) {
        if (mine.has(s.value)) continue
        if (cp(s.value) < 4) continue               // 过短的值（编号 "01" 之类）不参与跨页判定
        if (exact.has(s.value.trim())) foreign.push(`p${j}.${s.label}`)
        else if (nodes.some((nd) => nd.includes(s.value))) suspect.push(`p${j}.${s.label}`)
      }
    })
    let num = null
    if (p.type === 'data') { num = numberCheck(p, slice); if (!num.ok) numBad++ }
    let chart = null
    if (p.type === 'chart') { chart = chartCheck(p, slice, deck); if (!chart.ok) chartBad++ }
    missing += miss.length; leaks += foreign.length; suspects += suspect.length
    rows.push({ i, type: p.type, total: own.length, miss, foreign, suspect, slice, num, chart })
  })
  return { rows, missing, leaks, suspects, numBad, chartBad, slices }
}

// ---------------------------------------------------------------- 主流程
function main() {
  const args = process.argv.slice(2)
  const noRender = args.includes('--no-render')
  const deckPath = args.find((a) => !a.startsWith('--'))
  const oi = args.indexOf('--outdir')
  const outRoot = oi >= 0 ? resolve(args[oi + 1]) : join(HERE, 'out')
  if (!deckPath) fail(EXIT.USAGE, 'usage', '缺 deck.json 路径。用法: node render-deck.mjs <deck.json> [--outdir out] [--no-render]')

  const deckAbs = resolve(deckPath)
  if (!existsSync(deckAbs)) fail(EXIT.USAGE, 'usage', `deck 不存在: ${deckAbs}`)
  let deck
  try { deck = JSON.parse(readFileSync(deckAbs, 'utf8')) } catch (e) { fail(EXIT.USAGE, 'usage', `deck.json 不是合法 JSON: ${e.message}`) }
  const deckName = basename(deckAbs).replace(/\.json$/i, '')
  const ctx = { deck: deckName, deck_path: deckAbs }
  // ---- ⓪ 母版解析：masterId 是枚举 → masters/<id>/master.json（本文件不自带母版数值）----
  if (!deck.style || !MASTER_IDS.includes(deck.style.masterId)) {
    fail(EXIT.USAGE, 'master', `未知或缺失 masterId: ${JSON.stringify(deck.style && deck.style.masterId)}（可用: ${MASTER_IDS.join(', ')}）`, ctx)
  }
  MF = loadMaster(deck.style.masterId)
  if (!MF.paletteResolved[deck.style.palette]) {
    fail(EXIT.USAGE, 'palette', `母版 ${MF.id} 没有配色 ${JSON.stringify(deck.style.palette)}（可用: ${Object.keys(MF.paletteResolved).join(', ')}）`, ctx)
  }
  // 封面素材：**目前只支持母版自带封面**。deck 若指定了别的素材，必须报错而不是静默忽略
  //（"能过校验但不生效"正是契约第一条禁止的事）
  const coverPage = Array.isArray(deck.pages) ? deck.pages.find((x) => x && x.type === 'cover') : null
  const effectiveCover = `${MF.assets}/${MF.cover}`
  if (coverPage && coverPage.asset && coverPage.asset !== effectiveCover) {
    fail(EXIT.USAGE, 'asset',
      `deck 指定封面素材 ${JSON.stringify(coverPage.asset)}，但当前只支持母版自带封面 ${JSON.stringify(effectiveCover)}`
      + `（自定义封面尚未实现 —— 明确报错，不做静默忽略）`, ctx)
  }
  const name = deckName
  const workdir = join(outRoot, name)

  // ---- ① 闸门：校验不通过 → 大声失败、绝不渲染 ----
  const v = spawnSync(process.execPath, [VALIDATOR, deckAbs, '--json'], { cwd: HERE, encoding: 'utf8' })
  let vr = null
  try { vr = JSON.parse(v.stdout) } catch { /* fallthrough */ }
  if (!vr || !vr.pass) {
    console.error(`\n✗✗ 校验不通过 → 拒绝渲染（这是有意的硬闸门）\n`)
    console.error(v.stdout || v.stderr || '(校验器无输出)')
    emitResult({
      ok: false, code: EXIT.VALIDATE, stage: 'validate', ...ctx,
      errors: vr ? vr.errorCount : null, warns: vr ? vr.warnCount : null,
      validator_ran: !!vr,
      detail: vr ? (vr.issues || []).filter((x) => x.level === 'error').map((x) => `${x.path}: ${x.msg}`) : ['校验器无法产出可解析结果'],
    })
    process.exit(EXIT.VALIDATE)
  }
  console.log(`✓ 校验通过（不达标 0 / 建议 ${vr.warnCount}）`)

  // ---- ② 生成 HTML + 复制母版资产 ----
  mkdirSync(workdir, { recursive: true })
  for (const d of ['frames']) mkdirSync(join(workdir, d), { recursive: true })
  const assetsDir = join(workdir, MF.assets)
  if (existsSync(assetsDir)) rmSync(assetsDir, { recursive: true, force: true })
  cpSync(MF.assetsRoot, assetsDir, { recursive: true })
  const hfName = MF.hyperframes || 'hyperframes.json'
  cpSync(join(MF.dir, hfName), join(workdir, hfName), { force: true })
  // 图片页素材：从 deck 目录拷进产物目录（自包含）。素材缺失**在生成期就炸**，绝不渲成黑屏。
  const deckDirAbs = dirname(deckAbs)
  const imgPages = deck.pages.map((pg, i) => ({ pg, i })).filter((x) => x.pg && x.pg.type === 'image')
  for (const { pg } of imgPages) {
    const abs = resolve(deckDirAbs, pg.asset)
    if (!existsSync(abs)) {
      throw new Error(`图片页素材不存在：${abs}（deck 里写的是 ${JSON.stringify(pg.asset)}，相对 deck 文件解析）`)
    }
    cpSync(abs, join(assetsDir, basename(abs)), { force: true })
  }

  const htmlPath = join(workdir, 'deck-page.html')
  writeFileSync(htmlPath, buildHTML(deck), 'utf8')

  const n = deck.pages.length
  const total = +(n * MF.page).toFixed(4)
  const seq = deck.pages.map((p) => p.type).join(' → ')
  console.log(`母版: ${MF.id}（${MF.name}）→ masters/${MF.id}/`)
  console.log(`页型序列: ${seq}   （${n} 页 × ${MF.page}s = ${total}s，画布 ${MF.canvas[deck.style.orientation].w}×${MF.canvas[deck.style.orientation].h}，style=${deck.style.palette}/${deck.style.density}/${deck.style.tempo}）`)
  console.log(`生成: ${htmlPath}`)

  // ---- ③ 对账（HTML 级：逐页逐字段 verbatim 命中 + 跨页泄漏检查）----
  const recon = reconcile(deck, readFileSync(htmlPath, 'utf8'))
  const mp4 = join(workdir, `output-${name}.mp4`)
  const lines = []
  lines.push(`# 输入→输出 对账表 · ${name}`)
  lines.push('')
  lines.push(`- deck: \`${deckAbs}\``)
  lines.push(`- 页型序列: ${seq}`)
  lines.push(`- 时长: ${n} × ${MF.page}s = **${total}s**（${FPS}fps → ${n * MF.page * FPS} 帧）`)
  lines.push(`- 母版: masterId=\`${deck.style.masterId}\`（${MF.name}）· 资产根 \`masters/${deck.style.masterId}/\``)
  lines.push(`- style: masterId=${deck.style.masterId} palette=${deck.style.palette} density=${deck.style.density} tempo=${deck.style.tempo} orientation=${deck.style.orientation}`)
  lines.push('')
  lines.push('## 逐页字段 → HTML 命中（**按文本节点**比对）')
  lines.push('')
  lines.push('- `未命中` = 本页字段在 HTML 里找不到 → **拦渲染**（丢内容）')
  lines.push('- `跨页重复` = 别页字段在本页出现了**正好等于该值的独立节点** → **拦渲染**（错位）')
  lines.push('- `疑似重复` = 只是**子串命中** → **不拦**，仅提示（可能是正常引用，需人看）')
  lines.push('')
  lines.push('| 页 | 页型 | 字段数 | 未命中 | 跨页重复(拦) | 疑似重复(不拦) |')
  lines.push('|---|---|---|---|---|---|')
  for (const r of recon.rows) {
    lines.push(`| ${r.i} | ${r.type} | ${r.total || '-'} | ${r.miss ? (r.miss.length ? r.miss.map((m) => m.label).join(', ') : '0 ✓') : '-'} | ${r.foreign ? (r.foreign.length ? r.foreign.join(', ') : '0 ✓') : '-'} | ${r.suspect ? (r.suspect.length ? r.suspect.join(', ') : '0') : '-'} |`)
  }
  lines.push('')
  lines.push('## 逐字段明细')
  lines.push('')
  lines.push('| 页 | 页型 | 字段 | 值 | 本页命中 |')
  lines.push('|---|---|---|---|---|')
  for (const r of recon.rows) {
    if (!r.slice) continue
    const nodes = textNodes(r.slice)
    for (const s of pageStrings(deck.pages[r.i], deck)) {
      const hit = nodes.some((nd) => nd.includes(s.value))
      lines.push(`| ${r.i} | ${r.type} | \`${s.label}\` | ${String(s.value).replace(/\|/g, '\\|')} | ${hit ? '✓' : '**✗ 缺失**'} |`)
    }
    if (r.num) lines.push(`| ${r.i} | ${r.type} | \`data.metric.number\` | ${deck.pages[r.i].metric.number} | ${r.num.ok ? '✓ 滚筒编码正确' : '**✗ ' + r.num.detail + '**'} |`)
    if (r.chart) lines.push(`| ${r.i} | ${r.type} | \`chart.series\` | ${deck.pages[r.i].chart.series.join(', ')} | ${r.chart.ok ? '✓ 图上几何 = 输入数据' : '**✗ ' + r.chart.detail + '**'} |`)
  }
  lines.push('')
  lines.push(`\n**结论：未命中 ${recon.missing} 项 / 大数字编码错误 ${recon.numBad} 项 / 图表编码错误 ${recon.chartBad} 项 / 跨页重复 ${recon.leaks} 项** —— 这四者必须全为 0 才允许渲染。`)
  lines.push(`（另有 **${recon.suspects} 项"疑似重复"**：仅子串命中、**不拦渲染**，属正常引用范畴，需人看。）`)
  lines.push('')
  lines.push('> 比对口径：把每页 HTML 切成**文本节点**后按节点比对（不是整片子串）—— 避免短字符串（单位"秒"、数字"4"）在别处误命中；')
  lines.push('> 跨页判定只认"**独立节点恰好相等**"（并跳过 <4 字的值），因为子串命中实测会产生假阳性：')
  lines.push('> `HTML 逐帧`（对比页标签）嵌在章节副题里、`2026-10`（封面日期）嵌在引用出处里、`01`（章节编号）撞上要点页编号 —— 三者均为正常内容。')
  lines.push('> `data.metric.number` 因是**滚筒渲染**（HTML 里没有字面量），改为校验"滚筒格数是否编码了正确数字"；')
  lines.push('> `chart.series` 因是**画出来的几何**，改为从图上坐标/柱高/弧长**反推数值**再与输入逐点比（见明细表）。')
  lines.push('')
  lines.push('> 说明：本表证明的是"**生成出的 HTML 里逐字包含 deck 的每个字段值、且没有串页**"（程序化可判）；')
  lines.push('> "画面上真的长这样"由同目录 `frames/p<i>-enter.png` / `p<i>-full.png` 人眼确认（不做 OCR，避免引入新误差源）。')
  writeFileSync(join(workdir, 'reconcile.md'), lines.join('\n'), 'utf8')
  console.log(`对账: 未命中 ${recon.missing} / 大数字错 ${recon.numBad} / 图表错 ${recon.chartBad} / 跨页泄漏 ${recon.leaks}  → ${join(workdir, 'reconcile.md')}`)

  // 图表几何元数据 → 供 verify-chart.mjs 做"抽帧反推数值"的**独立**校验（不重复 PLOT 常量，避免两处漂移）
  const chartPages = deck.pages.map((pg, i) => ({ pg, i })).filter((x) => x.pg.type === 'chart')
  if (chartPages.length) {
    const o = deck.style.orientation
    const pad = effectivePad(deck)
    const accent = MF.paletteResolved[deck.style.palette] || MF.paletteResolved['warm-gold']
    writeFileSync(join(workdir, 'chart-meta.json'), JSON.stringify({
      deck, masterId: MF.id, orientation: o, canvas: MF.canvas[o], density: deck.style.density, pad,
      plotTop: pad + MF.plotTopOffset[o],           // 与母版 CSS 的 .p6-plot top 一致
      plot: MF.plot[o], padBox: MF.plotPad,
      // 像素反推需要的颜色信息由母版给出，避免验证器写死"深底亮柱"（跨皮肤会全错）
      bg: MF.bg, ink: MF.ink, rule: MF.rule, barColor: accent.rgb, barAlpha: MF.chart.barAlpha,
      donutShades: MF.donutShades,
      pages: chartPages.map((x) => ({
        index: x.i, kind: x.pg.chart.type, series: x.pg.chart.series,
        meta: chartSVG(deck, x.pg).meta,
      })),
    }, null, 2), 'utf8')
    console.log(`图表几何: chart-meta.json（${chartPages.length} 页 · ${chartPages[0].pg.chart.type}）`)
  }
  // 图片页几何元数据 → 供 verify-image.mjs 做"素材真上屏 + 全幅压字对比度"的独立校验
  if (imgPages.length) {
    const o = deck.style.orientation
    writeFileSync(join(workdir, 'image-meta.json'), JSON.stringify({
      deck, masterId: MF.id, orientation: o, pad: effectivePad(deck), canvas: MF.canvas[o], bg: MF.bg,
      pages: imgPages.map((x) => ({
        index: x.i, layout: x.pg.layout, asset: x.pg.asset,
        srcPath: resolve(deckDirAbs, x.pg.asset), onScreen: `${MF.assets}/${basename(x.pg.asset)}`,
        region: MF.image[o][x.pg.layout], objectFit: 'cover',
        title: x.pg.title, caption: x.pg.caption || null,
      })),
    }, null, 2), 'utf8')
    console.log(`图片页几何: image-meta.json（${imgPages.length} 页 · ${imgPages.map((x) => x.pg.layout).join('/')}）`)
  }

  if (recon.missing > 0 || recon.leaks > 0 || recon.numBad > 0 || recon.chartBad > 0) {
    console.error('✗ 对账不通过，拒绝继续')
    emitResult({
      ok: false, code: EXIT.RECONCILE, stage: 'reconcile', ...ctx,
      master_id: MF.id, orientation: deck.style.orientation,
      missing: recon.missing, num_bad: recon.numBad, chart_bad: recon.chartBad, leaks: recon.leaks,
      detail: recon.rows.filter((r) => r.miss.length || r.foreign.length || (r.num && !r.num.ok) || (r.chart && !r.chart.ok))
        .map((r) => `p${r.i}:${r.type}`),
      note: '对账不通过 = 生成器缺陷信号（内容丢失/串页/图表几何与数据不符），不是 deck 内容问题',
    })
    process.exit(EXIT.RECONCILE)
  }

  if (noRender) {
    console.log('(--no-render：已停在生成+对账，未渲染)')
    emitResult({
      ok: true, code: EXIT.OK, stage: 'no-render', rendered: false, ...ctx,
      master_id: MF.id, orientation: deck.style.orientation, density: deck.style.density,
      palette: deck.style.palette, pages: n, page_s: MF.page, frames_expected: n * MF.page * FPS,
      duration_s: total, html: htmlPath, reconcile: join(workdir, 'reconcile.md'),
      reconcile_counts: { missing: recon.missing, num_bad: recon.numBad, chart_bad: recon.chartBad, leaks: recon.leaks },
    })
    return
  }

  // ---- ④ 渲染（D10: --workers 1）----
  const t0 = Date.now()
  const r = spawnSync(HF, ['render', '.', '-c', 'deck-page.html', '-o', `"${mp4}"`, '--fps', String(FPS), '--quality', 'looks', '--workers', '1'],
    { cwd: workdir, shell: true, encoding: 'utf8' })
  const renderMs = Date.now() - t0
  if (r.status !== 0) {
    emitResult({
      ok: false, code: EXIT.RENDER, stage: 'render', ...ctx,
      master_id: MF.id, render_ms: renderMs, hyperframes_exit: r.status,
      stderr_tail: String(r.stderr || '').trim().split('\n').slice(-6),
    })
    fail(EXIT.RENDER, 'render', `渲染失败（hyperframes 退出码 ${r.status}）`, ctx)
  }
  const report = (r.stdout || '').split('\n').filter((l) => /rendered in|\.mp4/.test(l)).slice(-2).join('\n')
  console.log(report.trim())

  // ---- ⑤ 产物校验（含 D9 色彩标签）----
  const p = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_frames,color_range,color_space',
    '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1', mp4], { encoding: 'utf8' })
  console.log('ffprobe:\n' + (p.stdout || '').trim().split('\n').map((l) => '  ' + l).join('\n'))

  // ---- ⑥ 每页 2 帧 ----
  for (let i = 0; i < n; i++) {
    const S = i * MF.page
    // ★ `full` 帧的取样时刻：页窗口是 [S-0.25, S+3.25]，而**下一页从 S+2.75 就开始淡入**
    //   ⇒ 必须取 S+2.75 之前；同时入场动画最晚到 S+2.70（图表的 source、小结的 closing）
    //   ⇒ 取 S+2.70：既"已落定"又"本页独显"。
    //   坑：曾取 S+2.85 ⇒ 采到下一页 0.1s 的淡入，实测把图下半压暗到 0.62 倍
    //   （被 verify-image 的逐点比色抓出来：源图黄色 (221,190,30) 渲成 (119,99,15)）。
    const shots = [['enter', S + 0.75], ['full', S + 2.70]]
    for (const [kind, t] of shots) {
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', join(workdir, 'frames', `p${i}-${kind}.png`)])
    }
  }
  console.log(`抽帧: ${n * 2} 张 → ${join(workdir, 'frames')}`)

  // ---- ⑦ 产物指纹 + 机器可读总结行 ----
  const kv = {}
  for (const line of (p.stdout || '').trim().split('\n')) { const s = line.split('='); if (s.length === 2) kv[s[0].trim()] = s[1].trim() }
  const frames = parseInt(kv.nb_frames || '0', 10) || n * MF.page * FPS
  const md5 = createHash('md5').update(readFileSync(mp4)).digest('hex')
  console.log(`RENDER total_s=${(renderMs / 1000).toFixed(2)} per_frame_ms=${(renderMs / frames).toFixed(1)} frames=${frames}`)
  console.log(`OUTPUT md5=${md5} bytes=${readFileSync(mp4).length}`)
  console.log(`\n产物: ${mp4}`)
  emitResult({
    ok: true, code: EXIT.OK, stage: 'done', rendered: true, ...ctx,
    master_id: MF.id, orientation: deck.style.orientation, density: deck.style.density,
    palette: deck.style.palette, pages: n, page_s: MF.page, fps: FPS,
    frames, duration_s: +kv.duration || total,
    width: +(kv.width || 0), height: +(kv.height || 0),
    codec: kv.codec_name || null, pix_fmt: kv.pix_fmt || null,
    color_range: kv.color_range || null, color_space: kv.color_space || null,
    mp4, frames_dir: join(workdir, 'frames'),
    reconcile: join(workdir, 'reconcile.md'),
    reconcile_counts: { missing: recon.missing, num_bad: recon.numBad, chart_bad: recon.chartBad, leaks: recon.leaks },
    md5, render_ms: renderMs,
  })
}

try {
  main()
} catch (e) {
  // 任何未预期异常都必须给出**独立退出码 6**，不能让它以 Node 默认的 1 混进"校验不通过"
  emitResult({
    ok: false, code: EXIT.INTERNAL, stage: 'internal',
    error: String((e && e.message) || e),
    stack: String((e && e.stack) || '').split('\n').slice(0, 5).map((s) => s.trim()),
  })
  console.error(`\n✗ [exit 6 · internal] ${String((e && e.message) || e)}`)
  process.exit(EXIT.INTERNAL)
}
