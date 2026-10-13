#!/usr/bin/env node
/**
 * temp/_exp/daily/shot-all.mjs —— 把日报页**一次拍全**（预览模式每段 100vh 竖向堆叠 ⇒ fullPage 一张到底）
 * 用途：肉眼复核「文字层随结构」到底是不是真的不一样（闸门只保证"不崩"，保证不了"看着不同"）。
 * 跑法：node temp/_exp/daily/shot-all.mjs <a.html> [out.png]
 * 依赖：与 temp/_exp/shot.mjs 同一个 puppeteer-core + 本机 Chrome（不改任何产品代码）
 */
import path from 'node:path'
import { createRequire } from 'node:module'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const src = process.argv[2]
const out = process.argv[3] || path.join(REPO, 'temp', '_exp', 'shots', 'all-segs.png')
const url = 'file:///' + path.resolve(REPO, src).replace(/\\/g, '/')

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--allow-file-access-from-files'] })
const page = await browser.newPage()
await page.setViewport({ width: 720, height: 1280, deviceScaleFactor: 0.5 })
await page.goto(url, { waitUntil: 'load' })
// 把"进场动效"钉死为已完成（--sp 由循环写，直接覆盖掉依赖它的透明度/位移 ⇒ 段段都看得见）
await page.addStyleTag({ content: '.kick,.stamp,.col,h2 span{opacity:1 !important;transform:none !important} .sec::after{opacity:1 !important}' })
await new Promise((r) => setTimeout(r, 600))
// 可选：只拍连续几段（--from N --count M）—— 全页缩太小看不清字的差别
const fromI = process.argv.indexOf('--from'), cntI = process.argv.indexOf('--count')
const from = fromI >= 0 ? Math.max(1, parseInt(process.argv[fromI + 1], 10) || 1) : 1
const cnt = cntI >= 0 ? Math.max(1, parseInt(process.argv[cntI + 1], 10) || 1) : 0
if (cnt) {
  const secH = await page.evaluate(() => document.querySelector('.sec')?.getBoundingClientRect().height || 1280)
  await page.screenshot({ path: out, clip: { x: 0, y: (from - 1) * secH, width: 720, height: cnt * secH } })
} else {
  await page.screenshot({ path: out, fullPage: true })
}
const n = await page.evaluate(() => document.querySelectorAll('.sec').length)
console.log('  段数 =', n, '｜ 截图 =', path.relative(REPO, out))
await browser.close()
