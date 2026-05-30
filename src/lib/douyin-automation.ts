import { aiDecideNext } from './ai-providers'
import * as UI from './uiautomator-driver'
import { ADB } from './adb-helper'

export const DOUYIN_PKG = 'com.ss.android.ugc.aweme'
export const DOUYIN_ACT = '.main.MainActivity'

const TS = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

/** 可中止的延迟 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(r => {
    if (signal?.aborted) return r()
    const timer = setTimeout(r, ms)
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); r() }, { once: true })
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
      await sleep(2500, signal)
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
