#!/usr/bin/env node
/**
 * ★VF_FILM2PAGE_V1 —— 「成片」生成器：风格包 + 多段镜头组 → 一条可渲染的片
 * =============================================================================
 * · pack-to-page.mjs  单页 3 秒试片（看"风格对不对"）
 * · film-to-page.mjs  **多段成片**（每段 = 一个结构/镜头组 + 自己的时长/素材/文案）
 *
 * ★ 为什么是"新入口 + 新契约"，而不是往 deck.schema.json 里加 `scene` 页型：
 *   deck 那 12 种制式页型是老线（图片成片/图视混剪/PPT+图视）在跑的契约，动它=动老线。
 *   这里走独立入口：老链路一行不改，且天然满足"新东西失败 ⇒ 调用方回退老画法"。
 *
 * ★ 多段的 CSS / DOM 约定（实测踩过才定下来的）：
 *   多段共用一个 HTML 文件 ⇒ **不能用 id**（id 会撞，`#t1` 会同时命中所有段）。
 *   所以：① 段落用**结构类名**作用域 `.st-<structure>`；② 元素一律用**类名**（.t1/.t2/.sub/.media…）；
 *        ③ 运行时按 `#sc<i> .t1` 在段内查找，互不干扰。
 *
 * film.json 契约（v0.1）：
 * { "id":"demo-30s", "pack":"pipeline-green", "fps":25,
 *   "scenes":[ { "structure":"opening-hero", "dur":4.0,
 *                "slots":{...}, "media":["a.jpg"] }, ... ] }
 * 已实现结构（6）：opening-hero / works-wall / glass-product / data-dashboard / fullbleed / grid-2x2
 */
import fs from 'node:fs'
import path from 'node:path'
// ★VF_FILMBLEEDFIX_V1：量"实拍在被压字那一条上的亮度"要用 ffmpeg（与渲染器钉同一个可执行文件的口径一致）
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME = path.join(HERE, 'tools', 'runtime', 'film.js')
const GSAP = path.join(HERE, 'masters', 'master-tech', 'assets', 'gsap.min.js')
const FONTS = path.join(HERE, 'fonts')
export const FILM_STRUCTS = ['opening-hero', 'works-wall', 'glass-product', 'data-dashboard', 'fullbleed', 'grid-2x2']

