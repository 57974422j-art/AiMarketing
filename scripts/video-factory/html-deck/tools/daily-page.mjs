#!/usr/bin/env node
/**
 * temp/_exp/template/daily.mjs —— 「日报落地页」模板生成器（阶段 1 的产物）
 * =============================================================================
 * 定位：**保底模板族**。AI 自由写 HTML 崩了 ⇒ 回落到这里：给一份 JSON（段配置）就出一份合规 HTML。
 *   产出物 = 单文件 HTML，自带双模式（preview 自动循环 / film 由 __seek 驱动），目标是过 R1~R14。
 *
 * 用法：
 *   node temp/_exp/template/daily.mjs <配置.json> [--out temp/_exp/template/out/xxx.html]
 *
 * 配置（JSON）：
 * {
 *   "meta": { "issue": "第 07 期", "accent": "#C6392B", "paper": "#F5F1E8", "title": "页面标题" },
 *   "motion": "calm|normal|lively",              // 动效档：影响推近幅度 / 错峰快慢 / 预览循环节奏
 *   "imageDir": "images",                        // 真图目录（占位时不引用）
 *   "segments": [
 *     { "kind": "cover",   "kicker": "第 07 期 · 夜食", "stamp": "封面故事",
 *       "title": ["凌晨四点", "第一锅汤"], "imgs": [1], "points": [["四点起火","老汤先滚"],["手切现片","立盘不掉"],["七上八下","毛肚最佳"]] },
 *     { "kind": "feature", "kicker": "后厨 · 手作", "stamp": "现场",
 *       "title": ["刀起刀落", "薄如纸片"], "imgs": [2, 3], "points": [...],
 *       "form": "sticker", "place": "cover" },
 *     ...
 *   ]
 * }
 *   · kind：cover（封面，3.4s）/ feature（正片，3.2s）/ end（结尾，3.2s）
 *   · imgs：图号数组，1 张=单图版式，2 张=并列版式（竖屏左右、横屏上下）
 *   · points：最多 3 组 [大字, 小字]
 *
 * ★ 自带的**字数体检**（R11：标题 ≤12 字/行、信息点 ≤3 组、每组 ≤8 字）——不合规**打印警告**（不静默）。
 */
import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')

const argv = process.argv.slice(2)
const cfgFile = argv.find((a) => a.endsWith('.json'))
const outIdx = argv.indexOf('--out')
if (!cfgFile) { console.log('用法：node temp/_exp/template/daily.mjs <配置.json> [--out xxx.html]'); process.exit(1) }
const cfg = JSON.parse(fs.readFileSync(path.resolve(cfgFile), 'utf8'))

const META = Object.assign({ issue: '', accent: '#C6392B', paper: '#F5F1E8', title: '日报落地页' }, cfg.meta || {})
const MOTION = {
  calm: { zoom: 1.04, dmul: 1.35, gap: 900, dur: 0.14 },     // 稳：推近小、错峰慢
  normal: { zoom: 1.07, dmul: 1.0, gap: 700, dur: 0 },
  lively: { zoom: 1.12, dmul: 0.7, gap: 520, dur: -0.04 },    // 活：推近大、错峰快
}[String(cfg.motion || 'normal')] || { zoom: 1.07, dmul: 1, gap: 700, dur: 0 }
const IMG_DIR = String(cfg.imageDir || 'images')

const segs = Array.isArray(cfg.segments) ? cfg.segments : []
if (!segs.length) { console.log('✗ 配置里没有 segments'); process.exit(1) }

/* ═══════════ ★VF_DAILY_L2（2026-10-12 用户「说 L2 大胆试」）：段**结构库** ═══════════
   病灶（用户原话「你是不是把设计说的很死，我看它设计跟你的一模一样」）：
   老实现**只有一套骨架** —— 每段都是"图 + 标题 + 信息点"同一个 grid，`form/place` 只改三处 CSS，
   于是两份产物连 `<style>` 都逐字节相同（md5 一致），AI 的自由度只剩文字。
   现口径：引擎提供 **8 种真实结构**，AI 按素材挑（见 daily-plan.ts 的同名白名单，两处必须一致）：

     hero     满幅压字  1 图   图吃满整段，文字贴下沿深色衬带
     sticker  贴纸标题  1 图   标题是纸色贴块 + 朱红硬投影
     vertical 竖排标题  1 图   竖排标题占独立一列，图在左
     split    图文左右  1 图   竖屏也左右分栏（字左图右）
     stack2   上下双图  2 图   竖屏上下 / 横屏左右
     grid3    三图拼版  3 图   1 大 + 2 小
     grid4    四宫格    4 图   2×2
     quote    引文页    0~1 图 大字居中 + 落款（图作窄条）

   ⚠️ 兼容：老方案没有 `layout` 字段 ⇒ 按 `form` 与图数**推导**（见 layoutOf），行为不变。
   ⚠️ 结构只决定"怎么排"，**皮肤（纸/朱红/字体）仍由 meta 定**（L4 才放开皮肤）。 */
