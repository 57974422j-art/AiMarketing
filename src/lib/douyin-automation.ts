import { RPAClient } from './rpa-client'
import { aiDecideNext } from './ai-providers'
import * as UI from './uiautomator-driver'

export const DOUYIN_PKG = 'com.ss.android.ugc.aweme'
export const DOUYIN_ACT = '.main.MainActivity'

/**
 * AI 驱动发布工作流
 * 双引擎模式：HTTP 截图（感知） + RPA TCP 点击（执行）
 */
export async function aiPublishVideoWorkflow(
  rpa: RPAClient,
  apiPort: number,
  title: string,
  topics: string[]
): Promise<{ success: boolean; message: string }> {
  
  const goal = `发布视频到抖音，标题："${title}"，话题：${topics.join(',')}。`

  await rpa.openDevice()

  for (let loop = 0; loop < 60; loop++) {
    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) {
      console.log('[AI-WorkFlow] HTTP 截图失败')
      await new Promise(r => setTimeout(r, 2000))
      continue
    }

    const dec = await aiDecideNext(b64, '', goal)
    if (!dec) continue

    console.log(`[AI-Decide] 步骤${loop}: ${dec.analysis}`)

    if (dec.status === 'DONE') return { success: true, message: '视频已发布' }

    if (dec.action === 'click' && (dec.target_desc.includes('关闭') || dec.target_desc.includes('放弃'))) {
      await rpa.touchClick(dec.coordinates.x, dec.coordinates.y)
      await new Promise(r => setTimeout(r, 2000))
      continue
    }

    if (dec.action === 'input' && dec.target_desc.includes('标题')) {
      await rpa.touchClick(dec.coordinates.x, dec.coordinates.y)
      await new Promise(r => setTimeout(r, 1000))
      await rpa.execCmd(`input text "${title.replace(/"/g, '\\"')}"`)
      await new Promise(r => setTimeout(r, 1000))
      continue
    }

    if (dec.action === 'click') {
      await rpa.touchClick(dec.coordinates.x, dec.coordinates.y)
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  return { success: false, message: '执行超时' }
}