// ★VF_FILMNODEMO_V1（2026-10-09 用户实测：火锅素材的片子里出现
//   「实时投放监控 / 45% / 12.4 万 / 4.8 % / 3.2 千」「数据驱动增长 / 78.5%」「一次成型」等）：
//   根因 = **这里的内置示例数据在兜底**（编排器没填的镜，渲染层自己编了一套）。
//   直接违反用户定过的反 AI 味规矩②「不许编造数据」。现口径：**只画调用方真的给了的**——
//   文案类字段全清空（不再兜底产品自夸词/示例标题），数字类清空，
//   唯一保留的是 `nums`（那是四宫格的**编号位次** 01~04，不是数据，缺了会让格子没有序号）。
const D = {
  eyebrow: '', title1: '', title2: '', title: '', sub: '',
  value: '', unit: '',
  rows: [], kpi: [], chips: [], nums: ['01', '02', '03', '04'], tail: '', foot: '',
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const mediaTag = (m) => m ? `<img class="fill" src="${esc(m)}" alt="" />` : `<div class="ph"><span>素材</span></div>`

/** 每个结构的 **类名版** CSS（作用域 = .st-<structure>，可被所有段共用） */
export function filmCssFor(st) {
  if (st === 'opening-hero') return `
.st-opening-hero .eb{left:64px;top:120px}
.st-opening-hero .t1{left:64px;top:180px;width:600px;font-size:78px}
.st-opening-hero .t2{left:64px;top:300px;width:600px;font-size:78px}
.st-opening-hero .sub{left:64px;top:436px;width:600px;font-size:26px}
.st-opening-hero .media{right:48px;top:540px;width:288px;height:500px}`.trim()
  if (st === 'works-wall') return `
.st-works-wall .ttl{left:64px;top:170px;width:600px;font-size:46px}
.st-works-wall .sub{left:64px;top:242px;width:600px;font-size:24px}
.st-works-wall .c1{left:68px;top:340px;width:180px;height:380px}
.st-works-wall .c2{left:270px;top:380px;width:180px;height:380px}
.st-works-wall .c3{left:472px;top:340px;width:180px;height:380px}
.st-works-wall .row{left:64px;width:600px;font-size:23px;color:var(--ink)}
.st-works-wall .r1{top:820px}.st-works-wall .r2{top:872px}.st-works-wall .r3{top:924px}`.trim()
  if (st === 'glass-product') return `
.st-glass-product .ttl{left:64px;top:170px;width:600px;font-size:46px}
.st-glass-product .sub{left:64px;top:242px;width:600px;font-size:24px}
.st-glass-product .main{left:56px;top:430px;width:608px;height:300px}
.st-glass-product .num{position:absolute;left:40px;top:74px;width:220px;text-align:center;font-size:58px;font-weight:900;color:var(--ink)}
.st-glass-product .num .u{font-size:26px;margin-left:4px;color:var(--at)}
/* ⚠ 这两行必须自带 position:absolute —— 选择器 .sec > * 只兜住**直接子元素**，
   .kt / .krow 在 .glass.main 里面（嵌套），只写 left/top 会被忽略 ⇒ 三行指标退回文档流叠在一起
   （实测：引擎 check 判 content_overlap，t=11.25~13.88s）。同族坑第 3 次出现，务必记住。
   ⚠⚠ 本文件是模板字符串：**注释里不许出现反引号**（第 3 次栽在这上面了，见 VF_TOOLSYNTAX）。 */
.st-glass-product .kt{position:absolute;left:300px;top:44px;font-size:24px;font-weight:700;color:var(--ink)}
.st-glass-product .krow{position:absolute;left:300px;width:250px;display:flex;justify-content:space-between;font-size:20px;color:var(--dim)}
.st-glass-product .krow b{color:var(--at)}
.st-glass-product .kr1{top:104px}.st-glass-product .kr2{top:148px}.st-glass-product .kr3{top:192px}
.st-glass-product .mini{width:296px;height:130px}
.st-glass-product .mini span{position:absolute;left:22px;top:24px;font-size:19px;color:var(--dim)}
.st-glass-product .mini b{position:absolute;left:22px;top:56px;font-size:36px;font-weight:900;color:var(--ink)}
.st-glass-product .m1{left:56px;top:766px}.st-glass-product .m2{left:368px;top:766px}.st-glass-product .m3{left:56px;top:918px}
/* ★VF_FILMGLASS_V1：调用方没给 kpi 时（主卡带 .noKpi）大数字居中，免得右边空一块 */
.st-glass-product .main.noKpi .num{left:0;width:608px;text-align:center;top:104px;font-size:96px}
.st-glass-product .cta{left:56px;top:1096px;width:608px;height:78px;border-radius:39px;overflow:hidden;
  background:linear-gradient(100deg,var(--accent),color-mix(in srgb,var(--accent) 40%,#8b7bff));
  display:flex;align-items:center;justify-content:center;font-size:27px;font-weight:800;color:#06101f;letter-spacing:3px}
.st-glass-product .shine{position:absolute;top:0;left:0;width:170px;height:100%;
  background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.55),rgba(255,255,255,0))}`.trim()
  if (st === 'data-dashboard') return `
.st-data-dashboard .k{left:64px;top:120px;font-size:16px;font-weight:700;letter-spacing:3.4px;color:var(--at)}
.st-data-dashboard .t1{left:64px;top:176px;width:600px;font-size:64px}
.st-data-dashboard .ex{left:64px;top:280px;width:600px;font-size:25px}
.st-data-dashboard .ring{left:190px;top:430px}
.st-data-dashboard .num{left:230px;top:560px;width:260px;text-align:center;font-size:74px;font-weight:900;color:var(--ink)}
.st-data-dashboard .num .u{font-size:30px;color:var(--at)}
.st-data-dashboard .kpi{width:600px;height:96px;border-radius:var(--r);display:flex;align-items:center;justify-content:space-between;
  padding:0 26px;background:rgba(16,26,44,.78);border:1px solid rgba(140,200,255,.22)}
.st-data-dashboard .kpi span{font-size:22px;color:var(--dim)}
.st-data-dashboard .kpi b{font-size:34px;font-weight:800;color:var(--ink)}
.st-data-dashboard .kp1{left:56px;top:880px}.st-data-dashboard .kp2{left:56px;top:996px}.st-data-dashboard .kp3{left:56px;top:1112px}`.trim()
  if (st === 'fullbleed') return `
.st-fullbleed .full{left:0;top:0;width:720px;height:1280px}
.st-fullbleed .full img{width:100%;height:100%;object-fit:cover;display:block}
.st-fullbleed .scrimT{left:0;top:0;width:720px;height:360px;
  background:linear-gradient(180deg,rgba(4,8,16,.92) 0%,rgba(4,8,16,.55) 55%,rgba(4,8,16,0) 100%)}
.st-fullbleed .scrimB{left:0;bottom:0;width:720px;height:660px;
  background:linear-gradient(0deg,rgba(4,8,16,.96) 0%,rgba(4,8,16,.84) 42%,rgba(4,8,16,.30) 78%,rgba(4,8,16,0) 100%)}
.st-fullbleed .eb{left:56px;top:96px}
.st-fullbleed .ttl{left:56px;top:876px;width:608px;font-size:56px}
.st-fullbleed .sub{left:56px;top:962px;width:608px;font-size:24px}
.st-fullbleed .chips{left:56px;top:1044px}`.trim()
  return `
.st-grid-2x2 .ttl{left:64px;top:168px;width:600px;font-size:46px}
.st-grid-2x2 .sub{left:64px;top:240px;width:600px;font-size:24px}
.st-grid-2x2 .g{width:296px;height:322px}
.st-grid-2x2 .g1{left:56px;top:320px}.st-grid-2x2 .g2{left:368px;top:320px}
.st-grid-2x2 .g3{left:56px;top:662px}.st-grid-2x2 .g4{left:368px;top:662px}
.st-grid-2x2 .n{padding:6px 12px 7px;border-radius:8px;background:rgba(5,12,22,.86);
  border:1px solid rgba(140,200,255,.3);font-size:18px;font-weight:700;color:var(--at)}
.st-grid-2x2 .n1{left:72px;top:336px}.st-grid-2x2 .n2{left:384px;top:336px}
.st-grid-2x2 .n3{left:72px;top:678px}.st-grid-2x2 .n4{left:384px;top:678px}
.st-grid-2x2 .tail{left:64px;top:1024px;width:600px;font-size:24px;color:var(--ink)}`.trim()
}

/** 结构 → 段落 DOM（**只用类名，不用 id** —— 多段共用一份 HTML） */
function sceneBody(st, sc, i) {
  const s = Object.assign({}, D, sc.slots || {})
  const md = sc.__media || []
  if (st === 'opening-hero') return `
    <div class="eb">${esc(s.eyebrow)}</div>
    <div class="ttl t1">${esc(s.title1)}</div>
    <div class="ttl t2 accent">${esc(s.title2)}</div>
    <div class="sub">${esc(s.sub)}</div>
    <div class="card media">${mediaTag(md[0])}</div>
    <div class="foot">${esc(s.foot)}</div>`
  if (st === 'works-wall') return `
    <div class="ttl ttl1">${esc(s.title)}</div>
    <div class="sub">${esc(s.sub)}</div>
    <div class="card cd c1">${mediaTag(md[0])}</div>
    <div class="card cd c2">${mediaTag(md[1])}</div>
    <div class="card cd c3">${mediaTag(md[2])}</div>
    ${s.rows.slice(0, 3).map((r, k) => `<div class="row r${k + 1}">${esc(r)}</div>`).join('')}
    <div class="foot">${esc(s.foot)}</div>`
  if (st === 'glass-product') {
    // ★VF_FILMGLASS_V1（2026-10-09 用户定案「反 AI 味 ②不许编造数据」时实测抓到）：
    //   病灶：老版本**无条件**渲染「关键指标（曝光 12.4万 / 点击率 4.8% / 下单 3.2千）」+
    //   三张**写死的迷你卡**（倍率 3 倍 / 耗时 6 分 / 成本 -62%）——
    //   火锅店片子里冒出"成本 -62%"这种经营数据，属于典型的"AI 脑补数据"（用户实测定过不许）。
    //   现口径：**只画调用方真的给了的**（给了才画，没给就不画；只做减法，绝不脑补）——
    //     · kpi   给了（3 组）才画「关键指标」块，标题可用 slots.kpiTitle 改（默认"关键指标"）；
    //     · mini  给了（3 组）才画三张迷你卡（老版本这三张是写死的）；
    //     · value/unit 也**必须来自 slots**（不再吃默认值，避免漏成 78.5% 这种示例数据）；
    //     · cta 给了才画（默认不再塞"立即体验"）。
    //   ⚠️ 没给 kpi 时主卡加 `.noKpi`（大数字居中），免得右边空一大块。
    const raw = sc.slots || {}
    const kpi = Array.isArray(raw.kpi) && raw.kpi.length >= 3 ? raw.kpi.slice(0, 3) : null
    const mini = Array.isArray(raw.mini) && raw.mini.length >= 3 ? raw.mini.slice(0, 3) : null
    const cta = raw.cta ? String(raw.cta) : ''
    const num = (raw.value !== undefined && raw.value !== null && String(raw.value) !== '')
      ? `<div class="num">${esc(raw.value)}<span class="u">${esc(raw.unit || '')}</span></div>` : ''
    // ★VF_FILMGLASS_V2（2026-10-09 用户实测「结尾卡是个空白卡片框」）：
    //   上一版（V1）只改了"没给就不画内容"，但**玻璃主卡那个框还是照画** ⇒ 结尾卡只剩一个
    //   淡粉圆角空框（实测：最后 3 秒满屏就这一个空格子）。现口径：**框里啥都没有就整块不画**
    //   （title/sub/eyebrow 照旧 —— 那是文案，不属于"编造数据"）。
    const hasBox = !!(num || kpi)
    return `
    <div class="eb">${esc(s.eyebrow)}</div>
    <div class="ttl ttl1">${esc(s.title)}</div>
    <div class="sub">${esc(s.sub)}</div>
    ${hasBox ? `<div class="glass main${kpi ? '' : ' noKpi'}">
      ${num}
      ${kpi ? `<div class="kt">${esc(raw.kpiTitle || '关键指标')}</div>` + kpi.map((k, i) => `<div class="krow kr${i + 1}"><span>${esc(k[0])}</span><b>${esc(k[1])}</b></div>`).join('') : ''}
    </div>` : ''}
    ${mini ? mini.map((m, i) => `<div class="glass mini m${i + 1}"><span>${esc(m[0])}</span><b>${esc(m[1])}</b></div>`).join('') : ''}
    ${cta ? `<div class="cta">${esc(cta)}<span class="shine"></span></div>` : ''}`
  }
  if (st === 'data-dashboard') {
    // ★VF_FILMDASH_V1（2026-10-09 用户实测：火锅片里出现「实时投放监控 / 45% / 12.4万 / 4.8% / 3.2千」）：
    //   与 glass-product 同一条红线（反 AI 味②不许编造数据）。旧实现**无条件**读 `s.kpi` / `s.value`，
    //   而 `s` 会吃到上面 D 的示例数据 ⇒ 假数据必然出现（上次只修了 glass，**漏了这里**，这次补齐）。
    //   现口径：**给了才画** —— kpi 给满 3 组才画指标条；value 给了才画大数字与圆环。
    const raw = sc.slots || {}
    const kpi = Array.isArray(raw.kpi) && raw.kpi.length >= 3 ? raw.kpi.slice(0, 3) : null
    const hasNum = raw.value !== undefined && raw.value !== null && String(raw.value) !== ''
    const num = hasNum
      ? `<div class="num">${esc(raw.value)}<span class="u">${esc(raw.unit || '')}</span></div>` : ''
    const ring = hasNum
      ? `<div class="ring"><svg width="340" height="340" viewBox="0 0 340 340">
      <circle cx="170" cy="170" r="152" fill="none" stroke="rgba(150,185,215,.16)" stroke-width="13"/>
      <circle class="ringArc" cx="170" cy="170" r="152" fill="none" stroke="var(--accent)" stroke-width="13"
        stroke-linecap="round" stroke-dasharray="955" stroke-dashoffset="999" transform="rotate(-90 170 170)"/>
    </svg></div>` : ''
    return `
    <div class="k">${esc(s.eyebrow)}</div>
    <div class="ttl t1">${esc(s.title)}</div>
    <div class="sub ex">${esc(s.sub)}</div>
    ${ring}
    ${num}
    ${kpi ? kpi.map((k, i) => `<div class="cd kpi kp${i + 1}"><span>${esc(k[0])}</span><b>${esc(k[1])}</b></div>`).join('') : ''}
    <div class="foot">${esc(s.foot)}</div>`
  }
  if (st === 'fullbleed') return `
    <div class="full">${mediaTag(md[0])}</div>
    <div class="scrimT"></div><div class="scrimB"></div>
    <div class="eb">${esc(s.eyebrow)}</div>
    <div class="ttl">${esc(s.title)}</div>
    <div class="sub">${esc(s.sub)}</div>
    <div class="chips">${s.chips.slice(0, 4).map((c) => `<div class="chip">${esc(c)}</div>`).join('')}</div>
    <div class="foot">${esc(s.foot)}</div>`
  return `
    <div class="ttl ttl1">${esc(s.title)}</div>
    <div class="sub">${esc(s.sub)}</div>
    <div class="card g g1">${mediaTag(md[0])}</div>
    <div class="card g g2">${mediaTag(md[1])}</div>
    <div class="card g g3">${mediaTag(md[2])}</div>
    <div class="card g g4">${mediaTag(md[3])}</div>
    ${s.nums.slice(0, 4).map((n, k) => `<div class="n n${k + 1}">${esc(n)}</div>`).join('')}
    <div class="tail">${esc(s.tail)}</div>
    <div class="foot">${esc(s.foot)}</div>`
}

const lum = (hex) => { const h = String(hex || '#000').replace('#', ''); const n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16) || 0; return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 }

