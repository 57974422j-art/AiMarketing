#!/usr/bin/env node
/**
 * temp/_exp/daily/probe-cover.mjs —— **图槽覆盖率探针**（闸门测不到的那一类）
 * 病灶背景：日报引擎把"推近"从图框挪到框内的图上，用 `inset + scale` 抵消越界。
 *   一旦内缩与缩放**不同步**（比如内缩写死按 --mz、而缩放随时间收到 1），
 *   动画末尾图就只铺 93.5% ⇒ 四周露一圈边。越界/压图/字号闸门都**测不到**这个。
 * 本探针在 sp=0 / 0.5 / 1 三个时刻，量每个 `.fig` 的图片是否真的铺满图框。
 * 跑法：node temp/_exp/daily/probe-cover.mjs <a.html>
 * 判定：|1 - 覆盖比| ≤ 0.02 视为铺满（1% 抗舍入）。
 */
import path from 'node:path'
import { createRequire } from 'node:module'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const src = process.argv[2]
const url = 'file:///' + path.resolve(REPO, src).replace(/\\/g, '/')

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--allow-file-access-from-files'] })
const page = await browser.newPage()
await page.setViewport({ width: 720, height: 1280 })
await page.goto(url, { waitUntil: 'load' })
await new Promise((r) => setTimeout(r, 500))

let bad = 0, total = 0
for (const sp of [0, 0.5, 1]) {
  const r = await page.evaluate((sp) => {
    document.querySelectorAll('.sec').forEach((s) => s.style.setProperty('--sp', String(sp)))
    const out = []
    for (const fig of document.querySelectorAll('.fig')) {
      const img = fig.querySelector('img.ph')
      if (!img) continue                       // 没真图（onerror 摘掉了）⇒ 本就该是渐变底，跳过
      const a = fig.getBoundingClientRect(), b = img.getBoundingClientRect()
      out.push({ seg: fig.closest('.sec')?.dataset.seg || '?', cx: +((a.width / b.width).toFixed(3)), cy: +((a.height / b.height).toFixed(3)) })
    }
    return out
  }, sp)
  for (const x of r) {
    total++
    const ok = Math.abs(1 - x.cx) <= 0.02 && Math.abs(1 - x.cy) <= 0.02
    if (!ok) { bad++; console.log('  ✗ sp=' + sp + ' 段' + x.seg + ' 覆盖 x' + x.cx + ' y' + x.cy + '（图没铺满图框 ⇒ 会露边）') }
  }
  console.log('  sp=' + sp + '：量了 ' + r.length + ' 个图槽')
}
console.log(bad ? '  ⇒ 覆盖率探针：' + bad + '/' + total + ' 不达标' : '  ⇒ 覆盖率探针：全部铺满（' + total + ' 个采样点）')
await browser.close()
process.exit(bad ? 1 : 0)