const LAYOUTS = {
  hero:     { name: '满幅压字', minImg: 1, maxImg: 1 },
  sticker:  { name: '贴纸标题', minImg: 1, maxImg: 1 },
  vertical: { name: '竖排标题', minImg: 1, maxImg: 1 },
  split:    { name: '图文左右', minImg: 1, maxImg: 1 },
  stack2:   { name: '上下双图', minImg: 2, maxImg: 2 },
  grid3:    { name: '三图拼版', minImg: 3, maxImg: 3 },
  grid4:    { name: '四宫格',   minImg: 4, maxImg: 4 },
  quote:    { name: '引文页',   minImg: 0, maxImg: 1 },
}
const FORM_IDS = { hero: 'overlay', sticker: 'sticker', vertical: 'vertical' }
const layoutOf = (s) => {
  const l = String(s.layout || '')
  if (LAYOUTS[l]) return l
  const n = (Array.isArray(s.imgs) ? s.imgs : []).length
  if (n >= 4) return 'grid4'
  if (n === 3) return 'grid3'
  if (n === 2) return 'stack2'
  const f = String(s.form || '')
  if (f === 'sticker' || f === 'vertical') return f
  return 'hero'
}

// ── 字数体检（R11）：不合规只警告，不阻断（人要能看见） ──
const warns = []
segs.forEach((s, i) => {
  const n = i + 1
  for (const [j, line] of (s.title || []).entries()) {
    if (String(line).length > 12) warns.push(`段${n} 标题第${j + 1}行 ${String(line).length} 字 > 12`)
  }
  const pts = Array.isArray(s.points) ? s.points : []
  if (pts.length > 3) warns.push(`段${n} 信息点 ${pts.length} 组 > 3`)
  pts.forEach((p, k) => {
    const big = String((p && p[0]) || ''), small = String((p && p[1]) || '')
    if (big.length > 8) warns.push(`段${n} 信息点${k + 1} 大字 ${big.length} 字 > 8`)
    if (small.length > 8) warns.push(`段${n} 信息点${k + 1} 小字 ${small.length} 字 > 8`)
  })
  const lay = layoutOf(s)
  const lim = LAYOUTS[lay]
  const imgs = Array.isArray(s.imgs) ? s.imgs : []
  if (!imgs.length && lim.minImg > 0) warns.push(`段${n} 没有图（imgs 为空），但结构「${lim.name}」要 ${lim.minImg}~${lim.maxImg} 张`)
  if (imgs.length > Math.max(4, lim.maxImg)) warns.push(`段${n} 图数 ${imgs.length} 超过 ${lim.name} 的 ${lim.maxImg} 张（多的会被丢掉）`)
  if (imgs.length && (imgs.length < lim.minImg || imgs.length > lim.maxImg)) {
    warns.push(`段${n} 图数 ${imgs.length} 与结构「${lim.name}」(${lim.minImg}~${lim.maxImg}) 不匹配 —— 实际按 n${Math.min(imgs.length, lim.maxImg)} 渲染`)
  }
})