/** ★VF_FILMBLEEDFIX_V1（2026-10-09 用户实测「全幅实拍上字看不见 / 深色渐变很丑」）用：
 *  量一张图某个**横带**（y 用 0~1 比例）的平均亮度（0~255，ffmpeg signalstats 的 YAVG）。
 *  · 失败返回 −1 ⇒ 调用方**一个字都不改**（量不出来就维持原样式，绝不瞎猜）。
 *  · 按 文件+区间 缓存（同一张图常被多段复用）。 */
const _lumaCache = new Map()
function bandLuma(file, y0, y1) {
  const key = file + '|' + y0 + '|' + y1
  if (_lumaCache.has(key)) return _lumaCache.get(key)
  let v = -1
  try {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf',
      `crop=iw:ih*${(y1 - y0).toFixed(4)}:0:ih*${y0.toFixed(4)},signalstats,metadata=print:file=-`,
      '-f', 'null', '-'], { encoding: 'utf8', timeout: 20000 })
    const m = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(String(r.stdout || ''))
    if (m) v = parseFloat(m[1])
  } catch { v = -1 }
  _lumaCache.set(key, v)
  return v
}

/** ★VF_FILMBLEEDFIX_V1：全幅实拍段（fullbleed）的"按**实测亮度**自动改字色 + 自动选遮罩"。
 *  为什么要它（用户实拍的病）：这个 pack 的字色是**为浅色纸面**设计的（ink=深字、accent=暗红），
 *  一旦 fullbleed 把**任意实拍**铺满整屏，就变成"深字压深图" ⇒ 看不见；而两条 scrim 又是**写死的深色**，
 *  压到暗图上既没用、又把画面弄脏（用户原话："渐变效果怎么出现非常不好"）。
 *  口径（对齐老引擎 ★VF_DECK_CONTRAST_V1：字色 vs 底的实际亮度 |Δ| ≥ 70）：
 *   · 底暗（YAVG < 120）⇒ **亮字**（ink→白、dim→浅灰、accent 太暗就换白）+ 遮罩**减淡**（用户定过"餐饮要亮"）
 *   · 底亮（YAVG ≥ 120）⇒ **深字** + **亮遮罩**（不把图压黑，自然也就"亮"）
 *   · 量不到 ⇒ 返回空串（零回归）
 *  ⚠️ 只动**这一段的字色 + 两条 scrim + chip 底色**；版式/位置/动效一律不动。 */
