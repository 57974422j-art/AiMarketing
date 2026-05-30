import { aiDecideNext } from './ai-providers'
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

/** XML 扫描底部导航栏"+"号（灰白圆框 ImageView） */
async function findPlus(apiPort: number, SW: number, SH: number): Promise<{ x: number; y: number } | null> {
  const xmlR = await UI.dumpXml(apiPort)
  if (!xmlR.success) return null
  let best: { x: number; y: number } | null = null
  for (const n of UI.parseUiXml(xmlR.data)) {
    if (!n.className.includes('ImageView') && !n.className.includes('FrameLayout')) continue
    const b = UI.parseBounds(n.bounds)
    if (!b) continue
    const cx = Math.round(b.x + b.width / 2)
    if (b.y >= SH * 0.73 && cx >= SW * 0.278 && cx <= SW * 0.685) {
      if (!best || b.y > best.y) best = { x: cx, y: Math.round(b.y + 5) }
    }
  }
  return best
}

/** XML 找文字按钮 */
async function findText(apiPort: number, text: string): Promise<{ x: number; y: number } | null> {
  const f = await UI.findByText(apiPort, text)
  return f.center || null
}

/** 执行点击，优先 ADB */
async function doTap(apiPort: number, x: number, y: number, adb?: ADB | null, signal?: AbortSignal) {
  if (adb) adb.tap(x, y)
  else await sh(apiPort, `input tap ${x} ${y}`, signal)
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
  console.log(`[${TS()}] [AI-Decide] 屏幕 ${SW}x${SH}`)

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

    // 死循环检测
    if (dec.analysis === lastAnalysis) samePageCount++; else { samePageCount = 0; lastAnalysis = dec.analysis }
    if (samePageCount > 8) {
      console.log(`[${TS()}] [AI-Decide] 死循环重启`)
      if (adb) adb.shell(`am force-stop ${DOUYIN_PKG}`); else await sh(apiPort, `am force-stop ${DOUYIN_PKG}`, signal)
      await sleep(2000, signal)
      if (adb) adb.shell(`am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`); else await sh(apiPort, `am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`, signal)
      await sleep(12000, signal)
      samePageCount = 0; continue
    }

    // XML 优先定位（可靠），AI 兜底
    let tapX: number | null = null
    let tapY: number | null = null

    if (dec.target_desc?.includes('加号') || dec.analysis.includes('加号')) {
      const p = await findPlus(apiPort, SW, SH)
      if (p) { tapX = p.x; tapY = p.y; console.log(`[${TS()}] [AI-Decide] XML找+号 (${tapX},${tapY})`) }
    } else if (dec.target_desc?.includes('相册')) {
      const p = await findText(apiPort, '相册')
      if (p) { tapX = p.x; tapY = p.y; console.log(`[${TS()}] [AI-Decide] XML找相册 (${tapX},${tapY})`) }
    } else if (dec.target_desc?.includes('去编辑') || dec.target_desc?.includes('我知道了')) {
      const p = await findText(apiPort, '去编辑') || await findText(apiPort, '我知道了')
      if (p) { tapX = p.x; tapY = p.y; console.log(`[${TS()}] [AI-Decide] XML找弹窗按钮 (${tapX},${tapY})`) }
    } else if (dec.target_desc?.includes('添加标题') || dec.target_desc?.includes('发布') || dec.target_desc?.includes('发作品')) {
      const txt = dec.target_desc.includes('发') ? '发布' : '添加标题'
      const p = await findText(apiPort, txt)
      if (p) { tapX = p.x; tapY = p.y; console.log(`[${TS()}] [AI-Decide] XML找${txt} (${tapX},${tapY})`) }
    }

    // XML 没找到 → 用 AI 坐标
    if (tapX === null && dec.coordinates) {
      tapX = Math.round(dec.coordinates.x * SW)
      tapY = Math.round(dec.coordinates.y * SH)
    }

    // 执行点击
    if (tapX !== null && tapY !== null && dec.action === 'click') {
      await doTap(apiPort, tapX, tapY, adb, signal)
      console.log(`[${TS()}] [AI-Decide] tap (${tapX},${tapY}) ${dec.target_desc || ''}`)
      await sleep(4000, signal)
    } else if (dec.action === 'input' && dec.text_content) {
      if (adb) adb.inputText(dec.text_content)
      else await sh(apiPort, `input text "${dec.text_content.replace(/"/g, '\\"')}"`, signal)
      console.log(`[${TS()}] [AI-Decide] text: ${dec.text_content.substring(0, 20)}`)
      await sleep(1000, signal)
    }
  }
  return { success: false, message: '执行超时' }
}
