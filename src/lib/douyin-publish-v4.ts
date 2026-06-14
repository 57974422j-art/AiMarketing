/**
 * V4 纯坐标极速模式 — 抖音发布
 * 
 * L1: 8步固定坐标序列 + 极简XML抽查
 * L2: 连续2次抽查失败 → VL全景自检 + 截图存档 + 诊断上报
 */

import * as UI from './uiautomator-driver'
import { ADB } from './adb-helper'

const DOUYIN_PKG = 'com.ss.android.ugc.aweme'
const DOUYIN_ACT = '.main.MainActivity'
const TS = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

// ══════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise(r => { const start = Date.now(); const tick = () => { if (signal?.aborted) return r(); if (Date.now() - start >= ms) return r(); setTimeout(tick, 200) }; tick() })
}

async function sh(apiPort: number, cmd: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmd)}`, { signal: signal || AbortSignal.timeout(15000) })
    return res.ok
  } catch { return false }
}

async function smartTap(apiPort: number, x: number, y: number, duration: number, signal?: AbortSignal, adb?: ADB | null): Promise<boolean> {
  const rx = Math.round(x) + Math.floor(Math.random() * 7 - 3)
  const ry = Math.round(y) + Math.floor(Math.random() * 7 - 3)
  const cmd = `input swipe ${rx} ${ry} ${rx} ${ry} ${duration}`
  if (adb) { try { adb.shell(cmd); return true } catch { return sh(apiPort, cmd, signal) } }
  return sh(apiPort, cmd, signal)
}

function pad2(n: number): string { return n.toString().padStart(2, '0') }

// ══════════════════════════════════════════════════════
// 中文输入（复用 AdbKeyboard）
// ══════════════════════════════════════════════════════

async function doInput(apiPort: number, text: string, signal?: AbortSignal, adb?: ADB | null): Promise<boolean> {
  console.log(`[输入] ${text.length}字: "${text.substring(0, 30)}"`)
  
  // 探测输入法
  const imeRaw = await execShell(apiPort, 'ime list -a', signal, adb)
  const adbKeyboardId = imeRaw.output.match(/(com\.android\.adbkeyboard\/\.AdbIME)/)?.[1] || ''
  const hasAdbKb = !!adbKeyboardId
  if (!hasAdbKb) { console.log('[输入⚠] AdbKeyboard未安装'); return false }

  // 切换IME
  const prevIme = imeRaw.output.match(/mCurrentUserId=0 mCurMethodId=([\w./]+)/)?.[1] || ''
  await execShell(apiPort, `ime enable ${adbKeyboardId}`, signal, adb)
  await execShell(apiPort, `ime set ${adbKeyboardId}`, signal, adb)
  await sleep(500, signal)

  // 发送广播（双引号包裹避免#号被shell吞掉）
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')
  const result = await execShell(apiPort, `am broadcast -a ADB_INPUT_TEXT --es msg "${escaped}"`, signal, adb)

  // 恢复原输入法
  if (prevIme) { await sleep(200, signal); await execShell(apiPort, `ime set ${prevIme}`, signal, adb) }
  return result.ok && !result.output.includes('Exception')
}

async function execShell(apiPort: number, cmd: string, signal?: AbortSignal, adb?: ADB | null): Promise<{ ok: boolean; output: string }> {
  try {
    if (adb) {
      const out = adb.shell(cmd)
      return { ok: out.success, output: String(out.output || '') }
    } else {
      const res = await fetch(`http://127.0.0.1:${apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmd)}`, { signal: signal || AbortSignal.timeout(15000) })
      return { ok: res.ok, output: await res.text() }
    }
  } catch (e) { return { ok: false, output: String(e) } }
}

// ══════════════════════════════════════════════════════
// XML 抽查（只找1个关键字）
// ══════════════════════════════════════════════════════

async function xmlSpotCheck(apiPort: number, keyword: string, screenH: number): Promise<{ found: boolean; x: number; y: number }> {
  // 直接 XML dump 手动搜索
  try {
    const dumpResult = await UI.dumpXml(apiPort)
    if (dumpResult.success && dumpResult.data) {
      const nodes = UI.parseUiXml(dumpResult.data)
      for (const node of nodes) {
        const t = (node as any).text || ''
        const d = (node as any).contentDesc || ''
        if (t.includes(keyword) || d.includes(keyword)) {
          const b = UI.parseBounds((node as any).bounds || '')
          if (b) {
            const cx = Math.round(b.x + b.width / 2)
            const cy = Math.round(b.y + b.height / 2)
            if (cy > screenH * 0.05 && cy < screenH * 0.98) return { found: true, x: cx, y: cy }
          }
        }
      }
    }
  } catch {}
  return { found: false, x: 0, y: 0 }
}

