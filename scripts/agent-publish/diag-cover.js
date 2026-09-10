/**
 * 只读诊断：连登记浏览器(CDP 9222) —— 打印当前页面 + 封面弹窗真实结构
 * 不点击、不修改，仅读取。
 */
const { chromium } = require('playwright')

async function main() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = b.contexts()[0]
  const pages = ctx.pages()
  console.log('页面数: ' + pages.length)
  for (const p of pages) {
    let url = ''
    try { url = p.url() } catch (e) { url = '(读不到)' }
    console.log('\n===== PAGE: ' + url + ' =====')
    if (!/douyin|creator/.test(url)) continue
    try {
      // 可见按钮/可点元素文本
      const info = await p.evaluate(() => {
        const vis = (e) => !!(e && e.offsetParent !== null)
        const out = {}
        out.buttons = Array.from(document.querySelectorAll('button,[role="button"],span,div,a'))
          .filter(vis)
          .map((e) => (e.innerText || '').trim())
          .filter((t) => t && t.length <= 12)
        out.buttons = Array.from(new Set(out.buttons)).slice(0, 60)
        out.fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((e) => ({
          accept: (e.getAttribute('accept') || '').slice(0, 60),
          visible: vis(e),
          name: e.getAttribute('name') || '',
          cls: String(e.className || '').slice(0, 40),
        }))
        // 弹窗容器（可见的 modal/dialog）
        out.dialogs = Array.from(document.querySelectorAll('[role="dialog"],[class*="modal"],[class*="Modal"],[class*="popup"],[class*="Popup"]'))
          .filter(vis).map((e) => ({
            cls: String(e.className || '').slice(0, 70),
            text: (e.innerText || '').trim().slice(0, 200),
          })).slice(0, 8)
        // 含"封面/上传/完成/保存/确定"字样的可见元素（tag+cls+文本）
        out.coverEls = Array.from(document.querySelectorAll('*'))
          .filter(vis)
          .filter((e) => {
            const t = (e.innerText || '').trim()
            return t && t.length <= 12 && /封面|上传|完成|保存|确定/.test(t)
          })
          .map((e) => ({ tag: e.tagName, cls: String(e.className || '').slice(0, 50), text: (e.innerText || '').trim() }))
          .slice(0, 30)
        return out
      })
      console.log('--- 可见文本元素(去重前60) ---')
      console.log(JSON.stringify(info.buttons, null, 0))
      console.log('--- input[type=file] ---')
      console.log(JSON.stringify(info.fileInputs, null, 1))
      console.log('--- 可见弹窗容器 ---')
      console.log(JSON.stringify(info.dialogs, null, 1))
      console.log('--- 含封面/上传/完成/保存的可见元素 ---')
      console.log(JSON.stringify(info.coverEls, null, 1))
    } catch (e) {
      console.log('读取失败: ' + e.message)
    }
  }
  await b.close().catch(() => {})
}
main().catch((e) => { console.error('ERR ' + e.message); process.exit(1) })
