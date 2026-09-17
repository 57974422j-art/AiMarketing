/** 诊断：弹窗内所有 upload 相关元素的上下文（找真正的"上传封面"入口） */
const { chromium } = require('playwright')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /creator\.douyin/.test(p.url())) || ctx.pages()[0]
  console.log('URL=' + page.url())

  // 没弹窗就先点入口开
  if ((await page.$$('.semi-upload-drag-area')).length === 0) {
    const ctrls = await page.$$('[class*="coverControl"]')
    for (const c of ctrls) {
      const t = String(await c.innerText().catch(() => '')).trim()
      if (t.indexOf('横封面') >= 0) { await c.click({ timeout: 3000 }).catch(() => {}); console.log('已点入口: ' + t); break }
    }
    await sleep(2500)
  }

  const r = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const out = {}
    // 所有 semi-upload 相关元素 + 上下文（往上找有文本的祖先）
    out.uploads = []
    for (const e of Array.from(document.querySelectorAll('[class*="semi-upload"], [class*="upload-"]'))) {
      if (!vis(e)) continue
      let ctxText = ''
      let p = e
      for (let i = 0; i < 6 && p; i++) {
        const t = (p.innerText || '').trim()
        if (t && t.length < 120) { ctxText = t; break }
        p = p.parentElement
      }
      out.uploads.push({ tag: e.tagName, cls: String(e.className).slice(0, 55), type: e.getAttribute('type') || '', accept: (e.getAttribute('accept') || '').slice(0, 40), ctx: ctxText.slice(0, 90) })
    }
    out.uploads = out.uploads.slice(0, 25)
    // "选择封面/上传封面"文本元素
    out.pickEls = Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => {
      const t = (e.innerText || '').trim()
      return t && t.length <= 10 && /^(选择封面|上传封面|点击上传.*|重新上传)$/.test(t)
    }).map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 55), text: (e.innerText || '').trim() })).slice(0, 20)
    return out
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
