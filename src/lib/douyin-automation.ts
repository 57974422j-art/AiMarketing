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

      // 发送文本广播（用双引号包裹，避免 # $ ` 等shell特殊字符问题）
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')
      const r = await execShell(apiPort, `am broadcast -a ADB_INPUT_TEXT --es msg "${escaped}"`, signal, adb)

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
          const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')
          const broadcastR = await execShell(apiPort, `am broadcast -a ADB_INPUT_TEXT --es msg "${escaped}"`, signal, adb)

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

  // ════════════════════════════════════════════════════════════
  // V4 纯坐标极速模式 + VL 自检兜底
  // ════════════════════════════════════════════════════════════

  // 构建完整输入文本（标题+话题一次性合并）
  let fullInputText = _safeTitle
  if (_safeTopics && _safeTopics.trim()) {
    const topicList = _safeTopics
      .split(/[,#\s]+/)
      .map(t => t.trim().replace(/^#+/, ''))
      .filter(t => t.length >= 2)
      .map(t => `#${t}`)
    if (topicList.length > 0) fullInputText += ' ' + topicList.join(' ')
  }

  const sh2 = screenH
  const sw2 = screenW
  console.log(`[${TS()}] ========== V4 纯坐标模式 屏幕${sw2}x${sh2} 目标:"${fullInputText.substring(0,30)}" ==========`)

  // 8 步固定坐标序列（基于真实XML采集数据）
  const steps: Array<{
    name: string; x: number; y: number; check: string | null; input?: string; waitS: number
  }> = [
    { name: '点加号',    x: Math.round(sw2 * 0.50), y: Math.round(sh2 * 0.958), check: '相册',        waitS: 4 },
    { name: '点相册',    x: 873,                     y: 2024,                       check: '全部',        waitS: 4 },
    { name: '切视频标签',x: 405,                     y: 497,                        check: '00:',         waitS: 3 },
    { name: '选视频',    x: 178,                     y: 642,                        check: '下一步',      waitS: 4 },
    { name: '点下一步1', x: 828,                     y: 2279,                       check: '下一步',      waitS: 5 },
    { name: '点下一步2', x: 803,                     y: 2260,                       check: '添加标题',    waitS: 5 },
    { name: '输标题',    x: 554,                     y: 1000,                       check: _safeTitle.substring(0, 3), input: fullInputText, waitS: 4 },
    { name: '点发布',    x: 731,                     y: 2183,                       check: null,          waitS: 5 },
  ]

  let failStreak = 0
  let currentIdx = 0
  const TOTAL_STEPS = steps.length

  while (currentIdx < TOTAL_STEPS) {
    if (signal?.aborted) return { success: false, message: '用户停止' }
    const step = steps[currentIdx]
    const waitMs = step.waitS * 1000 + Math.floor(Math.random() * 2001)

    console.log(`\n[${TS()}] ── Step ${currentIdx + 1}/${TOTAL_STEPS}: ${step.name} (${step.x},${step.y}) ──`)

    await smartTap(apiPort, step.x, step.y, 200 + Math.floor(Math.random() * 81), signal, adb)
    console.log(`[${TS()}] [操作] ${step.name}: (${step.x},${step.y}) 等待${(waitMs/1000).toFixed(1)}s`)

    if (step.input) {
      await sleep(1500, signal)
      console.log(`[${TS()}] [输入] ${step.input.length}字: "${step.input.substring(0,40)}"`)
      const inputOk = await doInput(apiPort, step.input, signal, adb)
      console.log(`[${TS()}] [输入${inputOk ? '✓' : '⚠'}] ${inputOk ? '成功' : '失败但继续'}`)
      await sleep(1000, signal)
    }

    await sleep(waitMs, signal)

    let spotOk = true
    if (step.check) {
      try {
        const found = await findAnyText(apiPort, [step.check], sh2, 2000)
        if (found) {
          console.log(`[${TS()}] [抽查✓] "${step.check}" → (${found.x},${found.y})`)
          failStreak = 0
        } else {
          console.log(`[${TS()}] [抽查✗] "${step.check}" 未找到! 连续${failStreak + 1}次`)
          failStreak++
          spotOk = false
        }
      } catch {
        failStreak++
        spotOk = false
      }
    } else {
      failStreak = 0
    }

    if (!spotOk && failStreak >= 2) {
      console.log(`\n[${TS()}] ╔══ L2 VL自检触发 ══╗`)
      try {
        const diagB64 = await UI.takeScreenshot(apiPort)
        if (diagB64) {
          const desc = await describeScreenVL(diagB64)
          console.log(`[${TS()}] [VL自检] 画面: ${desc ? desc.substring(0, 200) : '(VL无响应)'}`)

          const now = new Date()
          const ssName = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}_step${currentIdx+1}_${step.name}.png`
          try {
            await saveScreenshot(apiPort, diagB64, ssName)
            console.log(`[${TS()}] [存档] 截图已保存: ${ssName}`)
          } catch { console.log('[存档] 保存截图失败') }

          try {
            await postDiagnosis({
              app: '抖音', step: step.name,
              errorLog: `抽查"${step.check}"连续失败 | VL: ${desc?.substring(0, 150) || '无'}`,
              screenshot: ssName, diagnosis: desc || 'VL未返回描述',
              severity: failStreak >= 3 ? 'critical' : 'warning',
            })
          } catch { console.log('[诊断上报] 失败') }

          if (desc) {
            const isPopup = desc.includes('弹窗') || desc.includes('提示') || desc.includes('我知道了') || desc.includes('取消') || desc.includes('确定')
            if (isPopup) {
              console.log(`[${TS()}] [弹窗!] 尝试关闭...`)
              const popupBtn = await findAnyText(apiPort, ['我知道了', '取消', '确定', '知道了', '关闭'], sh2, 2000)
              if (popupBtn) {
                await smartTap(apiPort, popupBtn.x, popupBtn.y, 200, signal, adb)
                await sleep(2000, signal)
              } else {
                try { adb ? adb.shell('input keyevent KEYCODE_BACK') : await sh(apiPort, 'input keyevent KEYCODE_BACK', signal) } catch {}
                await sleep(1500, signal)
              }
            }

            const isDesktop = desc.includes('桌面') || desc.includes('图库') || desc.includes('短信') || desc.includes('相机')
            if (isDesktop) {
              console.log(`[${TS()}] [桌面!] 重启抖音...`)
              await sh(apiPort, `am force-stop ${DOUYIN_PKG}`, signal)
              await sleep(1000, signal)
              await sh(apiPort, `am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`, signal)
              await sleep(5000, signal)
              currentIdx = 0
              failStreak = 0
              continue
            }
          }
        }
      } catch (e: any) {
        console.log(`[${TS()}] [VL自检异常] ${e?.message || e}`)
      }
      console.log(`[${TS()}] ╚══ L2 结束，继续尝试 ══╝\n`)
      failStreak = 0
      continue
    }

    if (spotOk) currentIdx++
  }

  console.log(`\n[${TS()}] ========== 流程完成 ✅ ==========`)
  return { success: true, message: '发布流程已执行' }
}

// ==================== V4 工具函数 ====================

/**
 * VL 自由描述画面
 */
async function describeScreenVL(b64: string): Promise<string | null> {
  try {
    const { dashscopeDescribeScreen } = await import('./ai-providers') as any
    return await dashscopeDescribeScreen(b64)
  } catch { return null }
}

function pad2(n: number): string { return n.toString().padStart(2, '0') }

async function saveScreenshot(apiPort: number, b64: string, filename: string): Promise<void> {
  const fs = await import('fs/promises')
  const path = await import('path')
  const dir = path.join(process.cwd(), 'public', 'screenshots')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, filename), Buffer.from(b64, 'base64'))
}

async function postDiagnosis(data: { app: string; step: string; errorLog: string; screenshot?: string; diagnosis: string; severity: string }): Promise<void> {
  try {
    await fetch('http://localhost:3000/api/admin/diagnosis-reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch {}
}

// ==================== 步骤执行器 ====================

// ==================== 步骤执行器 ====================

interface StepResult {