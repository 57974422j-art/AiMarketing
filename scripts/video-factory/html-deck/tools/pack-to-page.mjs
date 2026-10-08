#!/usr/bin/env node
/**
 * ★VF_PACK2PAGE_V1 —— 「风格包 → 页面」生成器（批次 2.1「scene 页型」的雏形）
 * =============================================================================
 * 输入：一份风格包（styles/<id>.json）  输出：一个可直接渲染的 hyperframes 项目 + 3 秒试片
 *
 * 分工：本文件负责**结构与令牌**（HTML 骨架 + CSS 变量）；tools/runtime/app.js 负责**动效与背景**。
 *
 * ⚠ 架构纪律（实测踩过）：**模块顶层不许读文件、读 argv**。
 *   本文件既被 CLI 调用，也被 tools/studio-server.mjs `import`。
 *   第一版在顶层就 `JSON.parse(readFileSync(process.argv...))` ⇒ 服务 import 它时，
 *   它把服务的 `--port 7791` 当成了风格包路径，去读文件 "7791" ⇒ ENOENT、服务当场崩。
 *   ⇒ 现在一律：**函数化 + 只在 CLI 分支读 argv**。
 *
 * 已实现结构（v0.1）：opening-hero / works-wall / glass-product / data-dashboard
 *   其余结构回落 opening-hero（stdout 会说明）。
 * ⚠ v0.1 试片统一渲 9:16 · 720×1280 · 3 秒。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME = path.join(HERE, 'tools', 'runtime', 'app.js')
const GSAP = path.join(HERE, 'masters', 'master-tech', 'assets', 'gsap.min.js')
const FONTS = path.join(HERE, 'fonts')
const IMPL = ['opening-hero', 'works-wall', 'glass-product', 'data-dashboard']
const DUR = 3.0

/** 试片用的占位文案（用字都在字体子集内，由 check-page-fonts 二次把关） */
const SAMPLE = {
  eyebrow: 'SHOWREEL 2026',
  title1: 'AI 营销', title2: '一次生成',
  sub: '素材进来，成片出去',
  num: '78.5', unit: '%',
  rows: ['素材不动 · 动效层加信息', '同一份文案 · 每次换风格', '逐帧可复现 · 可验收'],
  kpi: [['曝光', '12.4 万'], ['点击率', '4.8 %'], ['下单', '3.2 千']],
  cards: ['海报', '文案', '成片'],
}

const lum = (hex) => {
  const h = String(hex || '#000').replace('#', '')
  const n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16) || 0
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

/** 只输出**当前结构**那一段 CSS（跨结构混写会串味，实测过）—— film-to-page 也复用它 */
export function cssFor(s) {
  if (s === 'opening-hero') return `
  #t1{left:64px;top:180px;width:600px;font-size:78px}
  #t2{left:64px;top:300px;width:600px;font-size:78px}
  #sub{left:64px;top:436px;width:600px;font-size:26px}
  #media{right:48px;top:540px;width:288px;height:500px;transform-origin:center}`.trim()
  if (s === 'works-wall') return `
  #ttl{left:64px;top:170px;width:600px;font-size:46px}
  #sub{left:64px;top:242px;width:600px;font-size:24px}
  .cd{position:absolute}
  #s1 .c1{left:68px;top:340px;width:180px;height:380px}
  #s1 .c2{left:270px;top:380px;width:180px;height:380px}
  #s1 .c3{left:472px;top:340px;width:180px;height:380px}
  .row{position:absolute;left:64px;width:600px;font-size:23px;color:var(--ink)}
  #r1{top:820px}#r2{top:872px}#r3{top:924px}`.trim()
  if (s === 'glass-product') return `
  #ttl{left:64px;top:170px;width:600px;font-size:46px}
  #sub{left:64px;top:242px;width:600px;font-size:24px}
  .glass{position:absolute;border-radius:calc(var(--r) + 8px);background:rgba(255,255,255,.10);
    border:1px solid rgba(255,255,255,.22);backdrop-filter:blur(16px) saturate(1.2);
    box-shadow:0 18px 46px rgba(2,6,24,.42),inset 0 1px 0 rgba(255,255,255,.14)}
  .main{left:56px;top:430px;width:608px;height:300px}
  .num{position:absolute;left:40px;top:74px;width:220px;text-align:center;font-size:58px;font-weight:900;color:var(--ink)}
  .num .u{font-size:26px;margin-left:4px;color:var(--at)}
  .kt{position:absolute;left:300px;top:44px;font-size:24px;font-weight:700;color:var(--ink)}
  .krow{position:absolute;left:300px;width:250px;display:flex;justify-content:space-between;font-size:20px;color:var(--dim)}
  .krow b{color:var(--at)}
  .kr1{top:104px}.kr2{top:148px}.kr3{top:192px}
  .mini{width:296px;height:130px}
  .mini span{position:absolute;left:22px;top:24px;font-size:19px;color:var(--dim)}
  .mini b{position:absolute;left:22px;top:56px;font-size:36px;font-weight:900;color:var(--ink)}
  #s1 .m1{left:56px;top:766px}#s1 .m2{left:368px;top:766px}#s1 .m3{left:56px;top:918px}
  .cta{position:absolute;left:56px;top:1096px;width:608px;height:78px;border-radius:39px;overflow:hidden;
    background:linear-gradient(100deg,var(--accent),color-mix(in srgb,var(--accent) 40%,#8b7bff));
    display:flex;align-items:center;justify-content:center;font-size:27px;font-weight:800;color:#06101f;letter-spacing:3px}
  .shine{position:absolute;top:0;left:0;width:170px;height:100%;
    background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.55),rgba(255,255,255,0))}`.trim()
  return `
  #k1{left:64px;top:120px;font-size:16px;font-weight:700;letter-spacing:3.4px;color:var(--at)}
  #t1{left:64px;top:176px;width:600px;font-size:64px}
  #ex{left:64px;top:280px;width:600px;font-size:25px}
  .ring{position:absolute;left:190px;top:430px}
  .num{position:absolute;left:230px;top:560px;width:260px;text-align:center;font-size:74px;font-weight:900;color:var(--ink)}
  .num .u{font-size:30px;color:var(--at)}
  .kpi{position:absolute;width:600px;height:96px;border-radius:var(--r);display:flex;align-items:center;justify-content:space-between;
    padding:0 26px;background:rgba(16,26,44,.78);border:1px solid rgba(140,200,255,.22)}
  .kpi span{font-size:22px;color:var(--dim)}
  .kpi b{font-size:34px;font-weight:800;color:var(--ink)}
  #s1 .kp1{left:56px;top:880px}#s1 .kp2{left:56px;top:996px}#s1 .kp3{left:56px;top:1112px}`.trim()
}

