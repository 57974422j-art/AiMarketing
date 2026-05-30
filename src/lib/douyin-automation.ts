import { aiDecideNext } from './ai-providers'
import * as UI from './uiautomator-driver'
import { ADB } from './adb-helper'

export const DOUYIN_PKG = 'com.ss.android.ugc.aweme'
export const DOUYIN_ACT = '.main.MainActivity'

const TS = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

/** 可中止的延迟（每 200ms 轮询一次 signal，不加监听器避免泄漏） */
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
  console.log(`[${TS()}] [AI-Decide] 屏幕 ${SW}x${SH} ${adb ? 'ADB模式' : 'HTTP模式'}`)

  let samePageCount = 0
  let lastAnalysis = ''

  for (let loop = 0; loop < 60; loop++) {
    if (signal?.aborted) { console.log(`[${TS()}] [AI-Decide] 已停止`); return { success: false, message: '用户停止' } }

    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) { await sleep(2000, signal); continue }
    const dec = await aiDecideNext(b64, '', goal)
    if (!dec) { await sleep(2000, signal); continue }
    console.log(`[${TS()}] [AI-Decide] 步骤${loop}: ${dec.analysis}`)
    if (dec.status === 'DONE') return { success: true, message: '视频已发布' }

    if (dec.analysis === lastAnalysis) samePageCount++; else { samePageCount = 0; lastAnalysis = dec.analysis }
    if (samePageCount > 6) {
      console.log(`[${TS()}] [AI-Decide] 死循环重启`)
      if (adb) adb.shell(`am force-stop ${DOUYIN_PKG}`); else await sh(apiPort, `am force-stop ${DOUYIN_PKG}`, signal)
      await sleep(2000, signal)
      if (adb) adb.shell(`am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`); else await sh(apiPort, `am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`, signal)
      await sleep(12000, signal)
      samePageCount = 0; continue
    }

    if (dec.action === 'click' && dec.coordinates) {
      const px = Math.round(dec.coordinates.x * SW)
      const py = Math.round(dec.coordinates.y * SH)
      if (adb) adb.tap(px, py)
      else await sh(apiPort, `input tap ${px} ${py}`, signal)
      console.log(`[${TS()}] [AI-Decide] ${adb?'ADB':'HTTP'} tap (${px},${py}) ${dec.target_desc || ''}`)
      // 等待页面响应：前 2 秒等动画，再 3 秒确认页面稳定
      for (let w = 0; w < 5; w++) {
        await sleep(1000, signal)
        if (signal?.aborted) break
        if (w === 4 || loop < 5) continue // 最后一次或前几次等待更久
      }
      // 如果 tap 后再次分析仍然是同一页面描述，且已等够时间，让下一轮循环重新判断
      lastAnalysis = '' // 清空记录，避免连续相同判断
    }
    if (dec.action === 'input' && dec.text_content) {
      if (adb) adb.inputText(dec.text_content)
      else await sh(apiPort, `input text "${dec.text_content.replace(/"/g, '\\"')}"`, signal)
      console.log(`[${TS()}] [AI-Decide] text: ${dec.text_content.substring(0, 20)}`)
      await sleep(1000, signal)
    }
  }
  return { success: false, message: '执行超时' }
}
