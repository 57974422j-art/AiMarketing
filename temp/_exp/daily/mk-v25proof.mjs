#!/usr/bin/env node
/**
 * temp/_exp/daily/mk-v25proof.mjs —— V25 的**肉眼证明**（去同质化不是嘴上说的）：
 *   ① 同一条内容、同一条皮肤，只换**字体配对** ⇒ 三张并排（文字这条轴）
 *   ② 同一条内容、同一条皮肤，只换**文字动效** ⇒ 四张并排（文字动效这条轴）
 * ②用 `__seek` 钉在同一时刻（入场进行中）⇒ 四张图里的文字**位置/形态确实不同**，不是"我看不出来"。
 * 跑法：node temp/_exp/daily/mk-v25proof.mjs
 * 产物：temp/_exp/shots/v25-fonts.png · v25-tm.png
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
const FF = process.env.FFMPEG || 'C:/Users/Admin/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe'
const ENGINE = path.join(REPO, 'scripts/video-factory/html-deck/tools/daily-page.mjs')
const TMP = path.join(REPO, 'temp/_exp/daily/out/proof')
const SHOTS = path.join(REPO, 'temp/_exp/shots')
fs.mkdirSync(TMP, { recursive: true })
fs.mkdirSync(SHOTS, { recursive: true })

const base = JSON.parse(fs.readFileSync(path.join(REPO, 'temp/_exp/daily/plan-demo.json'), 'utf8'))
const gen = (plan, tag) => {
  const pf = path.join(TMP, tag + '.json')
  fs.writeFileSync(pf, JSON.stringify(plan), 'utf8')
  const out = path.join(TMP, tag + '.html')
  execFileSync(process.execPath, [ENGINE, pf, '--out', out], { cwd: REPO, encoding: 'utf8' })
  return out
}
// ① 字体：同一条（换成单段 split，标题最醒目），只改 meta.font
const one = { ...base, segments: [base.segments[1]] }          // 段2 = split（大字标题）
delete one.imageNames
const FONTS = ['song-hei', 'kai-song', 'hei-hei']
const fontFiles = FONTS.map((f) => {
  const p = JSON.parse(JSON.stringify(one))
  p.meta = { ...p.meta, font: f }
  return { f, out: gen(p, 'font-' + f) }
})
// ② 文字动效：同一个单段 hero，只改 tm
const TMS = ['rise', 'push', 'wipe', 'blur']
const tmFiles = TMS.map((tm) => {
  const p = JSON.parse(JSON.stringify(one))
  p.segments = [{ ...p.segments[0], layout: 'hero', form: 'overlay', tm }]
  return { tm, out: gen(p, 'tm-' + tm) }
})

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] })
const page = await browser.newPage()
await page.setViewport({ width: 720, height: 1280, deviceScaleFactor: 0.5 })
const shootAt = async (file, png, t) => {
  await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 120000 })
  await page.evaluate((tt) => { if (tt !== null) window.__seek(tt) }, t)
  await new Promise((r) => setTimeout(r, t === null ? 500 : 120))
  await page.screenshot({ path: png })
}
// 字体：看**末态**（字体差异在静态下最清楚）
for (const x of fontFiles) await shootAt(x.out, path.join(SHOTS, 'v25-font-' + x.f + '.png'), null)
// 动效：钉在"入场进行到 ~45%"的同一时刻（字体差异不参与，只看动作形态）
for (const x of tmFiles) await shootAt(x.out, path.join(SHOTS, 'v25-tm-' + x.tm + '.png'), 0.42)
await browser.close()

const stack = (list, out, w) => {
  const args = []
  list.forEach((p) => args.push('-i', p))
  const fc = list.map((_, i) => `[${i}:v]scale=${w}:-1[v${i}]`).join(';') + ';' + list.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${list.length}`
  execFileSync(FF, ['-y', '-loglevel', 'error', ...args, '-filter_complex', fc, out])
}
stack(FONTS.map((f) => path.join(SHOTS, 'v25-font-' + f + '.png')), path.join(SHOTS, 'v25-fonts.png'), 300)
stack(TMS.map((t) => path.join(SHOTS, 'v25-tm-' + t + '.png')), path.join(SHOTS, 'v25-tm.png'), 300)
console.log('  字体对比（左→右：' + FONTS.join(' / ') + '）→ temp/_exp/shots/v25-fonts.png')
console.log('  文字动效对比（左→右：' + TMS.join(' / ') + '，同一时刻 t=0.42s）→ temp/_exp/shots/v25-tm.png')