/** 结构 → body 片段（全部用占位块，零外部图片 ⇒ 任何风格包都能渲） */
function bodyFor(structure, T) {
  const S = SAMPLE
  const ph = (label) => `<div class="ph"><span>${label}</span></div>`
  if (structure === 'opening-hero') return `
  <section id="s1" class="clip sec" data-start="0" data-duration="${DUR}">
    <div class="eb" id="ew">${S.eyebrow}</div>
    <div class="ttl" id="t1">${S.title1}</div>
    <div class="ttl accent" id="t2">${S.title2}</div>
    <div class="sub" id="sub">${S.sub}</div>
    <div class="card media" id="media">${ph('素材')}</div>
    <div class="foot">AiMarketing 视频工厂</div>
  </section>`
  if (structure === 'works-wall') return `
  <section id="s1" class="clip sec" data-start="0" data-duration="${DUR}">
    <div class="ttl" id="ttl">${S.title1}${S.title2}</div>
    <div class="sub" id="sub">${S.sub}</div>
    <div class="card cd c1">${ph(S.cards[0])}</div>
    <div class="card cd c2">${ph(S.cards[1])}</div>
    <div class="card cd c3">${ph(S.cards[2])}</div>
    <div class="row" id="r1">${S.rows[0]}</div>
    <div class="row" id="r2">${S.rows[1]}</div>
    <div class="row" id="r3">${S.rows[2]}</div>
    <div class="foot">AiMarketing 视频工厂</div>
  </section>`
  if (structure === 'glass-product') return `
  <section id="s1" class="clip sec" data-start="0" data-duration="${DUR}">
    <div class="eb" id="ew">${S.eyebrow}</div>
    <div class="ttl" id="ttl">${S.title1}${S.title2}</div>
    <div class="sub" id="sub">${S.sub}</div>
    <div class="glass main" id="main">
      <div class="num" id="num">${S.num}<span class="u">${S.unit}</span></div>
      <div class="kt">关键指标</div>
      <div class="krow kr1"><span>曝光</span><b>${S.kpi[0][1]}</b></div>
      <div class="krow kr2"><span>点击率</span><b>${S.kpi[1][1]}</b></div>
      <div class="krow kr3"><span>下单</span><b>${S.kpi[2][1]}</b></div>
    </div>
    <div class="glass mini m1"><span>倍率</span><b>3 倍</b></div>
    <div class="glass mini m2"><span>耗时</span><b>6 分</b></div>
    <div class="glass mini m3"><span>成本</span><b>-62%</b></div>
    <div class="cta" id="cta">立即体验<span class="shine" id="shine"></span></div>
  </section>`
  return `
  <section id="s1" class="clip sec" data-start="0" data-duration="${DUR}">
    <div class="k" id="k1">LIVE DASHBOARD</div>
    <div class="ttl" id="t1">${S.title1}${S.title2}</div>
    <div class="sub" id="ex">${S.sub}</div>
    <svg class="ring" width="340" height="340" viewBox="0 0 340 340">
      <circle cx="170" cy="170" r="152" fill="none" stroke="rgba(150,185,215,.16)" stroke-width="13"/>
      <circle id="ringArc" cx="170" cy="170" r="152" fill="none" stroke="${T.accent}" stroke-width="13"
              stroke-linecap="round" stroke-dasharray="955" stroke-dashoffset="999" transform="rotate(-90 170 170)"/>
    </svg>
    <div class="num" id="num">${S.num}<span class="u">${S.unit}</span></div>
    <div class="cd kpi kp1"><span>曝光</span><b>${S.kpi[0][1]}</b></div>
    <div class="cd kpi kp2"><span>点击率</span><b>${S.kpi[1][1]}</b></div>
    <div class="cd kpi kp3"><span>下单</span><b>${S.kpi[2][1]}</b></div>
    <div class="foot">AiMarketing 视频工厂</div>
  </section>`
}

