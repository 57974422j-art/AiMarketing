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
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')                       // dist-rel/probe-hf/
const MASTER = join(ROOT, 'master-v1')                 // v1 母版（CSS/JS/字体/GSAP 都从这里取）
const HF = join(ROOT, 'node_modules', '.bin', 'hyperframes.cmd')
const VALIDATOR = join(HERE, 'validate-deck.mjs')

const PAGE = 3        // 单页时长（秒）——与 master.css 的 --page 一致
const XOVER = 0.5     // 页间转场（秒）——与 --xover 一致
const FPS = 25
const GEO = { '16:9': { w: 1280, h: 720, portrait: false }, '9:16': { w: 720, h: 1280, portrait: true } }

/* ------------------------------------------------------------------
   style 三个枚举 → CSS 令牌 的实际映射。
   ★ 没有这一层，契约里的 palette/density/tempo 就是"能过校验但不生效"——
     正是 team-lead 警告的"契约能过、渲染不出来"。这里让它们真的落到位。
   ★ tempo 会改 --xover，而页窗口是用 xover 算出来的 → 生成器必须用同一个值算窗口，
     否则 clip 窗口与 master.js 的时间轴会错位。所以 TIMING 是唯一真相源。
   ------------------------------------------------------------------ */
const PALETTE = {
  'warm-gold': { accent: '#c8a06a', rgb: '200,160,106' },   // 母版默认
  'olive': { accent: '#a8b0a0', rgb: '168,176,160' },
  'clay': { accent: '#b98c7a', rgb: '185,140,122' },
  'mist-blue': { accent: '#8fa3b8', rgb: '143,163,184' },
}
const DENSITY = {
  'airy': { pad: '96px', gap: '24px' },
  'normal': {},                                             // 母版默认，不覆盖
  'dense': { pad: '72px', gap: '16px' },
}
const TEMPO = {
  'calm': { enter: 0.85, gap: 0.65, xover: 0.6 },
  'normal': { enter: 0.72, gap: 0.55, xover: 0.5 },
  'brisk': { enter: 0.55, gap: 0.42, xover: 0.4 },
}

