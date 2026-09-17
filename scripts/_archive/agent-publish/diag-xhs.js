/** 诊断：小红书发布页结构（只读） */
const { chromium } = require('playwright')

async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  console.log('页面数=' + ctx.pages().length)
  for (const p of ctx.pages()) {
    console.log('\n===== ' + p.url() + ' =====')
    if (!/xiaohongshu/.test(p.url())) continue
    const r = await p.evaluate(() => {
      const vis = (e) => !!(e && e.offsetParent !== null)
      const out = {}
      out.fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((e) => ({
        accept: (e.getAttribute('accept') || '').slice(0, 50), visible: vis(e), cls: String(e.className || '').slice(0, 40),
      }))
      out.buttons = Array.from(new Set(Array.from(document.querySelectorAll('button,[role="button"],span,div,a'))
        .filter(vis).map((e) => (e.innerText || '').trim()).filter((t) => t && t.length <= 14))).slice(0, 50)
      out.inputs = Array.from(document.querySelectorAll('input[type="text"],textarea,[contenteditable="true"]')).map((e) => ({
        tag: e.tagName, ph: e.getAttribute('placeholder') || '', cls: String(e.className || '').slice(0, 40), visible: vis(e),
      })).slice(0, 12)
      out.coverLike = Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => {
        const t = (e.innerText || '').trim()
        return t && t.length <= 14 && /封面|上传|标题|正文|发布/.test(t)
      }).map((e) => ({ tag: e.tagName, cls: String(e.className || '').slice(0, 50), text: (e.innerText || '').trim().slice(0, 25) })).slice(0, 30)
      return out
    })
    console.log(JSON.stringify(r, null, 1))
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
