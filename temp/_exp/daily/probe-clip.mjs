#!/usr/bin/env node
/**
 * temp/_exp/daily/probe-clip.mjs —— **文字被裁探针 v2**（越界/溢出/折行/字号四个判据都测不到的一类）
 * 病灶来源：用户 2026-10-13 截图指出 gen_20261013_009.html 有一处标题第二行被**切掉**。
 *
 * v1 判据（错）：`scrollHeight > clientHeight` —— 把"行高偏紧、行盒内溢 5~7px"也算成被裁
 *   ⇒ 全篇误报（14 段每段都在报）**当场就被我否掉了**。
 * v2 判据（对）：文字元素是否**伸出最近的裁剪祖先**（overflow != visible 的祖先）的框。
 *   这才是"被裁"的定义：元素画得出来，但被祖先裁掉了。
 * 跑法：node temp/_exp/daily/probe-clip.mjs <a.html>
 */
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

let bad = 0
for (const sp of ['1', '0.4']) {
  const rows = await page.evaluate((sp) => {
    document.querySelectorAll('.sec').forEach((s) => s.style.setProperty('--sp', sp))
    const out = []
    const clipAncestor = (el) => {
      let n = el.parentElement
      while (n && n.nodeType === 1) {
        const cs = getComputedStyle(n)
        if (cs.overflow !== 'visible' || cs.clipPath !== 'none') return n
        n = n.parentElement
      }
      return null
    }
    for (const el of document.querySelectorAll('.sec *')) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      if (!el.textContent || !el.textContent.trim() || el.children.length) continue
      const a = el.getBoundingClientRect()
      if (a.width < 2 || a.height < 2) continue
      const anc = clipAncestor(el)
      if (!anc) continue
      const b = anc.getBoundingClientRect()
      // 允许 1px 舍入；任一方向被切超过 1px ⇒ 判"被裁"
      const cutT = Math.round(b.top - a.top), cutB = Math.round(a.bottom - b.bottom)
      const cutL = Math.round(b.left - a.left), cutR = Math.round(a.right - b.right)
      if (cutT > 1 || cutB > 1 || cutL > 1 || cutR > 1) {
        const sec = el.closest('.sec')
        out.push({
          seg: sec?.dataset.seg || '?', layout: sec?.dataset.layout || '?', fx: sec?.dataset.fx || '?',
          cls: (el.className || el.tagName).toString().slice(0, 14), cutT, cutB, cutL, cutR,
          txt: String(el.textContent).trim().slice(0, 20), anc: (anc.className || anc.tagName).toString().slice(0, 14),
        })
      }
    }
    return out
  }, sp)
  for (const r of rows) {
    bad++
    console.log('  ✗ sp=' + sp + ' 段' + r.seg + ' 结构' + r.layout + ' 效果' + r.fx + ' ' + r.cls
      + ' 被「' + r.anc + '」裁 上' + r.cutT + '/下' + r.cutB + '/左' + r.cutL + '/右' + r.cutR + 'px ｜「' + r.txt + '」')
  }
  console.log('  sp=' + sp + '：检查完（' + rows.length + ' 处被裁）')
}
console.log(bad ? '  ⇒ 文字被裁探针：' + bad + ' 处' : '  ⇒ 文字被裁探针：0 处（干净）')
await browser.close()
process.exit(bad ? 1 : 0)
