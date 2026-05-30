import * as UI from './uiautomator-driver'
import { ADB } from './adb-helper'

export const DOUYIN_PKG = 'com.ss.android.ugc.aweme'
export const DOUYIN_ACT = '.main.MainActivity'

const TS = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise(r => {
    const start = Date.now()
    const tick = () => {
      if (signal?.aborted) return r()
      if (Date.now() - start >= ms) return r()
      setTimeout(tick, 200)
    }
    tick()
  })
}

async function sh(apiPort: number, cmd: string, signal?: AbortSignal) {
  await fetch(`http://127.0.0.1:${apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmd)}`, { signal: signal || AbortSignal.timeout(15000) }).catch(() => {})
}

// ============================================================
// 坐标缓存
// ============================================================
interface CachedCoord { x: number; y: number; successCount: number }
const coordCache: Record<string, CachedCoord> = {}

/** 尝试从缓存取坐标 */
function getCached(step: string): CachedCoord | null {
  return coordCache[step] || null
}

/** 成功后的坐标存入缓存 */
function saveCache(step: string, x: number, y: number) {
  const existing = coordCache[step]
  if (existing && Math.abs(existing.x - x) < 5 && Math.abs(existing.y - y) < 5) {
    existing.successCount++
  } else {
    coordCache[step] = { x, y, successCount: 1 }
  }
  console.log(`[缓存] ${step} = (${x},${y}) 已记录${coordCache[step].successCount}次`)
}

// ============================================================
// 指挥官（DeepSeek）：看截图，判断现在在什么页面，下一步找什么
// ============================================================
async function commander(b64: string, stepIndex: number, goal: string): Promise<{
  stepName: string; element: string; pageType: string
} | null> {
  const { deepSeekChat } = await import('./ai-providers')
  const prompt = `你是抖音发布流程指挥官。任务：${goal}

当前已完成步骤数：${stepIndex}
请根据截图判断当前在什么页面，下一步该找什么元素。

只返回 JSON：
{"pageType":"首页/拍摄页/相册页/编辑页/发布页/弹窗/未知","element":"要找的元素描述","stepName":"步骤名如 find_plus"}

页面判断规则：
- 首页：视频流 + 底部导航栏（首页/朋友/+/消息/我）
- 拍摄页：相机预览 + "相册"文字
- 相册页："全部/视频/图片"标签 + 缩略图
- 编辑页：视频预览 + "添加标题"
- 发布页："发布"/"发作品"按钮
- 弹窗：悬浮窗口 + 背景变暗

截图如下（base64），只返回 JSON。`
  const resp = await deepSeekChat(prompt, 500)
  if (!resp) return null
  const m = resp.match(/\{[\s\S]*\}/)
  if (!m) return null
  return JSON.parse(m[0])
}

// ============================================================
// 定位器（qwen-vl-max）：找到指定元素的像素坐标
// ============================================================
async function locator(b64: string, element: string): Promise<{ x: number; y: number } | null> {
  const { locateElement } = await import('./ai-providers')
  return locateElement(b64, element)
}

// ============================================================
// 主工作流
// ============================================================
export async function aiPublishVideoWorkflow(
  apiPort: number,
  title: string,
  topics: string[],
  signal?: AbortSignal,
  adb?: ADB | null
): Promise<{ success: boolean; message: string }> {

  const goal = `发布视频到抖音，标题："${title}"，话题：${topics.join(',')}`
  const { width: SW, height: SH } = await UI.getScreenSize(apiPort)
  console.log(`[${TS()}] 屏幕 ${SW}x${SH}`)

  const doTap = (x: number, y: number) => {
    const rx = Math.round(x); const ry = Math.round(y)
    if (adb) adb.tap(rx, ry)
    else sh(apiPort, `input tap ${rx} ${ry}`, signal)
  }

  let stepIndex = 0
  let failCount = 0

  for (let loop = 0; loop < 60; loop++) {
    if (signal?.aborted) { return { success: false, message: '用户停止' } }

    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) { await sleep(2000, signal); continue }

    // === 指挥官：看截图，决定做什么 ===
    const cmd = await commander(b64, stepIndex, goal)
    if (!cmd) { await sleep(2000, signal); continue }
    console.log(`[${TS()}] [指挥] ${cmd.pageType} → 找${cmd.element}`)

    // === 检查缓存 ===
    const cached = getCached(cmd.stepName)
    let coord: { x: number; y: number } | null = null

    if (cached && cached.successCount > 0) {
      coord = { x: cached.x, y: cached.y }
      console.log(`[${TS()}] [定位] 命中缓存 (${coord.x},${coord.y})`)
    } else {
      // === 定位器：找坐标 ===
      coord = await locator(b64, cmd.element)
      if (!coord) { failCount++; if (failCount > 5) failCount = 0; await sleep(2000, signal); continue }
      failCount = 0
      console.log(`[${TS()}] [定位] AI定位 (${coord.x},${coord.y})`)
    }

    // === 点击 ===
    await doTap(coord.x, coord.y)
    console.log(`[${TS()}] [执行] tap (${coord.x},${coord.y}) ${cmd.element}`)

    // === 缓存成功 ===
    saveCache(cmd.stepName, coord.x, coord.y)
    stepIndex++
    await sleep(4000, signal)

    // === 完成判断 ===
    if (cmd.pageType === '发布页' && cmd.element.includes('发布')) {
      return { success: true, message: '视频已发布' }
    }
  }
  return { success: false, message: '执行超时' }
}
