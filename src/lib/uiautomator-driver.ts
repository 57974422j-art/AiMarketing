/**
 * uiautomator 驱动 — 通过 Q1 HTTP API 获取界面控件树
 * 
 * 原理：
 *   1. cmd=6 执行 uiautomator dump /sdcard/ui.xml
 *   2. download API 下载 ui.xml
 *   3. 解析 XML 按文字/ID/content-desc 查找控件坐标
 *   4. cmd=6 执行 input tap x y 或 input text
 * 
 * 优势：不依赖固定坐标，UI 微调后只要按钮文字不变就能用
 */

import { getDevice } from './device-engine'

export type UIResult = {
  success: boolean
  message: string
  bounds?: { x: number; y: number; width: number; height: number }
  center?: { x: number; y: number }
  node?: UINode
}

export interface UINode {
  text: string
  resourceId: string
  className: string
  packageName: string
  contentDesc: string
  bounds: string  // "[x1,y1][x2,y2]"
  clickable: boolean
  enabled: boolean
  checkable: boolean
  checked: boolean
  children: UINode[]
}

/** 解析 bounds 字符串 "[x1,y1][x2,y2]" → center */
function parseBounds(bounds: string): { x: number; y: number; width: number; height: number } | null {
  const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  if (!m) return null
  const x1 = parseInt(m[1]), y1 = parseInt(m[2]), x2 = parseInt(m[3]), y2 = parseInt(m[4])
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

/**
 * 通过 Shell 执行命令（已有的 Q1 API）
 */
async function execShell(deviceId: string, cmd: string): Promise<UIResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  const port = (dev as any).apiPort || 30001
  try {
    const r = await fetch(`http://localhost:${port}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmd)}`, { signal: AbortSignal.timeout(15000) })
    const d = await r.json()
    return { success: d.code === 200, message: d.ret || '' }
  } catch (e: any) {
    return { success: false, message: e.message || '执行失败' }
  }
}

/**
 * 从 Q1 下载文件
 */
async function downloadFile(deviceId: string, path: string): Promise<string | null> {
  const dev = await getDevice(deviceId)
  if (!dev) return null
  const port = (dev as any).apiPort || 30001
  try {
    const r = await fetch(`http://localhost:${port}/download?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) return null
    return await r.text()
  } catch { return null }
}

/**
 * 解析 uiautomator XML → 扁平的节点列表
 */
function parseUiXml(xml: string): UINode[] {
  const flat: UINode[] = []
  const regex = /<node\s+([^>]*?)\/?>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(xml)) !== null) {
    const attrs = match[1]
    const node: UINode = {
      text: (attrs.match(/text="([^"]*)"/) || ['', ''])[1],
      resourceId: (attrs.match(/resource-id="([^"]*)"/) || ['', ''])[1],
      className: (attrs.match(/class="([^"]*)"/) || ['', ''])[1],
      packageName: (attrs.match(/package="([^"]*)"/) || ['', ''])[1],
      contentDesc: (attrs.match(/content-desc="([^"]*)"/) || ['', ''])[1],
      bounds: (attrs.match(/bounds="([^"]*)"/) || ['', ''])[1],
      clickable: attrs.includes('clickable="true"'),
      enabled: attrs.includes('enabled="true"'),
      checkable: attrs.includes('checkable="true"'),
      checked: attrs.includes('checked="true"'),
      children: [],
    }
    flat.push(node)
  }
  return flat
}

/**
 * dump 当前界面控件树
 */
export async function dumpXml(deviceId: string): Promise<UIResult> {
  // 1. dump
  const dumpRes = await execShell(deviceId, 'uiautomator dump /sdcard/ui.xml')
  if (!dumpRes.success) return { success: false, message: 'dump 失败: ' + dumpRes.message }
  // 等一小会儿让文件写完
  await new Promise(r => setTimeout(r, 500))
  // 2. 下载
  const xml = await downloadFile(deviceId, '/sdcard/ui.xml')
  if (!xml) return { success: false, message: '下载 XML 失败' }
  return { success: true, message: 'OK', data: xml }
}

/**
 * 按文字查找按钮 — 核心函数！
 * 支持: text 匹配 / content-desc 匹配 / 模糊包含
 */
export async function findByText(deviceId: string, text: string): Promise<UIResult> {
  const dumpResult = await dumpXml(deviceId)
  if (!dumpResult.success) return dumpResult
  const xml = dumpResult.data as string
  const nodes = parseUiXml(xml)

  for (const node of nodes) {
    if (!node.clickable || !node.enabled) continue
    const match = node.text.includes(text) || node.contentDesc.includes(text) || 
                  node.text === text || node.contentDesc.includes(text.replace(/[#@]/g, ''))
    if (match) {
      const b = parseBounds(node.bounds)
      if (b) {
        return {
          success: true,
          message: `找到 "${text}" → (${b.x + b.width / 2}, ${b.y + b.height / 2})`,
          bounds: b,
          center: { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) },
          node,
        }
      }
    }
  }
  return { success: false, message: `未找到含"${text}"的按钮` }
}

/**
 * 按文字查找并点击 — 最常用的功能
 */
export async function findAndClick(deviceId: string, text: string): Promise<UIResult> {
  const found = await findByText(deviceId, text)
  if (!found.success) return found
  if (!found.center) return { success: false, message: '找不到坐标' }
  
  const tapRes = await execShell(deviceId, `input tap ${found.center.x} ${found.center.y}`)
  if (!tapRes.success) return { success: false, message: `点击失败: ${tapRes.message}` }
  
  return { ...found, message: `已点击 "${text}" 在 (${found.center.x}, ${found.center.y})` }
}

/**
 * 直接输入文字（不需要剪贴板！）
 */
export async function inputText(deviceId: string, text: string): Promise<UIResult> {
  // 先点击输入框让它获取焦点
  const inputRes = await findByText(deviceId, '添加标题')
  if (inputRes.success && inputRes.center) {
    await execShell(deviceId, `input tap ${inputRes.center.x} ${inputRes.center.y}`)
    await new Promise(r => setTimeout(r, 300))
  }
  // 清空已有文字
  await execShell(deviceId, 'input keyevent KEYCODE_MOVE_END')
  for (let i = 0; i < 20; i++) await execShell(deviceId, 'input keyevent KEYCODE_DEL')
  await new Promise(r => setTimeout(r, 200))
  // 输入文字
  const r = await execShell(deviceId, `input text "${text.replace(/"/g, '\\"').replace(/ /g, '\\ ')}"`)
  return r
}

/**
 * 滑动
 */
export async function swipe(deviceId: string, x1: number, y1: number, x2: number, y2: number, duration = 2000): Promise<UIResult> {
  return execShell(deviceId, `input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`)
}

/**
 * 点击坐标（兜底用）
 */
export async function tap(deviceId: string, x: number, y: number): Promise<UIResult> {
  return execShell(deviceId, `input tap ${x} ${y}`)
}

/**
 * 启动应用
 */
export async function openApp(deviceId: string, packageName: string, activity?: string): Promise<UIResult> {
  const intent = activity ? `${packageName}/${activity}` : packageName
  return execShell(deviceId, `am start -n ${intent}`)
}

/**
 * 返回
 */
export async function goBack(deviceId: string): Promise<UIResult> {
  return execShell(deviceId, 'input keyevent KEYCODE_BACK')
}

/**
 * 等待
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
