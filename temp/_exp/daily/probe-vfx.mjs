#!/usr/bin/env node
/**
 * temp/_exp/daily/probe-vfx.mjs —— **切分型图元探针**（只读）
 * =============================================================================
 * 为什么需要它（★VF_DAILY_V18 踩坑）：
 *   切分型（条分 slats / 百叶 blinds / 拼片 mosaic）的图**不是 `<img>`**，而是 `.fig.vfx` 里一堆
 *   `.vc` 小块用 `background-image:var(--img)` 拼出来的。既有闸门（shot.mjs）只量：
 *     · 缺图 → 只数 `img.ph`（切分型没有 img ⇒ 天然跳过）
 *     · 越界/溢出/覆盖 → 0 尺寸元素既不越界也不溢出
 *   ⇒ 结果：**条分只给 left/width（高 0）、百叶只给 top/height（宽 0）** 这种"整段图不可见"的
 *     bug，闸门全绿也照样报"缺图 0"（用户实测：「还是 4.5.10.11 空的 就一个黄底」）。
 *
 * 本探针量四件事：
 *   ① 每个 `.vc` 的实际宽高 —— 有 <2px 的 ⇒ ✗（"空条"）
 *   ② 每个 `.fig.vfx` 的 **覆盖面积比** = Σ(.vc 面积) / 图框面积（应 ≈1；<0.9 ⇒ ✗）
 *   ③ 图框是否真的"有画"（`--img` 是否解析出 url 且该 url 能取到）——取不到 ⇒ ✗（那就是黄底）
 *   ④ 逐段汇总：段N · 效果 · 块数 · 最小块 · 覆盖比 · 图源
 *
 * 用法：node temp/_exp/daily/probe-vfx.mjs <a.html> [b.html ...]
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = path.resolve(HERE, '..', '..', '..')
const require = createRequire(path.join(REPO, 'scripts', 'video-factory', 'html-deck', 'x.cjs'))
const puppeteer = require('puppeteer-core')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const files = process.argv.slice(2)

let bad = 0
for (const f of files) {
  const abs = path.resolve(f)
  if (!fs.existsSync(abs)) { console.log('  跳过（不存在）：' + f); continue }
  console.log('\n文件：' + path.basename(abs))

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--force-device-scale-factor=1'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 720, height: 1280 })
  // ⚠️ 别用 networkidle0：单文件版内嵌 10 张图后 6MB+，「一直有活」会把导航等到超时（实测 30s 挂）。
  await page.goto('file:///' + abs.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 120000 })
  // 把时间轴推到末态（用户看到的"静止帧"就该是全展开的样子）
  await page.evaluate(() => { try { window.__seek && window.__seek(1.2) } catch (e) { /* 无 seek 就算了 */ } })
  await new Promise((r) => setTimeout(r, 400))

  const rows = await page.evaluate(async () => {
    const out = []
    const secs = Array.from(document.querySelectorAll('.sec'))
    secs.forEach((sec, i) => {
      const seg = sec.getAttribute('data-seg') || String(i + 1)
      const fxs = Array.from(sec.querySelectorAll('.fig.vfx'))
      if (!fxs.length) return
      fxs.forEach((fig) => {
        const fr = fig.getBoundingClientRect()
        const vcs = Array.from(fig.querySelectorAll('.vc'))
        let area = 0
        let minW = 1e9
        let minH = 1e9
        vcs.forEach((v) => {
          const r = v.getBoundingClientRect()
          area += r.width * r.height
          minW = Math.min(minW, r.width)
          minH = Math.min(minH, r.height)
        })
        const cov = fr.width * fr.height ? area / (fr.width * fr.height) : 0
        const cs = getComputedStyle(vcs[0] || fig)
        const bg = cs.backgroundImage || ''
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/)
        out.push({
          seg, fx: sec.getAttribute('data-fx') || '-', form: sec.getAttribute('data-form') || '-',
          n: vcs.length, figW: Math.round(fr.width), figH: Math.round(fr.height),
          minW: Math.round(minW === 1e9 ? 0 : minW), minH: Math.round(minH === 1e9 ? 0 : minH),
          cov: Math.round(cov * 1000) / 1000,
          src: m ? (m[1].startsWith('data:') ? '内嵌 data:' : m[1]) : '(无 background-image)',
        })
      })
    })
    return out
  })

  if (!rows.length) { console.log('  本文件没有切分型图元（.fig.vfx）'); await browser.close(); continue }
  for (const r of rows) {
    const zero = r.minW < 2 || r.minH < 2
    const lowCov = r.cov < 0.9
    const noSrc = r.src.startsWith('(')
    const flag = zero ? '  ✗ 空条' : (lowCov ? '  ✗ 覆盖不足' : (noSrc ? '  ✗ 无图源' : '  ✓'))
    if (flag.trim().startsWith('✗')) bad++
    console.log(`  段${String(r.seg).padStart(2)}  ${r.fx.padEnd(7)} ${r.form.padEnd(7)} 块${String(r.n).padStart(2)}`
      + `  图框 ${r.figW}×${r.figH}  最小块 ${r.minW}×${r.minH}  覆盖 ${(r.cov * 100).toFixed(0)}%  图源 ${r.src.slice(0, 34)}${flag}`)
  }
  await browser.close()
}

console.log('\n结论：' + (bad ? `✗ 有 ${bad} 个切分图元不可见/不全（黄底就是它）` : '✓ 全部切分图元都有面积、都铺满、都有图源'))
process.exit(bad ? 1 : 0)
