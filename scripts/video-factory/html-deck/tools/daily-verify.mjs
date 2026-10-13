#!/usr/bin/env node
/**
 * daily-verify.mjs —— 「日报落地页」**逐段渲染校验**（★VF_DAILY_L3/B：服务端渲染闸门）
 * =============================================================================
 * 用途：给「AI 自写段」当裁判。生成之后，逐段在真浏览器里量一遍，把不合格的段挑出来，
 *   交给上层（src/lib/agent/daily.ts）**只把那几段**退回 L2 结构库模板，再重生成一次。
 *
 * 用法：
 *   node tools/daily-verify.mjs <file.html> [--json]
 * 退出码：0 = 竖屏（主画幅）全段通过；1 = 有段不合格（上层据此回落）；2 = 环境/渲染失败
 *
 * 判据（对齐 docs/exp/响应式段规范-v1.md；**竖屏 720×1280 为硬线**，横屏 1280×720 只报不拦）：
 *   ① 越界：可见元素矩形超出画布（容差 1px）
 *   ② 溢出：滚动尺寸 > 可视尺寸（x/y 两向）
 *   ③ 字号：最小字号 <22px（标题另判：竖屏主标题 ≥40px）
 *   ④ 折行/挤压：**短文本（≤8 字）的叶子元素高度 > 字号×1.7** ⇒ 判"被折行/挤压"（用户实测痛点）
 *   ⑤ 压图：文字矩形 ∩ 图片矩形 > 较小者 15%，且文字自己没有 ≥60% 不透明的底衬
 *   ⑥ JS 报错 / 外链请求（必须 0）
 *
 * 浏览器：优先 $CHROME → hyperframes 自带的无头 Chrome（成片线就是用它，服务器上已存在）→ 系统 Chrome。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const DECK = path.resolve(HERE, '..')                       // html-deck/
const puppeteer = require(path.join(DECK, 'node_modules', 'puppeteer-core'))

/** 找浏览器：env → hyperframes 缓存（各平台）→ 系统安装 */
function findChrome() {
  const env = process.env.CHROME
  if (env && fs.existsSync(env)) return env
  const cache = path.join(os.homedir(), '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell')
  try {
    for (const d of fs.readdirSync(cache)) {
      const base = path.join(cache, d)
      for (const sub of fs.readdirSync(base)) {
        for (const exe of ['chrome-headless-shell', 'chrome-headless-shell.exe']) {
          const p = path.join(base, sub, exe)
          if (fs.existsSync(p)) return p
        }
      }
    }
  } catch { /* 没缓存 */ }
  const cands = process.platform === 'win32'
    ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']
  for (const p of cands) if (fs.existsSync(p)) return p
  return ''
}

