const { chromium } = require('playwright')
async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /xiaohongshu/.test(p.url())) || ctx.pages()[0]
  console.log('URL=' + page.url())
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const out = {}
    out.editCover = Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => {
      const t = (e.innerText || '').trim()
      return t && t.length <= 12 && /编辑封面/.test(t)
    }).map((e) => ({ tag: e.tagName, cls: String(e.className || '').slice(0, 55), text: (e.innerText || '').trim() })).slice(0, 8)
    out.fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((e) => ({
      accept: (e.getAttribute('accept') || '').slice(0, 45), visible: vis(e), cls: String(e.className || '').slice(0, 45),
    }))
    out.btns = Array.from(new Set(Array.from(document.querySelectorAll('button,[role="button"],span,div,label'))
      .filter(vis).map((e) => (e.innerText || '').trim()).filter((t) => t && t.length <= 12 && /封面|上传|完成|确定|保存|应用|裁剪|下一步/.test(t)))).slice(0, 30)
    out.upLike = Array.from(document.querySelectorAll('[class*="upload"],[class*="Upload"],[class*="cover"],[class*="Cover"]')).filter(vis).map((e) => ({
      tag: e.tagName, cls: String(e.className || '').slice(0, 55), text: (e.innerText || '').trim().slice(0, 25),
    })).slice(0, 25)
    return out
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
