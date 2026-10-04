#!/usr/bin/env node
/**
 * check-master-manifest.mjs —— 第五条纪律「**声明必须有断言**」的执行器
 *
 * 背景：竖屏 `full` 版式曾退化成"顶带图 + 文字压在空底上"，而 `master.json` 里
 * `image.9:16.full = 整页` 的声明**完全正确** —— 也就是"清单说的"与"实际做的"脱节，
 * 这类问题没有任何断言能发现。本脚本把清单里每一类**声明性**内容都挂上一条可执行检查。
 *
 * ★ 期望值一律**从清单读**，脚本里不写任何母版数值（只有"要检查哪些产物"这张表是脚本里的）。
 *   因此**双向都会红**：
 *     - 清单改了、实现（CSS/生成器）没跟着改 → 像素层红；
 *     - 实现改了、清单没跟着改            → L1 链路层红。
 *
 * 四级断言（越靠后越"接地"）：
 *   L1 清单 → 元数据：生成器写出的 meta 里每个值都必须等于清单声明（专抓"生成器又写死一个值"）
 *   L2 元数据 → 像素：直接复用 verify-chart.mjs / verify-image.mjs 的测量函数（子进程，避免两处实现漂移）
 *   L3 清单自洽：声明性含义自检（full 必须=满幅 / left·right 必须贴边且不满幅 / 绘图区不越界 / 配色名色一致）
 *   L4 产物 → 清单：ffprobe 的画布、时长 = 页数×单页时长、帧数、抽帧 PNG 数 = 页数×2
 *
 * 用法：node check-master-manifest.mjs [--master master-v1]
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/* ★ 路径收口：唯一来源 `paths.mjs`（本文件**不再**自己 `resolve(HERE,'..')`；硬编码 `deck-contract` 也一并去掉） */
import { ENGINE_ROOT as ROOT, DECK_DIR, selfCheck } from './paths.mjs'
/* ★ K17-ff：外部媒体工具解析的**唯一实现**在 `engine-bin.mjs`（本文件只 import —— 断言：其它文件里该环境变量字面量必须为 0） */
import { resolveFfmpeg, resolveFfprobe } from './engine-bin.mjs'
selfCheck({ quiet: true })
/** 母版清单目录（可用 --masters 指向副本，用于"改清单必须变红"的敏感性自证） */
const MASTERS = (() => {
  const i = process.argv.indexOf('--masters')
  return i >= 0 ? resolve(process.argv[i + 1]) : join(ROOT, 'masters')
})()

/* ------------------------------------------------------------------
   检查矩阵：**只声明"要检查哪些产物"**，不声明任何期望值
   （期望值全部来自 masters/<id>/master.json，见 loadManifest）
   ------------------------------------------------------------------ */
const MATRIX = [
  { master: 'master-v1', orientation: '16:9', films: ['out/deck.all12', 'out/deck.img3'] },
  { master: 'master-v1', orientation: '9:16', films: ['out/deck.all12-9x16', 'out/deck.img3-9x16'] },
  { master: 'master-v2', orientation: '16:9', films: ['out-master-v2/deck.all12-master-v2', 'out-master-v2/deck.img3-master-v2'] },
  { master: 'master-v2', orientation: '9:16', films: ['out-master-v2/deck.all12-9x16-master-v2', 'out-master-v2/deck.img3-9x16-master-v2'] },
]

/* ---------------- 每张 film 声明它"必须长什么样"的期望来源 ---------------- */
// all12 含全部 12 种页型（有 chart 页、有 full 图页、12 页）
// img3  含 left/right/full 三种图片版式（5 页）
const FILM_KIND = (dir) => (existsSync(join(DECK_DIR, dir, 'chart-meta.json')) ? 'all12' : 'img3')

/* ---------------- 断言记账 ---------------- */
const issues = []
const notes = []
const layerCount = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 }
let curCtx = '?'
function chk(layer, what, ok, detail, hint) {
  layerCount[layer]++
  if (!ok) issues.push({ ctx: curCtx, layer, what, detail, hint })
  return ok
}
/** 提示（不计失败）：用来暴露"声明能过、但语义值得注意"的情况 */
function note(what) { notes.push(`${curCtx} :: ${what}`) }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const fx = (n, d = 2) => (typeof n === 'number' ? n.toFixed(d) : String(n))

