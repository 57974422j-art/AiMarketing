#!/usr/bin/env node
/**
 * temp/_exp/daily/probe-wipe.mjs —— 专量**擦显 wipe**（★VF_DAILY_V19 新增的安静效果）。
 *   量三件事（缺一件就是"看着像没图"或"永远擦不干净"）：
 *     ① 中段：`clip-path` 的 inset 必须**在 0 与 100 之间**（说明真有一条边在扫）；
 *     ② 末态：inset 必须回到 **0**（全展开 —— 否则最后定格还是半张图）；
 *     ③ 图位**确实有图**（`.ph` 尺寸 > 0 且没被裁没）。
 *
 * ⚠️ 踩过的坑（本文件第一版就错在这）：**一次只能 seek 一个时刻**。
 *   把"一串时间"喂给 `__seek(t)` 会算出 NaN 的进度，量出来的 inset 全是垃圾值
 *   （第一次跑出"末态 100% / 中段 0%"这种自相矛盾的结果，就是它）。
 *
 * 用法：node temp/_exp/daily/probe-wipe.mjs <产物.html>
 * 前置：图要与 HTML **同目录**（A′ 的形态）—— 否则 `<img onerror>` 会自己摘掉，自然量不到。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const file = process.argv[2]
if (!file) { console.log('用法：node temp/_exp/daily/probe-wipe.mjs <产物.html>'); process.exit(2) }

/** `inset(a b c d)` → [top, right, bottom, left]（按 CSS 的 1/2/3/4 值补全规则），单位统一取数字 */
function insetOf(clip) {
  const m = /inset\(([^)]*)\)/.exec(String(clip || ''))
  if (!m) return null
  const n = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }
  const p = m[1].trim().split(/\s+/).filter(Boolean).map(n)
  if (!p.length) return null
  if (p.length === 1) return [p[0], p[0], p[0], p[0]]
  if (p.length === 2) return [p[0], p[1], p[0], p[1]]
  if (p.length === 3) return [p[0], p[1], p[2], p[1]]
  return [p[0], p[1], p[2], p[3]]
}
const sum = (a) => (a ? a.reduce((x, y) => x + y, 0) : 0)

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files', '--force-device-scale-factor=1'] })
const page = await browser.newPage()
await page.setViewport({ width: 720, height: 1280 })
await page.goto('file:///' + path.resolve(file).replace(/\\/g, '/'), { waitUntil: 'load', timeout: 120000 })
await new Promise((r) => setTimeout(r, 300))

const snap = (t) => page.evaluate((tt) => {
  try { window.__seek(tt) } catch { /* ignore */ }
  const out = []
  document.querySelectorAll('section.sec').forEach((sec) => {
    const ph = sec.querySelector('.fig .ph')
    if (!ph) return
    const r = ph.getBoundingClientRect()
    out.push({
      seg: Number(sec.getAttribute('data-seg') || 0),
      fx: sec.getAttribute('data-fx') || '-',
      fv: sec.getAttribute('data-fv') || '0',
      start: Number(sec.getAttribute('data-start') || 0),
      clip: getComputedStyle(ph).clipPath || '',
      w: Math.round(r.width), h: Math.round(r.height),
      natural: ph.naturalWidth || 0,
    })
  })
  return out
}, t)

const base = await snap(0)
const wipeSegs = base.filter((x) => x.fx === 'wipe')
if (!wipeSegs.length) {
  console.log('  （这份产物没有 wipe 段；现有效果：' + Array.from(new Set(base.map((x) => x.fx))).join(', ') + '）')
  await browser.close(); process.exit(0)
}

let bad = 0
for (const s of wipeSegs) {
  const mid = (await snap(s.start + 0.5)).find((x) => x.seg === s.seg) || {}
  const end = (await snap(s.start + 2.9)).find((x) => x.seg === s.seg) || {}
  const im = insetOf(mid.clip), ie = insetOf(end.clip)
  const sweeping = sum(im) > 4 && sum(im) < 396          // 中段：四条边合计既不是 0（全开）也不是满（全裁）
  const openAtEnd = sum(ie) < 4                          // 末态：全展开（四边都为 0）
  const hasImg = (s.natural > 0) && s.w > 4 && s.h > 4
  const pass = sweeping && openAtEnd && hasImg
  if (!pass) bad++
  console.log(`  段${String(s.seg).padStart(2)} wipe fv=${s.fv}  中段 inset[${(im || []).join(', ') || '无'}]`
    + `  末态 inset[${(ie || []).join(', ') || '无'}]  图 ${s.w}×${s.h}（固有 ${s.natural}px）  `
    + (pass ? '✓ 有边在扫 + 末态全展开 + 有图'
      : '✗ ' + [sweeping ? '' : '中段没在扫', openAtEnd ? '' : '末态没全展开', hasImg ? '' : '图位没图/没落地'].filter(Boolean).join(' / ')))
}
await browser.close()
console.log('\n  结论：' + (bad ? `✗ ${bad} 个 wipe 段不合格` : `✓ ${wipeSegs.length} 个 wipe 段全部合格`))
process.exit(bad ? 1 : 0)
