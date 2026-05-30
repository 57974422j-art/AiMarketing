/**
 * uiautomator 驱动 v2 — 完整版
 * 
 * 通过 Q1 HTTP API + uiautomator dump 实现：
 *   - 按文字查找按钮并点击（不需坐标）
 *   - 输入文字（不需剪贴板）
 *   - 提取界面文字内容
 *   - 滑动查找元素
 */

export type UIResult = {
  success: boolean
  message: string
  bounds?: { x: number; y: number; width: number; height: number }
  center?: { x: number; y: number }
  node?: UINode
  data?: any
  nodes?: UINode[]
}

export interface UINode {
  text: string
  resourceId: string
  className: string
  packageName: string
  contentDesc: string
  bounds: string
  clickable: boolean
  enabled: boolean
  checkable: boolean
  checked: boolean
}

// ============================================================
// 内部工具
// ============================================================

export function parseBounds(bounds: string): { x: number; y: number; width: number; height: number } | null {
  const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  if (!m) return null
  return {
    x: parseInt(m[1]), y: parseInt(m[2]),
    width: parseInt(m[3]) - parseInt(m[1]), height: parseInt(m[4]) - parseInt(m[2]),
  }
}

async function execShell(apiPort: number, cmd: string): Promise<UIResult> {
  try {
    const r = await fetch(`http://localhost:${apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmd)}`, { signal: AbortSignal.timeout(20000) })
    const d = await r.json()
    return { success: d.code === 200, message: d.ret || '' }
  } catch (e: any) {
    return { success: false, message: e.message || '执行失败' }
  }
}