/* ---------------- 二进制解析（复用 hyperframes 给出的 ffmpeg 路径） ---------------- */
/* ★★ team-lead msg16 ①（K17 扩展）：**收口到 `engine-bin.mjs`**（候选数组/环境变量只许在那一处）⇒ 本处退化为一行转发。 */
function resolveBin(name) { return name === 'ffprobe' ? resolveFfprobe().p : resolveFfmpeg().p }
function probe(file) {
  const r = spawnSync(resolveBin('ffprobe'), ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,pix_fmt,nb_frames,avg_frame_rate,color_range,color_space',
    '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) return null
  const j = JSON.parse(r.stdout)
  const s = (j.streams || [])[0] || {}
  const [nu, de] = String(s.avg_frame_rate || '0/1').split('/').map(Number)
  return {
    w: s.width, h: s.height, pix: s.pix_fmt, frames: Number(s.nb_frames),
    fps: de ? nu / de : 0, dur: Number((j.format || {}).duration),
    range: s.color_range, space: s.color_space,
  }
}
/** 抽帧 PNG → rgb24 裸缓冲（用于"声明的两个版式矩形相同 ⇒ 实测必须逐像素一致"） */
function frameRaw(png) {
  const r = spawnSync(resolveBin('ffmpeg'), ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 28 })
  return r.status === 0 && r.stdout && r.stdout.length ? r.stdout : null
}
/** 比较两个同尺寸裸缓冲在矩形 r 内的差异 */
function diffRect(a, b, W, r) {
  let ch = 0, tot = 0, px = 0, maxd = 0
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * W + x) * 3
      let any = false
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(a[i + k] - b[i + k]); tot++
        if (d) { ch++; any = true }
        if (d > maxd) maxd = d
      }
      if (any) px++
    }
  }
  return { ch, tot, px, maxd }
}
function runVerifier(script, workdir) {
  const r = spawnSync(process.execPath, [join(HERE, script), workdir], { encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  const concl = (out.match(/^结论:.*$/m) || [''])[0].trim()
  return { ok: r.status === 0, code: r.status, concl }
}

/* ---------------- 清单载入 ---------------- */
function loadManifest(id) {
  const p = join(MASTERS, id, 'master.json')
  if (!existsSync(p)) throw new Error(`母版清单不存在: ${p}`)
  const m = JSON.parse(readFileSync(p, 'utf8'))
  if (m.id !== id) throw new Error(`${p} 的 id(${m.id}) 与目录名不一致`)
  return m
}
const hex2rgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',')
}

/* ==================================================================
   主流程
   ================================================================== */
const only = (() => { const i = process.argv.indexOf('--master'); return i >= 0 ? process.argv[i + 1] : null })()
const rows = []

