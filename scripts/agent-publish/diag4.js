/** 交互诊断：找"横封面4:3"入口哪一层可点开弹窗（会点击，仅测试用） */
const { chromium } = require('playwright')

async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const page = ctx.pages().find((p) => /creator\.douyin/.test(p.url())) || ctx.pages()[0]
  console.log('URL=' + page.url())
  const modalVisible = () =>
    page.evaluate(() => {
      const vis = (e) => !!(e && e.offsetParent !== null)
      const d = Array.from(document.querySelectorAll('.semi-upload-drag-area, [class*="dy-creator-content-modal"]')).filter(vis)
      return d.length
    }).catch(() => 0)

  // 找到 "横封面4:3" 元素 + 它的祖先链（tag/class）
  const chain = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null)
    const els = Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => (e.innerText || '').trim() === '横封面4:3')
    if (!els.length) return null
    let e = els[els.length - 1]
    const arr = []
    for (let i = 0; i < 6 && e; i++) {
      arr.push({ lvl: i, tag: e.tagName, cls: String(e.className || '').slice(0, 60), clickable: e.tagName === 'BUTTON' || e.getAttribute('role') === 'button' })
      e = e.parentElement
    }
    return arr
  })
  console.log('入口祖先链: ' + JSON.stringify(chain, null, 1))
  if (!chain) { console.log('未找到入口'); await b.close(); return }

  console.log('点击前弹窗可见数=' + (await modalVisible()))
  // 逐层点击（从最内层开始），每层点完看弹窗是否出现
  for (const lvl of chain) {
    const sel = lvl.cls ? '.' + String(lvl.cls).split(' ')[0] : lvl.tag.toLowerCase()
    try {
      const h = await page.evaluateHandle((L) => {
        const vis = (e) => !!(e && e.offsetParent !== null)
        const els = Array.from(document.querySelectorAll('*')).filter(vis).filter((e) => (e.innerText || '').trim() === '横封面4:3')
        if (!els.length) return null
        let e = els[els.length - 1]
        for (let i = 0; i < L && e; i++) e = e.parentElement
        return e
      }, lvl.lvl)
      const el = h.asElement()
      if (!el) { console.log('L' + lvl.lvl + ' 无元素'); continue }
      await el.click({ timeout: 2500 }).catch((e) => console.log('L' + lvl.lvl + ' click err: ' + e.message.slice(0, 50)))
      await page.waitForTimeout(1800)
      const n = await modalVisible()
      console.log('点 L' + lvl.lvl + ' (' + lvl.tag + '.' + (lvl.cls || '').slice(0, 30) + ') → 弹窗可见=' + n)
      if (n > 0) { console.log('>>> L' + lvl.lvl + ' 可点开弹窗！'); break }
    } catch (e) {
      console.log('L' + lvl.lvl + ' 异常: ' + e.message.slice(0, 60))
    }
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