async function downloadFile(apiPort: number, path: string): Promise<string | null> {
  try {
    const r = await fetch(`http://localhost:${apiPort}/download?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(10000) })
    return r.ok ? await r.text() : null
  } catch { return null }
}

// ============================================================
// XML 解析 & Dump
// ============================================================

export function parseUiXml(xml: string): UINode[] {
  const flat: UINode[] = []
  const regex = /<node\s+([^>]*?)\/?>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(xml)) !== null) {
    const a = match[1]
    flat.push({
      text: (a.match(/text="([^"]*)"/) || ['', ''])[1],
      resourceId: (a.match(/resource-id="([^"]*)"/) || ['', ''])[1],
      className: (a.match(/class="([^"]*)"/) || ['', ''])[1],
      packageName: (a.match(/package="([^"]*)"/) || ['', ''])[1],
      contentDesc: (a.match(/content-desc="([^"]*)"/) || ['', ''])[1],
      bounds: (a.match(/bounds="([^"]*)"/) || ['', ''])[1],
      clickable: a.includes('clickable="true"'),
      enabled: a.includes('enabled="true"'),
      checkable: a.includes('checkable="true"'),
      checked: a.includes('checked="true"'),
    })
  }
  return flat
}

export async function dumpXml(apiPort: number): Promise<UIResult> {
  const r = await execShell(apiPort, 'uiautomator dump /sdcard/ui.xml')
  if (!r.success) return { success: false, message: 'dump 失败: ' + r.message }
  await sleep(500)
  const xml = await downloadFile(apiPort, '/sdcard/ui.xml')
  if (!xml) return { success: false, message: '下载 XML 失败' }
  return { success: true, message: 'OK', data: xml }
}

function getNodes(apiPort: number): Promise<UINode[]> {
  return dumpXml(apiPort).then(r => r.success ? parseUiXml(r.data) : [])
}

// ============================================================
// 查找
// ============================================================

/** 按文字查找可点击元素 */
export async function findByText(apiPort: number, text: string): Promise<UIResult> {
  const nodes = await getNodes(apiPort)
  for (const node of nodes) {
    if (!node.clickable || !node.enabled) continue
    if (node.text.includes(text) || node.contentDesc.includes(text)) {
      const b = parseBounds(node.bounds)
      if (b) return {
        success: true, message: `找到 "${text}"`, bounds: b,
        center: { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }, node,
      }
    }
  }
  return { success: false, message: `未找到"${text}"` }
}

/** 精确匹配查找（更严格） */
export async function findByExactText(apiPort: number, text: string): Promise<UIResult> {
  const nodes = await getNodes(apiPort)
  for (const node of nodes) {
    if (!node.clickable || !node.enabled) continue
    if (node.text === text || node.contentDesc.startsWith(text) || node.contentDesc === text) {
      const b = parseBounds(node.bounds)
      if (b) return { success: true, message: `找到 "${text}"`, bounds: b,
        center: { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }, node }
    }
  }
  return findByText(apiPort, text) // 降级
}

/** 按 resourceId 查找 */
export async function findById(apiPort: number, id: string): Promise<UIResult> {
  const nodes = await getNodes(apiPort)
  for (const node of nodes) {
    if (!node.clickable || !node.enabled) continue
    if (node.resourceId.endsWith(id) || node.resourceId === id) {
      const b = parseBounds(node.bounds)
      if (b) return { success: true, message: `找到 ${id}`, bounds: b,
        center: { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }, node }
    }
  }
  return { success: false, message: `未找到 ${id}` }
}

// ============================================================
// 提取数据
// ============================================================

export interface ExtractedData {
  texts: string[]          // 所有可见文字
  clickableTexts: string[] // 可点击按钮的文字
  inputFields: UINode[]    // 输入框
  images: UINode[]         // 图片
  scrollableViews: boolean  // 是否可滚动
}

/** 提取当前界面所有数据 */
export async function extractScreenData(apiPort: number): Promise<UIResult> {
  const nodes = await getNodes(apiPort)
  const data: ExtractedData = {
    texts: nodes.filter(n => n.text).map(n => n.text),
    clickableTexts: nodes.filter(n => n.clickable && (n.text || n.contentDesc))
      .map(n => n.text || n.contentDesc),
    inputFields: nodes.filter(n => n.className.includes('EditText')),
    images: nodes.filter(n => n.className.includes('ImageView')),
    scrollableViews: nodes.some(n => n.className.includes('ScrollView') || n.className.includes('ViewPager')),
  }
  return { success: true, message: `提取到 ${data.texts.length} 个文字, ${data.clickableTexts.length} 个按钮`, data }
}

// ============================================================
// 执行操作
// ============================================================

export async function findAndClick(apiPort: number, text: string): Promise<UIResult> {
  const found = await findByText(apiPort, text)
  if (!found.success) {
    // 也试试 content-desc 匹配
    const found2 = await findByExactText(apiPort, text)
    if (!found2.success) return found2
    if (!found2.center) return { success: false, message: '无坐标' }
    const r = await execShell(apiPort, `input tap ${found2.center.x} ${found2.center.y}`)
    return r.success ? { ...found2, message: `已点击 (desc) "${text}"` } : { success: false, message: `点击失败: ${r.message}` }
  }
  if (!found.center) return { success: false, message: '无坐标' }
  const r = await execShell(apiPort, `input tap ${found.center.x} ${found.center.y}`)
  return r.success ? { ...found, message: `已点击 "${text}"` } : { success: false, message: `点击失败: ${r.message}` }
}

/** 输入文字 */
export async function inputText(apiPort: number, text: string): Promise<UIResult> {
  await sleep(500)
  const r = await execShell(apiPort, `input text "${text.replace(/"/g, '\\"')}"`)
  return r
}

/** 点击输入框并输入文字 */
export async function tapAndInput(apiPort: number, fieldText: string, input: string): Promise<UIResult> {
  const found = await findByText(apiPort, fieldText)
  if (found.center) {
    await execShell(apiPort, `input tap ${found.center.x} ${found.center.y}`)
    await sleep(500)
  }
  return inputText(apiPort, input)
}

/** 滑动 */
export async function swipe(apiPort: number, x1: number, y1: number, x2: number, y2: number, dur = 2000): Promise<UIResult> {
  return execShell(apiPort, `input swipe ${x1} ${y1} ${x2} ${y2} ${dur}`)
}

// ============================================================
// 动态屏幕尺寸（适配不同分辨率）
// ============================================================

const screenSizeCache = new Map<number, { width: number; height: number }>()

/** 获取屏幕分辨率（缓存结果，避免重复查询） */
export async function getScreenSize(apiPort: number): Promise<{ width: number; height: number }> {
  const cached = screenSizeCache.get(apiPort)
  if (cached) return cached
  const r = await execShell(apiPort, 'wm size')
  const m = r.message.match(/(\d+)x(\d+)/)
  const size = m ? { width: parseInt(m[1]), height: parseInt(m[2]) } : { width: 1080, height: 1920 }
  screenSizeCache.set(apiPort, size)
  return size
}

