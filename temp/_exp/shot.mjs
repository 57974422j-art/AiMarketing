#!/usr/bin/env node
/**
 * temp/_exp/shot.mjs —— 实验件「多画幅审核」工具 v3.0（只读，不改任何产品代码）
 * =============================================================================
 * 用法：node temp/_exp/shot.mjs <a.html> [b.html ...] [--out temp/_exp/shots]
 *
 * 三档画布（★v3.0 新增第 3 档：**窄窗**，用户实测"窗口被拖窄 ⇒ 短标签折行"就是这么来的）
 *   v 720×1280（竖）· h 1280×720（横）· n 520×1000（窄窗，只判"不折行/不溢出/不越界"）
 *
 * 判定项
 *   ① 溢出 / 越界元素 / JS 报错 / 外链请求（须 0）  ② 缺图（<img> 未加载）
 *   ③ 字号：最小 ≥22、注脚 ≥18、竖屏最大（主标题）≥40
 *   ④ ★R14 折行：**短文本（≤8 字）**的叶子元素若高度 > 字号×1.7 ⇒ 判为折行（"先涮后蘸"事故）
 *   ⑤ R4 密度：底部条带内容覆盖率（横屏 y>60%、竖屏 y>80%，下限 20%）
 *   ⑥ R5 文字压图：文字矩形 ∩ 图片矩形 > 较小矩形 15%（命中串带双方坐标，便于判"真压图还是框重叠"）
 *        · 图片候选 = 媒体元素 / 真图片 url() / 非整页图块；按**直接文本节点**排除自带上字的元素
 *        · 可见性按**累乘祖先 opacity**（`opacity` 不继承 ⇒ 只看自身会把父级隐藏的段算进来）
 *   ⑦ R11 预览可全见：可见段数 == 段总数
 *   ⑧ R12 出片动效：t=0.2 与 t=2.0 两帧对比 ≥5 元素动 且 ≥1 处**文字位移**
 *   ⑨ R13 预览动效：不调 __seek，隔 700ms 两帧对比 ≥3 元素在动（"打开是死的"=用户实测痛点）
 *
 * 依赖：puppeteer-core + 本机 Chrome（CHROME 环境变量可覆盖）
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const CANVAS = [[720, 1280, 'v'], [1280, 720, 'h'], [520, 1000, 'n']]
const COVER_MIN = 20
const BAND = { h: 0.6, v: 0.8, n: 0.8 }
const TITLE_MIN_V = 40

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const OUT = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, 'temp', '_exp', 'shots')
const files = outIdx >= 0 ? args.filter((a, i) => i !== outIdx && i !== outIdx + 1) : args.slice()

fs.mkdirSync(OUT, { recursive: true })

const probe = (BAND, COVER_MIN) => {
  const W = window.innerWidth, H = window.innerHeight
  const alphaOf = (css) => {
    const m = /rgba?\(([^)]+)\)/.exec(css || '')
    if (!m) return 0
    const p = m[1].split(',').map((s) => parseFloat(s))
    const a = p.length > 3 ? p[3] : 1
    return (p[0] + p[1] + p[2]) > 0 ? a : 0
  }
  // ★累乘祖先 opacity（`opacity` 不继承 ⇒ 只看自身会把"父级隐藏"的元素当可见）
  const effOpacity = (el) => {
    let o = 1, n = el
    while (n && n.nodeType === 1) { o *= parseFloat(getComputedStyle(n).opacity) || 0; n = n.parentElement }
    return o
  }
  const vis = (el) => {
    const cs = getComputedStyle(el)
    return !(cs.display === 'none' || cs.visibility === 'hidden') && effOpacity(el) > 0.05
  }
  const label = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/)[0] : '')

  const bad = [], small = [], imgs = [], texts = [], wrapped = []
  let minFont = 999, maxFont = 0

  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const cs = getComputedStyle(el)
    const bgi = cs.backgroundImage || 'none'
    const isUrlImg = /url\(/.test(bgi)
    const fullWrap = r.height > H * 0.85 && r.width > W * 0.85
    const ownDirectText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0)
    const isMedia = !ownDirectText && (/^(IMG|CANVAS|VIDEO|PICTURE|SVG)$/.test(el.tagName) || isUrlImg || (bgi !== 'none' && !fullWrap))

    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) {
      bad.push(label(el) + ' [' + [r.left, r.top, r.right, r.bottom].map((n) => Math.round(n)).join(',') + ']')
    }
    if (isMedia) imgs.push({ l: label(el), r })

    const txt = (el.textContent || '').trim()
    if (txt && el.children.length === 0) {
      const f = parseFloat(cs.fontSize) || 0
      if (f > 0 && f < minFont) minFont = f
      if (f > maxFont) maxFont = f
      if (f > 0 && f < 22) small.push(Math.round(f) + 'px: ' + txt.slice(0, 14))
      // ★R14 折行：短文本（≤8 字）却占了 1.6 个"行盒+内边距"以上 ⇒ 折行/裁切
      //   ⚠️ 自检：第一版用 `font-size×1.7` 判 ⇒ 把**带内边距的印章**（22px 字 + 8px padding = 41px）误报成折行。
      //   现口径：期望高度 = 行高 + 上下内边距（lineHeight 为 normal 时按 1.4×字号兜底）。
      const lh = parseFloat(cs.lineHeight) || f * 1.4
      const oneLine = lh + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
      if (f > 0 && txt.length <= 8 && r.height > oneLine * 1.6) {
        wrapped.push('"' + txt.slice(0, 10) + '" ' + Math.round(r.height) + 'px / 一行≈' + Math.round(oneLine) + 'px')
      }
      let backed = false, n = el
      for (let i = 0; i < 4 && n; i++, n = n.parentElement) {
        if (alphaOf(getComputedStyle(n).backgroundColor) >= 0.6) { backed = true; break }
      }
      if (!backed) texts.push({ l: label(el), t: txt.slice(0, 12), r })
    }
  }

  const broken = []
  for (const im of document.querySelectorAll('img')) {
    if (im.complete && im.naturalWidth === 0) broken.push(String(im.getAttribute('src') || '').slice(0, 40))
  }

  const frac = W > H ? BAND.h : BAND.v
  const y0 = H * frac
  const inBand = [], counted = []
  let cover = 0
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    const cs = getComputedStyle(el)
    const bgi = cs.backgroundImage || 'none'
    const isUrlImg = /url\(/.test(bgi)
    const fullWrap = r.height > H * 0.85 && r.width > W * 0.85
    if (fullWrap && !isUrlImg) continue
    const hasText = (el.textContent || '').trim().length > 0 && el.children.length === 0
    const isMedia = isUrlImg || /^(IMG|CANVAS|VIDEO|PICTURE|SVG)$/.test(el.tagName) || (bgi !== 'none' && !fullWrap)
    if (!hasText && !isMedia) continue
    if (r.bottom <= y0 || r.top >= H) continue
    if (counted.some((c) => r.left >= c.left - 1 && r.top >= c.top - 1 && r.right <= c.right + 1 && r.bottom <= c.bottom + 1)) continue
    counted.push(r)
    const top = Math.max(r.top, y0), bottom = Math.min(r.bottom, H)
    const left = Math.max(r.left, 0), right = Math.min(r.right, W)
    cover += Math.max(0, right - left) * Math.max(0, bottom - top)
    inBand.push(label(el) + '@' + Math.round(r.top))
  }
  const coverPct = Math.round(100 * cover / (W * (H - y0)))

  const hits = []
  for (const t of texts) for (const im of imgs) {
    const a = t.r, b = im.r
    const ow = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const oh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    if (ow <= 0 || oh <= 0) continue
    const minArea = Math.min(a.width * a.height, b.width * b.height)
    const R = (x) => '[' + [x.left, x.top, x.right, x.bottom].map((n) => Math.round(n)).join(',') + ']'
    if ((ow * oh) / (minArea || 1) > 0.15) hits.push(t.l + '"' + t.t + '"' + R(a) + ' ∩ ' + im.l + R(b))
  }

  return {
    W, H, overX: document.documentElement.scrollWidth - W, overY: document.documentElement.scrollHeight - H,
    badCount: bad.length, bad: bad.slice(0, 5),
    minFont: minFont === 999 ? null : minFont, maxFont, smallCount: small.length, small: small.slice(0, 4),
    wrappedCount: wrapped.length, wrapped: wrapped.slice(0, 5),
    brokenCount: broken.length, broken: broken.slice(0, 5),
    bandLabel: (W > H ? '横屏下40%' : '竖屏下20%'), bandFrom: Math.round(y0),
    bandCount: inBand.length, band: inBand.slice(0, 4), coverPct, coverMin: COVER_MIN,
    textOverImg: hits.length, hits: hits.slice(0, 5),
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files', '--font-render-hinting=none'],
})

let hard = 0, soft = 0
for (const f of files) {
  const abs = path.resolve(f)
  if (!fs.existsSync(abs)) { console.log('  ✗ 文件不存在: ' + abs); hard++; continue }
  const base = path.basename(abs, path.extname(abs))
  console.log('\n=== ' + path.relative(REPO, abs) + ' ===')
  for (const [W, H, tag] of CANVAS) {
    const narrow = tag === 'n'
    const page = await browser.newPage()
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
    const ext = []
    page.on('request', (r) => { const u = r.url(); if (!/^(file|data|blob):/.test(u)) ext.push(u) })
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 80)))
    await page.goto('file:///' + abs.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 500))

    // R13 预览动效（不调 __seek）：打开文件时就在动？
    const previewAnim = await page.evaluate(async () => {
      const snap = () => {
        const map = {}; let i = 0
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el)
          if (cs.display === 'none' || cs.visibility === 'hidden') continue
          const r = el.getBoundingClientRect()
          if (r.width < 2 || r.height < 2) continue
          const isText = (el.textContent || '').trim().length > 0 && el.children.length === 0
          map['k' + (i++)] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',') + '|' + (isText ? 1 : 0)
        }
        return map
      }
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const a = snap(); await sleep(700); const b = snap()
      let moved = 0, text = 0, total = 0
      for (const k of Object.keys(a)) {
        total++
        if (!b[k]) { moved++; continue }
        const va = a[k].split('|')[0].split(','), vb = b[k].split('|')[0].split(',')
        let diff = false
        for (let j = 0; j < 4; j++) if (Math.abs(Number(va[j]) - Number(vb[j])) > 2) { diff = true; break }
        if (diff) { moved++; if (a[k].split('|')[1] === '1') text++ }
      }
      return { moved, text, total }
    })

    // R11 预览可全见
    const prev = await page.evaluate(() => {
      const secs = Array.from(document.querySelectorAll('section, .sec, [data-seg]'))
      const vis = secs.filter((s) => {
        const cs = getComputedStyle(s), r = s.getBoundingClientRect()
        return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05 && r.height > 20
      })
      return { total: secs.length, vis: vis.length }
    })
    await page.screenshot({ path: path.join(OUT, base + '-' + tag + '-preview.png') })

    // 出片态那一帧
    try { await page.evaluate(() => (typeof window.__seek === 'function' ? window.__seek(1.2) : null)) } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300))
    const m = await page.evaluate(probe, BAND, COVER_MIN)
    await page.screenshot({ path: path.join(OUT, base + '-' + tag + '.png') })

    // R12 出片动效
    const anim = await page.evaluate(async () => {
      if (typeof window.__seek !== 'function') return { ok: false, moved: 0, textRect: 0, textFade: 0, total: 0 }
      const eff = (el) => {
        let o = 1, n = el
        while (n && n.nodeType === 1) { o *= parseFloat(getComputedStyle(n).opacity) || 0; n = n.parentElement }
        return o
      }
      const snap = () => {
        const map = {}; let i = 0
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el)
          if (cs.display === 'none' || cs.visibility === 'hidden') continue
          const r = el.getBoundingClientRect()
          if (r.width < 2 || r.height < 2) continue
          const isText = (el.textContent || '').trim().length > 0 && el.children.length === 0
          map['k' + (i++)] = JSON.stringify({
            r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
            o: Math.round(eff(el) * 100), t: isText ? 1 : 0,
            // ★V25（判据补盲）：把"**不改矩形**的运动"也记下来 —— 遮罩擦显(wipe/curtain)、
            //   失焦(blur) 全程矩形不动，只看矩形会把它们误报成"文字仅淡入"（我这次就被这个误报惊到了）。
            c: (cs.clipPath && cs.clipPath !== 'none' ? cs.clipPath : '') + '|'
              + (cs.filter && cs.filter !== 'none' ? cs.filter : ''),
          })
        }
        return map
      }
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      window.__seek(0.2); await sleep(180)
      const a = snap()
      window.__seek(2.0); await sleep(180)
      const b = snap()
      let moved = 0, textRect = 0, textFade = 0, total = 0
      for (const k of Object.keys(a)) {
        total++
        const va = JSON.parse(a[k])
        if (!b[k]) { moved++; continue }
        const vb = JSON.parse(b[k])
        let rectMove = false
        for (let j = 0; j < 4; j++) if (Math.abs(va.r[j] - vb.r[j]) > 2) { rectMove = true; break }
        const fade = Math.abs(va.o - vb.o) > 8
        const chgC = (va.c || '') !== (vb.c || '')          // ★V25：遮罩/失焦也算"动了"
        if (rectMove || fade || chgC) moved++
        if (va.t === 1 && (rectMove || chgC)) textRect++
        else if (va.t === 1 && fade) textFade++
      }
      return { ok: true, moved, textRect, textFade, total }
    })

    const isV = W < H && !narrow
    const titleBad = isV && m.maxFont < TITLE_MIN_V
    const prevBad = !narrow && prev.total > 1 && prev.vis < prev.total
    const animBad = !narrow && (!anim.ok || anim.moved < 5 || anim.textRect < 1)
    const pvBad = !narrow && previewAnim.moved < 3
    const wrapBad = m.wrappedCount > 0
    const hardOk = m.overX <= 1 && m.overY <= 1 && m.badCount === 0 && ext.length === 0 && errs.length === 0 && m.brokenCount === 0
    const softOk = narrow
      ? !wrapBad
      : (m.coverPct >= m.coverMin && m.textOverImg === 0 && !titleBad && !prevBad && !animBad && !pvBad && !wrapBad)
    if (!hardOk) hard++
    if (!softOk) soft++
    console.log('  [' + tag + ' ' + W + '×' + H + (narrow ? ' 窄窗' : '') + '] ' + (hardOk ? '结构✅' : '结构⚠️') + ' / ' + (softOk ? '观感✅' : '观感⚠️')
      + ' · 溢出 x' + m.overX + '/y' + m.overY + ' · 越界 ' + m.badCount + ' · 缺图 ' + m.brokenCount
      + ' · 字号 ' + (m.minFont === null ? '-' : m.minFont) + '~' + m.maxFont + 'px(' + m.smallCount + '处<22px'
      + (titleBad ? '，主标题<40px' : '') + ')'
      + ' · 外链 ' + ext.length + ' · JS错 ' + errs.length)
    console.log('      R14/折行 · ' + m.wrappedCount + ' 处' + (wrapBad ? '  ⚠️ ' + m.wrapped.join(' | ') : '  ✅'))
    if (narrow) {
      console.log('      （窄窗只判"不折行/不溢出/不越界"；覆盖率/主标题/动效在另两档判）')
    } else {
      console.log('      R11/预览 · 段数 ' + (prev.total || '—') + '，打开可见 ' + prev.vis
        + (prevBad ? '  ⇒ ⚠️ 打开看不全' : (prev.total > 1 ? '  ✅' : '')))
      console.log('      R13/预览动效 · 打开时在动 ' + previewAnim.moved + '/' + previewAnim.total + ' 个元素（文字 ' + previewAnim.text + '）'
        + (pvBad ? '  ⇒ ⚠️ 打开是死的' : '  ✅'))
      console.log('      R12/出片动效 · ' + (anim.ok
        ? '动了 ' + anim.moved + '/' + anim.total + ' · 文字位移 ' + anim.textRect + ' · 文字仅淡入 ' + anim.textFade
          + (animBad ? '  ⇒ ⚠️ 不足' : '  ✅')
        : '无 __seek ⇒ ⚠️ 无时间轴动效'))
      console.log('      R4 · ' + m.bandLabel + '(y>' + m.bandFrom + ') 内容 ' + m.bandCount + ' 个 · 覆盖 ' + m.coverPct + '%（下限 ' + m.coverMin + '%）'
        + (m.coverPct < m.coverMin ? ' ⇒ ⚠️ 偏空' : ''))
      console.log('      R5 · 文字压图 ' + m.textOverImg + ' 处' + (m.textOverImg ? '  ' + m.hits.join(' | ') : ''))
      if (m.badCount) console.log('      越界: ' + m.bad.join(' | '))
      if (m.small.length) console.log('      小字: ' + m.small.join(' | '))
      if (ext.length) console.log('      外链: ' + ext.slice(0, 3).join(' | '))
      if (errs.length) console.log('      JS错: ' + errs.slice(0, 2).join(' | '))
    }
    console.log('      截图: ' + path.relative(REPO, path.join(OUT, base + '-' + tag + '.png')))
    await page.close()
  }
}
await browser.close()
console.log('\n结构闸门：' + (hard === 0 ? '全部通过' : hard + ' 处不通过') + ' · 观感闸门：' + (soft === 0 ? '全部通过' : soft + ' 处要看')
  + ' · 截图目录 ' + path.relative(REPO, OUT))
process.exit(0)
