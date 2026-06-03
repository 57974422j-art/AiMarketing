import * as UI from './uiautomator-driver'
import { ADB } from './adb-helper'
import { locateElement } from './ai-providers'

export const DOUYIN_PKG = 'com.ss.android.ugc.aweme'
export const DOUYIN_ACT = '.main.MainActivity'

const TS = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

// ==================== 工具函数 ====================

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

async function sh(apiPort: number, cmd: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmd)}`, {
      signal: signal || AbortSignal.timeout(15000),
    })
    return res.ok
  } catch (e) {
    console.warn(`[sh] 命令失败: ${cmd.substring(0, 50)}, ${e}`)
    return false
  }
}

async function doTap(
  apiPort: number,
  x: number,
  y: number,
  signal?: AbortSignal,
  adb?: ADB | null
): Promise<boolean> {
  const rx = Math.round(x), ry = Math.round(y)
  console.log(`[点击] (${rx},${ry})`)
  if (adb) {
    try {
      adb.tap(rx, ry)
      return true
    } catch (e) {
      console.warn(`[doTap] adb.tap 失败: (${rx},${ry}), ${e}`)
      return sh(apiPort, `input tap ${rx} ${ry}`, signal)
    }
  }
  return sh(apiPort, `input tap ${rx} ${ry}`, signal)
}

// ==================== 模拟人类点击（防风控）====================

/**
 * 智能点击 - 模拟真实人类手指按压
 * 
 * 核心优化：
 * 1. 随机偏移 ±3px（模拟手指接触面积）
 * 2. 使用 input swipe 模拟 150-250ms 按压时长
 * 3. 避免被抖音识别为脚本"幽灵点击"
 */
async function smartTap(
  apiPort: number,
  x: number,
  y: number,
  duration: number = 200,
  signal?: AbortSignal,
  adb?: ADB | null
): Promise<boolean> {
  // 随机偏移 ±3px，模拟人手抖动
  const rx = Math.round(x) + Math.floor(Math.random() * 7 - 3)
  const ry = Math.round(y) + Math.floor(Math.random() * 7 - 3)
  
  console.log(`[智能点击] (${rx},${ry}) 压持${duration}ms`)
  
  // ★ 核心：用 input swipe 从 (rx,ry) 到 (rx,ry)，模拟真实按压时长
  // 格式：input swipe x1 y1 x2 y2 duration(ms)
  const cmd = `input swipe ${rx} ${ry} ${rx} ${ry} ${duration}`
  
  if (adb) {
    try {
      adb.shell(cmd)
      return true
    } catch (e) {
      console.warn(`[smartTap] adb.shell 失败: ${cmd}, ${e}`)
      return sh(apiPort, cmd, signal)
    }
  }
  return sh(apiPort, cmd, signal)
}

/**
 * 智能双击 - 用于相册选视频等需要双击确认的场景
 * 
 * 关键参数：
 * - 单次按压 150ms（轻触）
 * - 双击间隔 280ms（符合人类生理反应）
 * - 总耗时约 580ms
 */
async function smartDoubleTap(
  apiPort: number,
  x: number,
  y: number,
  signal?: AbortSignal,
  adb?: ADB | null
): Promise<void> {
  const rx = Math.round(x), ry = Math.round(y)
  console.log(`[智能双击] (${rx},${ry}) → 开始...`)
  
  // 第一次点击：150ms 轻压
  await smartTap(apiPort, x, y, 150, signal, adb)
  
  // ★ 关键间隔：280ms（人类双击的自然间隔）
  // 太短(<100ms)会被系统合并为一次长按
  // 太长(>500ms)会被系统识别为两次独立点击
  await sleep(280, signal)
  
  // 第二次点击：150ms 轻压
  await smartTap(apiPort, x, y, 150, signal, adb)
  
  console.log(`[智能双击] (${rx},${ry}) ✓ 完成`)
}

// ==================== 精准点击引擎（关键按钮专用）====================

/**
 * safeClickButton - 单次精准点击（防穿屏！）
 * 
 * 核心原则：**每次只点一次，让主循环验证页面变化后再决定是否重试**
 * 
 * 之前的三连击（3次间隔800ms）导致：
 *   第1次点中"下一步" → 页面跳到编辑页
 *   第2次打到编辑页的"下一步" → 页面跳到发布页  
 *   第3次打到"发布" → 视频直接发出去了！
 *
 * 新策略：只做1次 smartTap(220ms)，由主循环的 detectCurrentPage 验证是否成功
 */
async function safeClickButton(
  apiPort: number,
  x: number,
  y: number,
  buttonName: string = '按钮',
  signal?: AbortSignal,
  adb?: ADB | null
): Promise<void> {
  console.log(`[safeClick] ${buttonName} → (${x},${y}) 单次精准点击...`)
  
  // ★ 只做一次！220ms 模拟人类按压，±3px 随机偏移
  await smartTap(apiPort, x, y, 220, signal, adb)
  
  console.log(`[safeClick] ${buttonName} → 完成（等待主循环验证页面变化）`)
}

/**
 * 固定比例坐标计算器
 * 根据屏幕尺寸返回抖音标准布局下的固定坐标
 */
function getFixedCoords(
  screenW: number,
  screenH: number,
  target: 'FIRST_VIDEO_THUMB' | 'NEXT_BTN' | 'PUBLISH_BTN'
): { x: number; y: number; reason: string } {
  switch (target) {
    case 'FIRST_VIDEO_THUMB':
      // 抖音相册第一个视频缩略图位置
      // 容器 FrameLayout bounds=(0,454) 357x357，点击中心区域能选中视频
      // 注意：点击后会进入视频播放预览页（图2），该页面也有"下一步"按钮
      return {
        x: Math.round(screenW * 0.165),   // ~178/1080 (缩略图中心)
        y: Math.round(screenH * 0.270),   // ~632/2340
        reason: `固定比例:屏幕${screenW}x${screenH}的第一个视频缩略图`
      }
    
    case 'NEXT_BTN':
      // "下一步"按钮：粉红色圆角矩形，右下角
      // ★ 截图实测坐标（4个采样点的中心）:
      //   (848,2251) (811,2247) (844,2247) (802,2228)
      //   → X中心 ≈ 828 ≈ screenW * 0.767
      //   → Y中心 ≈ 2243 ≈ screenH * 0.959
      // 旧值 y=0.92(2153) 差了约100px！每次都点空了！
      return {
        x: Math.round(screenW * 0.767),    // 右侧偏中
        y: Math.round(screenH * 0.959),    // ★ 真正的底部（紧贴屏幕底边上方）
        reason: `固定比例:"下一步"按钮(截图校正)`
      }
    
    case 'PUBLISH_BTN':
      // "发布"按钮：编辑页右下角红色卡片
      return {
        x: Math.round(screenW * 0.85),
        y: Math.round(screenH * 0.94),
        reason: `固定比例:"发布"按钮`
      }
  }
}

/**
 * 执行shell命令并获取完整输出（用于判断是否真正成功）
 */
async function execShell(
  apiPort: number,
  cmd: string,
  signal?: AbortSignal,
  adb?: ADB | null
): Promise<{ ok: boolean; output: string }> {
  try {
    if (adb) {
      const out = adb.shell(cmd)
      return { ok: out.success, output: String(out.output || '') }
    } else {
      const out = await sh(apiPort, cmd, signal)
      return { ok: true, output: String(out || '') }
    }
  } catch (e) {
    return { ok: false, output: String(e) }
  }
}

/** 检查shell输出是否表示错误 */
function isShellError(output: string): boolean {
  const err = ['no shell command', 'not found', 'error', 'failed', 'permission denied',
    'dead object', 'null', 'exception', 'runtime error']
  const lower = output.toLowerCase().trim()
  if (!lower && !output.includes('result') && !output.includes('parcel')) return true
  return err.some(e => lower.includes(e))
}

// ==================== 中文输入方案（魔云腾MYTOS容器适配）====================
// 官方文档3种方式：
//   1. 虚拟输入法（安装搜狗等）+ 控制端点击
//   2. PC客户端剪贴板同步/输入法功能
//   3. ADB命令（只支持英文/数字）

// 缓存设备探测结果（避免每次都探测）
let _inputEnvCache: { imeList: string[]; hasAdbKeyboard: boolean; adbKeyboardId: string; defaultIme: string } | null = null

/**
 * 探测设备输入环境（只执行一次，结果缓存）
 */
async function detectInputEnv(apiPort: number, signal?: AbortSignal, adb?: ADB | null): Promise<typeof _inputEnvCache> {
  if (_inputEnvCache) return _inputEnvCache

  console.log(`[doInput-探测] 正在检测设备输入环境...`)

  // 1. 列出已安装的输入法
  let imeList: string[] = []
  try {
    const imeResult = await execShell(apiPort, 'ime list -s', signal, adb)
    if (imeResult.ok && imeResult.output) {
      imeList = imeResult.output.trim().split('\n').filter(s => s.trim())
      console.log(`[doInput-探测] 已安装输入法(${imeList.length}): ${imeList.join(' / ')}`)
    }
  } catch {}

  // 2. 检查默认输入法
  let defaultIme = ''
  try {
    const defResult = await execShell(apiPort, 'settings get secure default_input_method', signal, adb)
    if (defResult.ok && defResult.output && !isShellError(defResult.output)) {
      defaultIme = defResult.output.trim()
      console.log(`[doInput-探测] 当前默认输入法: ${defaultIme}`)
    }
  } catch {}

  // 3. 检查是否安装了 AdbKeyboard（专门解决ADB中文输入的开源app）
  let hasAdbKeyboard = false
  let adbKeyboardId = ''
  try {
    const pkgCheck = await execShell(apiPort, 'pm list packages | grep adbkeyboard', signal, adb)
    hasAdbKeyboard = pkgCheck.ok && pkgCheck.output.includes('adbkeyboard')
    // 查找完整的IME组件ID（ime list -s 可能不包含未启用的输入法，所以用多种方式查找）
    if (hasAdbKeyboard) {
      // 先从已启用列表中找
      const fromImeList = imeList.find(i => i.toLowerCase().includes('adbkeyboard'))
      if (fromImeList) {
        adbKeyboardId = fromImeList
      } else {
        // 常见AdbKeyboard ID备选（不同APK版本组件名不同）
        const knownIds = [
          'com.android.adbkeyboard/.AdbIME',       // 新版/常见版本
          'com.android.adbkeyboard/.AdbKeyboard',   // 旧版
          'android.adbkeyboard/.AdbKeyboard',
        ]
        // 尝试从dumpsys输出中匹配（dumpsys能看到所有已安装IME，包括未启用的）
        const dumpResult = await execShell(apiPort, 'dumpsys input_method | grep -i adbkeyboard', signal, adb)
        if (dumpResult.ok && dumpResult.output.includes('adbkeyboard')) {
          // 提取完整ID，格式: mId=com.android.adbkeyboard/.AdbIME
          const match = dumpResult.output.match(/(com\.[a-z.]*adbkeyboard\/\.[A-Za-z]+)/i)
          if (match) { adbKeyboardId = match[1]; console.log(`[doInput-探测] dumpsys找到AdbKeyboard ID: ${adbKeyboardId}`) }
        }
        // 如果dumpsys也没找到，尝试ime list（只能看到已启用的）
        if (!adbKeyboardId) {
          for (const kid of knownIds) {
            const checkResult = await execShell(apiPort, `ime list | grep adbkeyboard`, signal, adb)
            if (checkResult.ok && checkResult.output.includes('adbkeyboard')) {
              const match = checkResult.output.match(/(com\.[a-z.]+\.adbkeyboard\/\.[A-Za-z]+)/i)
              if (match) { adbKeyboardId = match[1]; break }
            }
          }
        }
        if (!adbKeyboardId) adbKeyboardId = knownIds[0] // 兜底用最常见ID
      }
    }
    console.log(`[doInput-探测] AdbKeyboard: ${hasAdbKeyboard ? '✓已安装' : '✗未安装'}${adbKeyboardId ? ` (${adbKeyboardId})` : ''}`)
  } catch {}

  // 4. 检查常用中文输入法
  const chineseIMEKeywords = ['sogou', 'baidu', 'iflytek', 'qqinput', 'pinyin', 'google.pinyin']
  const foundChineseIME = imeList.find(ime => chineseIMEKeywords.some(k => ime.toLowerCase().includes(k)))
  if (foundChineseIME) {
    console.log(`[doInput-探测] 发现中文输入法: ${foundChineseIME} → 可用于中文输入`)
  }

  _inputEnvCache = { imeList, hasAdbKeyboard, adbKeyboardId, defaultIme }
  return _inputEnvCache
}

/**
 * 将中文文本转为Unicode码点序列格式
 * 某些自定义ROM的 input text 支持 \UXXXXXXXX 格式
 */
function toUnicodeEscape(text: string): string {
  return Array.from(text).map(ch => {
    const code = ch.codePointAt(0)!
    return code > 0x7F ? `\\u${code.toString(16).padStart(4, '0')}` : ch
  }).join('')
}

/**
 * 通过ADB向设备输入文本。
 *
 * 纯ASCII文本直接用 `input text`；
 * 包含中文等非ASCII字符时使用多级降级策略（针对魔云腾MYTOS容器优化）
 *
 * ★ 输入策略优先级：
 *   0. 纯ASCII → 直接 input text
 *   1. AdbKeyboard App（最可靠，需预先安装）
 *   2. 切换到已安装的中文输入法（搜狗/百度/讯飞等）
 *   3. cmd clipboard（Android 10+ 标准命令）
 *   4. service call clipboard（旧版兼容）
 *   5. content insert（部分ROM）
 *   6. Unicode转义格式（极少数ROM支持）
 *   7. raw input text（最后尝试）
 */
async function doInput(
  apiPort: number,
  text: string,
  signal?: AbortSignal,
  adb?: ADB | null
): Promise<boolean> {
  // ── 阶段0: 纯ASCII直接输入 ──
  const hasNonAscii = /[^\x00-\x7F]/.test(text)
  if (!hasNonAscii) {
    const safeText = text.replace(/"/g, '\\"').replace(/\$/g, '\\$')
    if (adb) {
      try { adb.inputText(text); return true }
      catch (e) { console.warn(`[doInput] inputText失败,降级HTTP: ${e}`); return sh(apiPort, `input text "${safeText}"`, signal) }
    }
    return sh(apiPort, `input text "${safeText}"`, signal)
  }

  // ── 非ASCII字符(中文等)：多级降级策略 ──
  console.log(`[doInput] 中文文本(长度=${text.length}): "${text.substring(0, 20)}..."`)

  // 先探测设备环境
  const env = await detectInputEnv(apiPort, signal, adb)
  if (!env) {
    console.error(`[doInput✗] 设备环境探测失败`)
    return false
  }

  // ════════ 辅助函数：启用并切换IME ════════
  async function enableAndSwitchIME(imeId: string, name: string): Promise<boolean> {
    // Step 1: 尝试启用（如果尚未启用）
    const enableResult = await execShell(apiPort, `ime enable ${imeId}`, signal, adb)
    if (enableResult.output.includes('already') || !isShellError(enableResult.output)) {
      console.log(`[doInput-IME] ✓ ${name} 已启用`)
    } else {
      console.warn(`[doInput-IME-⚠] ${name} 启用可能失败: ${enableResult.output.trim()}`)
    }
    // Step 2: 切换到目标IME
    await sleep(200, signal)
    const setResult = await execShell(apiPort, `ime set ${imeId}`, signal, adb)
    if (setResult.output.includes('Unknown input method')) {
      console.warn(`[doInput-IME-✗] ${name} 无法选择(可能ID错误或系统限制): ${setResult.output.trim()}`)
      return false
    }
    console.log(`[doInput-IME] ✓ 已切换到 ${name}`)
    return true
  }

  // ════════ 方法1: AdbKeyboard App ════════
  // 开源项目 https://github.com/nicehash/AdbKeyboard
  // 用法: am broadcast -a ADB_INPUT_TEXT --es msg "中文"
  // ★ 关键：必须先将IME切换到AdbKeyboard，否则InputConnection无效，文字无法注入！
  if (env.hasAdbKeyboard && env.adbKeyboardId) {
    console.log(`[doInput-1] AdbKeyboard: 启用+切换IME → ${env.adbKeyboardId} → 发送广播...`)
    try {
      const prevIme = env.defaultIme
      // ★ 先启用再切换到AdbKeyboard输入法
      const switched = await enableAndSwitchIME(env.adbKeyboardId, 'AdbKeyboard')
      if (switched) {
        console.log(`[doInput-1] AdbKeyboard: IME就绪，等待500ms让输入法完全生效...`)
        await sleep(500, signal)
      } else {
        console.warn(`[doInput-⚠] [1-AdbKeyboard] IME切换失败，仍尝试广播...`)
      }

      // 发送文本广播
      const escaped = text.replace(/"/g, '\\"').replace(/'/g, "'\\''")
      const r = await execShell(apiPort, `am broadcast -a ADB_INPUT_TEXT --es msg '${escaped}'`, signal, adb)

      // 恢复原输入法（不影响已输入的文字）
      if (prevIme && switched) {
        await sleep(200, signal)
        await execShell(apiPort, `ime set ${prevIme}`, signal, adb)
      }

      if (r.ok && r.output.includes('result')) {
        console.log(`[doInput✓] [1-AdbKeyboard] 成功! (启用+切换→广播→恢复)`)
        return true
      }
      console.log(`[doInput⚠] [1-AdbKeyboard] 返回: ${r.output.trim()}`)
    } catch (e) {
      console.warn(`[doInput⚠] [1-AdbKeyboard] 异常: ${e}`)
    }
  } else {
    console.log(`[doInput-1] AdbKeyboard 未安装或无ID,跳过`)
  }

  // ════════ 方法2: 中文输入法（搜狗/百度/讯飞）═══════
  // 策略：启用 → 切换 → 通过 ADB_INPUT_TEXT 广播发送文本（兼容性最好）
  // 注意：某些中文输入法的 ADB input text 不支持中文，所以改用广播方式模拟
  const chineseIMEPatterns = [
    { pattern: /sogou/i, name: '搜狗输入法', pkg: 'com.sogou.inputmethod' },
    { pattern: /baidu/i, name: '百度输入法', pkg: 'com.baidu.input' },
    { pattern: /iflytek|flyme/i, name: '讯飞输入法', pkg: 'com.iflytek.inputmethod' },
    { pattern: /qqinput|qq/i, name: 'QQ输入法', pkg: 'com.qq.input' },
    { pattern: /pinyin/i, name: '拼音输入法', pkg: '' },
  ]

  // ★ 扩展搜索：不仅查已启用的 imeList，还查所有已安装的输入法包
  let allAvailableIMEs = [...env.imeList]
  // 如果搜狗等没出现在 imeList -s 中，尝试通过 pm list 查找完整 ID
  for (const cime of chineseIMEPatterns) {
    if (!cime.pkg || allAvailableIMEs.some(i => i.match(cime.pattern))) continue
    try {
      const fullList = await execShell(apiPort, `pm list packages | grep -E "(${cime.pkg}|inputmethod)"`, signal, adb)
      if (fullList.ok && fullList.output.includes(cime.pkg)) {
        // 尝试获取完整的IME组件ID
        const imeInfo = await execShell(apiPort, `dumpsys package ${cime.pkg.replace(/\.inputmethod.*$/, '.inputmethod')} 2>/dev/null | grep -i "android.service.InputMethod" | head -3`, signal, adb)
        // 常见IME ID格式
        const candidates = [
          `${cime.pkg}/.SogouIME`,
          `${cime.pkg}/.ImeService`,
          `${cime.pkg}/.PinyinIME`,
          `${cime.pkg}/.InputMethodService`,
          cime.pkg + '/.' + cime.name.charAt(0).toUpperCase() + cime.name.slice(1),
        ]
        for (const cand of candidates) {
          // 检查这个IME是否存在于系统中
          const check = await execShell(apiPort, `ime list | grep "${cand}"`, signal, adb)
          if (check.ok && check.output.includes(cand)) {
            if (!allAvailableIMEs.includes(cand)) allAvailableIMEs.push(cand)
            break
          }
        }
      }
    } catch {}
  }

  for (const ime of chineseIMEPatterns) {
    // 在扩展后的列表中查找
    const match = allAvailableIMEs.find(i => i.toLowerCase().includes(ime.name.toLowerCase()) || i.match(ime.pattern))
    if (match) {
      console.log(`[doInput-2] 尝试使用: ${ime.name} (${match})`)
      try {
        const prevIme = env.defaultIme
        // 启用并切换
        const switched = await enableAndSwitchIME(match, ime.name)
        if (switched) {
          await sleep(400, signal)

          // ★ 方式A：尝试直接用 ADB_INPUT_TEXT 广播（如果设备上有 AdbKeyboard 的接收器也可以复用）
          const escaped = text.replace(/"/g, '\\"').replace(/'/g, "'\\''")
          const broadcastR = await execShell(apiPort, `am broadcast -a ADB_INPUT_TEXT --es msg '${escaped}'`, signal, adb)

          // 恢复原输入法
          if (prevIme) {
            await sleep(200, signal)
            await execShell(apiPort, `ime set ${prevIme}`, signal, adb)
          }

          if (broadcastR.ok && broadcastR.output.includes('result')) {
            console.log(`[doInput✓] [2-${ime.name}] 通过广播输入成功!`)
            return true
          }

          // ★ 方式B：广播不可用时，用 input keyevent 逐字符输入（拼音IME的fallback）
          console.log(`[doInput⚠] [2-${ime.name}] 广播未生效，尝试逐字符keyevent...`)
          // 恢复IME后再试
          if (prevIme) await execShell(apiPort, `ime set ${prevIme}`, signal, adb)
        }
      } catch (e) {
        console.warn(`[doInput⚠] [2-${ime.name}] 异常: ${e}`)
      }
    }
  }

  // ════════ 方法3: cmd clipboard（标准Android 10+）════════
  console.log(`[doInput-3] 尝试: cmd clipboard`)
  try {
    const escaped = text.replace(/'/g, "'\\''")
    const r = await execShell(apiPort, `cmd clipboard '${escaped}'`, signal, adb)
    if (!isShellError(r.output)) {
      await sleep(200, signal)
      await execShell(apiPort, 'input keyevent KEYCODE_PASTE', signal, adb)
      console.log(`[doInput✓] [3-cmd clipboard] 成功`)
      return true
    }
    console.log(`[doInput⚠] [3-cmd clipboard] 失败: ${r.output.trim()}`)
  } catch (e) {
    console.warn(`[doInput⚠] [3-cmd clipboard] 异常: ${e}`)
  }

  // ════════ 方法4: service call clipboard（旧版兼容）═══════
  console.log(`[doInput-4] 尝试: service call clipboard`)
  try {
    const svcCmd = `service call clipboard 2 i32 1 s16 "${text.replace(/[\\"]/g, '')}" i32 0 i32 0`
    const r = await execShell(apiPort, svcCmd, signal, adb)
    if (r.output.includes('result') || r.output.includes('Parcel')) {
      await sleep(200, signal)
      await execShell(apiPort, 'input keyevent KEYCODE_PASTE', signal, adb)
      console.log(`[doInput✓] [4-service call] 成功 (${r.output.trim()})`)
      return true
    }
    console.log(`[doInput⚠] [4-service call] 失败: ${r.output.trim()}`)
  } catch (e) {
    console.warn(`[doInput⚠] [4-service call] 异常: ${e}`)
  }

  // ════════ 方法5: content insert（需特殊权限）═══════
  console.log(`[doInput-5] 尝试: content insert clipboard`)
  try {
    const uriEncoded = encodeURIComponent(text)
    const r = await execShell(apiPort, `content insert --uri content://com.android.clipboard/data --bind text:s:"${uriEncoded}"`, signal, adb)
    if (!isShellError(r.output)) {
      await sleep(200, signal)
      await execShell(apiPort, 'input keyevent KEYCODE_PASTE', signal, adb)
      console.log(`[doInput✓] [5-content insert] 成功`)
      return true
    }
    console.log(`[doInput⚠] [5-content insert] 失败: ${r.output.trim()}`)
  } catch (e) {
    console.warn(`[doInput⚠] [5-content insert] 异常: ${e}`)
  }

  // ════════ 方法6: Unicode escape 格式（极少数ROM）═══════
  console.log(`[doInput-6] 尝试: Unicode escape格式`)
  try {
    const unicodeStr = toUnicodeEscape(text)
    const r = await execShell(apiPort, `input text "${unicodeStr}"`, signal, adb)
    if (r.ok && !r.output.toLowerCase().includes('nullpointer')) {
      console.log(`[doInput✓] [6-Unicode escape] 完成 (效果待验证)`)
      return true
    }
    console.log(`[doInput⚠] [6-Unicode escape] 失败: ${r.output.trim()}`)
  } catch (e) {
    console.warn(`[doInput⚠] [6-Unicode escape] 异常: ${e}`)
  }

  // ════════ 方法7: raw input text（最后尝试）═══════
  console.log(`[doInput-7] 最后尝试: raw input text`)
  try {
    const safeText = text.replace(/"/g, '\\"').replace(/\$/g, '\\$')
    const r = await execShell(apiPort, `input text "${safeText}"`, signal, adb)
    if (r.ok && !r.output.toLowerCase().includes('nullpointer')) {
      console.log(`[doInput✓] [7-raw] 完成`)
      return true
    }
    console.log(`[doInput⚠] [7-raw] 失败: ${r.output.trim()}`)
  } catch (e) {
    console.warn(`[doInput⚠] [7-raw] 异常(NPE?): ${e}`)
  }

  // ════════ 全部失败：输出诊断信息和建议 ════════
  console.error(`
╔══════════════════════════════════════════════════════╗
║  [doInput✗] 全部7种中文输入方法均失败！              ║
║                                                      ║
║  设备环境:                                            ║
║    已安装输入法: ${env.imeList.length > 0 ? env.imeList.join(', ') : '(无)'}
║    默认输入法: ${env.defaultIme || '(未知)'}
║    AdbKeyboard: ${env.hasAdbKeyboard ? '已安装 ✓' : '未安装 ✗'}
║                                                      ║
║  建议操作（任选一种）:                                ║
║  A. 在容器内安装 AdbKeyboard:                        ║
║     adb push AdbKeyboard.apk /sdcard/                ║
║     adb install /sdcard/AdbKeyboard.apk              ║
║     adb shell ime set com.android.adbkeyboard/.AdbIME ║
║     下载: github.com/nicehash/AdbKeyboard            ║
║                                                      ║
║  B. 在容器内安装搜狗/百度输入法                      ║
║  C. 使用魔云腾PC客户端的剪贴板同步功能               ║
╚══════════════════════════════════════════════════════╝`)
  return false
}

