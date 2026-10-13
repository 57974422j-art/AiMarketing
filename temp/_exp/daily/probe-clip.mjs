#!/usr/bin/env node
/**
 * temp/_exp/daily/probe-clip.mjs —— **文字被裁探针**（现有闸门测不到的一类）
 * 病灶来源：用户 2026-10-13 截图指出 gen_20261013_009.html 有一处明显错误 ——
 *   标题第二行被**切掉**（元素被父级 overflow:hidden 裁掉，或行盒比内容矮）。
 *   越界/溢出/折行/字号四个判据**都测不到**它（元素没出画布、文档没变高）。
 * 判据：text 元素的 scrollHeight > clientHeight + 2（或 scrollWidth > clientWidth + 2）⇒ 判"被裁"。
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
const b2 = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--allow-file-access-from-files'] })
const p2 = await b2.newPage()
await p2.setViewport({ width: 720, height: 1280 })
await p2.goto('file:///' + path.resolve(REPO, src).replace(/\\/g, '/'), { waitUntil: 'load' })
await new Promise((r) => setTimeout(r, 400))

let bad = 0
for (const sp of ['1', '0.5', '0']) {
  const rows = await p2.evaluate((sp) => {
    document.querySelectorAll('.sec').forEach((s) => s.style.setProperty('--sp', sp))
    const out = []
    const secs = Array.from(document.querySelectorAll('.sec'))
    for (const el of document.querySelectorAll('.sec *')) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      if (!el.textContent || !el.textContent.trim()) continue
      if (el.children.length > 0) continue                    // 只看叶子文本节点
      const dh = el.scrollHeight - el.clientHeight
      const dw = el.scrollWidth - el.clientWidth
      if (dh > 2 || dw > 2) {
        const sec = el.closest('.sec')
        out.push({
          seg: sec ? sec.dataset.seg : '?', layout: sec ? sec.dataset.layout : '?',
          cls: el.className || el.tagName, dh, dw, txt: String(el.textContent).trim().slice(0, 18),
          clip: (cs.overflow !== 'visible' ? 'self:' + cs.overflow : '') ||
            (function (n) { let o = 'parent'; n = n.parentElement; while (n && n.nodeType === 1) { if (getComputedStyle(n).overflow !== 'visible') return 'parent:' + getComputedStyle(n).overflow + '(' + (n.className || n.tagName) + ')'; n = n.parentElement } return o })(el),
        })
      }
    }
    return out
  }, sp)
  for (const r of rows) {
    bad++
    console.log('  ✗ sp=' + sp + ' 段' + r.seg + ' 结构' + r.layout + ' ' + r.cls + ' 被裁 ' + r.dh + '/' + r.dw + 'px ｜「' + r.txt + '」｜ ' + r.clip)
  }
  console.log('  sp=' + sp + '：检查完（' + rows.length + ' 处被裁）')
}
console.log(bad ? '  ⇒ 文字被裁探针：' + bad + ' 处' : '  ⇒ 文字被裁探针：0 处（干净）')
await b2.close()
process.exit(bad ? 1 : 0)
