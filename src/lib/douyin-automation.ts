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
  topics: string[]
): Promise<{ success: boolean; message: string }> {

  const goal = `发布视频到抖音，标题："${title}"，话题：${topics.join(',')}。`

  for (let loop = 0; loop < 60; loop++) {
    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) { await new Promise(r => setTimeout(r, 2000)); continue }

    const dec = await aiDecideNext(b64, '', goal)
    if (!dec) continue

    console.log(`[AI-Decide] 步骤${loop}: ${dec.analysis}`)

    if (dec.status === 'DONE') return { success: true, message: '视频已发布' }

    // 点击（用 HTTP shell input tap）
    if (dec.action === 'click' && dec.coordinates) {
      const x = Math.round(dec.coordinates.x + (Math.random() * 6 - 3))
      const y = Math.round(dec.coordinates.y + (Math.random() * 6 - 3))
      await sh(apiPort, `input tap ${x} ${y}`)
      console.log(`[AI-Decide] tap (${x},${y}) ${dec.target_desc || ''}`)
      await new Promise(r => setTimeout(r, 2000))
    }

    // 输入文字（用 HTTP shell input text）
    if (dec.action === 'input' && dec.text_content) {
      const safe = dec.text_content.replace(/"/g, '\\"')
      await sh(apiPort, `input text "${safe}"`)
      console.log(`[AI-Decide] text: ${dec.text_content.substring(0, 20)}`)
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  return { success: false, message: '执行超时' }
}