function bleedCss(i, lm, T, AT) {
  const bot = Number(lm && lm.bot)
  if (!(bot >= 0)) return ''
  const sel = '#sc' + i
  const dark = bot < 120
  const out = []
  if (dark) {
    if (lum(T.ink) < 0.6) out.push(`${sel}{--ink:#ffffff;--dim:#e9f0f8}`)
    if (lum(AT) < 0.55) out.push(`${sel}{--at:#ffffff}`)
    out.push(`${sel} .scrimT{background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.22) 60%,rgba(0,0,0,0) 100%)}`)
    out.push(`${sel} .scrimB{background:linear-gradient(0deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.42) 42%,rgba(0,0,0,.12) 78%,rgba(0,0,0,0) 100%)}`)
    out.push(`${sel} .ttl{text-shadow:0 2px 12px rgba(0,0,0,.6)}`)
    out.push(`${sel} .chip{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.42);color:#fff}`)
  } else {
    if (lum(T.ink) > 0.35) out.push(`${sel}{--ink:#15181c;--dim:#3a4048}`)
    if (lum(AT) > 0.5) out.push(`${sel}{--at:#2b2f36}`)
    out.push(`${sel} .scrimT{background:linear-gradient(180deg,rgba(255,255,255,.78) 0%,rgba(255,255,255,.32) 60%,rgba(255,255,255,0) 100%)}`)
    out.push(`${sel} .scrimB{background:linear-gradient(0deg,rgba(255,255,255,.95) 0%,rgba(255,255,255,.86) 42%,rgba(255,255,255,.42) 78%,rgba(255,255,255,0) 100%)}`)
    out.push(`${sel} .chip{background:rgba(255,255,255,.9);border-color:rgba(0,0,0,.14);color:#1b1f24}`)
  }
  return out.join('\n')
}

