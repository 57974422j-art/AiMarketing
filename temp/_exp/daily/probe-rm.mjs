#!/usr/bin/env node
/**
 * temp/_exp/daily/probe-rm.mjs —— ★VF_DAILY_V24（prefers-reduced-motion）的**行为探针**。
 * 为什么不能只"看一眼截图就算过"：这条规则有三种坏法，肉眼都看不出来 ——
 *   ① 只声明了媒体查询、JS 循环照跑 ⇒ 用户设定"减少动态"页面**还在动**（等于没做）；
 *   ② 锁了末态但锁错（`--sp` 停在 0）⇒ 页面变成**一片空白**（比不动更糟）；
 *   ③ 中途切系统设置 ⇒ **双循环**（两个 rAF 同时写 --sp，画面抖/跳）。
 * 所以这里三组都量：A 减少动态（要"静止且末态"）· B 对照组（要"照旧在动"，证明没改坏默认）
 * · C 中途切换（要"跟随且只有一个循环"，用 --sp 序列的单调性判）。
 * 跑法：node temp/_exp/daily/probe-rm.mjs <产物.html>
 */
import path from 'node:path'
import { createRequire } from 'node:module'
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const file = process.argv[2]
if (!file) { console.log('用法：node temp/_exp/daily/probe-rm.mjs <产物.html>'); process.exit(2) }
const url = 'file:///' + path.resolve(file).replace(/\\/g, '/')

let pass = 0, fail = 0
const ok = (c, msg, extra) => { if (c) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ ' + msg + (extra ? '  → ' + extra : '')) } }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] })
const page = await browser.newPage()
await page.setViewport({ width: 720, height: 1280 })
const errs = []
page.on('pageerror', (e) => errs.push(String(e && e.message || e)))

/** 采样：每段的 --sp 内联值 + 文字不透明度 + 有没有横向溢出 */
const sample = () => page.evaluate(() => {
  const secs = Array.from(document.querySelectorAll('.sec'))
  const sp = secs.map((s) => Number(s.style.getPropertyValue('--sp') || 'NaN'))
  const vis = secs.map((s) => {
    const el = s.querySelector('h2 span') || s.querySelector('h2')
    return el ? Number(getComputedStyle(el).opacity) : 1
  })
  return {
    rm: document.documentElement.dataset.rm || '',
    sp, vis,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
})
const same = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9)
const allOne = (a) => a.every((x) => Math.abs(x - 1) < 1e-9)

console.log('\n=== A. 系统要求"减少动态" ⇒ 必须**: 静止 + 末态** ===')
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
await page.goto(url, { waitUntil: 'load', timeout: 120000 })
await new Promise((r) => setTimeout(r, 500))
const a1 = await sample()
await new Promise((r) => setTimeout(r, 900))
const a2 = await sample()
ok(a1.rm === '1', '标记了 data-rm="1"（页面自己知道在用"减少动态"）', 'data-rm="' + a1.rm + '"')
ok(allOne(a1.sp), '开头就锁在末态（--sp 全 = 1，不是 0 ⇒ 不会变空白）', JSON.stringify(a1.sp.slice(0, 6)))
ok(same(a1.sp, a2.sp), '过 0.9s 后 --sp 一点没变（真的静止，不是"慢慢动"）')
ok(a1.vis.every((x) => x >= 1), '所有段标题都可见（opacity=1）', JSON.stringify(a1.vis.filter((x) => x < 1)))
ok(a1.overflowX <= 1, '末态不产生横向溢出', '溢出 ' + a1.overflowX + 'px')
ok(errs.length === 0, 'JS 零报错', errs.slice(0, 2).join(' | '))
await page.screenshot({ path: path.join(REPO, 'temp', '_exp', 'shots', 'rm-on.png'), clip: { x: 0, y: 0, width: 720, height: 1280 } })

console.log('\n=== B. 对照组（不要求减少动态）⇒ 必须**照旧在动**（证明没把默认改坏）===')
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
await page.goto(url, { waitUntil: 'load', timeout: 120000 })
await new Promise((r) => setTimeout(r, 500))
const b1 = await sample()
await new Promise((r) => setTimeout(r, 700))
const b2 = await sample()
ok(b1.rm === '0' || b1.rm === '', 'data-rm 为 0/空（默认路径不锁）', 'data-rm="' + b1.rm + '"')
ok(!same(b1.sp, b2.sp), '0.7s 内 --sp 有变化（动效仍在跑）')
const moved = b1.sp.filter((x, i) => Math.abs(x - b2.sp[i]) > 1e-6).length
console.log('   （本帧动了 ' + moved + '/' + b1.sp.length + ' 段）')

console.log('\n=== C. 用户中途改系统设置 ⇒ 必须**跟随**且**只有一个循环** ===')
const c0 = await sample()
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
await new Promise((r) => setTimeout(r, 600))
const c1 = await sample()
await new Promise((r) => setTimeout(r, 900))
const c2 = await sample()
ok(c1.rm === '1', '切到"减少动态"后 data-rm 立刻变 1', 'data-rm="' + c1.rm + '"')
ok(allOne(c1.sp), '切过去后立即锁末态（--sp 全 1）', JSON.stringify(c1.sp.slice(0, 6)))
ok(same(c1.sp, c2.sp), '再等 0.9s 依旧静止（没有旧循环在背后继续写）')
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
await new Promise((r) => setTimeout(r, 600))
const c3 = await sample()
await new Promise((r) => setTimeout(r, 700))
const c4 = await sample()
ok(c3.rm === '0', '切回"不减少动态"⇒ data-rm 归 0')
ok(!same(c3.sp, c4.sp), '切回后动效**重新跑起来**（停循环不是"一次性停死"）')
ok(errs.length === 0, '全程 JS 零报错', errs.slice(0, 2).join(' | '))

await browser.close()
console.log(`\n  结果：通过 ${pass} · 失败 ${fail}（截图：temp/_exp/shots/rm-on.png）`)
process.exit(fail ? 1 : 0)