/** 按屏幕比例点击（xRatio / yRatio 范围 0~1） */
export async function tapRatio(apiPort: number, xRatio: number, yRatio: number): Promise<UIResult> {
  const { width, height } = await getScreenSize(apiPort)
  return tap(apiPort, Math.round(width * xRatio), Math.round(height * yRatio))
}

/** 上滑（翻页）— 动态坐标 */
export async function scrollUp(apiPort: number): Promise<UIResult> {
  const { width, height } = await getScreenSize(apiPort)
  return execShell(apiPort, `input swipe ${Math.round(width * 0.5)} ${Math.round(height * 0.833)} ${Math.round(width * 0.5)} ${Math.round(height * 0.208)} 500`)
}

/** 下滑 — 动态坐标 */
export async function scrollDown(apiPort: number): Promise<UIResult> {
  const { width, height } = await getScreenSize(apiPort)
  return execShell(apiPort, `input swipe ${Math.round(width * 0.5)} ${Math.round(height * 0.208)} ${Math.round(width * 0.5)} ${Math.round(height * 0.938)} 2000`)
}

/** 滑动直到找到某个文字 */
export async function swipeToFind(apiPort: number, text: string, maxSwipes = 10): Promise<UIResult> {
  for (let i = 0; i < maxSwipes; i++) {
    const found = await findByText(apiPort, text)
    if (found.success) return found
    await scrollUp(apiPort)
    await sleep(1500)
  }
  return { success: false, message: `滑动 ${maxSwipes} 次未找到"${text}"` }
}

/** 随机偏移（±3px，防止风控识别固定坐标） */
function jitter(base: number): number {
  return base + Math.round(Math.random() * 6 - 3)
}

/** 硬件级点击（魔云腾 autoclick API + 随机偏移 + 按下-保持-抬起） */
export async function tap(apiPort: number, x: number, y: number): Promise<UIResult> {
  const cx = jitter(x)
  const cy = jitter(y)
  try {
    // 魔云腾硬件级 touchDown + 随机延迟 + touchUp
    await fetch(`http://127.0.0.1:${apiPort}/autoclick?action=down&id=1&x=${cx}&y=${cy}`, { signal: AbortSignal.timeout(5000) })
    await sleep(50 + Math.random() * 80) // 50-130ms 随机按压时间
    await fetch(`http://127.0.0.1:${apiPort}/autoclick?action=up&id=1`, { signal: AbortSignal.timeout(5000) })
    return { success: true, message: `硬件点击 (${cx},${cy})` }
  } catch {
    // 降级到 input tap
    return execShell(apiPort, `input tap ${cx} ${cy}`)
  }
}

/** 长按 */
export async function longPress(apiPort: number, x: number, y: number, ms = 1500): Promise<UIResult> {
  const cx = jitter(x); const cy = jitter(y)
  return execShell(apiPort, `input swipe ${cx} ${cy} ${cx} ${cy} ${ms}`)
}

/** 返回 */
export async function goBack(apiPort: number): Promise<UIResult> {
  return execShell(apiPort, 'input keyevent KEYCODE_BACK')
}

/** 启动应用 */
export async function openApp(apiPort: number, pkg: string, act?: string): Promise<UIResult> {
  return execShell(apiPort, `am start -n ${act ? `${pkg}/${act}` : pkg}`)
}

/** 执行任意 Shell 命令（通过 Q1 API） */
export async function shell(apiPort: number, cmd: string): Promise<UIResult> {
  return execShell(apiPort, cmd)
}

/** 等待 */
export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// ============================================================
// 截图（用于 AI 视觉兜底）
// ============================================================

/** 截取当前屏幕，返回 base64 PNG */
export async function takeScreenshot(apiPort: number): Promise<string | null> {
  try {
    const res = await fetch(`http://localhost:${apiPort}/task=snap&level=0`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return Buffer.from(buf).toString('base64')
  } catch (e) {
    console.error('[截图] 失败:', e)
    return null
  }
}