for (const m of MATRIX) {
  if (only && m.master !== only) continue
  const man = loadManifest(m.master)
  const o = m.orientation
  const cv = man.canvas[o]
  curCtx = `${m.master} × ${o}`

  console.log(`\n==================== ${m.master}（${man.name}） × ${o} ====================`)
  console.log(`清单: masters/${m.master}/master.json   画布声明 ${cv.w}×${cv.h}${cv.portrait ? '（竖屏）' : ''}   单页 ${man.page}s`)

  /* ---------- L3 清单自洽（全部从清单读，不需要产物） ---------- */
  console.log(`\n  ── L3 清单自洽（声明性含义）`)
  const img = (man.image || {})[o] || {}
  /** 清单声明的 left/right 是否为同一条媒体带（竖屏常见；决定"侧向语义"是否存在） */
  const sameRectLR = !!(img.left && img.right && eq(img.left, img.right))
  /** 本几何**允许**的图片版式（D15：竖屏只有 full）—— 声明性内容，必须在清单里明写 */
  const allowed = img._allowed
  if (chk('L3', `image.${o}._allowed 必须声明`, Array.isArray(allowed) && allowed.length > 0,
    JSON.stringify(allowed), '清单必须声明本几何允许哪些图片版式（D15：竖屏只有 full）')) {
    const decl = Object.keys(img).filter((k) => !k.startsWith('_'))
    chk('L3', `image.${o}._allowed ⊆ 已声明的版式`, allowed.every((k) => decl.includes(k)),
      `_allowed=[${allowed.join(',')}] 已声明=[${decl.join(',')}]`, '_allowed 里不能出现没声明矩形的版式')
    chk('L3', `image.${o}._allowed 必须含 full`, allowed.includes('full'), `[${allowed.join(',')}]`,
      'full 是唯一在所有几何下都成立的图片版式')
    for (const k of decl) {
      if (!allowed.includes(k)) note(`image.${o}.${k}：规则保留但**不在 _allowed**（${allowed.join('/')} 之外）—— 仅横屏使用（D15）`)
    }
  }
  for (const L of ['full', 'left', 'right']) {
    const r = img[L]
    if (!chk3(r, `image.${o}.${L} 必须声明`)) continue
    const inside = r.x >= 0 && r.y >= 0 && r.x + r.w <= cv.w && r.y + r.h <= cv.h
    chk('L3', `image.${o}.${L} 在画布内`, inside, `${JSON.stringify(r)} vs ${cv.w}×${cv.h}`, '矩形必须落在画布内')
    if (L === 'full') {
      // ★ 这条就是"full = 满幅"的**声明性**断言：若有人为了迁就坏实现把 full 改成 720×538，这里立刻红
      chk('L3', `image.${o}.full 声明必须=满幅`, r.w === cv.w && r.h === cv.h,
        `声明 ${r.w}×${r.h}，画布 ${cv.w}×${cv.h}`, 'full 的含义是"媒体铺满整页"；若实情不是满幅，应改用 left/right 版式，而不是改这里的声明')
    } else {
      const notWhole = r.w < cv.w || r.h < cv.h
      chk('L3', `image.${o}.${L} 声明必须≠满幅`, notWhole, `声明 ${r.w}×${r.h} = 画布`,
        `${L} 的含义是"媒体占一侧/一带"；若实情满幅，应改用 full`)
      const edge = L === 'left' ? r.x === 0 : r.x + r.w === cv.w
      chk('L3', `image.${o}.${L} 必须贴${L === 'left' ? '左' : '右'}边`, edge,
        `x=${r.x} w=${r.w} 画布宽 ${cv.w}`, 'left/right 的语义就是贴对应边')
    }
  }
  if (img.left && img.right) {
    // left/right 的**语义**依赖几何：横屏 = 左右分栏 / 竖屏 = 整宽横带 / 也可能上下分列。
    // 三种几何各自有一套"应当在像素上成立"的含义，这里按**清单声明**自动选分支断言。
    if (sameRectLR) {
      chk('L3', `image.${o} left/right 矩形相同 ⇒ 必须如实声明`, true,
        `${JSON.stringify(img.left)} = ${JSON.stringify(img.right)}`,
        '本几何下两个版式共用同一条媒体带时，清单必须写成相同矩形（不许声称为分栏）')
      // D15 之后这条不再是"缺口"，只是解释"为什么规则保留却不可用"
      note(`image.${o}: left 与 right 的媒体矩形相同（${img.left.w}×${img.left.h}）⇒ 侧向语义不成立；本几何的 _allowed=[${(allowed || []).join(', ')}]`)
    } else if (img.left.w === cv.w && img.right.w === cv.w) {
      // 上下分列（整宽带）：必须一上一下、各贴一端、互不压盖
      const oneTop = img.left.y === 0 || img.right.y === 0
      const oneBottom = img.left.y + img.left.h === cv.h || img.right.y + img.right.h === cv.h
      const noOverlap = img.left.y + img.left.h <= img.right.y || img.right.y + img.right.h <= img.left.y
      chk('L3', `image.${o} 上下分列：一上一下、各贴一端、不重叠`, oneTop && oneBottom && noOverlap,
        `left ${JSON.stringify(img.left)} right ${JSON.stringify(img.right)} 画布高 ${cv.h}`, '上下分列时必须各贴一端且不压盖')
    } else {
      chk('L3', `image.${o} left/right 不得重叠`, img.left.x + img.left.w <= img.right.x,
        `left 右缘 ${img.left.x + img.left.w} vs right 左缘 ${img.right.x}`, '两个版式矩形不能互相压盖')
      chk('L3', `image.${o} left 贴左 / right 贴右`, img.left.x === 0 && img.right.x + img.right.w === cv.w,
        `left.x=${img.left.x} right 右缘=${img.right.x + img.right.w} 画布宽=${cv.w}`, '横向分栏时两侧必须各贴一边')
    }
  }
  // 绘图区必须放得下、不越界（用清单的 padBase，不是脚本里的 84/54）
  const padB = (man.padBase || {})[o]
  const plot = (man.plot || {})[o]
  if (chk3(plot, `plot.${o} 必须声明`) && chk3(padB, `padBase.${o} 必须声明`)) {
    chk('L3', `plot.${o} 宽度不越界`, plot.w <= cv.w - 2 * padB, `${plot.w} vs 画布内宽 ${cv.w - 2 * padB}`,
      '绘图区宽必须 ≤ 画布宽 − 2×页边距')
    const bottom = padB + (man.plotTopOffset || {})[o] + plot.h
    chk('L3', `plot.${o} 高度不越界`, bottom <= cv.h, `底缘 ${bottom} vs 画布高 ${cv.h}`,
      '绘图区底缘 = 页边距 + 上移量 + 绘图区高，必须 ≤ 画布高')
    chk('L3', `plotTopOffset.${o} 必须声明`, typeof (man.plotTopOffset || {})[o] === 'number', String((man.plotTopOffset || {})[o]), '清单必须声明绘图区上移量')
  }
  // 配色：名 → 色值/分量必须一致
  const palNames = Object.keys(man.palette || {})
  chk('L3', 'palette 清单非空', palNames.length > 0, palNames.join(', '), '母版必须声明自己的 palette 名清单')
  for (const n of palNames) {
    const p = man.palette[n]
    chk('L3', `palette.${n}.accent ↔ rgb 一致`, hex2rgb(p.accent) === p.rgb,
      `accent ${p.accent} → ${hex2rgb(p.accent)}，声明 rgb ${p.rgb}`, '两处必须同源（换色时两个一起改）')
  }
  chk('L3', 'bg / ink 是合法 #hex', !!hex2rgb(man.bg) && !!hex2rgb(man.ink), `bg=${man.bg} ink=${man.ink}`, '母版必须声明底色与主字色')
  chk('L3', 'page 为正数', Number(man.page) > 0, String(man.page), '单页时长必须为正')
  console.log(`     L3 共 ${layerCount.L3} 条（详见末尾汇总）`)

  /* ---------- 每条 film：L1 链路 / L2 像素 / L4 产物 ---------- */
  for (const dir of m.films) {
    const work = join(DECK_DIR, dir)
    curCtx = `${m.master} × ${o} · ${dir}`
    const kind = FILM_KIND(dir)
    console.log(`\n  ── ${dir}（${kind}）`)

    const cmPath = join(work, 'chart-meta.json')
    const imPath = join(work, 'image-meta.json')
    const cm = existsSync(cmPath) ? JSON.parse(readFileSync(cmPath, 'utf8')) : null
    const im = existsSync(imPath) ? JSON.parse(readFileSync(imPath, 'utf8')) : null

    /* L1 清单 → 元数据 */
    if (kind === 'all12') {
      if (chk('L1', 'chart-meta.json 存在', !!cm, cmPath, '含 chart 页的片必须写出图表几何元数据')) {
        chk('L1', 'meta.masterId = 清单 id', cm.masterId === man.id, `${cm.masterId} vs ${man.id}`, '元数据必须来自本次选定的母版')
        chk('L1', 'meta.orientation = 本次几何', cm.orientation === o, `${cm.orientation} vs ${o}`)
        chk('L1', 'meta.deck 与清单同几何', cm.deck?.style?.orientation === o, String(cm.deck?.style?.orientation))
        chk('L1', `meta.canvas = 清单 canvas.${o}`, eq(cm.canvas, cv), `${JSON.stringify(cm.canvas)} vs ${JSON.stringify(cv)}`)
        chk('L1', `meta.pad = 清单 padBase.${o}`, cm.pad === padB, `${cm.pad} vs ${padB}`, '页边距必须来自清单（density 未覆盖时应等于 padBase）')
        chk('L1', `meta.plot = 清单 plot.${o}`, eq(cm.plot, plot), `${JSON.stringify(cm.plot)} vs ${JSON.stringify(plot)}`, '★ 专抓"绘图区几何又被写死在生成器里"')
        chk('L1', 'meta.padBox = 清单 plotPad', eq(cm.padBox, man.plotPad), `${JSON.stringify(cm.padBox)} vs ${JSON.stringify(man.plotPad)}`)
        chk('L1', `meta.plotTop = 页边距 + 清单 plotTopOffset.${o}`,
          cm.plotTop === padB + man.plotTopOffset[o], `${cm.plotTop} vs ${padB}+${man.plotTopOffset[o]}`)
        chk('L1', 'meta.bg = 清单 bg', cm.bg === man.bg, `${cm.bg} vs ${man.bg}`)
        chk('L1', 'meta.ink = 清单 ink', cm.ink === man.ink, `${cm.ink} vs ${man.ink}`)
        chk('L1', 'meta.rule = 清单 rule', cm.rule === man.rule, `${cm.rule} vs ${man.rule}`)
        const palName = cm.deck?.style?.palette
        const pal = (man.palette || {})[palName]
        chk('L1', 'deck 用的 palette 在清单里', !!pal, `${palName} ∈ [${palNames.join(', ')}]`, 'palette 名必须来自所选母版的清单')
        if (pal) chk('L1', `meta.barColor = 清单 palette.${palName}.rgb`, cm.barColor === pal.rgb, `${cm.barColor} vs ${pal.rgb}`, '★ 专抓"配色又被写死在生成器里"')
        chk('L1', 'meta.barAlpha = 清单 chart.barAlpha', cm.barAlpha === man.chart.barAlpha, `${cm.barAlpha} vs ${man.chart.barAlpha}`)
        chk('L1', 'meta.donutShades = 清单 donutShades', eq(cm.donutShades, man.donutShades), `${JSON.stringify(cm.donutShades)} vs ${JSON.stringify(man.donutShades)}`)
        for (const p of cm.pages) {
          chk('L1', `chart 页 ${p.index} 的 meta.marks 数 = series 数`, p.meta?.marks?.length === p.series.length,
            `${p.meta?.marks?.length} vs ${p.series.length}`, '图上数据点数必须等于输入 series')
        }
      }
    }

    /* L1+L3 图片页 */
    if (im) {
      chk('L1', 'meta.masterId = 清单 id', im.masterId === man.id, `${im.masterId} vs ${man.id}`)
      chk('L1', 'meta.orientation = 本次几何', im.orientation === o, `${im.orientation} vs ${o}`)
      chk('L1', `meta.canvas = 清单 canvas.${o}`, eq(im.canvas, cv), `${JSON.stringify(im.canvas)} vs ${JSON.stringify(cv)}`)
      chk('L1', `meta.pad = 清单 padBase.${o}`, im.pad === padB, `${im.pad} vs ${padB}`)
      chk('L1', 'meta.bg = 清单 bg', im.bg === man.bg, `${im.bg} vs ${man.bg}`)
      for (const p of im.pages) {
        const decl = img[p.layout]
        chk('L1', `图片页 ${p.index}(${p.layout}) 的 region = 清单 image.${o}.${p.layout}`,
          !!decl && eq(p.region, decl), `${JSON.stringify(p.region)} vs ${JSON.stringify(decl)}`,
          '★ 专抓"媒体区矩形又被写死在生成器里"（竖屏 full 退化成顶带图就是这类）')
        // ★ D15：产物里出现的图片版式必须在清单允许集内（竖屏出现 left/right 即错）
        if (Array.isArray(allowed)) {
          chk('L1', `图片页 ${p.index} 的版式 "${p.layout}" 在清单 _allowed 内`, allowed.includes(p.layout),
            `_allowed=[${allowed.join(',')}]，实际用 "${p.layout}"`,
            o === '9:16' ? '竖屏图片页只有 full（D15）—— 换版式或改用 16:9' : '该版式未在清单声明')
        }
        // 声明 = 满幅 ⇒ 元数据里也必须是满幅，且右下角必须落在画布内
        if (p.layout === 'full') {
          chk('L3', `图片页 ${p.index} full 的 region 覆盖整页`, p.region.w === cv.w && p.region.h === cv.h,
            `${p.region.w}×${p.region.h} vs ${cv.w}×${cv.h}`, 'full 必须覆盖整页（声明性含义）')
        }
      }
      // ★ 声明 ↔ 像素的**直接**对照：清单声明 left/right 用同一条媒体带 ⇒ 两页的媒体带必须逐像素一致。
      //   （这是"清单说它们是同一个版式"的最硬证据；顺带证明"竖屏下侧向语义不成立"是真事实，不是我的推断）
      const lrP = ['left', 'right'].map((L) => im.pages.find((p) => p.layout === L))
      if (sameRectLR && lrP.every(Boolean)) {
        const pngs = lrP.map((p) => join(work, 'frames', `p${p.index}-full.png`))
        const raws = pngs.map((f) => (existsSync(f) ? frameRaw(f) : null))
        if (chk('L2', 'left/right 两页帧可读', raws.every(Boolean), pngs.join(' / '), '需要 frames/p<i>-full.png')) {
          const rr = img.left
          const d = diffRect(raws[0], raws[1], cv.w, rr)
          // 判据用**最大通道差**（编解码噪声级 ≤24/255），而不是"不同像素比例"：
          //   平坦图在 H.264 下逐帧重建本来就会抖动（实测 v1：5.6% 像素差 ±8，肉眼不可见）；
          //   而"同一条带被画偏 1px"会产生 max≈160 的差（源图内部边界处成一条竖线）—— 两者量级完全不同。
          const ok = d.maxd <= 24
          chk('L2', '声明 left/right 同一条媒体带 ⇒ 实测必须同一条带（只允许编解码噪声）', ok,
            `媒体带 ${rr.w}×${rr.h}：最大通道差 ${d.maxd}（噪声级 ≤24）· 不同通道 ${d.ch}/${d.tot} (${(d.ch / d.tot * 100).toFixed(4)}%) · 不同像素 ${d.px}/${rr.w * rr.h}`,
            '两版式声明同一媒体带，实测就必须是同一条带；差到 100+ 说明图被画偏/裁错（曾实测：内容盒被 1px 描边挤掉 ⇒ 偏 1px）')
          console.log(`     L2 left/right 媒体带 ${rr.w}×${rr.h}: 不同通道 ${d.ch}/${d.tot} · 不同像素 ${d.px}/${rr.w * rr.h} · 最大差 ${d.maxd}`)
        }
      }
    } else if (existsSync(join(work, 'hyperframes.json'))) {
      // 没 meta 但确实渲过：这本身是缺口（说明生成器没写该 meta）
      chk('L1', 'image-meta.json 存在', false, imPath, '图片页的像素矩形必须有独立真源（同图表几何的待遇）')
    }

    /* L2 元数据 → 像素（复用既有验证器的测量函数） */
    if (kind === 'all12') {
      const vc = runVerifier('verify-chart.mjs', dir)
      chk('L2', 'verify-chart（图表几何 ↔ 像素）', vc.ok, vc.concl || `exit=${vc.code}`, '期望值来自 meta（meta 来自清单）')
      console.log(`     L2 verify-chart : ${vc.ok ? '✓' : '✗'} ${vc.concl}`)
    }
    const vi = runVerifier('verify-image.mjs', dir)
    chk('L2', 'verify-image（媒体区矩形 ↔ 像素 · 外侧=底色）', vi.ok, vi.concl || `exit=${vi.code}`, '期望值来自 meta（meta 来自清单）')
    console.log(`     L2 verify-image : ${vi.ok ? '✓' : '✗'} ${vi.concl}`)

    /* L4 产物 → 清单（每条片都查：画布/时长/帧数/抽帧锚点） */
    const pages = cm?.deck?.pages?.length ?? im?.deck?.pages?.length ?? null
    const mp4 = join(work, `output-${dir.split('/').slice(-1)[0]}.mp4`)
    const info = existsSync(mp4) ? probe(mp4) : null
    if (chk('L4', '产物 mp4 存在', !!info, mp4)) {
      chk('L4', `画布 = 清单 canvas.${o}`, info.w === cv.w && info.h === cv.h, `${info.w}×${info.h} vs ${cv.w}×${cv.h}`)
      if (chk3(pages, 'L4 页数（来自 meta.deck）')) {
        chk('L4', `时长 = 页数 × 清单 page（${pages}×${man.page}）`, Math.abs(info.dur - pages * man.page) < 0.02,
          `${fx(info.dur, 3)}s vs ${fx(pages * man.page, 3)}s`, '单页时长必须来自清单')
        chk('L4', '帧数 = 时长 × fps', Math.abs(info.frames - Math.round(info.dur * info.fps)) <= 1,
          `${info.frames} vs ${Math.round(info.dur * info.fps)} (fps=${fx(info.fps, 3)})`)
        const pngs = readdirSync(join(work, 'frames')).filter((f) => f.endsWith('.png')).length
        chk('L4', '抽帧 PNG 数 = 页数 × 2（独立锚点）', pngs === pages * 2, `${pngs} vs ${pages * 2}`, '抽帧静默失败会在这里红')
        chk('L4', '像素格式 yuv420p', info.pix === 'yuv420p', String(info.pix))
        chk('L4', '色彩范围 tv + bt709', info.range === 'tv' && info.space === 'bt709', `${info.range}/${info.space}`)
        console.log(`     L4 产物: ${info.w}×${info.h} · ${fx(info.dur, 3)}s · ${info.frames} 帧 · PNG ${pngs}（页 ${pages} × 2）`)
      }
    }
  }
  rows.push({ ...m, canv: `${cv.w}×${cv.h}` })
}

