import { aiDecideNext } from './ai-providers'
import * as UI from './uiautomator-driver'

export const DOUYIN_PKG = 'com.ss.android.ugc.aweme'
export const DOUYIN_ACT = '.main.MainActivity'

/** HTTP Shell 执行 */
async function sh(apiPort: number, cmd: string) {
  await fetch(`http://127.0.0.1:${apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmd)}`, { signal: AbortSignal.timeout(15000) }).catch(() => {})
}

/**
 * AI 驱动发布工作流（全 HTTP Shell）
 */
export async function aiPublishVideoWorkflow(
  apiPort: number,
  title: string,
  topics: string[],
  signal?: AbortSignal
): Promise<{ success: boolean; message: string }> {

  const goal = `发布视频到抖音，标题："${title}"，话题：${topics.join(',')}。`
  const { width: SW, height: SH } = await UI.getScreenSize(apiPort)
  console.log(`[AI-Decide] 屏幕 ${SW}x${SH}`)

  let lastCoord = { x: 0, y: 0 }
  let sameClickCount = 0
  let samePageCount = 0
  let lastAnalysis = ''

  for (let loop = 0; loop < 60; loop++) {
    if (signal?.aborted) { console.log('[AI-Decide] 已停止'); return { success: false, message: '用户停止' } }
    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) { await new Promise(r => setTimeout(r, 2000)); continue }

    const dec = await aiDecideNext(b64, '', goal)
    if (!dec) continue

    console.log(`[AI-Decide] 步骤${loop}: ${dec.analysis}`)

    if (dec.status === 'DONE') return { success: true, message: '视频已发布' }

    // 死循环检测：连续相同分析结果
    if (dec.analysis === lastAnalysis) samePageCount++; else { samePageCount = 0; lastAnalysis = dec.analysis }
    if (samePageCount > 6) {
      console.log('[AI-Decide] 死循环重启')
      await sh(apiPort, `am force-stop ${DOUYIN_PKG}`)
      await new Promise(r => setTimeout(r, 2000))
      await sh(apiPort, `am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`)
      await new Promise(r => setTimeout(r, 12000))
      samePageCount = 0; continue
    }

    // 比例坐标 → 实际像素
    if (dec.action === 'click' && dec.coordinates) {
      let px = Math.round(dec.coordinates.x * SW)
      let py = Math.round(dec.coordinates.y * SH)

      // 同坐标检测：连续 3 次相同则偏移
      if (Math.abs(px - lastCoord.x) < 10 && Math.abs(py - lastCoord.y) < 10) {
        sameClickCount++
      } else {
        sameClickCount = 0
      }
      if (sameClickCount >= 3) {
        py = Math.round(py + 60) // 向下偏移避免遮挡
        sameClickCount = 0
        console.log('[AI-Decide] 同坐标 3 次，偏移 +60px')
      }

      lastCoord = { x: px, y: py }
      await sh(apiPort, `input tap ${px + Math.round(Math.random() * 6 - 3)} ${py + Math.round(Math.random() * 6 - 3)}`)
      console.log(`[AI-Decide] tap (${px},${py}) ${dec.target_desc || ''}`)
      await new Promise(r => setTimeout(r, 2500))
    }

    if (dec.action === 'input' && dec.text_content) {
      const safe = dec.text_content.replace(/"/g, '\\"')
      await sh(apiPort, `input text "${safe}"`)
      console.log(`[AI-Decide] text: ${dec.text_content.substring(0, 20)}`)
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  return { success: false, message: '执行超时' }
}
