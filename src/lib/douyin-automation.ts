import { RPAClient } from './rpa-client'
import { aiDecideNext } from './ai-providers'

export const DOUYIN_PKG = 'com.ss.android.ugc.aweme'
export const DOUYIN_ACT = '.main.MainActivity'

/**
 * 完整重构后的 AI 驱动发布工作流
 * 核心原则：彻底摒弃 UI.findAndClick 等老式逻辑，所有动作由 AI 驱动
 */
export async function aiPublishVideoWorkflow(
  rpa: RPAClient,
  title: string,
  topics: string[]
): Promise<{ success: boolean; message: string }> {
  
  const goal = `发布视频到抖音，标题："${title}"，话题：${topics.join(',')}。` +
               `规则：遇到草稿弹窗或任何阻挡性弹窗先点击"关闭/放弃/删除"；目标是完成发布。`

  // 确保设备状态
  await rpa.openDevice()

  for (let loop = 0; loop < 60; loop++) {
    const b64 = await rpa.takeScreenshot()
    if (!b64) {
      console.log('[AI-WorkFlow] 截图失败，尝试重启 App')
      await rpa.execCmd(`am force-stop ${DOUYIN_PKG}`)
      await new Promise(r => setTimeout(r, 3000))
      await rpa.openApp(DOUYIN_PKG, DOUYIN_ACT)
      continue
    }

    // AI 决策中心
    const dec = await aiDecideNext(b64, '', goal)
    if (!dec) {
      await new Promise(r => setTimeout(r, 2000))
      continue
    }

    console.log(`[AI-Decide] 步骤${loop}: ${dec.analysis}`)

    // 1. 成功完成
    if (dec.status === 'DONE') {
      return { success: true, message: '视频已发布' }
    }

    // 2. 紧急阻挡处理 (弹窗/草稿/更新提示)
    if (dec.action === 'click' && (dec.target_desc.includes('关闭') || dec.target_desc.includes('放弃') || dec.target_desc.includes('删除'))) {
      await rpa.touchClick(dec.coordinates.x, dec.coordinates.y)
      await new Promise(r => setTimeout(r, 2000))
      continue
    }

    // 3. 标题输入处理 (关键优化：先聚焦，再注入)
    if (dec.action === 'input' && (dec.target_desc.includes('标题') || dec.target_desc.includes('写点什么'))) {
      await rpa.touchClick(dec.coordinates.x, dec.coordinates.y)
      await new Promise(r => setTimeout(r, 1500))
      await rpa.execCmd(`input text "${title.replace(/"/g, '\\"')}"`)
      await new Promise(r => setTimeout(r, 1000))
      continue
    }

    // 4. 常规执行 (点击)
    if (dec.action === 'click') {
      await rpa.touchClick(dec.coordinates.x, dec.coordinates.y)
      await new Promise(r => setTimeout(r, 2000)) 
    }
  }

  return { success: false, message: '执行超时或陷入死循环' }
}
