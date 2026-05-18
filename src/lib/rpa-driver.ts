/**
 * Q1 RPA 驱动 — 通过 HTTP 桥接调用 MYT_RPA_SDK
 * 
 * 核心能力：
 *   - findAndClick(text) → 按文字找按钮并点击（不需要坐标！）
 *   - sendText(text) → 输入文字
 *   - dumpNodeXml() → 获取控件树
 *   - openApp(package) → 启动应用
 * 
 * 部署要求：
 *   1. FRP 隧道暴露 Q1 的 9083 端口（辅助控制 API 端口）
 *   2. 服务器运行: python3 src/lib/rpa_bridge.py 9100
 *   3. 后台配置 Q1 设备的 9083 端口
 */

import { getDevice } from './device-engine'

export type RPABridgeResult = {
  success: boolean
  message: string
  data?: any
}

// RPA 桥接服务本地地址
const BRIDGE_URL = 'http://127.0.0.1:9100'

async function callBridge(body: Record<string, unknown>): Promise<RPABridgeResult> {
  try {
    const res = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    const d = await res.json()
    return { success: d.ok === true, message: d.msg || '', data: d.data || d }
  } catch (e: any) {
    return { success: false, message: e.message || 'RPA 桥接连接失败' }
  }
}

function getPortFromDevice(device: any): number {
  return (device as any).rpaPort || 9083
}

/**
 * 按文字查找并点击按钮 — 核心功能，替代固定坐标
 * 示例: await rpaFindAndClick(deviceId, "评论")
 */
export async function rpaFindAndClick(deviceId: string, text: string, timeoutMs = 200): Promise<RPABridgeResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  const port = getPortFromDevice(dev)
  return callBridge({ action: 'findAndClick', text, port, timeout: timeoutMs })
}

/** 按文字查找节点，返回位置信息 */
export async function rpaFindNode(deviceId: string, text: string): Promise<RPABridgeResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  return callBridge({ action: 'findNode', text, port: getPortFromDevice(dev) })
}

/** 导出界面控件树（XML） */
export async function rpaDumpXml(deviceId: string): Promise<RPABridgeResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  return callBridge({ action: 'dumpNodeXml', port: getPortFromDevice(dev) })
}

/** 输入文字 */
export async function rpaSendText(deviceId: string, text: string): Promise<RPABridgeResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  return callBridge({ action: 'sendText', text, port: getPortFromDevice(dev) })
}

/** 点击坐标（兜底用） */
export async function rpaClick(deviceId: string, x: number, y: number): Promise<RPABridgeResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  return callBridge({ action: 'click', x, y, port: getPortFromDevice(dev) })
}

/** 打开应用 */
export async function rpaOpenApp(deviceId: string, pkg: string): Promise<RPABridgeResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  return callBridge({ action: 'openApp', package: pkg, port: getPortFromDevice(dev) })
}

/** 停止应用 */
export async function rpaStopApp(deviceId: string, pkg: string): Promise<RPABridgeResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  return callBridge({ action: 'stopApp', package: pkg, port: getPortFromDevice(dev) })
}

/** 执行 Shell 命令 */
export async function rpaExecCmd(deviceId: string, cmd: string): Promise<RPABridgeResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  return callBridge({ action: 'execCmd', cmd, port: getPortFromDevice(dev) })
}

/** 滑动 */
export async function rpaSwipe(deviceId: string, x1: number, y1: number, x2: number, y2: number, duration = 2000): Promise<RPABridgeResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  return callBridge({ action: 'swipe', x1, y1, x2, y2, duration, port: getPortFromDevice(dev) })
}

/** 截图 */
export async function rpaScreenshot(deviceId: string): Promise<RPABridgeResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  return callBridge({ action: 'screenshot', port: getPortFromDevice(dev) })
}

/** 检查 RPA 桥接是否在线 */
export async function rpaPing(deviceId: string): Promise<RPABridgeResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  return callBridge({ action: 'ping', port: getPortFromDevice(dev) })
}