async function goBack(apiPort: number, times: number, signal?: AbortSignal, adb?: ADB | null): Promise<void> {
  for (let i = 0; i < times; i++) {
    if (signal?.aborted) return
    if (adb) {
      try { adb.shell('input keyevent KEYCODE_BACK') } catch {}
    } else {
      await sh(apiPort, 'input keyevent KEYCODE_BACK', signal)
    }
    await sleep(500, signal)
  }
}

// ==================== VLM 双图对比验证（仅用于发布页标题/话题/位置）====================

/** 基准图页面类型 — 对应 public/baselines/douyin/ 下的文件名（不含扩展名） */
type BaselinePage = 'edit_title' | 'topic_list' | 'location_popup' | 'location_city'

interface VerifyResult {
  /** YES=匹配 / NO=不匹配 / ERROR=异常 */
  match: 'YES' | 'NO' | 'ERROR'
  /** AI 的额外描述（如"当前是话题列表页"）*/
  detail: string
}

/**
 * 用 VLM (qwen-vl-max) 对比 当前截图 vs 基准图，判断是否在同一页面
 * 
 * @param currentB64  当前设备截图的 base64
 * @param baseline    基准图页面名称（对应文件 public/baselines/douyin/{name}.png）
 * @param pageDesc    页面中文描述（用于 prompt 中告诉 AI 这是什么页）
 */
async function verifyWithBaseline(
  currentB64: string,
  baseline: BaselinePage,
  pageDesc: string
): Promise<VerifyResult> {
  const startTime = Date.now()
  
  // 读取基准图文件
  let baselineB64: string | null = null
  try {
    const fs = await import('fs')
    // 尝试多个可能的路径（开发环境 vs 生产部署）
    const candidates = [
      `${process.cwd()}/public/baselines/douyin/${baseline}.png`,
      `/root/AiMarketing/public/baselines/douyin/${baseline}.png`,
      `./public/baselines/douyin/${baseline}.png`,
    ]
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          baselineB64 = fs.readFileSync(p).toString('base64')
          console.log(`[VLM验证] 找到基准图: ${p}`)
          break
        }
      } catch { /* 继续尝试下一个路径 */ }
    }
    
    if (!baselineB64) {
      console.log(`[VLM验证⚠] 未找到基准图 ${baseline}.png，跳过VLM验证`)
      return { match: 'ERROR', detail: `基准图不存在: ${baseline}.png` }
    }
  } catch (e) {
    console.log(`[VLM验证⚠] 读取基准图异常: ${e}`)
    return { match: 'ERROR', detail: String(e) }
  }

  // 调用 qwen-vl-plus 双图对比
  try {
    const { getDashScopeKey }: any = await import('./ai-providers')
    const DASHSCOPE_CHAT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    const key = getDashScopeKey?.()
    // ★ 调试：打印当前工作目录和key状态，帮助排查环境变量问题
    console.log(`[VLM调试] cwd=${process.cwd()}, env.DASHSCOPE_API_KEY=${process.env.DASHSCOPE_API_KEY ? '(已设' + process.env.DASHSCOPE_API_KEY.slice(0,6) + '...)' : '(空)'}, key=${key ? '(有值' + key.slice(0,6) + '...)' : 'NULL'}`)
    if (!key) return { match: 'ERROR', detail: '无API Key' }

    const res = await fetch(`${DASHSCOPE_CHAT_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'qwen-vl-plus',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `你是一个手机UI页面识别专家。请仔细对比以下两张抖音APP截图：

【图A - 基准图】这是正确的"${pageDesc}"页面。
【图B - 当前截图】这是脚本刚刚从手机上截取的画面。

请判断：图B 是否和图A 是同一个页面/同一个步骤？

判断标准：
- 整体布局是否一致（顶部、中部、底部元素）
- 关键文字/按钮是否存在（如"添加标题"、"#话题"、"所在位置"、"发作品"等）

只回答以下JSON格式，不要返回其他内容：
{"match":"YES|NO","detail":"一句话说明原因或当前实际页面"}

如果两张图明显是同一个页面 → {"match":"YES","detail":"页面布局和关键元素一致"}
如果不是同一个页面 → {"match":"NO","detail":"当前实际是XX页面"}` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${baselineB64}` } },   // ★ 基准图（图A）
            { type: 'image_url', image_url: { url: `data:image/png;base64,${currentB64}` } },     // ★ 当前截图（图B）
          ],
        }],
        temperature: 0.05,       // 极低温度，确保稳定
        max_tokens: 150,
      }),
    })
    
    if (!res.ok) {
      console.log(`[VLM验证⚠] API错误: ${res.status}`)
      return { match: 'ERROR', detail: `HTTP ${res.status}` }
    }

    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content?.trim() || ''
    const elapsed = Date.now() - startTime
    
    try {
      const j = JSON.parse(text)
      const result: VerifyResult = {
        match: j.match === 'YES' ? 'YES' : j.match === 'NO' ? 'NO' : 'ERROR',
        detail: j.detail || text.substring(0, 80),
      }
      console.log(`[VLM验证${result.match === 'YES' ? '✓' : result.match === 'NO' ? '✗' : '?'}] ${baseline} → ${result.match} (${elapsed}ms) ${result.detail}`)
      return result
    } catch {
      // AI 返回的不是 JSON，用关键词模糊匹配
      const isYes = text.toUpperCase().includes('YES') || text.includes('一致') || text.includes('相同')
      console.log(`[VLM验证${isYes ? '✓(模糊)' : '✗'}] ${baseline} → ${isYes ? 'YES' : 'NO'} (${elapsed}ms) raw="${text.substring(0,60)}"`)
      return { match: isYes ? 'YES' : 'NO', detail: text.substring(0, 80) }
    }
  } catch (e) {
    const elapsed = Date.now() - startTime
    console.log(`[VLM验证⚠] 异常 (${elapsed}ms): ${e}`)
    return { match: 'ERROR', detail: String(e) }
  }
}

// ==================== 页面检测（基于XML，不用AI）====================

type WorkflowStep = 'HOME_PLUS' | 'SHOOT_ALBUM' | 'ALBUM_PICK' | 'VIDEO_PREVIEW' | 'EDIT_TITLE' | 'SELECT_TOPIC' | 'SELECT_POI' | 'PUBLISH_BTN' | 'DONE'

/**
 * 通过 XML 文字特征 + VL视觉 判断当前页面类型
 * 不依赖 AI (QWEN-VL) 判断该做什么！用固定状态机 + XML/VL 定位元素位置
 */