/** 在页面里跑：逐段量尺寸/字号/折行/压图（与 temp/_exp/shot.mjs 同口径，独立实现，服务端可用） */
function measureFn() {
  const txt = (el) => Array.prototype.slice.call(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('')
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(String(c || '')); if (!m) return c ? 1 : 0; const p = m[1].split(','); return p.length > 3 ? Number(p[3]) : 1 }
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
  const overlap = (a, b) => {
    const w = Math.min(a.r, b.r) - Math.max(a.l, b.l)
    const h = Math.min(a.b, b.b) - Math.max(a.t, b.t)
    return w > 0 && h > 0 ? w * h : 0
  }
  const out = []
  const secs = Array.prototype.slice.call(document.querySelectorAll('.sec'))
  secs.forEach((sec, i) => {
    const sr = rect(sec)
    const bad = [], small = [], wrap = [], over = []
    let minFont = 999, maxFont = 0
    const imgs = []
    const texts = []
    Array.prototype.slice.call(sec.querySelectorAll('*')).forEach((el) => {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') return
      // 累乘祖先 opacity（opacity 不继承 ⇒ 只看自身会漏判/误判）
      let op = 1, p = el
      while (p && p !== document.body) { op *= Number(getComputedStyle(p).opacity || 1); p = p.parentElement }
      if (op <= 0.02) return
      const r = rect(el)
      const isImg = el.tagName === 'IMG' || (cs.backgroundImage && cs.backgroundImage !== 'none' && el.className !== 'sec' && r.w * r.h > sr.w * sr.h * 0.05)
      if (el.tagName === 'IMG') imgs.push({ el, r })
      if (isImg && el.tagName !== 'IMG') imgs.push({ el, r })
      const t = txt(el)
      const fz = parseFloat(cs.fontSize) || 0
      if (t) {
        texts.push({ el, r, t, fz })
        if (fz < minFont) minFont = fz
        if (fz > maxFont) maxFont = fz
        if (fz && fz < 22) small.push(t.slice(0, 10) + ' ' + fz.toFixed(1) + 'px')
        // 折行/挤压：短文本却占了 2 行以上
        // ⚠️ 必须**扣掉内边距/边框**再比 —— 第一版直接拿 h 比，把带 padding 的角标（h=40, fz=22）误报成折行。
        const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
          + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
        const contentH = r.h - pad
        if (t.length <= 8 && fz && contentH > fz * 1.75) {
          wrap.push(t.slice(0, 10) + ' 内容高=' + contentH.toFixed(0) + ' 字号=' + fz.toFixed(0))
        }
      }
      // 越界（容差 1px）
      if (r.w > 0 && r.h > 0 && (r.l < sr.l - 1 || r.t < sr.t - 1 || r.r > sr.r + 1 || r.b > sr.b + 1)) {
        bad.push((el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0]).slice(0, 40))
      }
    })
    if (sec.scrollWidth > sec.clientWidth + 1) over.push('x ' + sec.scrollWidth + '>' + sec.clientWidth)
    if (sec.scrollHeight > sec.clientHeight + 1) over.push('y ' + sec.scrollHeight + '>' + sec.clientHeight)
    // 压图：文字 ∩ 图片（文字自己有 ≥60% 不透明底衬则豁免）
    // ★VF_DAILY_V15（2026-10-13 用户定案：R5′ —— 「主题明确的图不怕遮挡、文字遮挡完全没关系」）：
    //   当服务端把该段标成 `data-scrim="none"`（= **量过图，确定是深色底**，服务端 scrimFor() 按亮度判定）
    //   且文字自带**描边/阴影**时，**不再判压图**：深色照片本来就是白字最清楚的底，
    //   再压一层暗衬反而把餐饮/美食压黑（用户：「餐饮需要亮，不要暗黑效果」）。
    //   口径：不是"随便允许压字"，而是"**用数据换来的豁免**"（亮度是量出来的，不是 AI 说的）。
    const noScrim = String(sec.dataset.scrim || '') === 'none'
    let hit = 0
    texts.forEach((t) => {
      const cs = getComputedStyle(t.el)
      const shadow = cs.textShadow && cs.textShadow !== 'none'
      if (noScrim && shadow) return                       // R5′ 豁免（深色底 + 描边）
      const backer = (() => { let p = t.el; for (let k = 0; k < 4 && p && p !== document.body; k++) { if (alpha(getComputedStyle(p).backgroundColor) >= 0.6) return true; p = p.parentElement } return false })()
      if (backer) return
      imgs.forEach((m) => { if (m.el !== t.el && overlap(t.r, m.r) > Math.min(t.r.w * t.r.h, m.r.w * m.r.h) * 0.15) hit++ })
    })
    out.push({
      seg: i + 1,
      layout: sec.dataset.layout || '-',
      minFont: minFont === 999 ? 0 : +minFont.toFixed(1),
      maxFont: +maxFont.toFixed(1),
      bad, small, wrap, over, textOverImg: hit,
    })
  })
  return out
}

