#!/usr/bin/env node
/**
 * temp/_exp/film.mjs —— 把「AI 设计的段页面」逐帧渲成 MP4（验证「设计 → 出片」闭环）
 * =============================================================================
 * 原理：页面必须实现 `window.__seek(t)`（t=秒）。本工具按 fps 逐帧调用它 → 截图 → ffmpeg 合成。
 *   · 与 shot.mjs 的分工：shot = 抽查几帧 + 各项闸门；film = **整段逐帧**出一个能看的片子。
 *   · 确定性：只依赖 __seek(t)，不用 rAF/时间；同一 t 永远同一帧（页面的 preview 循环会被 __seek 自动关掉）。
 *
 * 用法：
 *   node temp/_exp/film.mjs <file.html> [--w 720 --h 1280] [--fps 25 --dur 9.6]
 *        [--out temp/_exp/out/xxx.mp4] [--tag v] [--keepframes]
 * 默认：720×1280 / 25fps / 9.6s（3 段 × 3.2s）
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const FFMPEG = process.env.FFMPEG || 'C:/Users/Admin/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe'

const argv = process.argv.slice(2)
const val = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
const flag = (k) => argv.includes(k)
const file = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== undefined && !/^--/.test(argv[argv.indexOf(a) - 1]))
  || argv.filter((a) => a.endsWith('.html'))[0]

if (!file) { console.log('用法：node temp/_exp/film.mjs <file.html> [--w 720 --h 1280 --fps 25 --dur 9.6] [--out xxx.mp4] [--tag v]'); process.exit(1) }
const abs = path.resolve(file)
if (!fs.existsSync(abs)) { console.log('✗ 文件不存在: ' + abs); process.exit(1) }

const W = Number(val('--w', 720)), H = Number(val('--h', 1280))
const FPS = Number(val('--fps', 25)), DUR = Number(val('--dur', 9.6))
const TAG = val('--tag', W + 'x' + H)
const base = path.basename(abs, '.html') + '-' + TAG
const OUT = path.resolve(val('--out', path.join(REPO, 'temp', '_exp', 'out', base + '.mp4')))
const FRAMES = path.join(REPO, 'temp', '_exp', 'frames', base)
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.mkdirSync(FRAMES, { recursive: true })

const total = Math.round(FPS * DUR)
console.log('渲 ' + path.relative(REPO, abs) + ' → ' + W + '×' + H + ' @' + FPS + 'fps · ' + DUR + 's（' + total + ' 帧）')

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files', '--font-render-hinting=none', '--force-device-scale-factor=1'],
})
const page = await browser.newPage()
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
const errs = []
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 100)))
let ext = 0
page.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) ext++ })
await page.goto('file:///' + abs.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 30000 })
await new Promise((r) => setTimeout(r, 400))
const hasSeek = await page.evaluate(() => typeof window.__seek === 'function')
if (!hasSeek) { console.log('✗ 页面没有 window.__seek(t)，无法逐帧渲染'); await browser.close(); process.exit(2) }

const t0 = Date.now()
const MAXF = Number(val('--maxframes', 0))         // 0 = 不限；>0 = 本轮最多渲这么多帧（崩溃后能续）
const framePath = (i) => path.join(FRAMES, 'f' + String(i).padStart(5, '0') + '.png')
let done = 0, skipped = 0
for (let i = 0; i < total; i++) {
  // ★VF_RESUME_V1：已存在的帧**直接跳过** —— 长渲染被中断（本机扩展崩溃过两次）后能接着跑，不白费
  if (!flag('--force') && fs.existsSync(framePath(i))) { skipped++; continue }
  await page.evaluate((tt) => window.__seek(tt), i / FPS)
  await page.screenshot({ path: framePath(i) })
  done++
  if (i % 25 === 0) process.stdout.write('  ' + Math.round((i / total) * 100) + '%\r')
  if (MAXF && done >= MAXF) { console.log('  本轮渲到 --maxframes=' + MAXF + ' 停（再跑一次同命令会**续渲**）'); break }
}
await browser.close()
console.log('  本轮渲 ' + done + ' 帧 / 跳过已有 ' + skipped + ' 帧 · 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's（JS错 ' + errs.length + ' · 外链 ' + ext + '）')

const have = fs.existsSync(FRAMES) ? fs.readdirSync(FRAMES).filter((n) => /^f\d{5}\.png$/.test(n)).length : 0
if (have < total) {
  console.log('⚠️ 帧还差 ' + (total - have) + '/' + total + ' 帧 —— 再跑一次同命令续渲（帧保留在 ' + path.relative(REPO, FRAMES) + '）')
  process.exit(4)
}

const r = spawnSync(FFMPEG, [
  '-y', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%05d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-movflags', '+faststart',
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  OUT,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
if (r.status !== 0) { console.log('✗ ffmpeg 失败：\n' + String(r.stderr || '').split('\n').slice(-6).join('\n')); process.exit(3) }
if (!flag('--keepframes')) fs.rmSync(FRAMES, { recursive: true, force: true })
const sz = fs.statSync(OUT).size
console.log('✅ 出片：' + path.relative(REPO, OUT) + '（' + (sz / 1048576).toFixed(2) + 'MB）')
console.log('   （静音测试片；配音/字幕是下一层，不在本次范围）')
process.exit(0)
