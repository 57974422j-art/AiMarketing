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
// 指挥官（DeepSeek）：看截图，判断现在在什么页面，下一步找什么
// ============================================================
async function commander(b64: string, goal: string): Promise<{
  pageType: string; element: string; stepName: string
} | null> {
  const { deepSeekChat } = await import('./ai-providers')
  const prompt = `你是抖音发布流程指挥官。任务：${goal}

请根据截图判断当前在什么页面，下一步该找什么元素点击。

只返回 JSON，不要其他文字：
{"pageType":"首页/拍摄页/相册页/编辑页/发布页/弹窗/未知","element":"要找的元素描述","stepName":"英文步骤名如 find_plus"}

页面判断：
- 首页：视频流 + 底部导航栏（首页/朋友/+/消息/我）
- 拍摄页：相机预览 + "相册"文字
- 相册页："全部/视频/图片"标签 + 缩略图
- 编辑页：视频预览 + "添加标题"
- 发布页："发布"/"发作品"按钮
- 弹窗：悬浮窗口 + 背景变暗`

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
// 主工作流（每步先验证再缓存）
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
    if (adb) adb.tap(Math.round(x), Math.round(y))
    else sh(apiPort, `input tap ${Math.round(x)} ${Math.round(y)}`, signal)
  }

  // 已成功的步骤（页面类型 → 坐标），后续命中直接执行
  const learned: Record<string, { x: number; y: number }> = {}
  let lastPage = ''
  let stuckCount = 0

  for (let loop = 0; loop < 60; loop++) {
    if (signal?.aborted) { return { success: false, message: '用户停止' } }

    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) { await sleep(2000, signal); continue }

    // === 指挥：看截图，判断当前页面 + 下一步 ===
    const cmd = await commander(b64, goal)
    if (!cmd) { await sleep(2000, signal); continue }
    console.log(`[${TS()}] [指挥] ${cmd.pageType} → 找${cmd.element}`)

    // 页面没变 → stuck++
    if (cmd.pageType === lastPage) stuckCount++; else { stuckCount = 0; lastPage = cmd.pageType }
    if (stuckCount > 10) {
      console.log(`[${TS()}] [卡死] ${cmd.pageType} 卡住，回首页`)
      for (let i = 0; i < 5; i++) { if (adb) adb.shell('input keyevent KEYCODE_BACK'); else await sh(apiPort, 'input keyevent KEYCODE_BACK', signal); await sleep(500, signal) }
      await sleep(3000, signal); stuckCount = 0; delete learned[cmd.stepName]; continue
    }

    // 完成判断
    if (cmd.pageType === '发布页' || cmd.pageType === '完成') {
      return { success: true, message: '视频已发布' }
    }

    // === 查学习记录（跳过 AI 定位） ===
    if (learned[cmd.stepName]) {
      const c = learned[cmd.stepName]
      await doTap(c.x, c.y)
      console.log(`[${TS()}] [学习] (${c.x},${c.y}) ${cmd.element}`)
      await sleep(4000, signal)
      continue
    }

    // === 定位器：找坐标（最多试 5 次） ===
    let coord: { x: number; y: number } | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      coord = await locator(b64, cmd.element)
      if (!coord) { await sleep(1000, signal); continue }
      // 加号校验
      if (cmd.element.includes('加号') && coord.y < SH * 0.8) {
        console.log(`[${TS()}] [定位] y=${coord.y} 偏低，重试`)
        await sleep(1000, signal); continue
      }
      break
    }
    if (!coord) { await sleep(2000, signal); continue }
    console.log(`[${TS()}] [定位] (${coord.x},${coord.y}) ${cmd.element}`)

    // === 执行 ===
    await doTap(coord.x, coord.y)
    await sleep(4000, signal)

    // === 验证：截图再看页面变了没 ===
    const b64v = await UI.takeScreenshot(apiPort)
    if (b64v) {
      const cmd2 = await commander(b64v, goal)
      if (cmd2 && cmd2.pageType !== cmd.pageType && cmd2.pageType !== '未知') {
        // 页面变了 → 成功了，记下来
        learned[cmd.stepName] = { x: coord.x, y: coord.y }
        console.log(`[${TS()}] [成功] ${cmd.stepName} = (${coord.x},${coord.y}) 已学习`)
      } else {
        console.log(`[${TS()}] [失败] ${cmd.stepName} (${coord.x},${coord.y}) 页面未变，丢弃`)
      }
    }
  }
  return { success: false, message: '执行超时' }
}
