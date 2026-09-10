/** 只读诊断 v2：聚焦封面弹窗内部结构（找真正的上传入口） */
const { chromium } = require('playwright')

async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /creator\.douyin/.test(p.url())) || ctx.pages()[0]
  console.log('URL=' + page.url())
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    // 找可见弹窗
    const modals = Array.from(document.querySelectorAll('[class*="modal"], [role="dialog"]')).filter(vis)
    const out = { modalCount: modals.length, modals: [] }
    for (const m of modals.slice(0, 3)) {
      const info = { cls: String(m.className).slice(0, 80), items: [] }
      // 弹窗内所有元素（button/div/span/input/label），带 class + 文本 + role
      const els = Array.from(m.querySelectorAll('button, [role="button"], input, label, div, span, img, svg'))
      for (const e of els) {
        if (!vis(e)) continue
        const txt = (e.innerText || '').trim()
        const cls = String(e.className || '')
        const isUp = /upload|Upload|上传/.test(cls + txt)
        const clickable = e.tagName === 'BUTTON' || e.getAttribute('role') === 'button' || /upload|Upload/.test(cls)
        if (isUp || clickable || (txt && txt.length <= 10 && /上传|选择|点击|拖|保存|确定|完成|下一步/.test(txt))) {
          info.items.push({
            tag: e.tagName,
            cls: cls.slice(0, 60),
            role: e.getAttribute('role') || '',
            type: e.getAttribute('type') || '',
            accept: (e.getAttribute('accept') || '').slice(0, 30),
            text: txt.slice(0, 30),
          })
        }
      }
      info.items = info.items.slice(0, 40)
      out.modals.push(info)
    }
    // 全页含"上传"的可见元素
    out.uploadEls = Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => {
      const t = (e.innerText || '').trim()
      return t && t.length <= 15 && /上传/.test(t)
    }).map((e) => ({ tag: e.tagName, cls: String(e.className || '').slice(0, 60), text: (e.innerText || '').trim().slice(0, 30) })).slice(0, 15)
    return out
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