// ── 时间轴（段时长 → data-start/data-duration + __seek 映射） ──
const DUR = { cover: 3.4, feature: 3.2, end: 3.2 }
let acc = 0
const scenes = segs.map((s, i) => {
  const d = DUR[s.kind] || 3.2
  const sc = { i, kind: s.kind || 'feature', start: +acc.toFixed(2), dur: d }
  acc += d
  return sc
})
const TOTAL = +acc.toFixed(2)

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function segBody(s, sc) {
  const layout = layoutOf(s)
  const lim = LAYOUTS[layout]
  const form = FORM_IDS[layout] || String(s.form || 'overlay')
  const title = (s.title || []).map((line, j) => j === 0 ? `<span>${esc(line)}</span>` : `<span><em>${esc(line)}</em></span>`).join('')
  // ★VF_DAILY_L2：每段图数按**该结构**的上限收（grid4 可到 4 张）
  const imgs = (Array.isArray(s.imgs) ? s.imgs : []).slice(0, lim.maxImg)
  // ★VF_DAILY_V2：图槽真的挂上 images/N.jpg（缺图时 onerror 自己摘掉 ⇒ 退回渐变占位，不裂图）
  const figs = imgs.map((n) => `<div class="fig" style="background:var(--g${n % 3})">`
    + `<img class="ph" src="${IMG_DIR}/${n}.jpg" alt="" loading="lazy" onerror="this.remove()"></div>`).join('')
  const pts = (Array.isArray(s.points) ? s.points : []).slice(0, 3)
    .map((p) => `<div class="col"><b>${esc(p && p[0])}</b><i>${esc(p && p[1])}</i></div>`).join('')
  const head = `<div class="head"><span class="kick">${esc(s.kicker || '')}</span>`
    + (s.stamp ? `<span class="stamp">${esc(s.stamp)}</span>` : '') + `</div>`
  return `<section class="sec" data-seg="${sc.i + 1}" data-start="${sc.start}" data-duration="${sc.dur}"`
    + ` data-place="${esc(s.place || 'cover')}" data-form="${esc(form)}" data-layout="${layout}">`
    + head
    + `<h2>${title}</h2>`
    + `<div class="figs n${imgs.length}">${figs}</div>`
    + `<div class="cols c${pts.length}">${pts}</div>`
    + `</section>`
}

