/** 只读：确认编辑页"设置封面"区域的两个入口能不能定位到 */
const { chromium } = require('playwright')

async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /creator\.douyin/.test(p.url())) || ctx.pages()[0]
  console.log('URL=' + page.url())
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const out = {}
    // 1) 含"封面"字样的可见元素（编辑页封面区）
    out.coverText = Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => {
      const t = (e.innerText || '').trim()
      return t && t.length <= 20 && /封面/.test(t)
    }).map((e) => ({ tag: e.tagName, cls: String(e.className || '').slice(0, 55), text: (e.innerText || '').trim().slice(0, 30) })).slice(0, 25)
    // 2) 两个方向入口（竖封面3:4 / 横封面4:3）——外层可点容器
    const pick = (kw) => {
      const arr = Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => (e.innerText || '').includes(kw))
      const last = arr[arr.length - 1]  // 最内层（按钮本体）
      if (!last) return null
      // 往上找可点祖先（button / role=button / class含cover）
      let p = last
      for (let k = 0; k < 5 && p; k++) {
        if (p.tagName === 'BUTTON' || p.getAttribute('role') === 'button' || /cover|Cover/.test(String(p.className))) break
        p = p.parentElement
      }
      return {
        inner: { tag: last.tagName, cls: String(last.className).slice(0, 55), text: (last.innerText || '').trim() },
        clickable: p ? { tag: p.tagName, cls: String(p.className).slice(0, 70), role: p.getAttribute('role') || '' } : null,
        count: arr.length,
      }
    }
    out.entry竖 = pick('竖封面3:4')
    out.entry横 = pick('横封面4:3')
    // 3) 设置封面按钮本体
    const setEls = Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => (e.innerText || '').trim() === '设置封面')
    out.setCover = setEls.map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 60) }))
    return out
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