/* ==================================================================
   L5 全产物扫描 —— 防"死规则"悄悄复活
   《D15》：竖屏图片页只有 full。母版层的 left/right 规则是**刻意保留**的（想复活不用重写），
   所以更要一条护栏：**任何已渲染产物**都不得使用 `_allowed` 之外的图片版式。
   这条同时能防"产物陈旧"（本轮实测过：误传 --outdir 留下旧产物含 left/right，被立刻判红）。
   ★ 扫描范围是产物目录本身，而不是脚本里的表 ⇒ 新渲的片自动被覆盖。
   ================================================================== */
console.log('\n==================== L5 全产物扫描（图片版式必须在该母版/几何的 _allowed 内）====================')
const manCache = new Map()
let scanned = 0, pagesSeen = 0
for (const root of ['out', 'out-master-v2'].map((d) => join(DECK_DIR, d))) {
  if (!existsSync(root)) continue
  for (const name of readdirSync(root)) {
    const im = join(root, name, 'image-meta.json')
    if (!existsSync(im)) continue
    let meta = null
    try { meta = JSON.parse(readFileSync(im, 'utf8')) } catch { continue }
    const mid = meta.masterId, oo = meta.orientation
    if (!mid || !oo) continue
    scanned++
    curCtx = `L5 · ${name}（${mid} × ${oo}）`
    if (!manCache.has(mid)) manCache.set(mid, loadManifest(mid))
    const al = manCache.get(mid).image?.[oo]?._allowed
    if (!chk('L5', `产物 ${name} 所在母版/几何 有 _allowed 声明`, Array.isArray(al), `${mid}/${oo}`,
      '母版清单必须声明该几何允许的图片版式')) continue
    for (const p of meta.pages || []) {
      pagesSeen++
      chk('L5', `${name} 图片页 ${p.index} 的版式 "${p.layout}" 在 _allowed 内`, al.includes(p.layout),
        `_allowed=[${al.join(',')}]，实际用 "${p.layout}"`,
        `D15：${oo === '9:16' ? '竖屏图片页只有 full' : '该版式未在清单声明'}；_allowed 之外一律不得出现`)
    }
  }
}
console.log(`  扫描 ${scanned} 个产物目录 · ${pagesSeen} 个图片页  ${pagesSeen ? '' : '（无可扫描产物）'}`)