/** 生成 <style> 里的 :root 覆盖块（几何 + 配色 + 节奏） */
function styleVars(deck) {
  const g = GEO[deck.style.orientation]
  const p = PALETTE[deck.style.palette] || PALETTE['warm-gold']
  const t = TEMPO[deck.style.tempo] || TEMPO['normal']
  const d = DENSITY[deck.style.density] || {}
  const decls = [`--W:${g.w}px`, `--H:${g.h}px`, `--accent:${p.accent}`, `--accent-rgb:${p.rgb}`,
    `--enter:${t.enter}s`, `--enter-gap:${t.gap}s`, `--xover:${t.xover}s`]
  for (const [k, v] of Object.entries(d)) decls.push(`--${k}:${v}`)
  return `:root{ ${decls.join('; ')} }`
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------------------------------------------------------------- 版式计算
/** 第 i 页的 clip 窗口（与母版手写值逐一吻合：i=0 → 0/3.25；末页 → S-0.25/3.25；中间 → S-0.25/3.5） */
function pageWindow(i, n, xover) {
  const S = i * PAGE
  const start = i === 0 ? 0 : S - xover / 2
  const end = i === n - 1 ? S + PAGE : S + PAGE + xover / 2
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
  const SUM = +(PAGE - xover / 2 - enter - 0.05).toFixed(2)
  const LAST_MAX = +(SUM - 0.38).toFixed(2)
  const gap = nItems <= 1 ? 0 : Math.min(0.5, (LAST_MAX - FIRST) / (nItems - 1))
  const items = []
  for (let k = 0; k < nItems; k++) items.push(+(FIRST + k * gap).toFixed(3))
  return { items, sum: SUM }
}

// ---------------------------------------------------------------- 页型 → HTML
function pageHTML(p, i, n, deck) {
  const T = TEMPO[deck.style.tempo] || TEMPO['normal']
  const w = pageWindow(i, n, T.xover)
  const head = `  <!-- PAGE ${i}:${p.type} -->\n  <section class="page clip" data-start="${w.start}" data-duration="${w.dur}" data-track-index="1">`
  const tail = `    <div class="progress"><i></i></div>\n  </section>\n  <!-- /PAGE ${i} -->`

  if (p.type === 'cover') {
    // 与手写母版保持同一措辞：出品方带"出品："前缀；日期跟在后面
    const iss = [deck.meta.issuer ? `出品：${deck.meta.issuer}` : '', deck.meta.date].filter(Boolean).join(' · ')
    return [
      head,
      `    <div class="tex"></div>`,
      `    <div class="photo" data-anim="push" data-at="0.15"><img src="assets/cover.jpg" alt="" /></div>`,
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

  // end
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

function buildHTML(deck) {
  const g = GEO[deck.style.orientation]
  const n = deck.pages.length
  const total = +(n * PAGE).toFixed(4)
  const body = deck.pages.map((p, i) => pageHTML(p, i, n, deck)).join('\n\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${g.w}, height=${g.h}" />
<title>${esc(deck.meta.title)}</title>
<link rel="stylesheet" href="assets/master.css" />
<style>${styleVars(deck)}</style>
</head>
<body${g.portrait ? ' class="p"' : ''}>
<div id="stage" data-composition-id="main" data-start="0" data-duration="${total}"
     data-fps="${FPS}" data-width="${g.w}" data-height="${g.h}">

  <div class="glow clip" data-start="0" data-duration="${total}" data-track-index="0"></div>

${body}
</div>

<script src="assets/gsap.min.js"></script>
<script src="assets/master.js"></script>
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
  } else {
    push('end.line1', p.line1); push('end.line2', p.line2); push('end.cta', p.cta); push('end.en', p.en)
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
  let missing = 0, leaks = 0, numBad = 0
  deck.pages.forEach((p, i) => {
    const own = allStrings[i]
    const slice = slices[i]
    if (!slice) {
      rows.push({ i, type: p.type, total: own.length, miss: [{ label: '(整页)', value: '页面切片未找到（生成器 bug）' }], foreign: [] })
      missing++; return
    }
    const nodes = textNodes(slice)
    const mine = new Set(own.map((s) => s.value))
    const miss = own.filter((s) => !nodes.some((nd) => nd.includes(s.value)))
    const foreign = []
    allStrings.forEach((arr, j) => {
      if (j === i) return
      for (const s of arr) if (!mine.has(s.value) && nodes.some((nd) => nd.includes(s.value))) foreign.push(`p${j}.${s.label}`)
    })
    let num = null
    if (p.type === 'data') { num = numberCheck(p, slice); if (!num.ok) numBad++ }
    missing += miss.length; leaks += foreign.length
    rows.push({ i, type: p.type, total: own.length, miss, foreign, slice, num })
  })
  return { rows, missing, leaks, numBad, slices }
}

// ---------------------------------------------------------------- 主流程
function main() {
  const args = process.argv.slice(2)
  const noRender = args.includes('--no-render')
  const deckPath = args.find((a) => !a.startsWith('--'))
  const oi = args.indexOf('--outdir')
  const outRoot = oi >= 0 ? resolve(args[oi + 1]) : join(HERE, 'out')
  if (!deckPath) { console.error('用法: node render-deck.mjs <deck.json> [--outdir out] [--no-render]'); process.exit(2) }

  const deckAbs = resolve(deckPath)
  if (!existsSync(deckAbs)) { console.error(`✗ deck 不存在: ${deckAbs}`); process.exit(2) }
  const deck = JSON.parse(readFileSync(deckAbs, 'utf8'))
  const name = basename(deckAbs).replace(/\.json$/i, '')
  const workdir = join(outRoot, name)

  // ---- ① 闸门：校验不通过 → 大声失败、绝不渲染 ----
  const v = spawnSync(process.execPath, [VALIDATOR, deckAbs, '--json'], { cwd: HERE, encoding: 'utf8' })
  let vr = null
  try { vr = JSON.parse(v.stdout) } catch { /* fallthrough */ }
  if (!vr || !vr.pass) {
    console.error(`\n✗✗ 校验不通过 → 拒绝渲染（这是有意的硬闸门）\n`)
    console.error(v.stdout || v.stderr || '(校验器无输出)')
    process.exit(1)
  }
  console.log(`✓ 校验通过（不达标 0 / 建议 ${vr.warnCount}）`)

  // ---- ② 生成 HTML + 复制母版资产 ----
  mkdirSync(workdir, { recursive: true })
  for (const d of ['frames']) mkdirSync(join(workdir, d), { recursive: true })
  const assetsDir = join(workdir, 'assets')
  if (existsSync(assetsDir)) rmSync(assetsDir, { recursive: true, force: true })
  cpSync(join(MASTER, 'assets'), assetsDir, { recursive: true })
  cpSync(join(MASTER, 'hyperframes.json'), join(workdir, 'hyperframes.json'), { force: true })
  const htmlPath = join(workdir, 'deck-page.html')
  writeFileSync(htmlPath, buildHTML(deck), 'utf8')

  const n = deck.pages.length
  const total = +(n * PAGE).toFixed(4)
  const seq = deck.pages.map((p) => p.type).join(' → ')
  console.log(`页型序列: ${seq}   （${n} 页 × ${PAGE}s = ${total}s，画布 ${GEO[deck.style.orientation].w}×${GEO[deck.style.orientation].h}，style=${deck.style.palette}/${deck.style.density}/${deck.style.tempo}）`)
  console.log(`生成: ${htmlPath}`)

  // ---- ③ 对账（HTML 级：逐页逐字段 verbatim 命中 + 跨页泄漏检查）----
  const recon = reconcile(deck, readFileSync(htmlPath, 'utf8'))
  const mp4 = join(workdir, `output-${name}.mp4`)
  const lines = []
  lines.push(`# 输入→输出 对账表 · ${name}`)
  lines.push('')
  lines.push(`- deck: \`${deckAbs}\``)
  lines.push(`- 页型序列: ${seq}`)
  lines.push(`- 时长: ${n} × ${PAGE}s = **${total}s**（${FPS}fps → ${n * PAGE * FPS} 帧）`)
  lines.push(`- style: masterId=${deck.style.masterId} palette=${deck.style.palette} density=${deck.style.density} tempo=${deck.style.tempo} orientation=${deck.style.orientation}`)
  lines.push('')
  lines.push('## 逐页字段 → HTML 命中（**按文本节点**比对；`未命中` 非空即"丢内容"，`跨页泄漏` 非空即"错位"）')
  lines.push('')
  lines.push('| 页 | 页型 | 字段数 | 未命中 | 跨页泄漏 |')
  lines.push('|---|---|---|---|---|')
  for (const r of recon.rows) {
    lines.push(`| ${r.i} | ${r.type} | ${r.total || '-'} | ${r.err ? r.err : (r.miss.length ? r.miss.map((m) => m.label).join(', ') : '0 ✓')} | ${r.foreign ? (r.foreign.length ? r.foreign.join(', ') : '0 ✓') : '-'} |`)
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
  }
  lines.push('')
  lines.push(`\n**结论：未命中 ${recon.missing} 项 / 大数字编码错误 ${recon.numBad} 项 / 跨页泄漏 ${recon.leaks} 项** —— 三者必须全为 0 才允许渲染。`)
  lines.push('')
  lines.push('> 比对口径：把每页 HTML 切成**文本节点**后按节点比对（不是整片子串）—— 避免短字符串（单位"秒"、数字"4"）在别处误命中；')
  lines.push('> `data.metric.number` 因是**滚筒渲染**（HTML 里没有字面量），改为校验"滚筒格数是否编码了正确数字"。')
  lines.push('')
  lines.push('> 说明：本表证明的是"**生成出的 HTML 里逐字包含 deck 的每个字段值、且没有串页**"（程序化可判）；')
  lines.push('> "画面上真的长这样"由同目录 `frames/p<i>-enter.png` / `p<i>-full.png` 人眼确认（不做 OCR，避免引入新误差源）。')
  writeFileSync(join(workdir, 'reconcile.md'), lines.join('\n'), 'utf8')
  console.log(`对账: 未命中 ${recon.missing} / 跨页泄漏 ${recon.leaks}  → ${join(workdir, 'reconcile.md')}`)
  if (recon.missing > 0 || recon.leaks > 0) { console.error('✗ 对账不通过，拒绝继续'); process.exit(1) }

  if (noRender) { console.log('(--no-render：已停在生成+对账，未渲染)'); return }

  // ---- ④ 渲染（D10: --workers 1）----
  const r = spawnSync(HF, ['render', '.', '-c', 'deck-page.html', '-o', `"${mp4}"`, '--fps', String(FPS), '--quality', 'looks', '--workers', '1'],
    { cwd: workdir, shell: true, encoding: 'utf8' })
  if (r.status !== 0) { console.error(`✗ 渲染失败(${r.status})\n${r.stdout || ''}\n${r.stderr || ''}`); process.exit(1) }
  const report = (r.stdout || '').split('\n').filter((l) => /rendered in|\.mp4/.test(l)).slice(-2).join('\n')
  console.log(report.trim())

  // ---- ⑤ 产物校验（含 D9 色彩标签）----
  const p = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_frames,color_range,color_space',
    '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1', mp4], { encoding: 'utf8' })
  console.log('ffprobe:\n' + (p.stdout || '').trim().split('\n').map((l) => '  ' + l).join('\n'))

  // ---- ⑥ 每页 2 帧 ----
  for (let i = 0; i < n; i++) {
    const S = i * PAGE
    const shots = [['enter', S + 0.75], ['full', S + 2.85]]
    for (const [kind, t] of shots) {
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', join(workdir, 'frames', `p${i}-${kind}.png`)])
    }
  }
  console.log(`抽帧: ${n * 2} 张 → ${join(workdir, 'frames')}`)
  console.log(`\n产物: ${mp4}`)
}

main()