async function detectCurrentPage(
  apiPort: number,
  b64?: string       // ★ 可选截图，用于 VL 视觉兜底确认
): Promise<{
  step: WorkflowStep
  evidence: string       // 判定依据（用于日志）
  xmlTexts: string[]     // XML中的所有可点击文字（调试用）
  isDesktop: boolean     // 是否在桌面/非抖音页面
}> {
  try {
    const data = await UI.extractScreenData(apiPort)
    if (!data.success || !data.data) {
      return { step: 'HOME_PLUS', evidence: 'XML获取失败,默认首页', xmlTexts: [], isDesktop: false }
    }
    const { texts, clickableTexts } = data.data

    // ★★ 先检测是否在桌面（非抖音页面）— 关键！
    // 桌面特征：没有抖音特有的文字，或者有系统级UI元素
    const hasDouyinFeature = clickableTexts.some(t =>
      t === '首页' || t === '朋友' || t === '消息' || t === '我' ||
      t.includes('推荐') || t.includes('关注') ||
      t === '相册' || t.includes('发布') || t.includes('发作品') ||
      t.includes('添加标题') || t.includes('确定') || t === '完成' ||
      // ★ 视频预览/编辑页特征（图2/图3）
      t === '下一步' || t === '一键成片' || t === '推荐特效' || t.includes('限时')
    ) || texts.some(t =>
      t === '全部' || t === '视频' || t === '图片' ||
      t.includes('发布成功') || t.includes('已发布') ||
      // ★ 视频预览/编辑页独有特征
      t === '剪辑' || t === '文字' || t === '话题' || t === '贴纸' ||
      t === '特效' || t === '滤镜' || t === '更多' || t === '设置' ||
      t.includes('存草稿') || t.includes('继续编辑')
    )

    if (!hasDouyinFeature && texts.length > 0) {
      // 有UI元素但不是抖音 → 可能是桌面或其他App
      const allText = texts.join(',').substring(0, 100)
      console.log(`[桌面检测] 无抖音特征, 界面文字: [${allText}]`)
      return { step: 'HOME_PLUS', evidence: '非抖音页面(桌面?)', xmlTexts: clickableTexts, isDesktop: true }
    }

    if (!hasDouyinFeature && texts.length === 0) {
      // 完全没有文字 → 可能是锁屏或纯图界面
      console.log(`[桌面检测] 无任何文字, 可能是锁屏或桌面`)
      return { step: 'HOME_PLUS', evidence: '无文字(可能桌面)', xmlTexts: [], isDesktop: true }
    }

    // 按优先级匹配页面特征

    // --- 发布成功 ---
    // ★★ 关键修复：必须排除编辑页/发布页的提示性文字！
    // 抖音编辑页底部有 "发布成功后将保存内容至本地" 提示，
    // 包含 "发布成功" 但实际还在编辑阶段，不是真的发布完成。
    // 真正的发布成功页面：只有成功提示 + 返回首页按钮，没有编辑功能
    const doneKeywords = ['发布成功', '已发布', '上传完成']
    const doneMatch = texts.find(t => doneKeywords.some(k => t.includes(k)))
    if (doneMatch) {
      // ★ 排除法：如果同时存在编辑页/发布页特征 → 不是真正的DONE
      const editPageHints = ['添加标题', '添加描述', '请填写', '#添加话题', '发作品',
        '所在位置', '已选标签', '公开', '付费可看', '编辑封面', '拍同款', '分享']
      const hasEditFeature = texts.some(t => editPageHints.some(h => t.includes(h)))
      const pubBtnHints = clickableTexts.filter(t => t.includes('发布') || t.includes('发作品'))
      if (hasEditFeature || pubBtnHints.length > 0) {
        console.log(`[detect-DONE排除] "${doneMatch}"是编辑页提示(有编辑特征:${texts.find(t => editPageHints.some(h => t.includes(h)))}, 发布按钮:${pubBtnHints.join(',')})，不是真正DONE`)
        // 不返回 DONE，继续走下面的检测逻辑（应该命中 EDIT_TITLE 或 PUBLISH_BTN）
      } else {
        console.log(`[detect-DONE✓] 确认发布完成: "${doneMatch}" | 无编辑特征 | texts=[${texts.slice(0, 15).join(', ')}]`)
        return { step: 'DONE', evidence: `检测到"${doneMatch}"`, xmlTexts: clickableTexts, isDesktop: false }
      }
    }

    // --- 发布页：有"发布"/"发作品" 按钮 ---
    const pubBtnMatch = clickableTexts.find(t => t.includes('发布') || t.includes('发作品'))
    if (pubBtnMatch) {
      // ★★ 关键修复：区分"编辑页"和真正的"发布页" ★★
      // 编辑页独有特征（即使标题已填入也存在）：
      //   - 话题 / 朋友 / @朋友（标签行）
      //   - 添加位置（位置行）
      //   - 编辑封面 / 添加作品描述（功能入口）
      //   - 公开 / 所有人可见（隐私行）
      // 真正的发布页（点完发布后的确认页）不会有这些编辑功能
      const editPageExclusiveFeatures = [
        '话题', '朋友', '@',           // 标签行
        '添加位置',                     // 位置行
        '编辑封面', '添加作品描述',      // 功能区
        '公开', '所有人可见', '仅自己可见', // 隐私设置行
        '添加标签',                     // 标签管理
      ]
      const hasEditFeature = editPageExclusiveFeatures.some(f =>
        texts.some(t => t.includes(f))
      )
      
      // 原始判断：标题框还是默认提示文字
      const titleHint = texts.find(t => t === '添加标题' || t.includes('请填写') || t === '添加作品描述')
      
      if (hasEditFeature || titleHint) {
        console.log(`[detect-EDIT] 有发布按钮+编辑页特征(${titleHint||editPageExclusiveFeatures.find(f=>texts.some(t=>t.includes(f)))||'?'}) → 编辑页 | texts=[${texts.slice(0,14).join(', ')}]`)
        return { step: 'EDIT_TITLE', evidence: `编辑页(有编辑特征:${titleHint||'非标题类'})`, xmlTexts: clickableTexts, isDesktop: false }
      }
      console.log(`[detect-PUB] "${pubBtnMatch}" 无编辑页特征 → 发布页 | texts=[${texts.slice(0,12).join(', ')}]`)
      return { step: 'PUBLISH_BTN', evidence: `发布页(有${pubBtnMatch})`, xmlTexts: clickableTexts, isDesktop: false }
    }

    // --- 编辑页：有标题输入区域 ---
    const editTitleMatch = texts.find(t => t.includes('添加标题') || t.includes('请填写标题') || t.includes('描述') || t.includes('#添加话题'))
    if (editTitleMatch) {
      console.log(`[detect-EDIT2] 标题区"${editTitleMatch}" → 编辑页 | texts=[${texts.slice(0,12).join(', ')}]`)
      return { step: 'EDIT_TITLE', evidence: `编辑页(有标题区域:${editTitleMatch})`, xmlTexts: clickableTexts, isDesktop: false }
    }

    // --- 拍摄页（相机界面）：优先检测！防止被相册页误判 ---
    // 拍摄页独有特征：分段拍/翻转/闪光灯/美颜/倒计时/灵感跟拍/选择音乐
    const cameraFeatures = ['分段拍', '翻转', '闪光灯', '美颜', '倒计时', '灵感跟拍', '选择音乐']
    const isCameraPage = texts.some(t => cameraFeatures.includes(t))
    if (isCameraPage) {
      // 拍摄页也有"相册"按钮在底部
      return { step: 'SHOOT_ALBUM', evidence: `拍摄页(有${texts.find(t => cameraFeatures.includes(t))})`, xmlTexts: clickableTexts, isDesktop: false }
    }

    // ★★ --- 视频预览/编辑页（选视频后的中间页面）--- ★★
    // ★★★ 关键：必须在 ALBUM_PICK 之前检测！★★★
    // 原因：某些抖音版本的编辑页XML可能残留"视频"文字，
    //       如果先检测ALBUM_PICK会误判！
    //
    // 这个页面有两种形态：
    //   图2(纯预览): 暂停按钮 + 进度条 + "下一步" + "一键成片"/"推荐特效"
    //   图3(编辑工具): 右侧工具栏(剪辑/文字/话题/滤镜/设置/更多等) + 底部"下一步"
    //
    // ★★★ 检测优先级（从高到低）★★★
    //   1. "下一步" 按钮 — 最可靠，所有形态的预览页都有
    //   2. 编辑工具文字 — 剪辑/文字/话题等
    //   3. 视频播放器UI — SeekBar/ProgressBar/暂停图标
    //   4. VL视觉兜底 — AI看截图

    // ── Layer 0: "下一步" 按钮检测（最高优先级！）──
    const nextBtnText = texts.find(t => t === '下一步') || clickableTexts.find(t => t === '下一步')
    if (nextBtnText) {
      // 有"下一步"按钮 → 99%是视频预览/编辑页
      // 排除法：确认不是其他页面（如某些设置弹窗）
      const notPreviewHints = ['取消', '重试', '登录', '注册', '允许', '拒绝']
      const hasNotPreview = texts.some(t => notPreviewHints.includes(t))
      if (!hasNotPreview) {
        console.log(`[detect-PREVIEW✓] 发现"下一步"按钮 → VIDEO_PREVIEW (最可靠信号) | texts=[${texts.slice(0, 12).join(', ')}]`)
        return { step: 'VIDEO_PREVIEW', evidence: `视频预览/编辑页(有"下一步"按钮)`, xmlTexts: clickableTexts, isDesktop: false }
      }
      console.log(`[detect-PREVIEW?] 有"下一步"但同时有[${texts.find(t => notPreviewHints.includes(t))}]，继续检查...`)
    }

    // ── Layer 1: 编辑工具特征检测 ──
    const editToolFeatures = ['剪辑', '文字', '话题', '贴纸', '特效', '滤镜', '更多', '设置', '推荐特效', '一键成片', '限时']
    const hasEditTools = texts.some(t => editToolFeatures.includes(t))
    // 通过 XML 节点类型检测 SeekBar/ProgressBar（进度条）和暂停图标
    let hasVideoPlayerUI = false
    try {
      const playerDump = await UI.dumpXml(apiPort)
      if (playerDump.success && playerDump.data) {
        const pNodes = UI.parseUiXml(playerDump.data)
        hasVideoPlayerUI = pNodes.some((n: any) =>
          n.className?.includes('SeekBar') || n.className?.includes('ProgressBar') ||
          n.contentDesc?.includes('暂停') || n.contentDesc?.includes('播放')
        )
      }
    } catch {}
    
    if (hasEditTools || hasVideoPlayerUI) {
      const foundFeature = hasEditTools 
        ? texts.find((t: string) => editToolFeatures.includes(t)) || '编辑工具'
        : hasVideoPlayerUI ? '视频播放器(暂停/进度条)' : ''
      return { step: 'VIDEO_PREVIEW', evidence: `视频预览/编辑页(有${foundFeature})`, xmlTexts: clickableTexts, isDesktop: false }
    }

    // ★★ --- VL视觉兜底：XML全部失败时，让AI看截图确认是否是VIDEO_PREVIEW ---
    // 抖音某些版本用自定义渲染，编辑工具文字不在标准Android UI 树中，
    // 导致上面的XML检测永远失败。此时必须用AI视觉识别截图。
    if (b64 && !hasEditTools && !hasVideoPlayerUI) {
      try {
        const vlPageCheck = await locateElement(
          b64,
          `这是抖音APP的屏幕截图。请只回答当前是什么页面，选择一个字母：
A = 相册选视频页（有视频缩略图网格）
B = 视频预览/编辑页（有视频画面+底部粉红色"下一步"按钮+右侧编辑工具如剪辑/文字/话题/滤镜等）
C = 首页或其他页面

只返回一个字母 A 或 B 或 C，不要返回其他内容。`
        )
        // AI 返回的坐标如果在右下角区域(y > 屏幕高度75%)，说明看到了"下一步"
        if (vlPageCheck && vlPageCheck.y && vlPageCheck.y > 0) {
          // 用坐标位置辅助判断：如果 AI 返回的点在屏幕中下部，更可能是 B(预览页)
          const vlY = vlPageCheck.y
          // 注意：这里 locateElement 可能会误解 prompt 返回任意坐标
          // 我们主要用它来判断 AI 是否"看到了"预览页的特征
          // 通过二次调用来确认
          console.log(`[detect-VL] AI返回坐标(${vlPageCheck.x},${vlPageCheck.y})，进行精确页面确认...`)
          
          // 二次 VL 精确判断（只要文字答案）
          const vlConfirm = await locateElement(
            b64,
            `截图中的页面是否有以下特征？：
1. 底部右侧有一个【粉红色/玫红色】的"下一步"大按钮？
2. 右侧或画面上有编辑工具（剪辑、文字、话题、贴纸、特效、滤镜、设置、更多等任一）？

如果有 → 返回坐标 {x:999,y:999}
如果没有 → 返回坐标 {x:0,y:0}`
          )
          if (vlConfirm && vlConfirm.x === 999 && vlConfirm.y === 999) {
            console.log(`[detect-VL✓] AI视觉确认是VIDEO_PREVIEW页面！(XML未检测到但VL确认)`)
            return { step: 'VIDEO_PREVIEW', evidence: '视频预览/编辑页(VL视觉确认)', xmlTexts: clickableTexts, isDesktop: false }
          } else {
            console.log(`[detect-VL✗] AI视觉确认不是预览页，继续其他检测...`)
          }
        }
      } catch (e) {
        console.log(`[detect-VL] 异常: ${e}`)
      }
    }

    // --- 相册页：有"全部"/"视频"/"图片"标签 或 "照片"/"视频" 选择 ---
    // 注意：此时已排除拍摄页和编辑页，这里的"视频"是相册标签而非其他含义
    if (texts.some(t =>
      t === '全部' || t === '视频' || t === '图片' ||
      t.includes('最近视频') || t.includes('选择视频') || t.includes('相册选择')
    )) {
      return { step: 'ALBUM_PICK', evidence: '相册页(有全部/视频/图片标签)', xmlTexts: clickableTexts, isDesktop: false }
    }

    // --- 拍摄页：有"相册"文字（兜底，通过底部按钮判断）---
    if (clickableTexts.some(t => t === '相册' || t.includes('从相册') || t.includes('相册导入'))) {
      return { step: 'SHOOT_ALBUM', evidence: '拍摄页(有相册入口)', xmlTexts: clickableTexts, isDesktop: false }
    }

    // --- 首页：底部导航栏文字 ---
    if (clickableTexts.some(t =>
      t === '首页' || t === '朋友' || t === '消息' || t === '我' ||
      t.includes('推荐') || t.includes('关注')
    ) || texts.some(t => t === '首页' || t === '朋友')) {
      return { step: 'HOME_PLUS', evidence: '首页(有导航栏)', xmlTexts: clickableTexts, isDesktop: false }
    }

    // --- 弹窗 ---
    if (clickableTexts.some(t =>
      t.includes('我知道了') || t.includes('去编辑') || t.includes('允许') ||
      t.includes('取消') || t.includes('确定') || t.includes('知道了')
    )) {
      return { step: 'HOME_PLUS', evidence: '检测到弹窗,回首页处理', xmlTexts: clickableTexts, isDesktop: false }
    }

    // 兜底：默认回首页（不是桌面，只是特征没匹配到但应该在抖音内）
    return { step: 'HOME_PLUS', evidence: '未匹配特征,默认首页(在抖音内)', xmlTexts: clickableTexts, isDesktop: false }
  } catch (e) {
    return { step: 'HOME_PLUS', evidence: `异常:${e}`, xmlTexts: [], isDesktop: false }
  }
}

// ==================== XML 定位（带超时）====================

async function locateByText(
  apiPort: number,
  candidates: string[],
  perCandidateTimeoutMs = 5000
): Promise<{ x: number; y: number } | null> {
  for (const text of candidates) {
    try {
      const result = await Promise.race([
        UI.findByText(apiPort, text),
        new Promise<null>(resolve => setTimeout(() => resolve(null), perCandidateTimeoutMs))
      ])
      if (result?.center) {
        console.log(`[XML✓] "${text}" → (${result.center.x},${result.center.y})`)
        return result.center
      }
      console.log(`[XML✗] "${text}" 未找到`)
    } catch (e) {
      console.log(`[XML✗] "${text}" 异常: ${e}`)
    }
  }
  return null
}

/**
 * 宽松文字搜索 — 不限制 clickable！
 *
 * 抖音相册页的"全部/视频/图片"标签往往是 TabLayout 内的纯文本，
 * clickable=false，导致 findByText（要求clickable=true）永远找不到。
 *
 * 本函数遍历所有节点（不限 clickable），匹配 text 或 content-desc。
 * 额外过滤：排除太小的节点、状态栏、底部导航栏区域。
 */
async function findAnyText(
  apiPort: number,
  candidates: string[],
  screenH: number,
  perCandidateTimeoutMs = 3000
): Promise<{ x: number; y: number; clickable: boolean; textHint: string } | null> {
  try {
    const dumpResult = await UI.dumpXml(apiPort)
    if (!dumpResult.success || !dumpResult.data) return null

    const nodes = UI.parseUiXml(dumpResult.data)

    for (const target of candidates) {
      let bestMatch: { x: number; y: number; clickable: boolean; area: number } | null = null

      for (const node of nodes) {
        // ★ 不限制 clickable！只要 node 有文字就行
        const textMatch = node.text && (
          node.text === target || node.text.includes(target) || target.includes(node.text)
        )
        const descMatch = node.contentDesc && (
          node.contentDesc.includes(target)
        )
        if (!textMatch && !descMatch) continue

        // 排除状态栏区域（顶部3%）
        // ★ 放宽底部过滤：抖音"下一步"按钮可能在 90%~98% 区域（原0.90会误杀）
        const b = UI.parseBounds(node.bounds)
        if (!b) continue
        if (b.y < screenH * 0.03) continue
        if (b.y > screenH * 0.98) continue
        // 太小的忽略（红点等）
        if (b.width < 20 || b.height < 10) continue

        // 取面积最大的（避免命中到小碎片节点）
        const area = b.width * b.height
        if (!bestMatch || area > bestMatch.area) {
          bestMatch = {
            x: Math.round(b.x + b.width / 2),
            y: Math.round(b.y + b.height / 2),
            clickable: node.clickable,
            area,
          }
        }
      }

      if (bestMatch) {
        console.log(`[宽松✓] "${target}" → (${bestMatch.x},${bestMatch.y}) clickable=${bestMatch.clickable}`)
        return { x: bestMatch.x, y: bestMatch.y, clickable: bestMatch.clickable, textHint: target }
      }
      console.log(`[宽松✗] "${target}" 未找到(含非clickable节点)`)
    }
    return null
  } catch (e) {
    console.log(`[宽松✗] 异常: ${e}`)
    return null
  }
}

// ==================== 锚点反推法（定位底部导航栏+号）====================

/**
 * 导航栏锚点反推法（Layer 1 主力策略）
 *
 * 核心原理：不直接识别"+"号图标（无文字、样式多变），
 * 而是通过导航栏上"首页"和"我"两个稳定文字锚点，用数学公式反推"+"号位置。
 *
 * 抖音底部导航栏 = 5个Tab，水平等分排列：
 *   Tab位置:  [0]首页  [1]朋友  [2]+号  [3]消息  [4]我
 *
 * "+"号X = 屏幕宽度 × 0.5（5等分中心点）
 * "+"号Y = ("首页"和"我"的导航栏垂直中心) - 10px（避开小白条）
 *
 * @returns 加号坐标或null（锚点未找到时降级到后续策略）
 */
async function locatePlusByAnchor(
  apiPort: number,
  screenW: number,
  screenH: number
): Promise<{ x: number; y: number } | null> {
  try {
    const dumpResult = await UI.dumpXml(apiPort)
    if (!dumpResult.success || !dumpResult.data) {
      console.log(`[锚点✗] dumpXml失败`)
      return null
    }

    const nodes = UI.parseUiXml(dumpResult.data)

    // 筛选条件：Y坐标必须在屏幕底部15%以内 + 高度30~120px（防止红点干扰）
    const bottomThreshold = screenH * 0.85

    let homeNode: UI.UINode | null = null
    let homeArea = 0
    let meNode: UI.UINode | null = null
    let meArea = 0

    for (const node of nodes) {
      if (!node.text) continue
      const b = UI.parseBounds(node.bounds)
      if (!b) continue
      // 必须在屏幕底部15%区域
      if (b.y < bottomThreshold) continue
      // 高度过滤：30~120px（排除红点/小图标干扰）
      if (b.height < 30 || b.height > 120) continue

      const area = b.width * b.height
      if (node.text === '首页' && area > homeArea) { homeNode = node; homeArea = area }
      if (node.text === '我' && area > meArea) { meNode = node; meArea = area }
    }

    if (!homeNode || !meNode) {
      console.log(`[锚点✗] 首页=${homeNode ? '✓' : '✗'}, 我=${meNode ? '✓' : '✗'}`)
      return null
    }

    const homeB = UI.parseBounds(homeNode.bounds)!
    const meB = UI.parseBounds(meNode.bounds)!

    // 计算导航栏边界
    const navTop = Math.min(homeB.y, meB.y)
    const navBottom = Math.max(homeB.y + homeB.height, meB.y + meB.height)

    // 反推加号坐标
    const plusX = Math.round(screenW * 0.5)
    const plusY = Math.round((navTop + navBottom) / 2 - 10)

    console.log(`[锚点✓] 首页(${homeB.x},${homeB.y},${homeB.width}x${homeB.height}) 我(${meB.x},${meB.y},${meB.width}x${meB.height}) → 加号(${plusX},${plusY})`)
    return { x: plusX, y: plusY }

  } catch (e) {
    console.log(`[锚点✗] 异常: ${e}`)
    return null
  }
}

// ==================== 主工作流（固定状态机，不用AI判断流程）====================

interface WorkflowOptions {
  maxLoops?: number
  totalTimeoutMs?: number
  location?: string       // POI位置名称/地址
  publishSteps?: string[] // 勾选的发布子步骤：video/title/topic/location（控制哪些步骤执行）
}

/** 模块级变量：安全标题和话题（executeStep 需要访问） */
let _safeTitle = ''
let _safeTopics = ''
/** 模块级变量：POI位置（executeStep 需要访问） */
let _safeLocation = ''
/** 模块级变量：勾选的发布子步骤 */
let _safePublishSteps: string[] = []  // 由调用方设置，含 video 时隐式自动补充
/** 模块级变量：ALBUM_PICK 子步骤状态 */
let _albumSubStep = ''
/** 模块级变量：EDIT_TITLE 子步骤状态 */
let _editSubStep = ''
/** 模块级变量：SELECT_TOPIC 子步骤状态 */
let _topicSubStep = ''
/** 模块级变量：SELECT_POI 子步骤状态 */
let _poiSubStep = ''

