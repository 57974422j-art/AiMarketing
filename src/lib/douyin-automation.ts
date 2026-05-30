import { aiDecideNext, stateMachine, PageType } from './ai-providers'
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

export async function aiPublishVideoWorkflow(
  apiPort: number,
  title: string,
  topics: string[],
  signal?: AbortSignal,
  adb?: ADB | null
): Promise<{ success: boolean; message: string }> {

  const goal = `发布视频到抖音，标题："${title}"，话题：${topics.join(',')}。`
  const { width: SW, height: SH } = await UI.getScreenSize(apiPort)
  console.log(`[${TS()}] [AI-Decide] 屏幕 ${SW}x${SH} ${adb ? 'ADB' : 'HTTP'}`)

  let currentState: PageType = 'home'
  let stuckCount = 0

  const doTap = (x: number, y: number) => {
    const rx = Math.round(x); const ry = Math.round(y)
    if (adb) adb.tap(rx, ry)
    else sh(apiPort, `input tap ${rx} ${ry}`, signal)
  }

  for (let loop = 0; loop < 60; loop++) {
    if (signal?.aborted) { console.log(`[${TS()}] [AI-Decide] 已停止`); return { success: false, message: '用户停止' } }

    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) { await sleep(2000, signal); continue }

    const dec = await aiDecideNext(b64, currentState, goal, { width: SW, height: SH })
    if (!dec) { await sleep(2000, signal); continue }

    console.log(`[${TS()}] [AI-Decide] 步骤${loop}: ${dec.analysis}`)

    if (dec.status === 'DONE') return { success: true, message: '视频已发布' }

    // 状态同步：用 AI 实际识别到的页面覆盖
    if (dec.pageType && dec.pageType !== 'unknown' && dec.pageType !== currentState) {
      console.log(`[${TS()}] [AI-Decide] 状态同步: ${currentState} → ${dec.pageType}`)
      currentState = dec.pageType
    }

    // 死循环检测（不再 force-stop，改用 goHome 回到首页重试）
    if (dec.action === 'wait') stuckCount++; else stuckCount = 0
    if (stuckCount > 15) {
      console.log(`[${TS()}] [AI-Decide] 卡住，回首页重试`)
      for (let i = 0; i < 5; i++) {
        if (adb) adb.shell('input keyevent KEYCODE_BACK'); else await sh(apiPort, 'input keyevent KEYCODE_BACK', signal)
        await sleep(500, signal)
      }
      await sleep(3000, signal)
      currentState = 'home'; stuckCount = 0; continue
    }

    // 执行
    if (dec.action === 'click' && dec.coordinates.x && dec.coordinates.y) {
      await doTap(dec.coordinates.x, dec.coordinates.y)
      console.log(`[${TS()}] [AI-Decide] tap (${dec.coordinates.x},${dec.coordinates.y}) ${dec.target_desc}`)
      await sleep(4000, signal)
    } else if (dec.action === 'input' && dec.text_content) {
      if (adb) adb.inputText(dec.text_content)
      else await sh(apiPort, `input text "${dec.text_content.replace(/"/g, '\\"')}"`, signal)
      console.log(`[${TS()}] [AI-Decide] text: ${dec.text_content.substring(0, 20)}`)
      await sleep(1000, signal)
    } else if (dec.action === 'wait') {
      await sleep(2000, signal)
    }
  }
  return { success: false, message: '执行超时' }
}