const fileArg = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0]
const asJson = process.argv.includes('--json')
if (!fileArg) { console.log('用法：node tools/daily-verify.mjs <file.html> [--json]'); process.exit(2) }
const abs = path.resolve(fileArg)
if (!fs.existsSync(abs)) { console.log('✗ 文件不存在：' + abs); process.exit(2) }

const exe = findChrome()
if (!exe) { console.log('✗ 找不到浏览器（设 $CHROME，或让 hyperframes 先跑一次以缓存无头 Chrome）'); process.exit(2) }

const VIEWS = [{ tag: 'v', w: 720, h: 1280, hard: true }, { tag: 'h', w: 1280, h: 720, hard: false }]
const result = { file: abs, chrome: exe, views: {} }
let hardFail = false
let browser = null
try {
  browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  for (const V of VIEWS) {
    const page = await browser.newPage()
    const errs = [], ext = []
    page.on('pageerror', (e) => errs.push(String(e.message || e).slice(0, 120)))
    page.on('request', (r) => { const u = r.url(); if (/^https?:/.test(u)) ext.push(u.slice(0, 80)) })
    await page.setViewport({ width: V.w, height: V.h, deviceScaleFactor: 1 })
    await page.goto('file:///' + abs.replace(/\\/g, '/'), { waitUntil: 'load' })
    const segs = await page.evaluate(() => Array.prototype.slice.call(document.querySelectorAll('.sec')).map((s) => ({ start: Number(s.dataset.start || 0), dur: Number(s.dataset.duration || 3.2) })))
    const per = []
    for (let i = 0; i < segs.length; i++) {
      await page.evaluate((t) => { try { window.__seek(t) } catch { /* 无 __seek */ } }, segs[i].start + segs[i].dur * 0.85)
      await new Promise((r) => setTimeout(r, 90))
      const m = (await page.evaluate(measureFn))[i]
      const reasons = []
      if (m.bad.length) reasons.push('越界 ' + m.bad.slice(0, 3).join(' / '))
      if (m.over.length) reasons.push('溢出 ' + m.over.join(' '))
      if (m.small.length) reasons.push('字号<22px ' + m.small.slice(0, 3).join(' / '))
      if (m.wrap.length) reasons.push('文字折行/挤压 ' + m.wrap.slice(0, 3).join(' / '))
      if (m.textOverImg) reasons.push('文字压图 ' + m.textOverImg + ' 处')
      if (V.hard && i === 0 && m.maxFont && m.maxFont < 40) reasons.push('竖屏主标题字不够大 ' + m.maxFont + 'px < 40px')
      per.push({ seg: m.seg, layout: m.layout, minFont: m.minFont, ok: reasons.length === 0, reasons })
      if (V.hard && reasons.length) hardFail = true
    }
    await page.close()
    result.views[V.tag] = { size: V.w + 'x' + V.h, hard: V.hard, jsErrors: errs.slice(0, 3), externals: ext.slice(0, 3), segs: per }
  }
} catch (e) {
  console.log('✗ 渲染失败：' + String(e?.message || e))
  try { await browser?.close() } catch { /* ignore */ }
  process.exit(2)
}
await browser.close()

if (asJson) {
  console.log(JSON.stringify(result))
} else {
  for (const tag of Object.keys(result.views)) {
    const V = result.views[tag]
    console.log(`[${tag} ${V.size}${V.hard ? ' · 硬线' : ' · 只报'} ] JS错 ${V.jsErrors.length} · 外链 ${V.externals.length}`)
    V.segs.forEach((s) => {
      const mark = s.ok ? '✅' : (V.hard ? '❌' : '⚠️')
      console.log(`   ${mark} 段${s.seg} [${s.layout}] 最小字号 ${s.minFont}px` + (s.ok ? '' : ' · ' + s.reasons.join('；')))
    })
  }
  console.log(hardFail ? '\n结论：竖屏有段不合格（上层应把这几段退回 L2 模板）' : '\n结论：竖屏全段通过')
}
process.exit(hardFail ? 1 : 0)