/** film → index.html（纯函数，不读盘） */
export function makeFilmHtml(film) {
  const pack = film.packObj || {}
  const T = Object.assign({ bg: '#0b0f14', bg2: '', ink: '#f0f5fa', dim: '#b8c6d6', accent: '#4dd7ff', font: 'sans-900', radius: 16, density: 'normal', grain: 0.04 }, pack.tokens || {})
  const serif = T.font === 'serif-700'
  const AT = T.accentText || T.accent
  const LIGHT = lum(T.bg) > 0.6

  let t = 0
  const scenes = (film.scenes || []).map((sc, i) => {
    const st = FILM_STRUCTS.includes(sc.structure) ? sc.structure : 'opening-hero'
    const start = t; t += Number(sc.dur || 4)
    return { st, start, dur: Number(sc.dur || 4), sc }
  })
  const total = +t.toFixed(2)
  const body = scenes.map((x, i) => `<section class="sec clip st-${x.st}" id="sc${i}" data-start="${x.start.toFixed(2)}" data-duration="${x.dur.toFixed(2)}">\n${sceneBody(x.st, x.sc, i)}\n  </section>`).join('\n')
  const usedStructs = [...new Set(scenes.map((x) => x.st))]
  // ★VF_FILMBLEEDFIX_V1：按"实测亮度"给全幅段做**局部**字色/遮罩修正（量不到的段一段都不改）
  const bleedFix = scenes.map((x, i) => bleedCss(i, x.sc.__luma, T, AT)).filter(Boolean).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<!-- 由 tools/film-to-page.mjs 生成（film=${esc(film.id)} · 风格包=${esc(pack.id || 'inline')} · ${scenes.length} 段 · ${total}s）
     独立入口：**不改 deck 契约**；新东西失败时调用方回退老画法。 -->
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=720, height=1280" />
<title>${esc(film.name || film.id)}</title>
<style>
  @font-face{font-family:'NotoSansSC';src:url('assets/NotoSansSC-sub.woff2') format('woff2');font-weight:100 900;font-display:block}
  ${serif ? "@font-face{font-family:'NotoSerifSC';src:url('assets/NotoSerifSC-sub.woff2') format('woff2');font-weight:200 900;font-display:block}" : ''}
  :root{ --bg:${T.bg}; --bg2:${T.bg2 || T.bg}; --ink:${T.ink}; --dim:${T.dim}; --accent:${T.accent}; --at:${AT}; --r:${T.radius}px; }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:720px;height:1280px;background:var(--bg)}
  body{font-family:${serif ? "'NotoSerifSC'" : "'NotoSansSC'"},system-ui,sans-serif;overflow:hidden}
  .clip{position:absolute}
  #filmBg{left:0;top:0;width:720px;height:1280px}
  #stage{position:relative;width:720px;height:1280px;overflow:hidden}
  .sec{position:absolute;left:0;top:0;width:720px;height:1280px}
  .sec > *{position:absolute}
  .eb{font-size:16px;font-weight:700;letter-spacing:3.4px;color:var(--at)}
  .ttl{font-weight:800;color:var(--ink);letter-spacing:1px;line-height:1.2}
  .ttl.accent{color:var(--at)}
  .sub{color:var(--dim)}
  .foot{left:64px;top:1180px;font-size:18px;color:var(--dim)}
  .card{overflow:hidden;border-radius:var(--r);border:1px solid color-mix(in srgb, var(--accent) 34%, transparent);box-shadow:0 16px 38px rgba(0,0,0,.45)}
  .ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;
      background:${LIGHT ? 'linear-gradient(135deg,color-mix(in srgb, var(--accent) 18%, #ffffff) 0%, #e6ebf2 100%)' : 'linear-gradient(135deg,color-mix(in srgb, var(--accent) 26%, #0a1020) 0%, rgba(10,16,32,.9) 100%)'}}
  .ph span{font-size:20px;font-weight:700;color:var(--ink);opacity:.85}
  .fill{width:100%;height:100%;object-fit:cover;display:block}
  .glass{position:absolute;border-radius:calc(var(--r) + 8px);background:rgba(255,255,255,.10);
    border:1px solid rgba(255,255,255,.22);backdrop-filter:blur(16px) saturate(1.2);
    box-shadow:0 18px 46px rgba(2,6,24,.42),inset 0 1px 0 rgba(255,255,255,.14)}
  .chip{padding:10px 16px 11px;border-radius:10px;background:rgba(10,22,36,.8);
    border:1px solid rgba(140,200,255,.3);font-size:19px;color:#eaf3ff;margin-right:12px;display:inline-block}
  #barIn{display:block;width:100%;height:100%;background:var(--accent);transform-origin:left center}
  #bar{position:absolute;left:0;bottom:0;width:720px;height:4px;background:rgba(130,180,230,.16)}

  /* ---------- 结构级（每个结构自带作用域 .st-xxx，多段共用不会串味） ---------- */
${usedStructs.map(filmCssFor).join('\n')}
  /* ---------- ★VF_FILMBLEEDFIX_V1：全幅段按**实测亮度**局部改字色/遮罩（量不到的段没有这几行） ---------- */
${bleedFix}
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-start="0" data-duration="${total}"
     data-fps="${film.fps || 25}" data-width="720" data-height="1280">
  <canvas id="filmBg" class="clip" data-start="0" data-duration="${total}" data-track-index="0" width="720" height="1280"></canvas>
${body}
  <div id="bar" class="clip" data-start="0" data-duration="${total}" data-track-index="9"><i id="barIn"></i></div>
</div>
<script>window.__FILM__ = ${JSON.stringify({ tokens: T, total, scenes: scenes.map((x) => ({ structure: x.st, start: x.start, dur: x.dur })) })};</script>
<script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = { seek: function () {}, duration: function () { return ${total}; }, pause: function () {}, play: function () {} };</script>
<script src="assets/gsap.min.js"></script>
<script src="assets/film.js"></script>
</body>
</html>
`
}

/** film → 磁盘项目（拷素材/运行时/字体）。返回 { dir,file,total,structs,missing } */
export function buildFilm(film, outDir, filmDir) {
  const missing = []
  const picked = []            // [{src,name}] —— 实际要拷进 assets 的文件（**名字统一改成 s{i}_{k}**）
  const scenes = (film.scenes || []).map((sc, i) => {
    const media = (sc.media || []).map((m, k) => {
      const src = path.resolve(filmDir || '.', m)
      if (!fs.existsSync(src)) { missing.push(m); return null }
      const name = `s${i}_${k}${path.extname(src).toLowerCase() || '.jpg'}`
      picked.push({ src, name })
      return name
    })
    return { ...sc, media, __media: media.map((x) => (x ? 'assets/' + x : '')) }
  })
  // ★VF_FILMBLEEDFIX_V1：给 fullbleed 段量"字压在什么亮度上"（上带 = eyebrow / 下带 = 标题·副题·chips）
  //   —— 量的是**源图**；量不到就留 −1（makeFilmHtml 那边一个字都不改 ⇒ 零回归）
  for (let i = 0; i < scenes.length; i++) {
    const st = FILM_STRUCTS.includes(scenes[i].structure) ? scenes[i].structure : 'opening-hero'
    if (st !== 'fullbleed') continue
    const raw0 = String((((film.scenes || [])[i] || {}).media || [])[0] || '')
    if (!raw0) continue
    const src = path.resolve(filmDir || '.', raw0)
    if (!fs.existsSync(src)) continue
    scenes[i].__luma = { top: bandLuma(src, 0.03, 0.16), bot: bandLuma(src, 0.66, 0.95) }
  }
  const f2 = { ...film, scenes }
  const assets = path.join(outDir, 'assets')
  fs.mkdirSync(assets, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'hyperframes.json'), JSON.stringify({
    $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
    paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
    media: { autoProxy: true },
  }, null, 2), 'utf8')
  fs.writeFileSync(path.join(outDir, 'index.html'), makeFilmHtml(f2), 'utf8')
  fs.copyFileSync(GSAP, path.join(assets, 'gsap.min.js'))
  fs.copyFileSync(RUNTIME, path.join(assets, 'film.js'))
  fs.copyFileSync(path.join(FONTS, 'NotoSansSC-sub.woff2'), path.join(assets, 'NotoSansSC-sub.woff2'))
  if (((film.packObj || {}).tokens || {}).font === 'serif-700') fs.copyFileSync(path.join(FONTS, 'NotoSerifSC-sub.woff2'), path.join(assets, 'NotoSerifSC-sub.woff2'))
  // ★ 素材用**改名后**的名字拷进 assets（与 makeFilmHtml 里生成的 src="assets/s{i}_{k}.jpg" 严格一致 ——
  //   实测踩过：一处按原名拷、一处按改名引用 ⇒ 素材全丢，页面只剩占位块。
  for (const x of picked) fs.copyFileSync(x.src, path.join(assets, x.name))
  const total = scenes.reduce((a, s) => a + Number(s.dur || 4), 0)
  return { dir: outDir, file: path.join(outDir, 'index.html'), total: +total.toFixed(2), structs: scenes.map((s) => FILM_STRUCTS.includes(s.structure) ? s.structure : 'opening-hero'), missing }
}

/* CLI */
import { pathToFileURL } from 'node:url'
const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isCli) {
  const args = process.argv.slice(2)
  const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
  const filmPath = args.find((a) => !a.startsWith('--'))
  if (!filmPath) { console.error('用法: node tools/film-to-page.mjs <film.json> --out <目录>'); process.exit(2) }
  const film = JSON.parse(fs.readFileSync(filmPath, 'utf8'))
  const outDir = path.resolve(HERE, arg('out', path.join('out', 'film', film.id)))
  const r = buildFilm(film, outDir, path.dirname(path.resolve(filmPath)))
  console.log(`生成：${path.relative(HERE, r.file)}（${r.structs.length} 段 · ${r.total}s · 结构 ${r.structs.join('/')}）`)
  if (r.missing.length) console.log('  ⚠ 缺素材：' + r.missing.join(', '))
}