/** 风格包 → index.html 全文（纯函数，不读盘） */
export function makeHtml(pack) {
  const T = Object.assign({ bg: '#0b0f1a', bg2: '', ink: '#eef4ff', dim: '#b6c4dc', accent: '#4dd7ff', font: 'sans-900', radius: 16, density: 'normal', grain: 0.04 }, pack.tokens || {})
  const serif = T.font === 'serif-700'
  const LIGHT = lum(T.bg) > 0.6
  const AT = T.accentText || T.accent
  const want = (pack.structure || [])[0] || 'opening-hero'
  const structure = IMPL.includes(want) ? want : 'opening-hero'

  const css = `
  @font-face{font-family:'NotoSansSC';src:url('assets/NotoSansSC-sub.woff2') format('woff2');font-weight:100 900;font-display:block}
  ${serif ? "@font-face{font-family:'NotoSerifSC';src:url('assets/NotoSerifSC-sub.woff2') format('woff2');font-weight:200 900;font-display:block}" : ''}
  :root{ --bg:${T.bg}; --bg2:${T.bg2 || T.bg}; --ink:${T.ink}; --dim:${T.dim}; --accent:${T.accent}; --at:${AT}; --r:${T.radius}px; }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:720px;height:1280px;background:var(--bg)}
  body{font-family:${serif ? "'NotoSerifSC'" : "'NotoSansSC'"},system-ui,sans-serif;overflow:hidden}
  .clip{position:absolute}
  #prebg{left:0;top:0;width:720px;height:1280px}
  #stage{position:relative;width:720px;height:1280px;overflow:hidden}
  .sec{position:absolute;left:0;top:0;width:720px;height:1280px}
  .sec > *{position:absolute}
  .eb{left:64px;top:120px;font-size:16px;font-weight:700;letter-spacing:3.4px;color:var(--at)}
  .ttl{font-weight:800;color:var(--ink);letter-spacing:1px;line-height:1.2}
  .ttl.accent{color:var(--at)}
  .sub{color:var(--dim)}
  .foot{left:64px;top:1180px;font-size:18px;color:var(--dim)}
  .card{overflow:hidden;border-radius:var(--r);border:1px solid color-mix(in srgb, var(--accent) 34%, transparent);box-shadow:0 16px 38px rgba(0,0,0,.45)}
  .ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;
      background:${LIGHT
        ? 'linear-gradient(135deg,color-mix(in srgb, var(--accent) 18%, #ffffff) 0%, #e6ebf2 100%)'
        : 'linear-gradient(135deg,color-mix(in srgb, var(--accent) 26%, #0a1020) 0%, rgba(10,16,32,.9) 100%)'}}
  .ph span{font-size:20px;font-weight:700;color:var(--ink);opacity:.85}
  #barIn{display:block;width:100%;height:100%;background:var(--accent);transform-origin:left center}
  #bar{position:absolute;left:0;bottom:0;width:720px;height:4px;background:rgba(130,180,230,.16)}

  /* ---------- 结构专用（只输出当前结构的一段） ----------
     ★ 踩坑一：4 个结构 CSS 混写 ⇒ opening-hero 的 "#s1 .ttl" 优先级高于 works-wall 的 "#ttl"
       ⇒ 毛玻璃页标题变 78px 压住副标（引擎判 content_overlap）。现按结构隔离。
     ★ 踩坑二：这段注释里曾经出现**反引号** ⇒ 本文件是模板字符串，反引号会截断它 ⇒ SyntaxError。
       ⚠ 规矩：模板字符串内部**任何反引号都不许出现**。 */
  ${cssFor(structure)}`.trim()

  return `<!doctype html>
<html lang="zh-CN">
<!-- 由 tools/pack-to-page.mjs 生成（风格包 id=${pack.id} · 结构 ${structure} · 3 秒试片）
     ★ 试片是"看风格"用的：素材用占位块，零外部图片 ⇒ 任何风格包都能渲。 -->
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=720, height=1280" />
<title>试片 · ${pack.name || pack.id}</title>
<style>
${css}
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-start="0" data-duration="${DUR}"
     data-fps="25" data-width="720" data-height="1280">
  <canvas id="prebg" class="clip" data-start="0" data-duration="${DUR}" data-track-index="0" width="720" height="1280"></canvas>
${bodyFor(structure, T)}
  <div id="bar" class="clip" data-start="0" data-duration="${DUR}" data-track-index="4"><i id="barIn"></i></div>
</div>
<script>window.__CFG__ = ${JSON.stringify({ tokens: T, structure, pace: (pack.motion && pack.motion.pace) || 1, slots: SAMPLE })};</script>
<script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = { seek: function () {}, duration: function () { return ${DUR}; }, pause: function () {}, play: function () {} };</script>
<script src="assets/gsap.min.js"></script>
<script src="assets/app.js"></script>
</body>
</html>
`
}

