/**
 * 指纹浏览器发布脚本 · CDP 穿透点击公共模块（保底方法论）
 *
 * 【为什么需要它】小红书发布红键在 xhs-publish-btn 的 CLOSED shadow-root 内，
 * 普通 Playwright（page.locator / elementHandle.click / >>> 选择器）永远进不去。
 * 经三轮实战验证，唯一可靠路径是走 Chrome DevTools Protocol（CDP）：
 *   1) page.context().newCDPSession(page) 建立协议通道
 *   2) DOM.getDocument({depth:-1, pierce:true}) 拿整棵 DOM 树
 *   3) pierce 树下 shadow 内容【不在 node.children】，而在独立字段 node.shadowRoots 数组；
 *      iframe 内容在 node.contentDocument；template 在 node.templateContent。
 *      → 必须递归 children + shadowRoots + contentDocument + templateContent
 *   4) 用谓词匹配目标节点（如 button 且文本含"发布"），拿到 nodeId
 *   5) DOM.getBoxModel({nodeId}) 返回 8 数字 quad（四角 x/y）→ 取中心坐标
 *   6) page.mouse.click(cx, cy) 真实鼠标点击（绕过 JS 沙箱，比 elementHandle.click 更真实）
 *
 * 各平台「点击发布/确认」应先试常规 Playwright，再 fallback 到本模块，
 * 避免每个平台各自重复踩 closed-shadow 的坑。getBoxModel 返回的是视口坐标，
 * 调用前务必把目标元素 scrollIntoView / scrollTo 进视口，否则坐标落在视口外会点空。
 */

'use strict'

function _kidsOf(node) {
  const kids = []
  if (node.children) kids.push(...node.children)
  if (node.shadowRoots) kids.push(...node.shadowRoots)
  if (node.contentDocument) kids.push(node.contentDocument)
  if (node.templateContent) kids.push(node.templateContent)
  return kids
}
function _subtreeText(node) {
  let t = ''
  if (node.nodeType === 3) t += (node.nodeValue || '')
  for (const c of _kidsOf(node)) t += _subtreeText(c)
  return t
}
function _attrsOf(node) {
  const a = node.attributes || []
  const o = {}
  for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1] || ''
  return o
}
// 深度遍历 pierced 树（含 closed shadow / iframe），收集满足 pred 的元素节点
function _collectPierced(node, pred, out) {
  if (!node || typeof node !== 'object') return
  if (node.nodeType === 1) {
    const name = (node.localName || '').toLowerCase()
    const attrs = _attrsOf(node)
    const txt = _subtreeText(node).replace(/\s+/g, ' ').trim()
    if (pred({ name, cls: attrs['class'] || '', txt, attrs, node })) out.push(node)
  }
  for (const c of _kidsOf(node)) _collectPierced(c, pred, out)
}

// 由 nodeId 取视口坐标并真实鼠标点击；返回是否成功
async function _clickNodeById(client, page, log, nodeId, label) {
  const model = await client.send('DOM.getBoxModel', { nodeId }).catch(() => null)
  if (!model || !model.model || !model.model.border) return false
  const q = model.model.border
  const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]]
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  if (!isFinite(cx) || !isFinite(cy)) return false
  log('  [CDP] 命中' + label + '，坐标 (' + Math.round(cx) + ',' + Math.round(cy) + ')，鼠标点击')
  await page.mouse.click(cx, cy)
  return true
}

/**
 * 通用保底：在 pierced 树里按文本匹配 button/a 并真实鼠标点击。
 * 各平台发布/确认按钮点击失败（含 closed shadow 场景）时调用此函数兜底。
 * @param {import('playwright').Page} page
 * @param {(msg:string)=>void} log
 * @param {string[]} texts 任一文本命中即点（如 ['发表','发布']）
 * @param {number} maxLen 文本长度上限，防止误点大容器
 * @returns {Promise<boolean>}
 */
async function clickByTextCDP(page, log, texts, maxLen = 30, tags = ['button', 'a']) {
  try {
    const client = await page.context().newCDPSession(page)
    const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true })
    const hits = []
    _collectPierced(root, ({ name, txt }) =>
      (tags.includes(name)) &&
      texts.some(t => txt.includes(t)) && txt.length < maxLen, hits)
    if (hits.length) {
      // 取文本最短（最精确）的命中，避免误点父容器等大块元素
      hits.sort((a, b) => _subtreeText(a).length - _subtreeText(b).length)
      const label = _subtreeText(hits[0]).replace(/\s+/g, ' ').trim().slice(0, 20)
      const ok = await _clickNodeById(client, page, log, hits[0].nodeId, '「' + label + '」(CDP保底)')
      await client.detach().catch(() => {})
      return ok
    }
    await client.detach().catch(() => {})
    return false
  } catch (e) { log('  [CDP] 保底点击异常: ' + e.message); return false }
}

module.exports = { _collectPierced, _clickNodeById, _subtreeText, clickByTextCDP }