/* ---------------- 汇总 ---------------- */
console.log('\n==================== 汇总 ====================')
const byLayer = {}
for (const it of issues) (byLayer[it.layer] = byLayer[it.layer] || []).push(it)
for (const L of ['L1', 'L2', 'L3', 'L4', 'L5']) {
  const n = layerCount[L], bad = (byLayer[L] || []).length
  console.log(`  ${L}: 断言 ${n} 条 · 失败 ${bad} 条  ${bad === 0 ? '✓' : '✗'}`)
}
if (issues.length) {
  console.log('\n失败明细：')
  for (const it of issues) {
    console.log(`  ✗ [${it.layer}] ${it.ctx} :: ${it.what}`)
    console.log(`      期望 ${it.detail}${it.hint ? `\n      → ${it.hint}` : ''}`)
  }
}
if (notes.length) {
  console.log('\n提示（不计失败，但都是"声明能过、语义值得注意"的点）：')
  for (const n of [...new Set(notes)]) console.log(`  • ${n}`)
}
console.log(`\n结论: ${issues.length === 0
  ? `PASS（${rows.length} 个"母版 × 几何"组合、${layerCount.L1 + layerCount.L2 + layerCount.L3 + layerCount.L4 + layerCount.L5} 条声明断言全部成立）`
  : `FAIL（${issues.length} 条声明与实现不符）`}`)
process.exit(issues.length ? 1 : 0)

function chk3(v, what) { return chk('L3', what, v != null, String(v), '清单必须声明该项') }
