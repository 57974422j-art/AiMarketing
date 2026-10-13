#!/usr/bin/env node
/** 一次性诊断：把每个图槽的 data-fx / 计算出的 --z / 实际宽高与变换打出来（排查覆盖率不达标） */
import path from 'node:path'
import { createRequire } from 'node:module'
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const src = process.argv[2]
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--allow-file-access-from-files'] })
const page = await browser.newPage()
await page.setViewport({ width: 720, height: 1280 })
await page.goto('file:///' + path.resolve(REPO, src).replace(/\\/g, '/'), { waitUntil: 'load' })
await new Promise((r) => setTimeout(r, 400))
const rows = await page.evaluate(() => {
  const out = []
  for (const sec of document.querySelectorAll('.sec')) {
    sec.style.setProperty('--sp', '0')
    const fig = sec.querySelector('.fig')
    const img = fig && fig.querySelector('img.ph')
    if (!img) continue
    const cs = getComputedStyle(img)
    out.push({
      seg: sec.dataset.seg, fx: sec.dataset.fx || '(无)', mz: getComputedStyle(sec).getPropertyValue('--mz').trim(),
      z: cs.getPropertyValue('--z').trim(),
      w: cs.width, tr: cs.transform, op: cs.objectPosition,
      figW: Math.round(fig.getBoundingClientRect().width), imgW: Math.round(img.getBoundingClientRect().width),
    })
  }
  return out
})
for (const r of rows) console.log('  段' + r.seg, 'fx=' + r.fx, 'mz=' + r.mz, 'z=' + r.z, 'w=' + r.w, 'objPos=' + r.op, 'fig=' + r.figW + ' img=' + r.imgW, 'tr=' + r.tr.slice(0, 40))
await browser.close()