/** 写项目到磁盘（读盘只在这一步发生，且只用传入的对象） */
export function buildPage(pack, outDir) {
  const structure = (() => { const w = (pack.structure || [])[0] || 'opening-hero'; return IMPL.includes(w) ? w : 'opening-hero' })()
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(outDir, 'hyperframes.json'), JSON.stringify({
    $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
    paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
    media: { autoProxy: true },
  }, null, 2), 'utf8')
  fs.writeFileSync(path.join(outDir, 'index.html'), makeHtml(pack), 'utf8')
  fs.copyFileSync(GSAP, path.join(outDir, 'assets', 'gsap.min.js'))
  fs.copyFileSync(RUNTIME, path.join(outDir, 'assets', 'app.js'))
  fs.copyFileSync(path.join(FONTS, 'NotoSansSC-sub.woff2'), path.join(outDir, 'assets', 'NotoSansSC-sub.woff2'))
  if ((pack.tokens || {}).font === 'serif-700') fs.copyFileSync(path.join(FONTS, 'NotoSerifSC-sub.woff2'), path.join(outDir, 'assets', 'NotoSerifSC-sub.woff2'))
  return { file: path.join(outDir, 'index.html'), structure }
}

/** 渲染 3 秒试片 + 抽缩略图 */
export function renderPreview(outDir) {
  const mp4 = path.join(outDir, 'preview.mp4')
  const hf = path.join(HERE, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs')
  const r = spawnSync(process.execPath, [hf, 'render', outDir, '-o', mp4, '-f', '25', '-q', 'draft'],
    { cwd: HERE, encoding: 'utf8', timeout: 5 * 60 * 1000 })
  if (r.status !== 0 || !fs.existsSync(mp4)) return { ok: false, err: String(r.stderr || r.stdout || '').slice(-400) }
  const jpg = path.join(outDir, 'preview.jpg')
  spawnSync('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-ss', '1.6', '-i', mp4, '-frames:v', '1', '-vf', 'scale=320:-1', jpg], { encoding: 'utf8' })
  return { ok: true, mp4, jpg: fs.existsSync(jpg) ? jpg : '' }
}

/* ---------------- CLI（只在直接运行时才读 argv） ---------------- */
const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isCli) {
  const args = process.argv.slice(2)
  const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
  const packPath = args.find((a) => !a.startsWith('--'))
  if (!packPath) { console.error('用法: node tools/pack-to-page.mjs <风格包json> --out <目录> [--render]'); process.exit(2) }
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'))
  const want = (pack.structure || [])[0] || 'opening-hero'
  const outDir = path.resolve(HERE, arg('out', path.join('out', 'preview', pack.id)))
  const g = buildPage(pack, outDir)
  if (want !== g.structure) console.log(`  · 结构 "${want}" 尚未实现（v0.1 已实现 ${IMPL.join('/')}）⇒ 试片回落 "${g.structure}"`)
  console.log(`生成：${path.relative(HERE, g.file)}（结构 ${g.structure} · ${pack.aspect || '9:16'} 风格）`)
  if (args.includes('--render')) {
    const r = renderPreview(outDir)
    console.log(r.ok ? `试片：${path.relative(HERE, r.mp4)}${r.jpg ? ' · 缩略图 ' + path.relative(HERE, r.jpg) : ''}` : `试片失败：${r.err}`)
    process.exit(r.ok ? 0 : 1)
  }
}
