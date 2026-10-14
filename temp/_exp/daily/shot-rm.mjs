#!/usr/bin/env node
/**
 * temp/_exp/daily/shot-rm.mjs —— 在"减少动态"模式（★V24）下拍全页：拿到的就是**末态**（每段都完成）。
 * 为什么单独一支：`shot-all.mjs` 只用 CSS 钉住文字（.kick/.stamp/.col/h2 span），**没有**钉 `--sp`
 * ⇒ 图效（百叶/条分/擦显/回拉）还停在半路，抓到的图不能当"版面验收"。RM 模式下游 JS 直接锁 --sp=1
 * ⇒ 拍到的是真正的"打开就该看到的样子"，也顺便证明 V24 这条改动是有用的。
 * 跑法：node temp/_exp/daily/shot-rm.mjs <产物.html> [out.png]
 */
import path from 'node:path'
import { createRequire } from 'node:module'
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const file = process.argv[2]
const out = process.argv[3] || path.join(REPO, 'temp/_exp/shots', 'rm-full.png')
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] })
const page = await browser.newPage()
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
await page.setViewport({ width: 720, height: 1280, deviceScaleFactor: 0.5 })
await page.goto('file:///' + path.resolve(file).replace(/\\/g, '/'), { waitUntil: 'load', timeout: 120000 })
await new Promise((r) => setTimeout(r, 600))
const n = await page.evaluate(() => document.querySelectorAll('.sec').length)
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log('  段数 ' + n + ' ⇒ ' + path.relative(REPO, out) + '（' + Math.round(360) + '×' + n * 640 + '）')