const html = `<!DOCTYPE html>
<html lang="zh-CN" data-mode="preview">
<head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(META.title)}</title>
<!-- 由 temp/_exp/template/daily.mjs 生成（日报落地页模板 · 阶段 1）
     段：${segs.length} · 总时长：${TOTAL}s · 动效档：${String(cfg.motion || 'normal')}
     结构（★VF_DAILY_L2 段结构库）：${segs.map((s) => layoutOf(s)).join(' → ')}
     图片槽位：${IMG_DIR}/ 目录，命名 1..N.jpg（${segs.map((s) => (s.imgs || []).join('+')).join(' / ')}）
     契约：section.sec[data-seg][data-start][data-duration][data-place][data-form]；时间轴 window.__seek(t)
     合规目标：R1~R14（见 docs/exp/响应式段规范-v1.md） -->
${warns.length ? '<!-- ⚠️ 字数体检警告：\n     ' + warns.join('\n     ') + '\n-->' : ''}
<style>
  :root{
    --paper:${META.paper}; --paper2:#EDE7DA; --ink:#17140F; --dim:#6B6157; --rule:${META.accent}; --line:rgba(23,20,15,.16);
    --pad:clamp(24px,3.6vmin,50px); --gap:clamp(14px,2vmin,26px);
    --title:clamp(44px,7vmin,92px); --label:22px; --num:clamp(30px,4.2vmin,56px);
    --mz:${MOTION.zoom};                    /* 动效档：推近幅度 */
    --sp:1; --d:0;
    --g1:linear-gradient(152deg,#8E3A22 0%,#C4703A 52%,#E3B478 100%);
    --g2:linear-gradient(152deg,#3E3226 0%,#7A6244 58%,#C9AE84 100%);
    --g0:linear-gradient(152deg,#6E2F1C 0%,#B4562A 52%,#E9B77F 100%);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  /* ★短标签一律不折行 + 窄窗降级列数（R14：窗口被拖窄时"先涮后蘸"会被折行） */
  .kick,.stamp,.col b,.col i,h2 span{white-space:nowrap;word-break:keep-all}
  @media (max-width:600px){ .cols.c3{grid-template-columns:1fr 1fr} .figs.n2{grid-template-columns:1fr} }
  html,body{background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased;
    font-family:"Noto Serif SC","Songti SC",Georgia,serif}
  body::after{content:"";position:fixed;inset:0;pointer-events:none;opacity:.5;
    background:radial-gradient(rgba(23,20,15,.05) .6px, transparent .6px);background-size:5px 5px}
  html[data-mode="preview"] body{overflow-y:auto}
  html[data-mode="preview"] .sec{position:relative;height:100vh;min-height:520px}
  html[data-mode="preview"] .sec + .sec{border-top:1px solid var(--line)}
  html[data-mode="film"] body{overflow:hidden;width:100vw;height:100vh}
  html[data-mode="film"] .sec{position:absolute;inset:0;opacity:0}
  html[data-mode="film"] .sec[data-live="1"]{opacity:1}

  .sec{padding:var(--pad);display:grid;gap:var(--gap);
    grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr) auto;
    grid-template-areas:"head" "title" "fig" "cols"}
  @media (min-aspect-ratio:1/1){
    .sec{grid-template-columns:minmax(0,1.06fr) minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr);
      grid-template-areas:"head fig" "title fig" "cols fig"}
  }

  .head{grid-area:head;display:flex;align-items:baseline;gap:14px}
  .kick{font-family:"Noto Sans SC",system-ui,sans-serif;font-size:var(--label);color:var(--rule);
    letter-spacing:.3em;opacity:clamp(0,calc(var(--sp)*5),1)}
  .stamp{margin-left:auto;font-family:"Noto Sans SC",system-ui,sans-serif;font-size:var(--label);color:#fff;
    background:var(--rule);padding:4px 10px;border-radius:2px;
    opacity:clamp(0,calc((var(--sp) - .12)*4),1);
    transform:rotate(calc(-3deg + 3deg * clamp(0,calc((var(--sp) - .12)*4),1)))}

  h2{grid-area:title;font-size:var(--title);line-height:1.14;font-weight:900;letter-spacing:-.01em}
  h2 span{display:block;opacity:clamp(0,calc((var(--sp) - var(--d,0))*4),1);
    transform:translateY(calc(30px*(1 - clamp(0,calc((var(--sp) - var(--d,0))*4),1))))}
  h2 span:nth-child(2){--d:calc(.10 * ${MOTION.dmul})}
  h2 em{font-style:normal;box-shadow:inset 0 -.22em 0 rgba(198,57,43,.35)}

  .figs{grid-area:fig;min-height:0;display:grid;gap:var(--gap);grid-template-columns:minmax(0,1fr)}
  .figs.n2{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  @media (min-aspect-ratio:1/1){ .figs.n2{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr)} }
  .fig{min-height:0;position:relative;overflow:hidden;border-radius:3px;margin-top:8px;
    box-shadow:0 22px 44px rgba(60,40,20,.18), 0 1px 0 rgba(255,255,255,.4) inset;
    transform:scale(calc(var(--mz) - (var(--mz) - 1)*var(--sp))) rotate(-.25deg);filter:saturate(.94) contrast(1.04)}
  .fig::before{content:"";position:absolute;left:14px;top:14px;width:16px;height:16px;
    border-left:2px solid rgba(255,255,255,.75);border-top:2px solid rgba(255,255,255,.75)}
  .fig::after{content:"";position:absolute;right:14px;bottom:14px;width:16px;height:16px;
    border-right:2px solid rgba(255,255,255,.75);border-bottom:2px solid rgba(255,255,255,.75)}
  /* ★VF_DAILY_V2：真图槽（images/N.jpg）；img 被 onerror 摘掉时露出下面的渐变占位 */
  .fig .ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}

  /* ═══ ★VF_DAILY_V3（2026-10-12 用户定案「排版要真的不一样」）═══
     form / place 以前只是写在标签上、看不出差别；现在**真的换版式**。
     全部用 grid（不用绝对定位）⇒ 越界/溢出闸门照旧管用；三种 form 互不相同，
     文字压在图上的一律带 ≥74% 暗衬（对比度与"压图"判定都稳）。 */
  /* form=overlay：大图吃满整段（横竖都拉通），文字贴图下沿 + 暗衬条 */
  .sec[data-form="overlay"]{grid-template-columns:minmax(0,1fr);
    grid-template-rows:auto minmax(0,1fr) auto auto;grid-template-areas:"head" "fig" "title" "cols"}
  /* ⚠️ 踩过的坑（实测）：满幅图的"推近"若加在图框上，横屏会算出 3px 越界（图框比视口宽）。
     所以满幅段把推近**移到框内的图**上 —— 被 .fig 的 overflow:hidden 裁掉，版面不动。 */
  .sec[data-form="overlay"] .fig{margin-top:0;transform:rotate(-.25deg)}
  .sec[data-form="overlay"] .fig .ph{transform:scale(calc(var(--mz) - (var(--mz) - 1)*var(--sp)));
    transition:none}
  /* 标题与信息点共用**一条**暗衬带（::after 跨两行、把中间的行距也盖住）——
     否则两个深色块中间露一条纸色缝，看着像"两个灰盒子"（截图上看过一眼就不想要了）。 */
  .sec[data-form="overlay"]::after{content:"";grid-row:3 / span 2;grid-column:1;
    background:rgba(23,20,15,.74);z-index:0}
  .sec[data-form="overlay"] h2,.sec[data-form="overlay"] .cols{position:relative;z-index:1}
  .sec[data-form="overlay"] h2{background:none;color:#fff;padding:.06em .26em .12em}
  .sec[data-form="overlay"] h2 em{box-shadow:inset 0 -.18em 0 rgba(230,150,120,.5)}
  .sec[data-form="overlay"] .cols{background:none;color:#fff;border-top:0;
    padding:var(--gap) calc(var(--gap) * .8)}
  .sec[data-form="overlay"] .cols .col i{color:rgba(255,255,255,.78)}
  .sec[data-form="overlay"] .cols .col b{color:#F3C9A0}
  /* form=sticker：标题变贴纸块（纸色底 + 朱红硬投影 + 轻倾斜） */
  .sec[data-form="sticker"] h2{align-self:start;justify-self:start;
    background:var(--paper2);padding:.10em .30em .16em;box-shadow:7px 8px 0 rgba(198,57,43,.22)}
  /* form=vertical：竖排标题（报纸竖排感）—— 标题单独占一列，图在左 */
  .sec[data-form="vertical"]{grid-template-columns:minmax(0,1fr) auto;
    grid-template-rows:auto minmax(0,1fr) auto;grid-template-areas:"head head" "fig title" "cols cols"}
  .sec[data-form="vertical"] h2{writing-mode:vertical-rl;text-orientation:upright;
    font-size:clamp(30px,3.4vmin,50px);letter-spacing:.08em;align-self:start;justify-self:end;
    padding-left:calc(var(--gap) * .6)}
  /* place=mat：相纸感（图缩一圈、白边、方角） */
  .sec[data-place="mat"] .figs{padding:clamp(8px,1.1vmin,16px)}
  .sec[data-place="mat"] .fig{outline:clamp(4px,0.7vmin,8px) solid #fff;border-radius:1px;
    box-shadow:0 16px 32px rgba(60,40,20,.16)}

  /* ═══ ★VF_DAILY_L2 结构库（8 种；全部走 grid，不用绝对定位 ⇒ 越界/溢出闸门照旧管用）═══
     hero/sticker/vertical 三条就是上面 V3 那三段 CSS（故意复用，别重复定义）；下面是新增的 5 条。 */
  /* split 图文左右：竖屏也分栏（字左 / 图右） */
  .sec[data-layout="split"]{grid-template-columns:minmax(0,1.04fr) minmax(0,1fr);
    grid-template-rows:auto minmax(0,1fr) auto;grid-template-areas:"head head" "title fig" "cols fig"}
  /* grid3 三图拼版（竖屏：左 1 大 + 右 2 小） */
  .figs.n3{grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr)}
  .figs.n3 .fig:nth-child(1){grid-row:1 / span 2}
  /* grid4 四宫格 */
  .figs.n4{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr)}
  /* quote 引文页：大字 + 图作窄条。
     ⚠️ 踩过的坑（截图上看出来的）：把 title 行设成 1fr ⇒ overlay 的暗衬带（跨 title+cols 两行）
     会把**剩下的空间全吃成一大块黑**。正确做法：图占弹性 1fr，**文字行 auto（贴紧）**。 */
  .sec[data-layout="quote"]{grid-template-columns:minmax(0,1fr);
    grid-template-rows:auto minmax(0,1fr) auto auto;grid-template-areas:"head" "fig" "title" "cols"}
  .sec[data-layout="quote"] h2{font-size:clamp(34px,5.6vmin,72px);line-height:1.24;padding-bottom:.10em}
  .sec[data-layout="quote"] .cols{grid-template-columns:1fr;padding-top:calc(var(--gap) * .7)}
  .figs.n0{display:none}
  /* 横屏：grid3 改"上 1 通栏 + 下 2 并排"（避免三根细条）；grid4 保持 2×2 */
  @media (min-aspect-ratio:1/1){
    .figs.n3{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:minmax(0,1.08fr) minmax(0,1fr)}
    .figs.n3 .fig:nth-child(1){grid-row:1;grid-column:1 / span 2}
  }

  .cols{grid-area:cols;display:grid;grid-template-columns:1.45fr 1fr 1fr;gap:var(--gap);align-self:end;
    border-top:1px solid var(--line);padding-top:var(--gap)}
  .cols.c2{grid-template-columns:1.45fr 1fr}
  .cols.c1{grid-template-columns:1fr}
  .col{display:flex;flex-direction:column;gap:2px;
    opacity:clamp(0,calc((var(--sp) - var(--d,0))*4),1);
    transform:translateY(calc(20px*(1 - clamp(0,calc((var(--sp) - var(--d,0))*4),1))))}
  .col:nth-child(1){--d:calc(.14 * ${MOTION.dmul})}
  .col:nth-child(2){--d:calc(.22 * ${MOTION.dmul})}
  .col:nth-child(3){--d:calc(.30 * ${MOTION.dmul})}
  .col b{font-size:var(--num);line-height:1.1}
  .col:nth-child(1) b{font-family:"Noto Sans SC",system-ui,sans-serif;color:var(--rule)}
  .col i{font-style:normal;font-size:var(--label);color:var(--dim)}
</style>
</head>
<body>
${segs.map((s, i) => segBody(s, scenes[i])).join('\n\n')}

<script>
  /* 双模式：preview 自动循环（人打开就能看见动）；__seek(t) 一调 ⇒ 切 film 并停循环（渲染确定性） */
  (function () {
    var SECS = ${JSON.stringify(scenes.map((s) => ({ s: s.start, d: s.dur })))}
    var nodes = Array.prototype.slice.call(document.querySelectorAll('.sec'))
    var GAP = ${MOTION.gap}, t0 = (window.performance && performance.now) ? performance.now() : 0
    function paint(list) {
      for (var i = 0; i < list.length; i++) {
        list[i].node.style.setProperty('--sp', list[i].sp)
      }
    }
    function loop(now) {
      if (document.documentElement.dataset.mode === 'film') return
      var out = []
      for (var i = 0; i < nodes.length; i++) {
        var T = SECS[i] ? SECS[i].d * 1000 : 3200
        var t = ((now - t0 - i * GAP) % (T + GAP) + (T + GAP)) % (T + GAP)
        out.push({ node: nodes[i], sp: Math.min(1, t / T) })
      }
      paint(out)
      requestAnimationFrame(loop)
    }
    window.__seek = function (t) {
      document.documentElement.dataset.mode = 'film'
      t = Number(t) || 0
      var idx = SECS.length - 1
      for (var i = 0; i < SECS.length; i++) if (t >= SECS[i].s && t < SECS[i].s + SECS[i].d) idx = i
      var out = []
      for (var k = 0; k < nodes.length; k++) {
        var live = (k === idx)
        nodes[k].dataset.live = live ? '1' : '0'
        out.push({ node: nodes[k], sp: live ? Math.max(0, Math.min(1, (t - SECS[k].s) / SECS[k].d)) : 1 })
      }
      paint(out)
    }
    requestAnimationFrame(loop)
  })()
</script>
</body>
</html>
`

const OUT = path.resolve(outIdx >= 0 ? argv[outIdx + 1] : path.join(HERE, 'out', path.basename(cfgFile, '.json') + '.html'))
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, html, 'utf8')
console.log('✅ 生成：' + path.relative(REPO, OUT) + '（' + scenes.length + ' 段 · ' + TOTAL + 's · 动效档 ' + String(cfg.motion || 'normal') + '）')
if (warns.length) { console.log('⚠️ 字数体检（R11）' + warns.length + ' 条：'); warns.forEach((w) => console.log('   · ' + w)) }
else console.log('   R11 字数体检：通过')
