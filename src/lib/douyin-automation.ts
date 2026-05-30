import * as UI from './uiautomator-driver'
import { ADB } from './adb-helper'
import { aiDecideNext } from './ai-providers'

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

  const goal = `发布视频到抖音，标题："${title}"，话题：${topics.join(',')}`
  const { width: SW, height: SH } = await UI.getScreenSize(apiPort)
  console.log(`[${TS()}] 屏幕 ${SW}x${SH}`)

  const doTap = (x: number, y: number) => {
    if (adb) adb.tap(Math.round(x), Math.round(y))
    else sh(apiPort, `input tap ${Math.round(x)} ${Math.round(y)}`, signal)
  }

  // 学习记录（已验证成功的步骤坐标）
  const learned: Record<string, { x: number; y: number }> = {}
  let lastPageDesc = ''
  let stuckCount = 0

  for (let loop = 0; loop < 60; loop++) {
    if (signal?.aborted) { return { success: false, message: '用户停止' } }

    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) { await sleep(2000, signal); continue }

    // 原始 prompt 方式：一次调用完成页面识别 + 坐标定位
    const dec = await aiDecideNext(b64, '', goal, { width: SW, height: SH })
    if (!dec) { await sleep(2000, signal); continue }
    console.log(`[${TS()}] [AI] ${dec.analysis} → ${dec.target_desc}`)

    if (dec.status === 'DONE') return { success: true, message: '视频已发布' }

    // 卡住检测
    if (dec.analysis === lastPageDesc) stuckCount++; else { stuckCount = 0; lastPageDesc = dec.analysis }
    if (stuckCount > 10) {
      console.log(`[${TS()}] [卡住] 回首页`)
      for (let i = 0; i < 5; i++) { if (adb) adb.shell('input keyevent KEYCODE_BACK'); else await sh(apiPort, 'input keyevent KEYCODE_BACK', signal); await sleep(500, signal) }
      await sleep(3000, signal); stuckCount = 0; continue
    }

    // 查学习记录
    const cacheKey = `${dec.analysis}|${dec.target_desc}`
    if (learned[cacheKey]) {
      const c = learned[cacheKey]
      await doTap(c.x, c.y)
      console.log(`[${TS()}] [学习] (${c.x},${c.y}) ${dec.target_desc}`)
      await sleep(4000, signal)
      continue
    }

    // 执行
    if (dec.action === 'click' && dec.coordinates.x && dec.coordinates.y) {
      await doTap(dec.coordinates.x, dec.coordinates.y)
      console.log(`[${TS()}] [点击] (${dec.coordinates.x},${dec.coordinates.y}) ${dec.target_desc}`)
      await sleep(4000, signal)

      // 验证：页面变了才学习
      const b64v = await UI.takeScreenshot(apiPort)
      if (b64v) {
        const dec2 = await aiDecideNext(b64v, '', goal, { width: SW, height: SH })
        if (dec2 && dec2.analysis !== dec.analysis) {
          learned[cacheKey] = { x: dec.coordinates.x, y: dec.coordinates.y }
          console.log(`[${TS()}] [成功] 已学习: ${cacheKey}`)
        }
      }
    } else if (dec.action === 'input' && dec.text_content) {
      if (adb) adb.inputText(dec.text_content)
      else await sh(apiPort, `input text "${dec.text_content.replace(/"/g, '\\"')}"`, signal)
      console.log(`[${TS()}] [输入] ${dec.text_content.substring(0, 20)}`)
      await sleep(1000, signal)
    } else {
      await sleep(2000, signal)
    }
  }
  return { success: false, message: '执行超时' }
}
