#!/usr/bin/env node
/**
 * temp/_exp/daily/probe-matrix.mjs —— ★VF_DAILY_V25（B3：皮肤 × 结构搭配矩阵）的**取证据**工具。
 * 为什么先跑这个再写规则：搭配好坏是**量出来的**，不是拍脑袋定的（我上几轮就因为"看着差不多"误判过两次）。
 * 每个格子量三件事：
 *   ① 对比度：标题实际颜色 vs 它**实际压着的**背景（V23 那套算法）；
 *   ② 是否压图：标题盒与图框的重叠面积占比（>15% 才算"压在照片上"）；
 *   ③ 越界/溢出：滚动宽 - 视口宽、有没有元素超出 1px。
 * 跑法：node temp/_exp/daily/probe-matrix.mjs            （用默认 4 皮肤 × 8 结构）
 *       node temp/_exp/daily/probe-matrix.mjs --skins a,b --layouts hero,split
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ENGINE = path.join(REPO, 'scripts/video-factory/html-deck/tools/daily-page.mjs')
const TMP = path.join(REPO, 'temp/_exp/daily/out/matrix')
const argOf = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? String(process.argv[i + 1] || '').split(',') : d }

const SKINS = argOf('--skins', ['copper-pot', 'late-night', 'paper-daily', 'nordic'])
const LAYOUTS = argOf('--layouts', ['hero', 'sticker', 'vertical', 'split', 'grid3', 'grid4', 'stack2', 'quote'])
const IMGS = { hero: 1, sticker: 1, vertical: 1, split: 1, grid3: 3, grid4: 4, stack2: 2, quote: 1 }
const POINTS = { split: [['切法', '手工'], ['上桌', '现涮']], vertical: [['脆', '现切'], ['鲜', '当日']], quote: [['第一筷', '百叶'], ['第二筷', '手切']] }
const FORMS = { hero: 'overlay', sticker: 'sticker', vertical: 'vertical' }

fs.mkdirSync(TMP, { recursive: true })
// 图上给真图（拿同一张本地素材铺过去，避免"占位渐变"影响"是否压图"的判断）
const src = 'E:/ai-marketing/storage/1/餐饮素材'
const files0 = fs.existsSync(src) ? fs.readdirSync(src).filter((f) => /\.jpe?g$/i.test(f)).sort() : []
if (files0[0]) fs.copyFileSync(path.join(src, files0[0]), path.join(TMP, 'images_1.jpg'))

const TM_ALL = ['rise', 'push', 'drift', 'zoom', 'wipe', 'curtain', 'blur']
const mk = (skin, layout, tm) => {
  const n = IMGS[layout]
  const seg = {
    kind: layout === 'hero' ? 'cover' : 'feature', layout, form: FORMS[layout] || 'overlay',
    type: 'band', scale: 1, kicker: '第 01 期 · 现拍', stamp: layout === 'hero' ? '现拍' : '',
    title: ['手切鲜肉', '现点现切'], imgs: Array.from({ length: n }, (_, i) => i + 1),
    points: POINTS[layout] || [['实拍', '原图'], ['细节', '特写']], place: 'cover',
    fx: 'zout#0',   // 只验"皮肤×结构"，把图效固定在安静组（否则量的东西混在一起）
  }
  if (tm) seg.tm = tm
  const tag = tm ? `${skin}__${layout}__${tm}` : `${skin}__${layout}`
  const plan = { meta: { issue: '矩阵', title: tm ? '结构×文字动效' : '皮肤×结构', theme: skin }, motion: 'normal', imageDir: 'images', segments: [seg] }
  const pf = path.join(TMP, tag + '.json')
  fs.writeFileSync(pf, JSON.stringify(plan), 'utf8')
  const out = path.join(TMP, tag + '.html')
  try { execFileSync(process.execPath, [ENGINE, pf, '--out', out], { cwd: REPO, encoding: 'utf8' }) } catch (e) { console.log('  生成失败 ' + tag + '：' + String(e).slice(0, 100)) }
  return { skin, layout, tm: tm || '-', out }
}
const cases = []
for (const skin of SKINS) for (const layout of LAYOUTS) cases.push(mk(skin, layout))
// ★V25：**文字动效 × 结构** 也必须进矩阵 —— 我这轮就是被这条轴咬的（--tmx 未归零 ⇒ 竖排溢出）
const TM_LAYOUTS = ['hero', 'split', 'vertical', 'stack2']
for (const layout of TM_LAYOUTS) for (const tm of TM_ALL) cases.push(mk(SKINS[0], layout, tm))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] })
const page = await browser.newPage()
await page.setViewport({ width: 720, height: 1280 })
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])   // ★V24：直接看末态
const lum = (c) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const contrast = (a, b) => { if (!a || !b) return 0; const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }
// ⚠️ 名字叫 hexRgb 而不是 parse：上一版我把它叫 parse 又定义在使用之后 ⇒ TDZ 直接崩（脚本自己也踩了 TDZ 的坑）
const hexRgb = (s) => { const x = /#?([0-9a-f]{6})/i.exec(String(s || '')); if (!x) return null; const v = parseInt(x[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255] }

const rows = []
for (const c of cases) {
  await page.goto('file:///' + c.out.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 120000 })
  await new Promise((r) => setTimeout(r, 150))
  const m = await page.evaluate(() => {
    const parse = (s) => { const x = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || ''); return x ? [+x[1], +x[2], +x[3]] : null }
    const sec = document.querySelector('.sec')
    const h2 = sec.querySelector('h2')
    const figs = Array.from(sec.querySelectorAll('.fig'))
    const r2 = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } }
    const H = r2(h2)
    // 标题实际压着的背景：从 h2 往上找第一个不透明背景色（同 V23 探针）
    let bg = null
    let n = h2
    while (n && n !== document.documentElement) {
      const st = getComputedStyle(n)
      const a = /rgba\([^)]*,\s*([\d.]+)\)/.exec(st.backgroundColor)
      if (parse(st.backgroundColor) && (!a || parseFloat(a[1]) > 0.5)) { bg = parse(st.backgroundColor); break }
      n = n.parentElement
    }
    // 与图框重叠面积占比（>15% 视为"文字压在照片上"）
    let ov = 0
    figs.forEach((f) => {
      const F = r2(f)
      const w = Math.max(0, Math.min(H.x + H.w, F.x + F.w) - Math.max(H.x, F.x))
      const h = Math.max(0, Math.min(H.y + H.h, F.y + F.h) - Math.max(H.y, F.y))
      ov += w * h
    })
    const area = Math.max(1, H.w * H.h)
    return {
      color: parse(getComputedStyle(h2).color), bg,
      overlap: Math.round(100 * ov / area),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
    }
  })
  rows.push({ ...c, ...m, k: contrast(m.color, m.bg), paperDark: contrast([255, 255, 255], hexRgb(m.paper)) >= 4.5 })
}
await browser.close()
console.log('\n  皮肤 × 结构 矩阵（末态实测；k=标题对比度 · ov=标题压图面积% · sx=横向溢出）')
console.log('  ' + '皮肤'.padEnd(12) + LAYOUTS.map((l) => l.padEnd(9)).join(''))
for (const skin of SKINS) {
  const cells = LAYOUTS.map((l) => {
    const r = rows.find((x) => x.skin === skin && x.layout === l)
    if (!r) return '-'.padEnd(9)
    const ok = r.k >= 4.5 && r.overflowX <= 1
    return ((ok ? '✓' : '✗') + ' ' + r.k.toFixed(1) + '/' + r.overlap).padEnd(9)
  })
  console.log('  ' + (skin + (rows.find((x) => x.skin === skin).paperDark ? '(深)' : '(浅)')).padEnd(12) + cells.join(''))
}
console.log('\n  明细（挑出有问题的格子）')
const bad = rows.filter((r) => r.k < 4.5 || r.overflowX > 1)
if (!bad.length) console.log('   （没有不达标格子：对比都 ≥4.5、无横向溢出）')
bad.forEach((r) => console.log(`   ✗ ${r.skin}/${r.layout}/${r.tm}  对比 ${r.k.toFixed(2)} 压图 ${r.overlap}% 溢出 ${r.overflowX}px`))

// ── 结构 × 文字动效（这条轴要有覆盖：V25 的 --tmx 未归零就是在这里被咬的）──
const tmRows = rows.filter((r) => r.tm !== '-')
if (tmRows.length) {
  console.log('\n  结构 × 文字动效（末态；每格 = 对比度/横向溢出px）')
  console.log('  ' + 'tm'.padEnd(10) + TM_LAYOUTS.map((l) => l.padEnd(11)).join(''))
  for (const tm of TM_ALL) {
    const cells = TM_LAYOUTS.map((l) => {
      const r = tmRows.find((x) => x.layout === l && x.tm === tm)
      if (!r) return '-'.padEnd(11)
      const ok = r.k >= 4.5 && r.overflowX <= 1
      return ((ok ? '✓' : '✗') + ' ' + r.k.toFixed(1) + '/' + r.overflowX).padEnd(11)
    })
    console.log('  ' + tm.padEnd(10) + cells.join(''))
  }
  const tmBad = tmRows.filter((r) => r.k < 4.5 || r.overflowX > 1)
  console.log('   ' + (tmBad.length ? '✗ 有问题的组合：' + tmBad.map((r) => `${r.layout}/${r.tm}(溢出${r.overflowX})`).join('、') : '✓ 7 种文字动效 × 4 种结构：对比达标、无溢出'))
}
console.log('\n  说明：ov=100 表示标题整个压在照片上（需要暗衬/描边保证可读）；ov=0 表示标题在纸色区（要墨色）')