// ══════════════════════════════════════════════════════
// L2: VL 全景自检
// ══════════════════════════════════════════════════════

async function vlSelfCheck(
  apiPort: number,
  stepName: string,
  stepCheck: string | null,
  failStreak: number,
  signal?: AbortSignal
) {
  console.log(`\n[${TS()}] ╔══ L2 VL自检触发 ══╗`)
  try {
    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) { console.log(`[${TS()}] [L2✗] 截图失败`); return }

    // VL 自由描述
    const desc = await vlDescribe(b64)
    console.log(`[${TS()}] [VL] 画面: ${desc ? desc.substring(0, 200) : '(VL无响应)'}`)

    // 截图永久存档
    const now = new Date()
    const ssName = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}_${stepName}.png`
    try {
      const fs = await import('fs/promises')
      const path = await import('path')
      const dir = path.join(process.cwd(), 'public', 'screenshots')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, ssName), Buffer.from(b64, 'base64'))
      console.log(`[${TS()}] [存档] 截图: ${ssName}`)
    } catch { console.log(`[${TS()}] [存档✗] 失败`) }

    // 诊断上报
    try {
      await fetch('http://localhost:3000/api/admin/diagnosis-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app: '抖音', step: stepName,
          errorLog: `抽查"${stepCheck}"连续失败 | VL: ${desc?.substring(0, 150) || '无'}`,
          screenshot: ssName, diagnosis: desc || 'VL未返回描述',
          severity: failStreak >= 3 ? 'critical' : 'warning',
        }),
      })
    } catch { console.log(`[${TS()}] [诊断上报✗]`) }

    // 智能决策
    if (desc) {
      const isPopup = desc.includes('弹窗') || desc.includes('提示') || desc.includes('我知道了') || desc.includes('取消') || desc.includes('确定')
      if (isPopup) {
        console.log(`[${TS()}] [弹窗!] 尝试关闭...`)
        const popup = await xmlSpotCheck(apiPort, '我知道了', 2400)
        if (popup.found) { await smartTap(apiPort, popup.x, popup.y, 200, signal, null); await sleep(2000, signal) }
        else { try { await sh(apiPort, 'input keyevent KEYCODE_BACK', signal); await sleep(1500, signal) } catch {} }
      }
    }
  } catch (e: any) {
    console.log(`[${TS()}] [L2异常] ${e?.message || e}`)
  }
  console.log(`[${TS()}] ╚══ L2 结束 ══╝\n`)
}

async function vlDescribe(b64: string): Promise<string | null> {
  try {
    // 直接调百炼 VL
    const { dashscopeDescribeScreen } = await import('./ai-providers') as any
    if (typeof dashscopeDescribeScreen === 'function') return await dashscopeDescribeScreen(b64)
  } catch {}
  return null
}

// ══════════════════════════════════════════════════════
// V4 主入口
// ══════════════════════════════════════════════════════

export async function publishV4(
  apiPort: number,
  title: string,
  topics: string[],
  signal?: AbortSignal,
  adb?: ADB | null,
  options?: { location?: string }
): Promise<{ success: boolean; message: string }> {

  // 屏幕尺寸
  let screenW = 1080, screenH = 2340
  try { const size = await UI.getScreenSize(apiPort); screenW = size.width; screenH = size.height } catch {}

  // 合并标题+话题
  let fullText = title.replace(/"/g, '')
  if (topics && topics.length > 0) {
    const t = topics.join(',').split(/[,#\s]+/).map(x => x.trim().replace(/^#+/, '')).filter(x => x.length >= 2).map(x => `#${x}`)
    if (t.length > 0) fullText += ' ' + t.join(' ')
  }

  const sh2 = screenH, sw2 = screenW
  console.log(`[${TS()}] ====== V4纯坐标 屏幕${sw2}x${sh2} "${fullText.substring(0, 25)}" ======`)

  // 步骤序列（可包含XML文字定位和轮询等待）
  type V4Step = {
    name: string; x: number; y: number; check: string | null;
    input?: string; waitS: number;
    findByText?: string;   // 用XML找文字定位（忽略x/y）
    pollForText?: string;  // 轮询等待文字出现（AI生成封面等场景）
    pollTimeout?: number;  // 轮询超时秒数
  }
  const steps: V4Step[] = [
    { name: '点加号',    x: Math.round(sw2 * 0.50), y: Math.round(sh2 * 0.958), check: '相册',     waitS: 4 },
    { name: '点相册',    x: 873,                     y: 2024,                       check: '全部',     waitS: 4 },
    { name: '切视频标签',x: 405,                     y: 497,                        check: '00:',      waitS: 3 },
    { name: '选视频',    x: 178,                     y: 642,                        check: '下一步',   waitS: 4 },
    { name: '点下一步1', x: 828,                     y: 2279,                       check: '下一步',   waitS: 5 },
    { name: '点下一步2', x: 803,                     y: 2260,                       check: '添加标题', waitS: 5 },
    // 🆕 AI封面
    { name: '点编辑封面',x: 0,                       y: 0,                          check: '智能封面', findByText: '编辑封面', waitS: 3 },
    { name: '点智能封面',x: 141,                     y: 1885,                       check: null,       pollForText: '保存', pollTimeout: 30, waitS: 3 },
    { name: '点保存封面',x: 958,                     y: 139,                        check: '添加标题', waitS: 4 },
    // 输标题+发布
    { name: '输标题',    x: 554,                     y: 1000,                       check: title.substring(0, 3), input: fullText, waitS: 4 },
    { name: '点发布',    x: 731,                     y: 2183,                       check: null,       waitS: 5 },
  ]

  let failStreak = 0
  let currentIdx = 0

  while (currentIdx < steps.length) {
    if (signal?.aborted) return { success: false, message: '用户停止' }
    const step = steps[currentIdx]
    const waitMs = step.waitS * 1000 + Math.floor(Math.random() * 2001)

    console.log(`\n[${TS()}] ─ Step ${currentIdx + 1}/${steps.length}: ${step.name} ─`)

    // ── XML文字定位点击（findByText优先级最高）──
    let tapX = step.x, tapY = step.y
    if (step.findByText) {
      const found = await xmlSpotCheck(apiPort, step.findByText, sh2)
      if (found.found) {
        tapX = found.x; tapY = found.y
        console.log(`[${TS()}] [XML定位] "${step.findByText}" → (${tapX},${tapY})`)
      } else {
        console.log(`[${TS()}] [XML定位✗] "${step.findByText}" 未找到，用默认坐标`)
      }
    }
    await smartTap(apiPort, tapX, tapY, 200 + Math.floor(Math.random() * 81), signal, adb)

    // ── 轮询等待文字出现（AI生成封面等场景）──
    let pollFound = true  // 默认 true（非轮询步骤不干预）
    if (step.pollForText) {
      const timeout = (step.pollTimeout || 30) * 1000
      const pollStart = Date.now()
      pollFound = false
      console.log(`[${TS()}] [轮询] 等待"${step.pollForText}"出现... (超时${step.pollTimeout || 30}s)`)
      while (Date.now() - pollStart < timeout) {
        if (signal?.aborted) return { success: false, message: '用户停止' }
        await sleep(2000, signal)
        const ck = await xmlSpotCheck(apiPort, step.pollForText, sh2)
        if (ck.found) {
          console.log(`[${TS()}] [轮询✓] "${step.pollForText}" 出现 → (${ck.x},${ck.y})`)
          pollFound = true
          break
        }
        console.log(`[${TS()}] [轮询...] 已等${Math.round((Date.now()-pollStart)/1000)}s`)
      }
      if (!pollFound) {
        console.log(`[${TS()}] [轮询⚠] 超时，继续执行`)
      }
    }

    // ── 输入 ──
    if (step.input) {
      await sleep(1500, signal)
      const ok = await doInput(apiPort, step.input, signal, adb)
      console.log(`[${TS()}] [输入${ok ? '✓' : '⚠'}]`)
      await sleep(1000, signal)
    }

    await sleep(waitMs, signal)

    // 抽查
    let spotOk = true
    if (step.pollForText) {
      spotOk = pollFound  // 轮询结果即抽查结果
    } else if (step.check) {
      const ck = await xmlSpotCheck(apiPort, step.check, sh2)
      if (ck.found) {
        console.log(`[${TS()}] [抽查✓] "${step.check}" → (${ck.x},${ck.y})`)
        failStreak = 0
      } else {
        console.log(`[${TS()}] [抽查✗] "${step.check}" 未找到 (连续${failStreak + 1}次)`)
        failStreak++
        spotOk = false
      }
    } else {
      failStreak = 0
    }

    // L2 VL自检
    if (!spotOk && failStreak >= 2) {
      await vlSelfCheck(apiPort, step.name, step.check, failStreak, signal)
      failStreak = 0
      continue  // 重试当前步
    }

    if (spotOk) currentIdx++
  }

  console.log(`\n[${TS()}] ====== V4 完成 ✅ ======`)
  return { success: true, message: '发布流程已执行' }
}