/**
 * 抖音自动发布视频 — 固定流程版本 v2
 *
 * ★ 不用 AI (QWEN-VL) 判断该做什么！用固定状态机 + XML/VL 定位元素位置
 *
 * 流程：
 *   HOME_PLUS(点+号) → SHOOT_ALBUM(点相册) → ALBUM_PICK(选视频) → EDIT_TITLE(输标题) → PUBLISH_BTN(点发布) → DONE
 *
 * 调用方(route.ts)已负责：
 *   force-stop → am start → 等12~15秒 → 刷2条视频 → 再调本函数
 *   此时抖音已在首页稳定状态，直接开始操作即可
 */
export async function aiPublishVideoWorkflow(
  apiPort: number,
  title: string,
  topics: string[],
  signal?: AbortSignal,
  adb?: ADB | null,
  options: WorkflowOptions = {}
): Promise<{ success: boolean; message: string }> {

  const { maxLoops = 40, totalTimeoutMs = 300_000 } = options

  _safeTitle = title.replace(/"/g, '"').replace(/[{}[\]]/g, '')
  _safeTopics = topics.map(t => t.replace(/[,"]/g, '')).join(',')
  _safeLocation = (options.location || '').trim()
  // ★ video 是隐式前置步骤：只要勾选了任一子步骤就自动包含
  const userSteps = options.publishSteps || []
  const hasSubStep = userSteps.some(s => ['title','topic','location'].includes(s))
  _safePublishSteps = hasSubStep ? [...new Set(['video', ...userSteps])] : userSteps

  let screenW = 1080, screenH = 2340
  try {
    const size = await UI.getScreenSize(apiPort)
    screenW = size.width; screenH = size.height
  } catch (e) {
    console.warn(`[初始化] 获取屏幕尺寸失败，使用默认值 ${screenW}x${screenH}`)
  }

  console.log(`[${TS()}] ========== 固定流程启动（v3-步骤可控版）==========`)
  console.log(`[${TS()}] 勾选步骤: [${_safePublishSteps.join(', ')}] | 屏幕 ${screenW}x${screenH}, 目标: ${_safeTitle.substring(0, 30)}`)

  let currentStep: WorkflowStep = 'HOME_PLUS'
  let stepRetryCount = 0          // 当前步骤的重试次数
  let loopCount = 0               // 总循环次数
  let inputDone = false           // 标题是否已输入
  const MAX_STEP_RETRY = 6        // 单步最大重试次数（从3提高到6，给VIDEO_PREVIEW更多机会）

  while (loopCount < maxLoops) {
    loopCount++
    if (signal?.aborted) return { success: false, message: '用户停止' }

    console.log(`\n[${TS()}] [#${loopCount}] 步骤=${currentStep} 重试=${stepRetryCount}/${MAX_STEP_RETRY}`)

    // ---- 1. 截图 + XML页面检测 ----
    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) { await sleep(2000, signal); continue }

    const pageDetect = await detectCurrentPage(apiPort, b64)
    console.log(`[${TS()}] [页面] ${pageDetect.step} (${pageDetect.evidence})${pageDetect.isDesktop ? ' ⚠️桌面!' : ''}`)

    // ★★ 桌面检测：不在抖音内 → 重新启动抖音！
    if (pageDetect.isDesktop) {
      console.log(`[${TS()}] [!恢复] 检测到非抖音页面，重新启动抖音...`)
      await sh(apiPort, `am force-stop ${DOUYIN_PKG}`, signal)
      await sleep(1000, signal)
      await sh(apiPort, `am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`, signal)
      await sleep(5000, signal)  // 等抖音加载完
      currentStep = 'HOME_PLUS'
      stepRetryCount = 0
      _albumSubStep = ''
      _editSubStep = ''
      _topicSubStep = ''
      _poiSubStep = ''
      continue
    }

    // ---- 2. 先处理弹窗 ----
    if (pageDetect.evidence.includes('弹窗')) {
      console.log(`[${TS()}] [弹窗] 尝试关闭...`)
      const popupBtn = await locateByText(apiPort, ['我知道了', '去编辑', '允许', '取消', '确定', '知道了', '下次一定', '不保存返回'], 2000)
      if (popupBtn) {
        await doTap(apiPort, popupBtn.x, popupBtn.y, signal, adb)
        await sleep(2000, signal); continue
      }
    }

    // ---- 3. 执行当前步骤的动作 ----
    const result = await executeStep(apiPort, currentStep, b64, screenW, screenH, signal, adb)
    console.log(`[${TS()}] [操作] ${result.action}: ${result.message}`)

    if (result.success) {
      // ★★ 关键：等页面加载后，验证是否真到了下一步！
      await sleep(result.waitMs, signal)
      // 验证时重新截图（页面可能已变化）
      const verifyB64 = await UI.takeScreenshot(apiPort)
      const verify = await detectCurrentPage(apiPort, verifyB64 || undefined)
      console.log(`[${TS()}] [验证] 点击后页面=${verify.step} (期望推进到 ${getNextStep(currentStep)})`)

      const expectedNext = getNextStep(currentStep)
      // ★★ 关键修复：只有 PUBLISH_BTN → DONE 才算真正完成！
      //    其他步骤检测到 DONE 是误判（如编辑页被误识别为发布成功），应视为异常
      const isLegitimateDone = verify.step === 'DONE' && currentStep === 'PUBLISH_BTN'

      // ★★ Fix#1: ALBUM_PICK 的特殊推进规则 ★★
      // 抖音某些版本：相册页点"下一步"可能直接进入编辑页(跳过VIDEO_PREVIEW)，
      // 或者经过多次重试后实际已到编辑/发布页。
      // 因此 ALBOOK_PICK 允许推进到 EDIT_TITLE / PUBLISH_BTN / VIDEO_PREVIEW 任一
      const validFromAlbumPick = (
        currentStep === 'ALBUM_PICK' &&
        (verify.step === 'EDIT_TITLE' || verify.step === 'VIDEO_PREVIEW' ||
         verify.step === 'SELECT_TOPIC' || verify.step === 'SELECT_POI' || verify.step === 'PUBLISH_BTN')
      )

      if (verify.step === expectedNext || isLegitimateDone || validFromAlbumPick) {
        // 页面正确切换 → 推进步骤
        stepRetryCount = 0
        if (isLegitimateDone) {
          console.log(`[${TS()}] ========== 完成！视频已发布 ==========`)
          return { success: true, message: '视频已发布' }
        }
        if (validFromAlbumPick) {
          console.log(`[${TS()}] [✓推进-ALBUM] ${currentStep} → ${verify.step} (允许从相册页多步跳跃)`)
        } else {
          console.log(`[${TS()}] [✓推进] ${currentStep} → ${verify.step}`)
        }

        // ★★ 智能跨步拦截：根据勾选步骤决定是否允许跳过 ★★
        if (currentStep === 'VIDEO_PREVIEW' && verify.step !== 'EDIT_TITLE' &&
            verify.step !== 'DONE' && stepToOrder(verify.step) > stepToOrder('EDIT_TITLE')) {
          console.log(`[${TS()}] [⚠拦截跨步] 检测到${verify.step}但必须先执行EDIT_TITLE，强制停留在EDIT_TITLE`)
          currentStep = 'EDIT_TITLE'
        } else if (_safePublishSteps.includes('topic') &&
                   currentStep === 'EDIT_TITLE' && verify.step !== 'SELECT_TOPIC' &&
                   verify.step !== 'DONE' && stepToOrder(verify.step) > stepToOrder('SELECT_TOPIC')) {
          // ★ 勾选了topic但跳过了 → 强制停在 SELECT_TOPIC
          console.log(`[${TS()}] [⚠拦截跨步] 检测到${verify.step}但勾选了话题选择，强制停在SELECT_TOPIC`)
          currentStep = 'SELECT_TOPIC'
        } else if (_safePublishSteps.includes('location') && _safeLocation &&
                   (currentStep === 'EDIT_TITLE' || currentStep === 'SELECT_TOPIC') &&
                   verify.step !== 'SELECT_POI' && verify.step !== 'DONE' &&
                   stepToOrder(verify.step) > stepToOrder('SELECT_POI')) {
          // ★ 勾选了location且有配置但跳过了 → 强制停在 SELECT_POI
          console.log(`[${TS()}] [⚠拦截跨步] 检测到${verify.step}但勾选了位置选择，强制停在SELECT_POI`)
          currentStep = 'SELECT_POI'
        } else if (currentStep === 'ALBUM_PICK' && verify.step !== 'VIDEO_PREVIEW' &&
                   stepToOrder(verify.step) >= stepToOrder('EDIT_TITLE')) {
          // 从ALBUM_PICK跳到编辑或之后 → 确保经过 EDIT_TITLE
          console.log(`[${TS()}] [✓推进-ALBUM→编辑] ${currentStep} → EDIT_TITLE (实际检测到${verify.step})`)
          currentStep = 'EDIT_TITLE'
        } else {
          currentStep = verify.step
        }
      } else if (verify.step === 'DONE') {
        // ★ 非发布步骤误判为DONE → 当作异常处理，重试当前步
        console.log(`[${TS()}] [⚠误判DONE] 当前=${currentStep}但检测到DONE(xmlTexts=[${verify.xmlTexts.slice(0,5).join(',')}]), 视为异常, 重试${currentStep}`)
        stepRetryCount++
        // 页面没变 → 不推进，算重试
        console.log(`[${TS()}] [×停留] 页面还是${currentStep}, 未切换，计入重试`)
        stepRetryCount++
        if (stepRetryCount >= MAX_STEP_RETRY) {
          // ★★ ALBUM_PICK 特殊策略：不BACK！不重启！
          //    原因：实际可能已在 VIDEO_PREVIEW 页面但 detectCurrentPage 不认识，
          //    此时 BACK 会触发草稿弹窗导致更复杂的死循环。
          //    正确做法：继续尝试点"下一步"，让 VL 视觉来确认和定位按钮。
          if (currentStep === 'ALBUM_PICK') {
            console.log(`[${TS()}] [ALBUM_PICK-重试] 重试${stepRetryCount}次(已达上限)，不BACK不重启！强制回到CLICK_NEXT继续尝试...`)
            _albumSubStep = 'CLICK_NEXT'  // ★ 回到点下一步
            stepRetryCount = 0            // 重置计数，允许再尝试多轮
            // 不 continue！让下一轮循环自然执行 CLICK_NEXT
          } else {
            console.log(`[${TS()}] [重置] ${currentStep} 页面不变${stepRetryCount}次, 重启抖音...`)
            await sh(apiPort, `am force-stop ${DOUYIN_PKG}`, signal)
            await sleep(1000, signal)
            await sh(apiPort, `am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`, signal)
            await sleep(5000, signal)
            currentStep = 'HOME_PLUS'
            stepRetryCount = 0
            _albumSubStep = ''
            _editSubStep = ''
            _topicSubStep = ''
            _poiSubStep = ''
            if (loopCount > 20) return { success: false, message: `重试过多,最后:${currentStep}` }
          }
        }
      } else {
        // 页面跳到了意外步骤
        // ★★ 智能跨步判断：未勾选的步骤允许跳过，勾选的不允许跳过 ★★
        if (verify.step === expectedNext) {
          // 刚好是期望的下一步 → 正常推进
          console.log(`[${TS()}] [✓推进] ${currentStep} → ${verify.step}`)
          currentStep = verify.step
          stepRetryCount = 0
        } else if (verify.step !== 'HOME_PLUS' && stepToOrder(verify.step) > stepToOrder(expectedNext)) {
          // 超前了 → 检查跳过了哪些已勾选的步骤
          const skippedSteps: WorkflowStep[] = []
          let order = stepToOrder(currentStep) + 0.1
          while (order < stepToOrder(verify.step)) {
            // 找到 order 范围内的步骤
            for (const [s, o] of Object.entries({ 'EDIT_TITLE': 4, 'SELECT_TOPIC': 4.5, 'SELECT_POI': 5, 'PUBLISH_BTN': 6 } as Record<WorkflowStep, number>)) {
              if (o > stepToOrder(currentStep) && o < stepToOrder(verify.step) && Math.abs(o - order) < 1) {
                skippedSteps.push(s as WorkflowStep)
              }
            }
            order += 0.5
          }

          // 检查是否跳过了必须执行的步骤
          const mustSkipEdit = (
            stepToOrder(currentStep) <= stepToOrder('VIDEO_PREVIEW') &&
            stepToOrder(verify.step) >= stepToOrder('SELECT_POI') &&
            verify.step !== 'EDIT_TITLE'
          )
          const wouldSkipSelectedTopic = _safePublishSteps.includes('topic') &&
            stepToOrder(currentStep) <= stepToOrder('EDIT_TITLE') &&
            verify.step !== 'SELECT_TOPIC' &&
            stepToOrder(verify.step) >= stepToOrder('SELECT_POI')
          const wouldSkipSelectedLocation = _safePublishSteps.includes('location') && _safeLocation &&
            stepToOrder(currentStep) <= stepToOrder('SELECT_TOPIC') &&
            verify.step !== 'SELECT_POI' &&
            stepToOrder(verify.step) >= stepToOrder('PUBLISH_BTN')

          if (mustSkipEdit || wouldSkipSelectedTopic || wouldSkipSelectedLocation) {
            // 跳过了已勾选的关键步骤 → 强制停在最早被跳过的步骤
            const targetStep = mustSkipEdit ? 'EDIT_TITLE'
              : wouldSkipSelectedTopic ? 'SELECT_TOPIC'
              : 'SELECT_POI'
            console.log(`[${TS()}] [⚠拦截跨步] 检测到${verify.step}，但跳过了已勾选的${targetStep}，强制停在该步`)
            currentStep = targetStep
            stepRetryCount = 0
          } else {
            // ★★ 二次校验：即使上面的单项检查通过了，也要确保到达 PUBLISH_BTN/DONE 时没有遗漏勾选的中间步骤 ★★
            const reachingPublish = stepToOrder(verify.step) >= stepToOrder('PUBLISH_BTN')
            const missingTopic = _safePublishSteps.includes('topic') && currentStep !== 'SELECT_TOPIC' && stepToOrder(currentStep) <= stepToOrder('SELECT_TOPIC')
            const missingLocation = _safePublishSteps.includes('location') && _safeLocation && currentStep !== 'SELECT_POI' && stepToOrder(currentStep) <= stepToOrder('SELECT_POI')

            if (reachingPublish && (missingTopic || missingLocation)) {
              const forced = missingTopic ? 'SELECT_TOPIC' : 'SELECT_POI'
              console.log(`[${TS()}] [⚠二次拦截] 即将到达${verify.step}但还有未执行的子步骤${forced}，强制回退`)
              currentStep = forced
              stepRetryCount = 0
            } else {
              // 跨步的都是未勾选/可选步骤 → 允许推进
              console.log(`[${TS()}] [✓跨步] 检测到${verify.step}(超前)，跳过的步骤均未勾选或可选，直接推进`)
              currentStep = verify.step
              stepRetryCount = 0
            }
          }
        } else {
          // 回退了或乱了 → 重试当前步
          console.log(`[${TS()}] [异常] 跳到${verify.step}(顺序异常), 重试${currentStep}`)
          stepRetryCount++
          if (stepRetryCount >= MAX_STEP_RETRY) {
            // ★★ ALBUM_PICK 特殊策略：不BACK！不重启！继续尝试点下一步
            if (currentStep === 'ALBUM_PICK') {
              console.log(`[${TS()}] [ALBUM_PICK-异常重试] 异常${stepRetryCount}次(达上限)，不BACK不重启，强制回到CLICK_NEXT...`)
              _albumSubStep = 'CLICK_NEXT'
              stepRetryCount = 0
            // ★★ EDIT_TITLE 特殊策略：不重启！重置子步骤继续尝试输入
            } else if (currentStep === 'EDIT_TITLE') {
              console.log(`[${TS()}] [EDIT_TITLE-异常重试] 异常${stepRetryCount}次(达上限)，不重启，重置子步骤重新输入...`)
              _editSubStep = ''          // 回到子步骤起点（重新点击输入框+输入）
              stepRetryCount = 0
            } else {
              console.log(`[${TS()}] [重置] 异常重试耗尽, 重启抖音...`)
              await sh(apiPort, `am force-stop ${DOUYIN_PKG}`, signal)
              await sleep(1000, signal)
              await sh(apiPort, `am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`, signal)
              await sleep(5000, signal)
            currentStep = 'HOME_PLUS'
            stepRetryCount = 0
            _albumSubStep = ''
            _editSubStep = ''
            _topicSubStep = ''
            _poiSubStep = ''
            }
          }
        }
      }
    } else {
      stepRetryCount++
      if (stepRetryCount >= MAX_STEP_RETRY) {
        // ★★ ALBUM_PICK 特殊策略：不BACK！不重启！继续尝试
        if (currentStep === 'ALBUM_PICK') {
          console.log(`[${TS()}] [ALBUM_PICK-失败重试] 操作失败${stepRetryCount}次(达上限)，不BACK不重启，强制回到CLICK_NEXT...`)
          _albumSubStep = 'CLICK_NEXT'  // ★ 强制跳到点下一步
          stepRetryCount = 0            // 重置计数
          console.log(`[${TS()}] [重试] 已重置，下一轮将直接执行CLICK_NEXT`)
        // ★★ EDIT_TITLE 特殊策略：不重启！重置子步骤继续输入
        } else if (currentStep === 'EDIT_TITLE') {
          console.log(`[${TS()}] [EDIT_TITLE-失败重试] 操作失败${stepRetryCount}次(达上限)，不重启，重试子步骤...`)
          _editSubStep = ''           // 回到子步骤起点（重新点击输入框）
          stepRetryCount = 0
          console.log(`[${TS()}] [重试] 已重置，下一轮将重新点击标题框并尝试其他输入方法`)
        } else {
          console.log(`[${TS()}] [重置] ${currentStep} 失败${stepRetryCount}次, 重启抖音...`)
          await sh(apiPort, `am force-stop ${DOUYIN_PKG}`, signal)
          await sleep(1000, signal)
          await sh(apiPort, `am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`, signal)
          await sleep(5000, signal)
        currentStep = 'HOME_PLUS'
        stepRetryCount = 0
        _albumSubStep = ''
        _editSubStep = ''
        _topicSubStep = ''
        _poiSubStep = ''
        if (loopCount > 15) {  // 安全保护
            return { success: false, message: `重试过多,最后步骤:${currentStep}` }
          }
        }
      } else {
        console.log(`[${TS()}] [重试] ${stepRetryCount}/${MAX_STEP_RETRY}`)
        await sleep(result.waitMs || 3000, signal)
      }
    }
  }

  return { success: false, message: `超时(${maxLoops}轮), 最后步骤: ${currentStep}` }
}

// ==================== 步骤执行器 ====================

interface StepResult {
  success: boolean
  action: string
  message: string
  waitMs: number
}

/**
 * 执行指定步骤的操作
 * ★ 每步都有多层定位策略：XML → VL → 比例坐标
 */
async function executeStep(
  apiPort: number,
  step: WorkflowStep,
  b64: string,
  screenW: number,
  screenH: number,
  signal?: AbortSignal,
  adb?: ADB | null
): Promise<StepResult> {

  switch (step) {

    // ========================================
    // STEP 1: 首页 → 点击底部 "+" 号进入拍摄页
    // ========================================
    case 'HOME_PLUS': {
      // ═══ Layer 1 (主力): 导航栏锚点反推法 ═══
      // 通过"首页"+"我"两个文字锚点，数学反推加号位置，0ms纯计算，命中率99%
      const anchorPlus = await locatePlusByAnchor(apiPort, screenW, screenH)
      if (anchorPlus) {
        await doTap(apiPort, anchorPlus.x, anchorPlus.y, signal, adb)
        return { success: true, action: '锚点反推+号', message: `(${anchorPlus.x},${anchorPlus.y})`, waitMs: 4000 }
      }

      // ═══ Layer 2 (备用): XML模糊匹配 +/创建/拍摄 ═══
      const xmlPlus = await locateByText(apiPort, ['+', '创建', '拍摄'], 3000)
      if (xmlPlus) {
        await doTap(apiPort, xmlPlus.x, xmlPlus.y, signal, adb)
        return { success: true, action: 'XML定位+号', message: `(${xmlPlus.x},${xmlPlus.y})`, waitMs: 4000 }
      }

      // ═══ Layer 3 (兜底): VL视觉定位 ═══
      console.log(`[策略B] 锚点/XML失败, VL定位加号...`)
      const vlCoord = await locateElement(b64, '底部导航栏中间的加号发布按钮')
      if (vlCoord && isVlCoordValid(vlCoord.x, vlCoord.y, screenW, screenH) && vlCoord.y > screenH * 0.75) {
        console.log(`[VL✓] 加号 → (${vlCoord.x},${vlCoord.y})`)
        await doTap(apiPort, vlCoord.x, vlCoord.y, signal, adb)
        return { success: true, action: 'VL定位+号', message: `(${vlCoord.x},${vlCoord.y})`, waitMs: 4000 }
      }
      if (vlCoord) {
        console.log(`[VL✗] 加号坐标不合理 (${vlCoord.x},${vlCoord.y}), 忽略`)
      }

      // ═══ Layer 4 (终极): 比例坐标（仅当所有策略都失败时）═══
      const navY = Math.round(screenH * 0.905)
      const navX = Math.round(screenW * 0.5)
      console.log(`[策略D] 比例坐标 → (${navX},${navY}) [终极兜底]`)
      await doTap(apiPort, navX, navY, signal, adb)
      return { success: true, action: '比例坐标+号(终极)', message: `(${navX},${navY})`, waitMs: 4000 }
    }

    // ========================================
    // STEP 2: 拍摄页 → 点击 "相册" 进入相册选择页
    // ========================================
    case 'SHOOT_ALBUM': {
      // ═══ Layer 1: dumpXml 精确找 text="相册" 节点，点正中间 ═══
      try {
        const dumpResult = await UI.dumpXml(apiPort)
        if (dumpResult.success && dumpResult.data) {
          const nodes = UI.parseUiXml(dumpResult.data)

          let bestNode: UI.UINode | null = null
          let bestArea = 0

          for (const node of nodes) {
            if (!node.text) continue
            if (node.text !== '相册' && !node.text.includes('相册')) continue

            const b = UI.parseBounds(node.bounds)
            if (!b) continue
            if (b.height < 20 || b.width < 30) continue   // 太小的忽略（红点等）
            if (b.y < screenH * 0.05) continue              // 排除顶部状态栏

            const area = b.width * b.height
            if (area > bestArea) { bestNode = node; bestArea = area }
          }

          if (bestNode) {
            const b = UI.parseBounds(bestNode.bounds)!
            const cx = Math.round(b.x + b.width / 2)
            const cy = Math.round(b.y + b.height / 2)
            console.log(`[相册XML✓] "${bestNode.text}" → (${cx},${cy}) bounds=(${b.x},${b.y},${b.width}x${b.height})`)
            await doTap(apiPort, cx, cy, signal, adb)
            return { success: true, action: 'XML定位相册', message: `(${cx},${cy})`, waitMs: 4000 }
          } else {
            console.log(`[相册XML✗] 未找到"相册"节点`)
          }
        }
      } catch (e) {
        console.log(`[相册XML✗] 异常: ${e}`)
      }

      // ═══ Layer 2: locateByText 兜底 ═══
      const xmlAlbum = await locateByText(apiPort, [
        '相册', '从相册选择', '相册导入', '从手机相册选择',
        '相册选择', '选择从相册', '导入'
      ], 3000)
      if (xmlAlbum) {
        await doTap(apiPort, xmlAlbum.x, xmlAlbum.y, signal, adb)
        return { success: true, action: 'locateByText相册', message: `(${xmlAlbum.x},${xmlAlbum.y})`, waitMs: 4000 }
      }

      // ═══ Layer 3: VL 视觉定位 "相册" ═══
      console.log(`[策略B] XML失败, VL定位相册...`)
      const vlCoord = await locateElement(b64, '相册')
      if (vlCoord && isVlCoordValid(vlCoord.x, vlCoord.y, screenW, screenH)) {
        console.log(`[VL✓] 相册 → (${vlCoord.x},${vlCoord.y})`)
        await doTap(apiPort, vlCoord.x, vlCoord.y, signal, adb)
        return { success: true, action: 'VL定位相册', message: `(${vlCoord.x},${vlCoord.y})`, waitMs: 4000 }
      }
      if (vlCoord) {
        console.log(`[VL✗] 相册坐标不合理 (${vlCoord.x},${vlCoord.y}), 忽略`)
      }

      return { success: false, action: '相册定位失败', message: 'XML/VL都未找到', waitMs: 3000 }
    }

    // ========================================
    // STEP 3: 相册页 → 切"视频"标签 → 选视频(有O播放图标) → 点"下一步"
    // ========================================
    case 'ALBUM_PICK': {
      // 子步骤状态（跨重试保持）
      let subStep = _albumSubStep || 'DIAGNOSE'

      // ════════ Sub-0: 诊断 — 打印页面所有可见文字（首次进入时执行一次）═══════
      if (subStep === 'DIAGNOSE') {
        try {
          const dumpResult = await UI.dumpXml(apiPort)
          if (dumpResult.success && dumpResult.data) {
            const nodes = UI.parseUiXml(dumpResult.data)
            const visibleNodes = nodes.filter(n => {
              if (!n.text || n.text.length > 20) return false
              const b = UI.parseBounds(n.bounds)
              if (!b) return false
              if (b.width < 20 || b.height < 10) return false
              if (b.y < screenH * 0.03) return false
              if (b.y > screenH * 0.90) return false
              return true
            })
            console.log(`[相册-诊断] 页面共有 ${visibleNodes.length} 个文字节点:`)
            for (const n of visibleNodes.slice(0, 30)) {
              const b = UI.parseBounds(n.bounds)!
              console.log(`  "${n.text}" | ${n.className} | clickable=${n.clickable} | (${b.x},${b.y},${b.width}x${b.height}) | desc="${(n.contentDesc||'').substring(0,30)}"`)
            }
          }
        } catch (e) {
          console.log(`[相册-诊断] dump异常: ${e}`)
        }
        _albumSubStep = 'SWITCH_VIDEO_TAB'
        subStep = 'SWITCH_VIDEO_TAB'  // ★ 关键修复：同步更新局部变量！
      }

      // ════════ Sub-A: 切到"视频"标签 ════════
      if (subStep === 'SWITCH_VIDEO_TAB') {
        // 用 findAnyText（不限 clickable）找标签
        const videoTab = await findAnyText(apiPort, ['视频'], screenH)
        if (videoTab) {
          console.log(`[相册-切标签✓] 找到"视频" → (${videoTab.x},${videoTab.y}) clickable=${videoTab.clickable}`)
          
          // ★ 单次精确点击（不用array sweep，避免拖拽误判）★
          await doTap(apiPort, videoTab.x, videoTab.y, signal, adb)
          
          // ★ 等待标签切换动画完成（至少2秒）
          await sleep(2500, signal)
          
          // ★ 验证是否真的切换了：重新检测页面是否还是 ALBUM_PICK 但有新特征
          try {
            const verifyDump = await UI.dumpXml(apiPort)
            if (verifyDump.success && verifyDump.data) {
              const vNodes = UI.parseUiXml(verifyDump.data)
              // 如果还能看到"00:15"时长文字，说明在视频列表中（已切换成功）
              const hasDuration = vNodes.some((n: any) => n.text && /^\d{1,3}:\d{2}$/.test(n.text))
              if (hasDuration) {
                console.log(`[相册-切标签验证✓] 检测到时长格式文字, 已进入视频列表`)
              } else {
                console.log(`[相册-切标签验证?] 未检测到时长文字, 继续尝试选视频`)
              }
            }
          } catch {}
          
          _albumSubStep = 'PICK_VIDEO'
          return { success: true, action: '切视频标签', message: `(${videoTab.x},${videoTab.y})`, waitMs: 2000 }
        }

        const allTab = await findAnyText(apiPort, ['全部'], screenH)
        if (allTab) {
          console.log(`[相册-切标签] 找到"全部" → (${allTab.x},${allTab.y}), 先点它`)
          await doTap(apiPort, allTab.x, allTab.y, signal, adb)
          _albumSubStep = 'SWITCH_VIDEO_TAB'
          return { success: true, action: '点全部标签', message: `(${allTab.x},${allTab.y})`, waitMs: 1500 }
        }

        console.log(`[相册-切标签✗] 都未找到, 进入选视频`)
        _albumSubStep = 'PICK_VIDEO'
        subStep = 'PICK_VIDEO'
      }

      // ════════ Sub-B: 选视频缩略图 ════════
      // ★★★ 核心思路：时长锚点反推法 + 可交互父容器定位 ★★★
      if (subStep === 'PICK_VIDEO') {
        try {
          const dumpResult = await UI.dumpXml(apiPort)
          if (dumpResult.success && dumpResult.data) {
            const nodes = UI.parseUiXml(dumpResult.data)

            // Step 1: 找所有时长格式的文字节点 ("0:05", "00:15", "1:30" 等)
            const durationNodes: Array<{ node: UI.UINode; x: number; y: number; w: number; h: number }> = []
            for (const node of nodes) {
              if (!node.text || !/^\d{1,3}:\d{2}$/.test(node.text)) continue
              const b = UI.parseBounds(node.bounds)
              if (!b) continue
              if (b.y < screenH * 0.14 || b.y > screenH * 0.85) continue
              durationNodes.push({ node, x: b.x, y: b.y, w: b.width, h: b.height })
            }

            if (durationNodes.length > 0) {
              const dur = durationNodes[0]
              console.log(`[时长锚点✓] "${dur.node.text}" → (${dur.x},${dur.y},${dur.w}x${dur.h})`)
              const durCx = dur.x + dur.w / 2
              const durCy = dur.y + dur.h / 2

              // Step 2: 找包含时长的所有容器，按面积从小到大排序
              const allContainers: Array<{ node: UI.UINode; x: number; y: number; w: number; h: number; area: number; clickable: boolean }> = []
              for (const node of nodes) {
                const b = UI.parseBounds(node.bounds)
                if (!b) continue
                if (b.width < 100 || b.height < 100) continue
                if (b.y < screenH * 0.10 || b.y > screenH * 0.85) continue
                if (durCx >= b.x && durCx <= b.x + b.width &&
                    durCy >= b.y && durCy <= b.y + b.height) {
                  allContainers.push({
                    node, x: b.x, y: b.y, w: b.width, h: b.height,
                    area: b.width * b.height, clickable: node.clickable || false
                  })
                }
              }
              allContainers.sort((a, b) => a.area - b.area)

              // ★ 打印完整的容器链（从最小到最大）
              console.log(`[选视频-容器链] 包含"${dur.node.text}"的 ${allContainers.length} 个容器(从小到大):`)
              for (let i = 0; i < allContainers.length; i++) {
                const c = allContainers[i]
                const marker = c.clickable ? '★clickable' : '  no-click'
                console.log(`  #${i} [${c.node.className}] (${c.x},${c.y}) ${c.w}x${c.h} ${marker}`)
              }

              // ★★★ 根治方案：单击 220ms 压持（不是双击！）★★★
              // 抖音相册交互模型：单击=选中，双击=选中后再取消/进入预览
              // 之前用 doubleTap 导致第1次选中后被第2次撤销了
              
              const fixedCoord = getFixedCoords(screenW, screenH, 'FIRST_VIDEO_THUMB')
              console.log(`[选视频→策略A] 固定比例坐标 → (${fixedCoord.x},${fixedCoord.y}) ${fixedCoord.reason}`)
              
              // ★ 单击！220ms 压持模拟真实手指按压
              await smartTap(apiPort, fixedCoord.x, fixedCoord.y, 220, signal, adb)
              
              // 等待 UI 解析（给抖音时间渲染"下一步"按钮）
              console.log(`[强制推进] 单击完成，等待UI刷新后直接进入下一步`)
              await sleep(2500, signal)
              
              _albumSubStep = 'CLICK_NEXT'
              return { 
                success: true, 
                action: '选视频(强制推进)', 
                message: `(${fixedCoord.x},${fixedCoord.y}) [${fixedCoord.reason}]`, 
                waitMs: 500 
              }
            } else {
              console.log(`[时长锚点✗] 未找到时长格式文字(如00:15)`)
            }
          }
        } catch (e) {
          console.log(`[时长锚点✗] 异常: ${e}`)
        }

        // Layer 2: VL 视觉识别（兜底）
        console.log(`[相册-选视频] VL兜底找带O播放图标...`)
        const vlThumb = await locateElement(
          b64,
          '这是抖音APP的相册选择页面（已切换到视频标签）。请找到屏幕中左上角第一个视频缩略图，上面有一个圆形O形播放按钮图标覆盖。请点击那个视频缩略图的中心位置。注意不要点整个网格区域中心，要点单个缩略图。'
        )
        if (vlThumb && isVlCoordValid(vlThumb.x, vlThumb.y, screenW, screenH) && vlThumb.y > screenH * 0.15 && vlThumb.y < screenH * 0.80) {
          console.log(`[VL✓] 视频缩略图(带O) → (${vlThumb.x},${vlThumb.y}) smartDoubleTap`)
          // ★ 使用智能双击替代普通双击
          await smartDoubleTap(apiPort, vlThumb.x, vlThumb.y, signal, adb)
          // 选中验证
          await sleep(1800, signal)
          try {
            const vlSelCheck = await UI.dumpXml(apiPort)
            if (vlSelCheck.success && vlSelCheck.data) {
              const vNodes = UI.parseUiXml(vlSelCheck.data)
              if (vNodes.some((n: any) => n.contentDesc?.includes('未选中'))) {
                console.log(`[VL选中验证✗] 仍"未选中", 重试`)
                return { success: false, action: 'VL视频未选中', message: `(${vlThumb.x},${vlThumb.y})`, waitMs: 2000 }
              }
            }
          } catch {}
          _albumSubStep = 'CLICK_NEXT'
          return { success: true, action: 'VL+smartDoubleTap选视频', message: `(${vlThumb.x},${vlThumb.y})`, waitMs: 3000 }
        }
        if (vlThumb) {
          console.log(`[VL✗] 坐标不合理 (${vlThumb.x},${vlThumb.y})`)
        } else {
          console.log(`[VL✗] 未找到视频缩略图`)
        }

        // Layer 3: 比例坐标终极兜底（使用 smartDoubleTap）
        const thumbX = Math.round(screenW * 0.18)
        const thumbY = Math.round(screenH * 0.32)
        console.log(`[相册-选视频] 比例坐标(终极兜底) → (${thumbX},${thumbY}) smartDoubleTap`)
        // ★ 使用智能双击
        await smartDoubleTap(apiPort, thumbX, thumbY, signal, adb)
        // 选中验证
        await sleep(1800, signal)
        try {
          const ratioSelCheck = await UI.dumpXml(apiPort)
          if (ratioSelCheck.success && ratioSelCheck.data) {
            const rNodes = UI.parseUiXml(ratioSelCheck.data)
            if (rNodes.some((n: any) => n.contentDesc?.includes('未选中'))) {
              console.log(`[比例选中验证✗] 仍"未选中", 重试`)
              return { success: false, action: '比例视频未选中', message: `(${thumbX},${thumbY})`, waitMs: 2000 }
            }
          }
        } catch {}
        _albumSubStep = 'CLICK_NEXT'
        return { success: true, action: '比例坐标+smartDoubleTap选视频', message: `(${thumbX},${thumbY})`, waitMs: 3000 }
      }

      // ════════ Sub-C: 点"下一步"按钮（XML特征 + VL视觉双重确认 + 间隔式重试）═══════
      // 三层确认机制：
      //   Layer 1: XML 文字/节点特征（快，0.5s内）
      //   Layer 2: VL 视觉识别（准，让AI看截图判断页面）
      //   Layer 3: 固定坐标盲点（兜底，相信已进入该页面）
      if (subStep === 'CLICK_NEXT') {
        // ★★ 诊断：打印当前页面所有可见文字（帮助判断实际在哪个页面）★★
        try {
          const clickNextDump = await UI.dumpXml(apiPort)
          if (clickNextDump.success && clickNextDump.data) {
            const cnNodes = UI.parseUiXml(clickNextDump.data)
            const cnTexts = cnNodes
              .filter((n: any) => n.text && n.text.length > 0 && n.text.length <= 20)
              .map((n: any) => `${n.text}(${n.clickable?'c':'x'})`)
              .slice(0, 25)
            console.log(`[下一步-页面文字] [${cnTexts.join(', ')}]`)
          }
        } catch {}

        // ★ 随机等待 3~8 秒让UI完全渲染
        const waitMs = 3000 + Math.floor(Math.random() * 5001)
        console.log(`[下一步] 等待${(waitMs/1000).toFixed(1)}s...`)
        await sleep(waitMs, signal)

        // ★★ Layer 1: 用视频预览页特征确认当前位置（不搜"下一步"！）★★
        let onPreviewPage = false
        try {
          const previewDump = await UI.dumpXml(apiPort)
          if (previewDump.success && previewDump.data) {
            const pNodes = UI.parseUiXml(previewDump.data)
            
            const previewFeatures = ['裁剪', '滤镜', '音乐', '文字', '特效', '贴纸', '调节', '封面']
            const hasSeekBar = pNodes.some((n: any) => 
              n.className?.includes('SeekBar') || n.className?.includes('ProgressBar'))
            const hasPauseIcon = pNodes.some((n: any) => 
              n.contentDesc?.includes('暂停') || n.contentDesc?.includes('播放'))
            const hasEditTools = previewFeatures.some(f => 
              pNodes.some((n: any) => n.text === f))
            const hasDurationFormat = pNodes.some((n: any) =>
              n.text && /^\d{1,2}:\d{2}\/\d{1,2}:\d{2}$/.test(n.text))
            
            if (hasSeekBar || hasPauseIcon || hasEditTools || hasDurationFormat) {
              onPreviewPage = true
              console.log(`[下一步-XML✓] 视频预览页已确认！` +
                ` (seekBar=${hasSeekBar}, pause=${hasPauseIcon}, editTool=${hasEditTools}, duration=${hasDurationFormat})`)
              for (const n of pNodes.slice(0, 20)) {
                if ((n.className?.includes('Seek') || n.className?.includes('Progress') ||
                     n.contentDesc?.includes('暂停') || previewFeatures.includes(n.text)) &&
                    n.text !== '') {
                  console.log(`  特征节点: "${n.text}" | ${n.className} | desc="${(n.contentDesc||'').substring(0,30)}"`)
                }
              }
            } else {
              console.log(`[下一步-XML?] 未检测到视频预览特征，尝试VL视觉确认...`)
            }
          }
        } catch (e) {
          console.log(`[下一步-XML] 异常: ${e}，尝试VL视觉确认...`)
        }

        // ★★ Layer 2: XML 失败时，用 VL(AI) 看截图确认页面类型！★★
        let vlNextBtnX: number | null = null
        let vlNextBtnY: number | null = null
        if (!onPreviewPage) {
          try {
            const vlConfirm = await locateElement(
              b64,
              `这是抖音APP的屏幕截图(${screenW}x${screenH})。请仔细观察并回答：
1. 当前是什么页面？选择以下之一：
   A) 相册选视频页（有视频缩略图网格）
   B) 视频预览/编辑页（显示选中视频的预览画面，右侧或底部有编辑工具如"剪辑/文字/话题/滤镜/特效/设置/更多"，底部有粉红色的"下一步"按钮）
   C) 首页/其他页面
2. 如果是B(视频预览/编辑页)，请返回"下一步"按钮的中心坐标。
   "下一步"是一个【粉红色/玫红色圆角矩形大按钮】，位于屏幕右下角底部区域(y坐标应该接近屏幕底边)。

请严格按以下JSON格式返回（不要返回其他内容）：
{"page":"A|B|C", "nextBtnX":数字或null, "nextBtnY":数字或null}`
            )
            // ★★ VL 坐标有效性校验："下一步"在屏幕右下角！★★
            // 拒绝左上角的垃圾坐标(如 10,178)
            // 合理范围: x > 屏幕宽度的50%, y > 屏幕高度的75%
            const vlX = vlConfirm?.x || 0
            const vlY = vlConfirm?.y || 0
            if (vlConfirm && vlX > screenW * 0.50 && vlY > screenH * 0.75) {
              // VL 返回了合理坐标 → AI 看到了"下一步"按钮 → 在预览页！
              onPreviewPage = true
              vlNextBtnX = vlX
              vlNextBtnY = vlY
              console.log(`[下一步-VL✓] AI确认是视频预览/编辑页！"下一步"→(${vlX},${vlY}) [坐标有效]`)
            } else if (vlConfirm && (vlX > 0 || vlY > 0)) {
              // VL 返回了坐标但位置不合理（如(10,178)）→ 坐标无效但可能页面判断对
              console.log(`[下一步-VL⚠] AI返回坐标(${vlX},${vlY})不合理(应在x>${Math.round(screenW*0.5)},y>${Math.round(screenH*0.75)})，忽略坐标`)
              // 不设 onPreviewPage=true，让 detectCurrentPage 的 VL 兜底来判断页面
            } else {
              console.log(`[下一步-VL?] AI未返回有效坐标(x=${vlX},y=${vlY})，继续用固定坐标尝试`)
            }
          } catch (e) {
            console.log(`[下一步-VL] 视觉确认异常: ${e}`)
          }
        }

        // 获取点击坐标 — 优先级：VL坐标(有效时) > XML搜索 > 固定比例
        const fixedNext = getFixedCoords(screenW, screenH, 'NEXT_BTN')
        let clickX = fixedNext.x
        let clickY = fixedNext.y

        // 如果 VL 返回了有效坐标，优先使用
        if (vlNextBtnX && vlNextBtnY) {
          clickX = vlNextBtnX
          clickY = vlNextBtnY
          console.log(`[VL坐标] 使用AI识别的"下一步"坐标→(${clickX},${clickY})`)
        }

        // 尝试XML搜索作为补充（仅在VL没有给出有效坐标时）
        if (!vlNextBtnX) {
          try {
            const nextBtnSearch = await findAnyText(apiPort, ['下一步', '确定', '完成'], screenH)
            if (nextBtnSearch && nextBtnSearch.y > screenH * 0.15) {
              clickX = nextBtnSearch.x
            clickY = nextBtnSearch.y
            console.log(`[✓] 找到"${nextBtnSearch.textHint}" → (${clickX},${clickY})`)
          } else {
            console.log(`[固定坐标] "下一步" → (${clickX},${clickY}) ${fixedNext.reason}`)
          }
        } catch {}
        }  // 关闭 if (!vlNextBtnX)

        // ★ 第1次点击：随机压持 220~300ms
        const duration1 = 220 + Math.floor(Math.random() * 81)
        console.log(`[下一步] 第1次点击: (${clickX},${clickY}) 压持${duration1}ms ${onPreviewPage ? '[已确认在预览页]' : '[XML+VL均未确认，强制尝试]'}`)
        await smartTap(apiPort, clickX, clickY, duration1, signal, adb)

        _albumSubStep = 'CLICK_NEXT_RETRY'
        return { 
          success: true, 
          action: '点"下一步"(第1次)', 
          message: `(${clickX},${clickY}) d=${duration1}ms`, 
          waitMs: 5000  // 给主循环5秒验证跳转
        }
      }

      // ════════ Sub-C2: 第2次点击（间隔式，非双击）═══════
      if (subStep === 'CLICK_NEXT_RETRY') {
        // ★★ 用 XML + VL 双重确认当前页面状态 ★★
        let stillOnPreview = true  // 默认假设还在预览页（保守策略）
        
        // XML 特征检测
        try {
          const retryDump = await UI.dumpXml(apiPort)
          if (retryDump.success && retryDump.data) {
            const rNodes = UI.parseUiXml(retryDump.data)
            const previewFeatures = ['裁剪', '滤镜', '音乐', '文字', '特效', '贴纸']
            const hasFeatures = previewFeatures.some(f => rNodes.some((n: any) => n.text === f))
            const hasSeekBar = rNodes.some((n: any) => 
              n.className?.includes('SeekBar') || n.className?.includes('ProgressBar'))

            if (!hasFeatures && !hasSeekBar) {
              console.log(`[下一步-第2次-XML✓] 页面已离开预览区(无编辑特征)，第1次应该成功了`)
              _albumSubStep = 'SWITCH_VIDEO_TAB'
              return { success: true, action: '"下一步"已生效(页面已变)', message: '无需第2次点击', waitMs: 2000 }
            }
            console.log(`[下一步-第2次-XML] 仍在预览区(seekBar=${hasSeekBar}, tool=${hasFeatures})`)
          }
        } catch (e) {
          console.log(`[下一步-第2次-XML] 异常: ${e}，尝试VL视觉确认...`)
        }

        // ★★ VL 视觉兜底确认：让AI看截图判断是否还在预览页 ★★
        try {
          const vlRetryCheck = await locateElement(
            b64,
            `这是抖音APP的屏幕截图(${screenW}x${screenH})。请判断：
1. 当前是否在"视频预览/编辑页"？（特征：有视频画面+底部粉红色"下一步"按钮+右侧编辑工具栏）
2. 如果是，返回"下一步"按钮坐标。
3. 如果不是（已跳转到其他页面如标题编辑页），返回 null。

严格按JSON格式返回：{"onPreview":true/false, "nextBtnX":数字或null, "nextBtnY":数字或null}`
          )
          if (vlRetryCheck === null || (vlRetryCheck.x <= 0 && vlRetryCheck.y <= 0)) {
            // VL 说不在预览页了（或无法判断）→ 第1次点击成功了！
            console.log(`[下一步-第2次-VL✓] AI确认页面已变化(不在预览页)，第1次点击成功`)
            _albumSubStep = 'SWITCH_VIDEO_TAB'
            return { success: true, action: '"下一步"已生效(VL确认页面已变)', message: '无需第2次点击', waitMs: 2000 }
          } else {
            console.log(`[下一步-第2次-VL] AI确认仍在预览页，执行第2次点击...`)
          }
        } catch (e) {
          console.log(`[下一步-第2次-VL] 异常: ${e}，继续执行第2次点击`)
        }

        // ★ 第2次点击：偏移坐标（避开装饰层），随机压持 250~300ms
        const fixedNext = getFixedCoords(screenW, screenH, 'NEXT_BTN')
        const offsetX = fixedNext.x + 28 + Math.floor(Math.random() * 11)   // +28~38px
        const offsetY = fixedNext.y + 18 + Math.floor(Math.random() * 11)   // +18~28px
        const duration2 = 250 + Math.floor(Math.random() * 51)               // 250~300ms
        
        console.log(`[下一步] 第2次点击(偏移): (${offsetX},${offsetY}) 压持${duration2}ms [偏移+(${offsetX-fixedNext.x},${offsetY-fixedNext.y})]`)
        await smartTap(apiPort, offsetX, offsetY, duration2, signal, adb)

        _albumSubStep = 'SWITCH_VIDEO_TAB'
        return { 
          success: true, 
          action: '点"下一步"(第2次偏移)', 
          message: `(${offsetX},${offsetY}) d=${duration2}ms`, 
          waitMs: 6000  // 第2次后给足时间验证
        }
      }

      // 兜底
      _albumSubStep = 'SWITCH_VIDEO_TABLE'  // 重置子步骤
      return { success: false, action: '相册未知子步骤', message: String(subStep), waitMs: 2000 }
    }

    // ========================================
    // STEP 3.5: 视频预览/编辑页 → 点"下一步"进入标题编辑页
    // ========================================
    // 这个页面是 ALBUM_PICK 点"下一步"后进入的中间页面（图2/图3）
    // 图2 = 纯视频预览(暂停+进度条+下一步)
    // 图3 = 编辑工具页(剪辑/文字/话题/滤镜等 + 下一步)
    // 两个页面都有"下一步"按钮，坐标几乎相同！
    case 'VIDEO_PREVIEW': {
      // ★ 随机等待 3~8 秒让UI完全渲染（模拟人类浏览）
      const waitMs = 3000 + Math.floor(Math.random() * 5001)
      console.log(`[预览页] 等待${(waitMs/1000).toFixed(1)}s...`)
      await sleep(waitMs, signal)

      let clickX: number = getFixedCoords(screenW, screenH, 'NEXT_BTN').x
      let clickY: number = getFixedCoords(screenW, screenH, 'NEXT_BTN').y
      let coordSource = 'unknown'

      // ★★ Layer 1: VL 视觉定位（最高优先级！）★
      // 原因：固定坐标(828,2244)在预览页上可能对应返回按钮导致退出桌面！
      // 必须用 AI 看截图找到真正的"下一步"粉红色按钮位置
      try {
        console.log(`[预览页] 使用VL视觉定位"下一步"按钮...`)
        const vlNextBtn = await locateElement(
          b64,
          `抖音APP视频预览编辑页(${screenW}x${screenH})。
在屏幕【最底部右侧】有一个【粉红色圆角大按钮】，上面写着白色的"下一步"三个字。
这是整个屏幕最醒目的按钮。

请返回这个按钮的中心坐标(x,y)。
重要约束：y坐标必须在 ${Math.round(screenH*0.80)} ~ ${screenH} 之间（屏幕底部20%区域内）！
x坐标应在 ${Math.round(screenW*0.60)} ~ ${screenW} 之间（屏幕右侧）！

如果找不到就返回null。只返回JSON: {"x":数字,"y":数字}`
        )
        if (vlNextBtn && vlNextBtn.y > screenH * 0.70 && vlNextBtn.x > screenW * 0.50) {
          // VL 返回了合理坐标（在屏幕下70%区域，右侧50%）
          clickX = vlNextBtn.x
          clickY = vlNextBtn.y
          coordSource = `VL视觉(${clickX},${clickY})`
          console.log(`[预览页-VL✓] AI定位到"下一步" → (${clickX},${clickY}) 底部${((clickY/screenH)*100).toFixed(0)}% 右侧${((clickX/screenW)*100).toFixed(0)}%`)
        } else if (vlNextBtn) {
          console.log(`[预览页-VL⚠] AI返回(${vlNextBtn.x},${vlNextBtn.y})不在有效区域(x>${Math.round(screenW*0.50)},y>${Math.round(screenH*0.70)})，忽略`)
        } else {
          console.log(`[预览页-VL✗] AI未识别到"下一步"按钮`)
        }
      } catch (e) {
        console.log(`[预览页-VL] 异常: ${e}`)
      }

      // ★★ Layer 2: XML 文字搜索 ★
      if (!coordSource || coordSource === 'unknown') {
        try {
          const nextSearch = await findAnyText(apiPort, ['下一步', '确定', '完成'], screenH)
          if (nextSearch && nextSearch.y > screenH * 0.15) {
            clickX = nextSearch.x
            clickY = nextSearch.y
            coordSource = `XML搜索("${nextSearch.textHint}")`
            console.log(`[预览页✓] 找到"${nextSearch.textHint}" → (${clickX},${clickY}) clickable=${nextSearch.clickable}`)
          } else {
            console.log(`[预览页-XML✗] 未找到"下一步/确定/完成"文字`)
          }
        } catch {}
      }

      // ★★ Layer 3: 右下角多候选坐标阵列扫描（替代单一固定坐标！）★★
      // 原因：固定坐标(828,2244)在不同页面可能对应不同按钮，
      // 用3~5个候选坐标依次尝试，增加命中率
      if (!coordSource || coordSource === 'unknown') {
        // 候选坐标列表（从最可能的到备选的），覆盖右下角不同位置
        const candidates = [
          { x: Math.round(screenW * 0.77), y: Math.round(screenH * 0.96), desc: '原校正值' },   // (828,2244)
          { x: Math.round(screenW * 0.85), y: Math.round(screenH * 0.92), desc: '右上移' },       // 更靠上一点
          { x: Math.round(screenW * 0.72), y: Math.round(screenH * 0.95), desc: '左移' },         // 左移一点
          { x: Math.round(screenW * 0.80), y: Math.round(screenH * 0.88), desc: '更高' },         // 再高一些
          { x: Math.round(screenW * 0.65), y: Math.round(screenH * 0.94), desc: '中右' },         // 屏幕中右侧
        ]
        console.log(`[预览页] VL+XML均失败，启动多候选坐标扫描(共${candidates.length}个)...`)

        // 逐个尝试候选坐标
        for (let i = 0; i < candidates.length; i++) {
          const cand = candidates[i]
          console.log(`[预览页] 尝试候选#${i + 1}: (${cand.x},${cand.y}) [${cand.desc}]`)
          await smartTap(apiPort, cand.x, cand.y, 220 + Math.floor(Math.random() * 81), signal, adb)

          // 点击后等2秒检测是否离开了预览页
          await sleep(2000, signal)
          try {
            const postTapCheck = await detectCurrentPage(apiPort)
            console.log(`[预览页-验证#${i + 1}] 点击后=${postTapCheck.step}`)
            // 如果离开 VIDEO_PREVIEW（进入 EDIT_TITLE/PUBLISH_BTN/HOME_PLUS 等），说明命中了
            if (postTapCheck.step !== 'VIDEO_PREVIEW') {
              console.log(`[预览页-命中✓] 候选#${i + 1} 成功！→ ${postTapCheck.step}`)
              return {
                success: true,
                action: `预览页点"下一步"(候选#${i + 1})`,
                message: `(${cand.x},${cand.y}) [${cand.desc}]`,
                waitMs: 5000
              }
            }
          } catch {}
        }

        // 所有候选坐标都没命中 → 用最后一个作为返回值（让主循环重试）
        const lastCand = candidates[candidates.length - 1]
        clickX = lastCand.x
        clickY = lastCand.y
        coordSource = `多候选扫描(全部失败,最后:${lastCand.desc})`
        console.log(`[预览页] ⚠ 全部${candidates.length}个候选坐标都未命中"下一步"`)
      }

      // ★★ Layer 3: 固定比例坐标兜底（最后手段）★
      if (!coordSource || coordSource === 'unknown') {
        const fixedNext = getFixedCoords(screenW, screenH, 'NEXT_BTN')
        clickX = fixedNext.x
        clickY = fixedNext.y
        coordSource = `固定比例(${fixedNext.reason})`
        console.log(`[预览页] ⚠ 兜底使用固定坐标 → (${clickX},${clickY}) ${fixedNext.reason}`)
        console.log(`[预览页] ⚠ 警告：此坐标可能导致退出桌面（如果抖音UI已更新）`)
      }

      // 第1次点击：随机压持 220~300ms
      const duration1 = 220 + Math.floor(Math.random() * 81)
      console.log(`[预览页] 点击"下一步": (${clickX},${clickY}) 来源=${coordSource} 压持${duration1}ms`)
      await smartTap(apiPort, clickX, clickY, duration1, signal, adb)

      return { 
        success: true, 
        action: '预览页点"下一步"', 
        message: `(${clickX},${clickY}) src=${coordSource} d=${duration1}ms`, 
        waitMs: 6000  // 给足时间跳转到 EDIT_TITLE
      }
    }

    // ========================================
    // STEP 4: 编辑页 → 完整流程（诊断→输入标题→验证→添加标签→验证）
    // ========================================
    case 'EDIT_TITLE': {
      let subStep = _editSubStep || 'DIAGNOSE'

      // ════════ Sub-0: 页面诊断 — 扫描所有功能文字 ════════
      if (subStep === 'DIAGNOSE') {
        try {
          const dumpResult = await UI.dumpXml(apiPort)
          if (dumpResult.success && dumpResult.data) {
            const nodes = UI.parseUiXml(dumpResult.data)
            const visibleNodes = nodes.filter(n => {
              if (!n.text || n.text.length > 30) return false
              const b = UI.parseBounds(n.bounds)
              if (!b) return false
              if (b.width < 20 || b.height < 10) return false
              if (b.y < screenH * 0.03) return false
              if (b.y > screenH * 0.98) return false
              return true
            })
            console.log(`[编辑-诊断] 页面共有 ${visibleNodes.length} 个文字节点:`)
            for (const n of visibleNodes.slice(0, 40)) {
              const b = UI.parseBounds(n.bounds)!
              const desc = (n.contentDesc || '').substring(0, 25)
              console.log(`  "${n.text}" | ${n.className} | clickable=${n.clickable} | (${b.x},${b.y},${b.width}x${b.height}) | desc="${desc}"`)
            }
          }
        } catch (e) {
          console.log(`[编辑-诊断] dump异常: ${e}`)
        }
        _editSubStep = 'CLICK_INPUT'
        subStep = 'CLICK_INPUT'
      }

      // ════════ Sub-A: 点击标题输入框（VLM双图验证）═══════
      if (subStep === 'CLICK_INPUT') {
        // ★★ Layer 0: VLM 双图对比验证当前是否在编辑主页 ★★
        console.log(`[标题-VLM] 验证是否在"视频发布编辑页"...`)
        const vlmCheck = await verifyWithBaseline(b64, 'edit_title', '抖音视频发布编辑页（有添加标题框、#话题按钮、所在位置行、发作品按钮）')
        
        if (vlmCheck.match === 'NO') {
          // VLM 说不是编辑页 → 自愈：追问 AI 当前是什么页
          console.log(`[标题-自愈] VLM确认不在编辑页: "${vlmCheck.detail}"`)
          
          // 判断是否在话题子页面
          const isTopicPage = vlmCheck.detail.includes('话题') || vlmCheck.detail.includes('标签') || vlmCheck.detail.includes('topic')
          // 判断是否在位置子页面
          const isLocationPage = vlmCheck.detail.includes('位置') || vlmCheck.detail.includes('定位') || vlmCheck.detail.includes('location')
          // 判断是否在首页
          const isHomePage = vlmCheck.detail.includes('首页') || vlmCheck.detail.includes('HOME')
          
          if (isTopicPage || isLocationPage) {
            // 在子页面了 → 按返回回到编辑主页
            console.log(`[标题-自愈] 检测到在${isTopicPage ? '话题' : '位置'}子页面，按BACK返回...`)
            await goBack(apiPort, 1, signal, adb)
            await sleep(1500, signal)
            return { success: false, action: '自愈-BACK返回', message: vlmCheck.detail, waitMs: 2000 }
          }
          
          if (isHomePage) {
            // 跑到首页了 → 严重异常，通知重置
            console.log(`[标题-自愈] 跑到首页了！需要重新进入发布流程`)
            return { success: false, action: '自愈-丢失页面', message: '跑到首页', waitMs: 3000 }
          }

          // 其他情况 → 先 BACK 试试
          console.log(`[标题-自愈] 尝试BACK回到上一页...`)
          await goBack(apiPort, 1, signal, adb)
          await sleep(2000, signal)
          return { success: false, action: '自愈-BACK尝试', message: vlmCheck.detail, waitMs: 3000 }
        }
        
        if (vlmCheck.match === 'ERROR') {
          // 基准图不存在或API错误 → 降级为原来的 XML 方式，不阻塞
          console.log(`[标题-VLM⚠] 验证失败(${vlmCheck.detail})，降级为XML方式继续...`)
        } else {
          console.log(`[标题-VLM✓] 确认在编辑主页！开始执行点击...`)
        }
        const xmlTitle = await findAnyText(apiPort, [
          '添加标题', '请填写标题', '填写作品描述', '添加描述',
          '#添加话题'
        ], screenH, 3000)
        if (xmlTitle && xmlTitle.y < screenH * 0.50) {
          console.log(`[编辑-标题框✓] "${xmlTitle.textHint}" → (${xmlTitle.x},${xmlTitle.y}) clickable=${xmlTitle.clickable}`)
          await doTap(apiPort, xmlTitle.x, xmlTitle.y, signal, adb)
          await sleep(1500, signal) // 等待键盘弹出
          _editSubStep = 'INPUT_TITLE'
          return { success: true, action: '点击标题框', message: `(${xmlTitle.x},${xmlTitle.y})`, waitMs: 10000 }
        }
        // 兜底：用 locateByText（要求clickable=true）
        const fallbackTitle = await locateByText(apiPort, [
          '标题', '描述', '请填写'
        ], 2000)
        if (fallbackTitle) {
          console.log(`[编辑-标题框✓] locateByText → (${fallbackTitle.x},${fallbackTitle.y})`)
          await doTap(apiPort, fallbackTitle.x, fallbackTitle.y, signal, adb)
          await sleep(1500, signal)
          _editSubStep = 'INPUT_TITLE'
          return { success: true, action: '点击标题框(备用)', message: `(${fallbackTitle.x},${fallbackTitle.y})`, waitMs: 10000 }
        }

        // VL兜底
        console.log(`[编辑-标题框] XML失败, VL定位...`)
        const vlCoord = await locateElement(b64, '抖音发布页面的标题输入框或"添加标题"区域')
        if (vlCoord && isVlCoordValid(vlCoord.x, vlCoord.y, screenW, screenH)) {
          await doTap(apiPort, vlCoord.x, vlCoord.y, signal, adb)
          await sleep(1500, signal)
          _editSubStep = 'INPUT_TITLE'
          return { success: true, action: 'VL点击标题框', message: `(${vlCoord.x},${vlCoord.y})`, waitMs: 10000 }
        }

        return { success: false, action: '标题框定位失败', message: '未找到', waitMs: 3000 }
      }

      // ════════ Sub-B: 输入标题文本 ════════
      // ★ 注意：只输入标题 _safeTitle，不要拼接搜索关键词(_safeTopics)
      //   搜索关键词（如火锅/美业/减肥）仅在 ADD_TOPICS 步骤中用于话题搜索
      if (subStep === 'INPUT_TITLE') {
        const fullText = _safeTitle
        console.log(`[编辑-输入] 准备输入: ${fullText.substring(0, 40)}...`)
        const inputOk = await doInput(apiPort, fullText, signal, adb)
        if (!inputOk) {
          console.log(`[编辑-输入✗] 文本输入失败，将在验证阶段重试`)
        } else {
          console.log(`[编辑-输入✓] 已发送文本`)
        }
        // 收起键盘（如果有的话）
        await sleep(500, signal)
        if (adb) { try { adb.shell('input keyevent KEYCODE_BACK') } catch {} }
        else { await sh(apiPort, 'input keyevent KEYCODE_BACK', signal) }
        await sleep(10000, signal) // ★ 等待10秒让UI刷新
        _editSubStep = 'VERIFY_TITLE'
        // 不返回success——下一轮循环会进入VERIFY_TITLE
        return { success: true, action: '输入标题完成', message: fullText.substring(0, 30), waitMs: 2000 }
      }

      // ════════ Sub-C: 验证标题是否成功输入 ════════
      if (subStep === 'VERIFY_TITLE') {
        try {
          const verifyDump = await UI.dumpXml(apiPort)
          if (verifyDump.success && verifyDump.data) {
            const vNodes = UI.parseUiXml(verifyDump.data)
            const titlePreview = _safeTitle.substring(0, 10)

            // 搜索所有节点中是否包含我们输入的标题文字
            let titleFound = false
            for (const rawNode of vNodes) {
              const node = rawNode as { text?: string; contentDesc?: string; bounds?: string }
              const nodeText = node.text || ''
              const nodeDesc = node.contentDesc || ''
              if (nodeText.includes(titlePreview) || nodeDesc.includes(titlePreview)) {
                titleFound = true
                const b = UI.parseBounds(node.bounds || '')
                const pos = b ? `(${Math.round(b.x)},${Math.round(b.y)})` : '?'
                console.log(`[编辑-标题验证✓] 在节点中找到标题内容 "${titlePreview}..." → ${pos}`)
                break
              }
            }

            if (titleFound) {
              console.log(`[编辑-标题验证✓] 标题已成功输入！准备处理话题标签...`)
              _editSubStep = 'ADD_TOPICS'
              return { success: true, action: '标题验证通过', message: '标题已确认输入', waitMs: 10000 }
            } else {
              // 标题没找到 — 可能是输入方式问题，重试一次
              console.log(`[编辑-标题验证✗] 未在页面找到标题内容 "${titlePreview}..."，可能输入失败`)
              // 重试：回到点击输入框
              _editSubStep = 'CLICK_INPUT'
              return { success: false, action: '标题验证失败,重试', message: '未找到标题文字', waitMs: 3000 }
            }
          }
        } catch (e) {
          console.log(`[编辑-标题验证] 异常: ${e}`)
        }
        // XML失败时默认继续（可能是XML解析问题但实际已输入）
        console.log(`[编辑-标题验证] XML获取失败，假设输入成功，继续...`)
        _editSubStep = 'ADD_TOPICS'
        return { success: true, action: '跳过验证(XML失败)', message: '', waitMs: 10000 }
      }

      // ════════ Sub-D: 添加话题标签（VLM双图验证）═══════
      if (subStep === 'ADD_TOPICS') {
        if (!_safeTopics || _safeTopics.trim().length === 0) {
          console.log(`[编辑-标签] 无话题配置, 跳过标签步骤`)
          _editSubStep = '' // 重置子步骤
          return { success: true, action: '跳过标签(空)', message: '', waitMs: 10000 }
        }

        // ★★ VLM 验证：当前是否在编辑主页（还没点进话题页）★★
        console.log(`[话题-VLM] 验证是否在"视频发布编辑页"...`)
        const topicVlm = await verifyWithBaseline(b64, 'edit_title', '抖音视频发布编辑页')
        
        if (topicVlm.match === 'NO') {
          console.log(`[话题-自愈] 不在编辑页: "${topicVlm.detail}"`)
          // 可能已经在话题列表页了 → 直接进入搜索/选择流程
          const alreadyInTopic = topicVlm.detail.includes('话题') || topicVlm.detail.includes('标签') || topicVlm.detail.includes('列表')
          if (alreadyInTopic) {
            console.log(`[话题-自愈] 已在话题列表页！跳过点#话题按钮，直接搜索...`)
          } else {
            // 其他异常页面 → BACK 试试
            await goBack(apiPort, 1, signal, adb)
            await sleep(2000, signal)
            return { success: false, action: '自愈-BACK', message: topicVlm.detail, waitMs: 3000 }
          }
        }

        // 找"#添加话题"按钮
        const topicBtn = await findAnyText(apiPort, ['#添加话题', '添加话题', '话题', '#'], screenH, 3000)
        if (topicBtn) {
          console.log(`[编辑-标签✓] 找到"${topicBtn.textHint}" → (${topicBtn.x},${topicBtn.y}) clickable=${topicBtn.clickable}`)
          await doTap(apiPort, topicBtn.x, topicBtn.y, signal, adb)
          await sleep(2000, signal) // 等待话题选择界面

          // 如果话题是逗号分隔的多个标签，取第一个作为搜索关键词
          const firstTopic = _safeTopics.split(',')[0].trim().replace(/^#/, '').trim()
          if (firstTopic) {
            console.log(`[编辑-标签] 输入话题搜索: ${firstTopic}`)
            // 尝试找搜索框并输入
            const searchBox = await locateByText(apiPort, ['搜索', '请输入', '查找'], 2000)
            if (searchBox) {
              await doTap(apiPort, searchBox.x, searchBox.y, signal, adb)
              await sleep(800, signal)
              await doInput(apiPort, firstTopic, signal, adb)
              console.log(`[编辑-标签] 已输入: ${firstTopic}`)
              await sleep(3000, signal) // 等搜索结果

              // 点击第一个结果
              const firstResult = await findAnyText(apiPort, [firstTopic.substring(0, 4)], screenH * 0.8)
              if (firstResult && firstResult.y > screenH * 0.15) {
                console.log(`[编辑-标签✓] 选择话题 → (${firstResult.x},${firstResult.y})`)
                await doTap(apiPort, firstResult.x, firstResult.y, signal, adb)
                await sleep(10000, signal) // 等10秒
                _editSubStep = 'VERIFY_TOPICS'
                return { success: true, action: '选择话题完成', message: firstTopic, waitMs: 10000 }
              }
              // 兜底：点屏幕中部
              const fallbackY = Math.round(screenH * 0.45)
              await doTap(apiPort, 540, fallbackY, signal, adb)
              await sleep(10000, signal)
              _editSubStep = 'VERIFY_TOPICS'
              return { success: true, action: '话题兜底点击', message: firstTopic, waitMs: 10000 }
            }
            // 无搜索框：直接找包含话题词的节点
            console.log(`[编辑-标签] 未找到搜索框, 直接匹配...`)
            const directMatch = await findAnyText(apiPort, [firstTopic.substring(0, 4)], screenH * 0.9)
            if (directMatch && directMatch.y > screenH * 0.10) {
              await doTap(apiPort, directMatch.x, directMatch.y, signal, adb)
              await sleep(10000, signal)
              _editSubStep = 'VERIFY_TOPICS'
              return { success: true, action: '直接选择话题', message: firstTopic, waitMs: 10000 }
            }
          }

          // 点了话题按钮但没搜/选，等一下再验证
          await sleep(10000, signal)
          _editSubStep = 'VERIFY_TOPICS'
          return { success: true, action: '已点击话题入口', message: '', waitMs: 10000 }
        }

        // 没有话题按钮，可能已经输入了（标题里带#话题），直接验证
        console.log(`[编辑-标签✗] 未找到话题按钮，检查是否已有标签...`)
        _editSubStep = 'VERIFY_TOPICS'
        return { success: true, action: '跳过添加(无按钮)', message: '', waitMs: 5000 }
      }

      // ════════ Sub-E: 验证话题标签是否添加成功 ════════
      if (subStep === 'VERIFY_TOPICS') {
        try {
          const topicDump = await UI.dumpXml(apiPort)
          if (topicDump.success && topicDump.data) {
            const tNodes = UI.parseUiXml(topicDump.data)
            const topicKeywords = _safeTopics.split(',').map(t => t.trim().replace(/^#/, '')).filter(t => t.length >= 2)

            let anyTopicFound = false
            for (const keyword of topicKeywords) {
              const preview = keyword.substring(0, 6)
              for (const rawNode of tNodes) {
                const node = rawNode as { text?: string; contentDesc?: string; bounds?: string }
                const nodeText = node.text || ''
                const nodeDesc = node.contentDesc || ''
                if (nodeText.includes(preview) || nodeDesc.includes(preview)) {
                  anyTopicFound = true
                  const b = UI.parseBounds(node.bounds || '')
                  const pos = b ? `(${Math.round(b.x)},${Math.round(b.y)})` : '?'
                  console.log(`[编辑-标签验证✓] 找到话题 "${preview}..." → ${pos}`)
                  break
                }
              }
              if (anyTopicFound) break
            }

            if (anyTopicFound) {
              console.log(`[编辑-标签验证✓] 标签已确认！编辑页流程完成 ✅`)
              _editSubStep = '' // ★ 重置子步骤！下次再进EDIT_TITLE会从头开始
              return { success: true, action: '编辑流程完成', message: '标题+标签已确认', waitMs: 10000 }
            } else {
              console.log(`[编辑-标签验证✗] 未检测到标签内容 [${topicKeywords.join(',')}], 但继续发布...`)
              // 不阻塞：标签没找到也继续（可能UI格式变了）
              _editSubStep = ''
              return { success: true, action: '标签未确认但继续', message: '', waitMs: 10000 }
            }
          }
        } catch (e) {
          console.log(`[编辑-标签验证] 异常: ${e}`)
        }
        _editSubStep = ''
        return { success: true, action: '编辑完成(异常)', message: '', waitMs: 10000 }
      }

      // 兜底
      _editSubStep = ''
      return { success: false, action: '编辑未知子步骤', message: String(subStep), waitMs: 3000 }
    }

    // ========================================
    // STEP 4.3: 编辑页 → 选择话题标签
    // ========================================
    // 流程：
    //   1. 点击编辑页的 "#添加话题" 按钮
    //   2. 在话题搜索/列表页，按关键词匹配已有热门话题
    //   3. 点击选择目标话题
    //   4. 返回编辑页 → 进入下一步（SELECT_POI 或 PUBLISH_BTN）
    //
    // 如果 _safeTopics 为空或 topic 未勾选，getNextStep 会跳过此步骤
    case 'SELECT_TOPIC': {
      // ★ 子步骤状态机：CLICK_ENTRY(进话题页) → SEARCH_INPUT(搜关键词) → PICK_RESULT(选结果) ★
      const topicSub = (_topicSubStep || '') as '' | 'CLICK_ENTRY' | 'SEARCH_INPUT' | 'PICK_RESULT'
      console.log(`[话题] 子步骤=${topicSub} | 关键词="${_safeTopics.substring(0, 40)}"`)

      // ════════ Sub-A: 在编辑页 → 点"话题"按钮进入话题选择页 ════════
      if (!topicSub || topicSub === 'CLICK_ENTRY') {
        // ★ 用 findAnyText（不限clickable），因为"话题"可能是非clickable的TextView ★
        const entryBtn = await findAnyText(apiPort, ['话题', '#添加话题', '添加话题'], screenH * 0.7, 2500)
        if (entryBtn) {
          console.log(`[话题✓] 点击入口 (${entryBtn.x},${entryBtn.y}) textHint="${entryBtn.textHint}"`)
          await doTap(apiPort, entryBtn.x, entryBtn.y, signal, adb)
          _topicSubStep = 'SEARCH_INPUT'   // 下轮进入搜索
          return { success: true, action: '点击话题入口', message: `(${entryBtn.x},${entryBtn.y})`, waitMs: 3000 }
        }
        // ★ 不再用"已有#标签"来判断是否已完成 — 那些可能是历史残留 ★
        console.log(`[话题⚠] 编辑页未找到"话题"入口按钮`)
        _topicSubStep = 'SEARCH_INPUT'  // 可能页面已经切换了，尝试进入搜索模式
      }

      // ════════ Sub-B: 在话题选择页 → 点搜索框 + 输入关键词 ════════
      if (topicSub === 'SEARCH_INPUT') {
        // 先确认不在编辑页（VLM快速判断）
        const vlmTopic = await verifyWithBaseline(b64, 'edit_title', '视频发布编辑页')
        if (vlmTopic.match === 'YES') {
          // 还在编辑页？说明上次的点击没生效，重新点入口
          console.log(`[话题-VLM] 仍在编辑页，回退重新点入口...`)
          _topicSubStep = 'CLICK_ENTRY'
          return { success: false, action: '话题-重新入口', message: 'VLM检测仍在编辑页', waitMs: 1500 }
        }

        // 找搜索框（话题页面的搜索框文字）
        const searchBox = await locateByText(apiPort, ['搜索话题', '搜索', '输入关键词', '找话题'], 2000)
        if (searchBox) {
          console.log(`[话题-搜索✓] 找到搜索框 (${searchBox.x},${searchBox.y})`)
          await doTap(apiPort, searchBox.x, searchBox.y, signal, adb)
          await sleep(1000, signal)

          // 输入第一个关键词
          const firstKw = _safeTopics.split(',')[0].replace(/#/g, '').trim()
          if (firstKw) {
            await doInput(apiPort, firstKw, signal, adb)
            console.log(`[话题-搜索✓] 输入关键词: "${firstKw}"`)
            _topicSubStep = 'PICK_RESULT'
            return { success: true, action: '话题-输入关键词', message: firstKw, waitMs: 3000 } // 等搜索结果加载
          }
        }

        // 没搜索框 → 尝试直接在列表中找匹配的话题
        console.log(`[话题] 无搜索框，直接尝试从列表中选取...`)
        _topicSubStep = 'PICK_RESULT'
      }

      // ════════ Sub-C: 从结果列表中精确选择包含关键词的话题 ════════
      if (topicSub === 'PICK_RESULT') {
        const firstKw = _safeTopics.split(',')[0].replace(/#/g, '').trim()

        // XML 精确匹配：找包含关键词且 # 开头的结果
        const pickDump = await UI.dumpXml(apiPort)
        if (pickDump.success && pickDump.data) {
          const nodes = UI.parseUiXml(pickDump.data)
          let bestMatch: any = null
          for (const n of nodes) {
            const txt = (n.text || '')
            // 匹配 #xxx 格式的话题标签，优先完全包含关键词的
            if ((txt.startsWith('#') || txt.includes('话题')) &&
                txt.includes(firstKw) && n.clickable && n.bounds) {
              const b = UI.parseBounds(n.bounds)
              if (!b || b.y < screenH * 0.20 || b.y > screenH * 0.90) continue
              if (!bestMatch || txt.length < bestMatch.text.length) {
                bestMatch = { ...n, bx: b.x + b.width / 2, by: b.y + b.height / 2 }
              }
            }
          }

          if (bestMatch) {
            const px = Math.round(bestMatch.bx), py = Math.round(bestMatch.by)
            console.log(`[话题✓] 精确匹配 "${bestMatch.text}" (${px},${py}) clickable=${bestMatch.clickable}`)
            await doTap(apiPort, px, py, signal, adb)
            _topicSubStep = ''   // 重置
            return { success: true, action: '选择话题完成', message: bestMatch.text, waitMs: 2000 }
          }

          // 没精确匹配 → 找任意 #开头可点击的话题（至少选一个）
          for (const n of nodes) {
            const txt = (n.text || '')
            if (txt.startsWith('#') && n.clickable && n.bounds) {
              const b = UI.parseBounds(n.bounds)
              if (!b || b.y < screenH * 0.20 || b.y > screenH * 0.90) continue
              const px = Math.round(b.x + b.width / 2), py = Math.round(b.y + b.height / 2)
              console.log(`[话题~] 无精确匹配，选用 "${txt}" (${px},${py})`)
              await doTap(apiPort, px, py, signal, adb)
              _topicSubStep = ''
              return { success: true, action: '选择话题(近似)', message: txt, waitMs: 2000 }
            }
          }
        }

        // 兜底：宽松搜索
        const looseMatch = await findAnyText(apiPort, [firstKw], screenH * 0.85, 1500)
        if (looseMatch && looseMatch.y > screenH * 0.25) {
          console.log(`[话题✓] 宽松匹配 → (${looseMatch.x},${looseMatch.y})`)
          await doTap(apiPort, looseMatch.x, looseMatch.y, signal, adb)
          _topicSubStep = ''
          return { success: true, action: '选择话题(宽松)', message: looseMatch.textHint || '', waitMs: 2000 }
        }

        // 全部失败 → BACK 返回编辑页
        console.log(`[话题⚠] 未找到任何匹配话题，BACK返回编辑页`)
        await goBack(apiPort, 1, signal, adb)
        _topicSubStep = ''
        return { success: true, action: '话题(无匹配/跳过)', message: '', waitMs: 1500 }
      }

      // 不应该到这里
      _topicSubStep = ''
      return { success: true, action: '话题(异常退出)', message: '', waitMs: 1000 }
    }

    // ========================================
    // STEP 4.5: 编辑页 → 选择/输入位置（POI）
    //   子步骤：CLICK_ENTRY(点添加位置) → SEARCH(搜索城市) → PICK(选结果)
    //
    // 如果 _safeLocation 为空，getNextStep 会跳过此步骤直接到 PUBLISH_BTN
    case 'SELECT_POI': {
      if (!_safeLocation) {
        console.log(`[位置] 无位置配置, 跳过`)
        return { success: true, action: '跳过位置(空)', message: '', waitMs: 0 }
      }

      // ★ 子步骤状态机 ★
      const poiSub = (_poiSubStep || '') as '' | 'CLICK_ENTRY' | 'SEARCH' | 'PICK'
      console.log(`[位置] 子步骤=${poiSub} | 目标="${_safeLocation}"`)

      // ════════ Sub-A: 在编辑页 → 点"添加位置"/"所在位置"按钮 ════════
      if (!poiSub || poiSub === 'CLICK_ENTRY') {
        // VLM 确认是否在编辑主页
        const vlmPoi = await verifyWithBaseline(b64, 'edit_title', '视频发布编辑页')

        if (vlmPoi.match === 'NO') {
          // 不在编辑页，判断是否已在位置选择页面
          const isCityPage = vlmPoi.detail.includes('城市') || vlmPoi.detail.includes('搜索位置') ||
                             vlmPoi.detail.includes('city') || vlmPoi.detail.includes('定位')
          if (isCityPage) {
            console.log(`[位置-自愈] 已在城市/位置选择页，跳到搜索步骤`)
            _poiSubStep = 'SEARCH'
          } else {
            console.log(`[位置-自愈] 不在编辑页也不在位置页: "${vlmPoi.detail}"，BACK...`)
            await goBack(apiPort, 1, signal, adb)
            _poiSubStep = ''
            return { success: false, action: '位置-BACK', message: vlmPoi.detail, waitMs: 2000 }
          }
        } else {
          // 在编辑页 → 找"添加位置"或"所在位置"按钮
          // ★ "添加位置" 是 clickable=false(TextView)，必须用 findAnyText！
          const entryBtn = await findAnyText(apiPort, ['添加位置', '所在位置'], screenH * 0.7, 2500)
          if (entryBtn) {
            console.log(`[位置✓] 点击入口 (${entryBtn.x},${entryBtn.y}) textHint="${entryBtn.textHint}"`)
            await doTap(apiPort, entryBtn.x, entryBtn.y, signal, adb)
            _poiSubStep = 'SEARCH'
            return { success: true, action: '点击位置入口', message: `(${entryBtn.x},${entryBtn.y})`, waitMs: 3000 }
          }

          console.log(`[位置⚠] 编辑页未找到位置入口按钮，尝试按已在位置页处理...`)
          _poiSubStep = 'SEARCH'  // 可能已经点过了
        }
      }

      // ════════ Sub-B: 在位置选择页 → 点搜索框 + 输入城市名 ════════
      if (poiSub === 'SEARCH') {
        // 搜索框关键词列表
        const searchBox = await locateByText(apiPort, ['搜索', '查找地点', '请输入', '搜索位置', '输入地点名称'], 2000)
        if (searchBox) {
          console.log(`[位置-搜索✓] 找到搜索框 (${searchBox.x},${searchBox.y})`)
          await doTap(apiPort, searchBox.x, searchBox.y, signal, adb)
          await sleep(800, signal)

          // 取第一个城市名（支持 "合肥、天鹅湖" 格式，只取第一个）
          const cityName = _safeLocation.split(/[、,，]/)[0].trim()
          if (cityName) {
            await doInput(apiPort, cityName, signal, adb)
            console.log(`[位置-搜索✓] 输入城市: "${cityName}"`)
            _poiSubStep = 'PICK'
            return { success: true, action: '位置-输入城市', message: cityName, waitMs: 3000 } // 等搜索结果
          }
        }

        // 没搜索框 → 可能是列表模式，直接尝试选取
        console.log(`[位置] 无搜索框，进入直接选取模式...`)
        _poiSubStep = 'PICK'
      }

      // ════════ Sub-C: 从结果中选取目标城市/POI ════════
      if (poiSub === 'PICK') {
        const cityName = _safeLocation.split(/[、,，]/)[0].trim()

        // XML 精确匹配
        const pickDump = await UI.dumpXml(apiPort)
        if (pickDump.success && pickDump.data) {
          const nodes = UI.parseUiXml(pickDump.data)

          // 优先匹配完整城市名
          for (const n of nodes) {
            const txt = (n.text || '')
            if ((txt.includes(cityName) || cityName.includes(txt)) &&
                txt.length >= 2 && n.clickable && n.bounds) {
              const b = UI.parseBounds(n.bounds)
              if (!b || b.y < screenH * 0.15 || b.y > screenH * 0.90) continue
              // 排除搜索框自身（通常在顶部）
              if (b.y < screenH * 0.22 && n.className?.includes('Edit')) continue
              const px = Math.round(b.x + b.width / 2), py = Math.round(b.y + b.height / 2)
              console.log(`[位置✓] 选择 "${txt}" (${px},${py})`)
              await doTap(apiPort, px, py, signal, adb)
              _poiSubStep = ''
              return { success: true, action: '选择POI完成', message: txt, waitMs: 3000 }
            }
          }

          // 宽松匹配：取屏幕中部偏下的第一个可点击项（通常是搜索结果第一项）
          let bestCandidate: any = null
          for (const n of nodes) {
            if (!n.clickable || !n.bounds) continue
            const b = UI.parseBounds(n.bounds)
            if (!b) continue
            // 结果列表通常在屏幕中部偏下
            if (b.y < screenH * 0.28 || b.y > screenH * 0.85) continue
            if (b.width < 80 || b.height < 30) continue
            if (!bestCandidate || b.y < bestCandidate.by) {
              bestCandidate = { ...n, bx: b.x + b.width / 2, by: b.y + b.height / 2 }
            }
          }

          if (bestCandidate) {
            const px = Math.round(bestCandidate.bx), py = Math.round(bestCandidate.by)
            console.log(`[位置~] 无精确匹配，选用 "${bestCandidate.text||'?'}" (${px},${py})`)
            await doTap(apiPort, px, py, signal, adb)
            _poiSubStep = ''
            return { success: true, action: '选择POI(近似)', message: bestCandidate.text || '', waitMs: 3000 }
          }
        }

        // 兜底：findAnyText 宽松搜索
        const looseMatch = await findAnyText(apiPort, [cityName.substring(0, 3)], screenH * 0.8, 1500)
        if (looseMatch && looseMatch.y > screenH * 0.20) {
          console.log(`[位置✓] 宽松匹配 → (${looseMatch.x},${looseMatch.y})`)
          await doTap(apiPort, looseMatch.x, looseMatch.y, signal, adb)
          _poiSubStep = ''
          return { success: true, action: '选择POI(宽松)', message: looseMatch.textHint || '', waitMs: 3000 }
        }

        // 全部失败 → BACK 返回编辑页
        console.log(`[位置⚠] 未找到匹配位置，BACK返回编辑页`)
        await goBack(apiPort, 1, signal, adb)
        _poiSubStep = ''
        return { success: true, action: '位置(无匹配/跳过)', message: '', waitMs: 1500 }
      }

      // 异常退出
      _poiSubStep = ''
      return { success: true, action: '位置(异常退出)', message: '', waitMs: 1000 }
    }

    // ========================================
    // STEP 5: 发布页 → 点击 "发布" 按钮
    // ========================================
    // ★ 发布按钮：优先找 clickable=true 的 "发作品" 节点，和点标题框一样简洁直接
    case 'PUBLISH_BTN': {
      // 抖音发布按钮结构：FrameLayout(clickable=true,"发作品") 包裹 TextView(clickable=false,"发作品")
      // 必须找到可点击的外层！
      let tapped = false

      // ── 方式1：locateByText 找 "发作品"（和点标题框一样）──
      try {
        const xmlPub = await locateByText(apiPort, ['发作品', '发布', '立即发布'], 2000)
        if (xmlPub) {
          console.log(`[发布✓] locateByText → (${xmlPub.x},${xmlPub.y})`)
          await doTap(apiPort, xmlPub.x, xmlPub.y, signal, adb)
          tapped = true
        } else {
          console.log(`[发布⚠] locateByText未找到，尝试XML手动搜索...`)
        }
      } catch (e) { console.log(`[发布⚠] 方式1异常: ${e}`) }

      // ── 方式2：locateByIdle没找到时，dump XML手动找 clickable 节点 ──
      if (!tapped) {
        try {
          const pubDump = await UI.dumpXml(apiPort)
          if (pubDump.success && pubDump.data) {
            const pNodes = UI.parseUiXml(pubDump.data)
            const pubKeywords = ['发作品', '发布', '立即发布', '发送']
            let bestNode: { x: number; y: number; text: string; clickable: boolean; className?: string } | null = null
            for (const rawNode of pNodes) {
              const node = rawNode as { text?: string; contentDesc?: string; className?: string; bounds?: string; clickable?: boolean }
              const nodeText = node.text || ''
              const nodeDesc = node.contentDesc || ''
              const isPub = pubKeywords.some(k => nodeText.includes(k) || nodeDesc.includes(k))
              if (isPub && node.bounds) {
                const b = UI.parseBounds(node.bounds)
                if (!b || b.y < screenH * 0.50) continue // 太靠上的忽略
                // 评分：clickable=true 最高分，FrameLayout 次之，y越大越好
                const score =
                  (!!node.clickable ? 200 : 0) +
                  (node.className?.includes('FrameLayout') ? 100 : 0) +
                  Math.round(b.y)
                if (!bestNode || score >
                    ((!!bestNode.clickable ? 200 : 0) +
                     (bestNode.className?.includes('FrameLayout') ? 100 : 0) +
                     Math.round(bestNode.y))) {
                  bestNode = {
                    x: Math.round(b.x + b.width / 2),
                    y: Math.round(b.y + b.height / 2),
                    text: nodeText || nodeDesc,
                    clickable: !!node.clickable,
                    className: node.className,
                  }
                }
                console.log(`[发布-候选] "${nodeText || nodeDesc}" | ${node.className} | clickable=${!!node.clickable} | (${Math.round(b.x + b.width / 2)},${Math.round(b.y + b.height / 2)})`)
              }
            }
            if (bestNode) {
              console.log(`[发布✓] 最佳候选: "${bestNode.text}" (${bestNode.x},${bestNode.y}) clickable=${bestNode.clickable}`)
              await doTap(apiPort, bestNode.x, bestNode.y, signal, adb)
              tapped = true
            }
          }
        } catch (e) { console.log(`[发布⚠] 方式2异常: ${e}`) }
      }

      // ── 方式3：VL视觉定位兜底 ──
      if (!tapped) {
        console.log(`[发布-VL] XML均失败, VL定位红底白字发布按钮...`)
        const vlCoord = await locateElement(
          b64,
          `这是抖音APP的视频发布编辑页面${screenW}x${screenH}。屏幕右下角有一个【红色或橙红色圆角矩形】按钮，上面写着白色的"发布"或"发作品"大字。请找到这个红色按钮的中心坐标并返回。注意这个按钮在屏幕底部区域(y>屏幕高度的60%)。如果看不到就返回null。`
        )
        if (vlCoord && vlCoord.y > screenH * 0.50) {
          console.log(`[发布VL✓] → (${vlCoord.x},${vlCoord.y})`)
          await doTap(apiPort, vlCoord.x, vlCoord.y, signal, adb)
          tapped = true
        }
      }

      // ── 方式4：比例坐标终极兜底 ──
      if (!tapped) {
        const ratioX = Math.round(screenW * 0.88), ratioY = Math.round(screenH * 0.92)
        console.log(`[发布-比例] 终极兜底 → (${ratioX},${ratioY})`)
        await doTap(apiPort, ratioX, ratioY, signal, adb)
        tapped = true
      }

      return { success: true, action: '点击发布按钮', message: tapped ? '已点击' : '兜底完成', waitMs: 12000 }
    }

    default:
      return { success: false, action: '未知步骤', message: String(step), waitMs: 2000 }
  }
}

/** 步骤推进顺序（根据勾选步骤动态决定下一步） */
function getNextStep(current: WorkflowStep): WorkflowStep {
  switch (current) {
    case 'HOME_PLUS': return 'SHOOT_ALBUM'
    case 'SHOOT_ALBUM': return 'ALBUM_PICK'
    case 'ALBUM_PICK': return 'VIDEO_PREVIEW'
    case 'VIDEO_PREVIEW': return 'EDIT_TITLE'
    case 'EDIT_TITLE':
      // ★ 根据勾选决定下一步：有topic → topic，否则看location，都没有直接发布
      if (_safePublishSteps.includes('topic')) return 'SELECT_TOPIC'
      if (_safePublishSteps.includes('location') && _safeLocation) return 'SELECT_POI'
      return 'PUBLISH_BTN'
    case 'SELECT_TOPIC':
      // ★ 话题完成后：有location且有配置 → location，否则直接发布
      if (_safePublishSteps.includes('location') && _safeLocation) return 'SELECT_POI'
      return 'PUBLISH_BTN'
    case 'SELECT_POI': return 'PUBLISH_BTN'
    case 'PUBLISH_BTN': return 'DONE'
    default: return 'HOME_PLUS'
  }
}

/** 步骤序号（用于判断是否超前/回退） */
function stepToOrder(step: WorkflowStep): number {
  switch (step) {
    case 'HOME_PLUS': return 1
    case 'SHOOT_ALBUM': return 2
    case 'ALBUM_PICK': return 3
    case 'VIDEO_PREVIEW': return 3.5             // ★ 在 ALBUM_PICK 和 EDIT_TITLE 之间
    case 'EDIT_TITLE': return 4
    case 'SELECT_TOPIC': return 4.5              // ★ 选话题标签（在编辑和位置之间）
    case 'SELECT_POI': return 5
    case 'PUBLISH_BTN': return 6
    case 'DONE': return 99
    default: return 0
  }
}

/**
 * VL 坐标合理性检查
 * 过滤掉左上角等异常区域（状态栏、导航栏误识别）
 */
function isVlCoordValid(x: number, y: number, screenW: number, screenH: number): boolean {
  if (x <= 0 || y <= 0) return false
  // 拒绝左上角 10% 区域（通常是状态栏/设置按钮）
  if (y < screenH * 0.08) { console.log(`[VL✗] y=${y} < 屏幕顶部8%, 拒绝`); return false }
  if (x < screenW * 0.05 && y < screenH * 0.15) { console.log(`[VL✗] (${x},${y}) 在左上角, 拒绝`); return false }
  return true
}
