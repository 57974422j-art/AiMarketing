#!/usr/bin/env node
/**
 * temp/_exp/daily/probe-accent.mjs —— **强调色面积探针**（用户 2026-10-13 点名要的"新造尺子"）
 * 为什么需要：现有判据全是"几何/字号/对比度"，**没有一条能量"配色克制度"**。
 *   「克制用色」是审美词，落地成数字就是：**强调色（--rule）占画面面积的比例**。
 * 做法（全部确定性，无新依赖）：
 *   ① puppeteer 打开页面（预览态：每段 100vh 竖向堆叠）→ 整页截图（缩到 0.25 倍，省内存）；
 *   ② ffmpeg 把 PNG 解成 raw RGB（有 ffmpeg 就不用引 PNG 解码库）；
 *   ③ 逐像素判"是不是强调色"：与 --rule 的 RGB 距离 <70 **且** 饱和（max-min>40）；
 *   ④ 按段切行（每段 1280×0.25=320 行）算每段占比 + 整页占比。
 * 判定：整页 ≤10%、单段 ≤18% 视为"克制"（阈值按本批样本拍的经验值，先给数再谈阈值）。
 * 跑法：node temp/_exp/daily/probe-accent.mjs <a.html> [...]
 */
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SCALE = 0.25
const PAGE_MAX = 10, SEG_MAX = 18

const hex2rgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim())
  if (!m) return [198, 57, 43]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const files = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--allow-file-access-from-files'] })
for (const src of files) {
  const page = await browser.newPage()
  await page.setViewport({ width: 720, height: 1280, deviceScaleFactor: SCALE })
  await page.goto('file:///' + path.resolve(REPO, src).replace(/\\/g, '/'), { waitUntil: 'load' })
  await page.addStyleTag({ content: '.kick,.stamp,.col,h2 span{opacity:1 !important;transform:none !important}' })
  await new Promise((r) => setTimeout(r, 500))
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--rule').trim())
  const png = await page.screenshot({ fullPage: true })
  await page.close()

  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: png, maxBuffer: 1 << 28 })
  const buf = raw.stdout
  const W = Math.round(720 * SCALE)
  const rows = buf.length / (W * 3)
  const segRows = Math.round(1280 * SCALE)
  const [ar, ag, ab] = hex2rgb(accent)

  let total = 0, hit = 0
  const per = []
  for (let y = 0; y < rows; y++) {
    let segHit = 0
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3
      const r = buf[i], g = buf[i + 1], b = buf[i + 2]
      const d = Math.abs(r - ar) + Math.abs(g - ag) + Math.abs(b - ab)
      const sat = Math.max(r, g, b) - Math.min(r, g, b)
      total++
      if (d < 70 && sat > 40) { hit++; segHit++ }
    }
    const seg = Math.floor(y / segRows)
    if (!per[seg]) per[seg] = { hit: 0, tot: 0 }
    per[seg].hit += segHit; per[seg].tot += W
  }
  const pct = (a, b) => (b ? (a / b) * 100 : 0)
  const bad = []
  per.forEach((v, i) => { const p = pct(v.hit, v.tot); if (p > SEG_MAX) bad.push('段' + (i + 1) + '=' + p.toFixed(1) + '%') })
  const pagePct = pct(hit, total)
  console.log('  ' + path.basename(src) + '  强调色 ' + accent
    + ' ｜ 整页 ' + pagePct.toFixed(1) + '%（限 ≤' + PAGE_MAX + '%）'
    + ' ｜ 段数 ' + per.length + ' ｜ 最花的三段：'
    + per.map((v, i) => ({ i: i + 1, p: pct(v.hit, v.tot) })).sort((a, b) => b.p - a.p).slice(0, 3).map((x) => '段' + x.i + '=' + x.p.toFixed(1) + '%').join(' ')
    + (pagePct > PAGE_MAX ? '  ⇒ ⚠️ 整页偏花' : '')
    + (bad.length ? '  ⇒ ⚠️ 单段超标：' + bad.join(' ') : ''))
}
await browser.close()
