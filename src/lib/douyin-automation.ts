import * as UI from './uiautomator-driver'
import { ADB } from './adb-helper'
import { aiDecideNext, locateElement } from './ai-providers'

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

async function doInput(
  apiPort: number,
  text: string,
  signal?: AbortSignal,
  adb?: ADB | null
): Promise<boolean> {
  const safeText = text.replace(/"/g, '\\"').replace(/\$/g, '\\$')
  if (adb) {
    try {
      adb.inputText(text)
      return true
    } catch (e) {
      console.warn(`[doInput] adb.inputText 失败, 降级到HTTP: ${e}`)
      return sh(apiPort, `input text "${safeText}"`, signal)
    }
  }
  return sh(apiPort, `input text "${safeText}"`, signal)
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

/**
 * ★ 核心函数：通过 am start 命令启动抖音 App 到首页
 * 比 goBack + 点击图标可靠 100 倍
 */
async function launchDouyin(apiPort: number, signal?: AbortSignal, adb?: ADB | null): Promise<boolean> {
  const cmd = `am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`
  console.log(`[启动抖音] ${cmd}`)
  if (adb) {
    try {
      adb.shell(cmd)
      return true
    } catch (e) {
      console.warn(`[启动抖音] adb 失败, 降级HTTP: ${e}`)
      return sh(apiPort, cmd, signal)
    }
  }
  return sh(apiPort, cmd, signal)
}

// ==================== 页面类型检测 ====================

type PageType = 'home' | 'shoot' | 'album' | 'edit' | 'publish' | 'popup' | 'success' | 'unknown'

/**
 * 第1层：精确页面描述短语（最高优先级）
 * 这些是 AI 通常输出的精确匹配，必须放在关键词前面
 */
const EXACT_PHRASES: Array<{ type: PageType; phrases: string[] }> = [
  { type: 'success', phrases: ['发布成功', '成功发布', '已发布完成', '上传完成'] },
  { type: 'publish', phrases: ['当前页面为发布页', '发布准备页', '准备发布视频'] },
  { type: 'edit',   phrases: ['当前页面为编辑页', '标题编辑页面', '视频编辑页面'] },
  { type: 'album',  phrases: ['当前页面为相册页', '当前在相册', '视频选择页面', '媒体选择页面', '相册选择页'] },
  { type: 'shoot',  phrases: ['当前页面为拍摄页', '当前在拍摄界面', '相机拍摄界面', '拍照界面'] },
  { type: 'popup',  phrases: ['弹窗', '弹出窗口', '提示框', '对话框'] },
  { type: 'home',   phrases: ['当前页面为首页', '首页信息流', '抖音首页', '推荐信息流'] },
]

/**
 * 第2层：排除性规则（解决核心 bug：shoot 页含"相册"二字被误判为 album）
 */
const EXCLUSION_RULES: Array<{ type: PageType; pattern: RegExp }> = [
  { type: 'shoot', pattern: /当前.*拍摄|拍摄界|相机界|拍摄页|相机预览|实时画面/ },
  { type: 'album', pattern: /缩略图|媒体列表|相册网格|视频标签|图片标签|全部.*标签/ },
  { type: 'home',  pattern: /底部导航栏.*推荐|首页.*推荐|信息流/ },
]

/**
 * 第3层：辅助特征关键词
 */
const AUX_KEYWORDS: Array<{ type: PageType; keywords: string[] }> = [
  { type: 'publish', keywords: ['发作品按钮', '发布按钮高亮'] },
  { type: 'edit',   keywords: ['添加标题', '标题输入框', '编辑工具栏'] },
  { type: 'shoot',  keywords: ['取景器', '快门按钮', '拍摄按钮(圆形)', '前后置切换'] },
]

/**
 * 从 AI 分析文本中提取页面类型
 *
 * 优先级链：精确短语 → 排除性正则 → 辅助特征 → 兜底关键词
 */
function detectPageType(analysis: string): PageType {
  if (!analysis) return 'unknown'
  const lower = analysis.toLowerCase()

  // 第1层：精确页面描述短语
  for (const { type, phrases } of EXACT_PHRASES) {
    for (const phrase of phrases) {
      if (lower.includes(phrase.toLowerCase())) return type
    }
  }

  // 第2层：排除性规则 — 明确提到拍摄界面时强制判为 shoot
  for (const { type, pattern } of EXCLUSION_RULES) {
    if (pattern.test(analysis)) return type
  }

  // 第3层：辅助特征
  for (const { type, keywords } of AUX_KEYWORDS) {
    if (keywords.some(kw => analysis.includes(kw))) return type
  }

  // 第4层：兜底
  if (analysis.includes('底部导航') || analysis.includes('首页')) return 'home'
  return 'unknown'
}

// ==================== 操作失败检测器 ====================

class ActionFailureTracker {
  private history: Array<{ pageType: PageType; action: string; target: string; loop: number }> = []
  private maxHistory = 6
  private threshold = 3   // 连续 3 次相同操作即触发

  record(pageType: PageType, action: string, target: string, loop: number): void {
    this.history.push({ pageType, action, target, loop })
    if (this.history.length > this.maxHistory) this.history.shift()
  }

  check(): { action: string; target: string; pageType: PageType; count: number } | null {
    if (this.history.length < this.threshold) return null
    const recent = this.history.slice(-this.threshold)
    const first = recent[0]
    const allSame = recent.every(h =>
      h.pageType === first.pageType && h.action === first.action && h.target === first.target
    )
    if (allSame) return { action: first.action, target: first.target, pageType: first.pageType, count: this.threshold }
    return null
  }

  clear(): void { this.history = [] }
  getSummary(): string {
    return this.history.map(h => `${h.pageType}:${h.action}/${h.target.substring(0, 8)}`).join(' → ')
  }
}

// ==================== 学习系统 ====================

interface LearnedCoord {
  x: number; y: number
  successCount: number; failCount: number; lastUsed: number
}

class CoordinateLearner {
  private coords: Map<string, LearnedCoord> = new Map()
  private maxFails = 3

  get(pageType: PageType): LearnedCoord | null { return this.coords.get(pageType) || null }

  recordSuccess(pageType: PageType, x: number, y: number): void {
    const existing = this.coords.get(pageType)
    if (existing) {
      existing.successCount++; existing.failCount = 0; existing.lastUsed = Date.now()
      existing.x = Math.round((existing.x * (existing.successCount - 1) + x) / existing.successCount)
      existing.y = Math.round((existing.y * (existing.successCount - 1) + y) / existing.successCount)
    } else {
      this.coords.set(pageType, { x, y, successCount: 1, failCount: 0, lastUsed: Date.now() })
    }
  }

  recordFail(pageType: PageType): void {
    const coord = this.coords.get(pageType)
    if (coord) {
      coord.failCount++
      if (coord.failCount >= this.maxFails) {
        console.warn(`[学习] ${pageType} 坐标废弃 (${coord.x},${coord.y})`)
        this.coords.delete(pageType)
      }
    }
  }

  clearAll(): void {
    console.log(`[学习] 清空全部记录 (${this.coords.size} 条)`)
    this.coords.clear()
  }

  getSummary(): string {
    const entries: string[] = []
    for (const [type, c] of this.coords) entries.push(`${type}(${c.x},${c.y}) ✓${c.successCount}`)
    return entries.join(' | ') || '(空)'
  }
}

// ==================== XML 文字定位（带超时）====================

/**
 * 尝试通过多个候选文字定位元素
 * ★ 关键改进：每个查找带 5 秒超时，避免单次调用卡住 50 秒
 */
async function locateByText(
  apiPort: number,
  candidates: string[],
  perCandidateTimeoutMs = 5000
): Promise<{ x: number; y: number } | null> {
  for (const text of candidates) {
    try {
      // 用 Promise.race 实现超时
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

// ==================== 主工作流 ====================

interface WorkflowOptions {
  maxLoops?: number
  totalTimeoutMs?: number
}

/**
 * 抖音自动发布视频工作流
 *
 * 正确流程：
 *   首页(home) → 点"+" → 拍摄页(shoot) → 点"相册" → 相册页(album) → 选视频
 *   → 编辑页(edit) → 输入标题 → 发布页(publish) → 点"发布" → 完成
 */
export async function aiPublishVideoWorkflow(
  apiPort: number,
  title: string,
  topics: string[],
  signal?: AbortSignal,
  adb?: ADB | null,
  options: WorkflowOptions = {}
): Promise<{ success: boolean; message: string }> {

  const { maxLoops = 60, totalTimeoutMs = 300_000 } = options

  const safeTitle = title.replace(/"/g, '"').replace(/[{}[\]]/g, '')
  const safeTopics = topics.map(t => t.replace(/[,"]/g, '')).join(',')
  const goal = `发布视频到抖音，标题："${safeTitle}"，话题：${safeTopics}`

  const startTime = Date.now()

  let screenW = 1080, screenH = 2340
  try {
    const size = await UI.getScreenSize(apiPort)
    screenW = size.width; screenH = size.height
  } catch (e) {
    console.warn(`[初始化] 获取屏幕尺寸失败，使用默认值 ${screenW}x${screenH}`)
  }
  console.log(`[${TS()}] 屏幕 ${screenW}x${screenH}, 目标: ${safeTitle.substring(0, 30)}`)

  // 初始化子系统
  const learner = new CoordinateLearner()
  const failTracker = new ActionFailureTracker()
  let lastAnalysisHash = ''
  let samePageCount = 0
  let inputDone = false
  let doneLoopCount = 0
  let shootAlbumFailCount = 0  // shoot→相册 特殊计数器

  for (let loop = 0; loop < maxLoops; loop++) {
    // ---- 超时检查 ----
    if (signal?.aborted) return { success: false, message: '用户停止' }
    if (Date.now() - startTime > totalTimeoutMs) {
      return { success: false, message: '执行超时' }
    }

    // ---- 截图 ----
    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) { await sleep(2000, signal); continue }

    // ---- AI 决策 ----
    const dec = await aiDecideNext(b64, '', goal, { width: screenW, height: screenH })
    if (!dec) { await sleep(2000, signal); continue }
    console.log(`[${TS()}] [AI#${loop + 1}] ${dec.analysis.substring(0, 60)} → ${dec.action}/${dec.target_desc}`)

    // ---- DONE 检测 ----
    if (dec.status === 'DONE') {
      doneLoopCount++
      if (doneLoopCount >= 2) {
        console.log(`[${TS()}] [完成] 连续 ${doneLoopCount} 次 DONE 确认`)
        return { success: true, message: '视频已发布' }
      }
      console.log(`[${TS()}] [DONE] 第 ${doneLoopCount} 次，等待确认...`)
      await sleep(2000, signal); continue
    } else {
      doneLoopCount = 0
    }

    // ---- 页面类型识别 ----
    const pageType = detectPageType(dec.analysis)
    console.log(`[${TS()}] [页面] ${pageType}${pageType === 'unknown' ? '(' + dec.analysis.substring(0, 30) + ')' : ''}`)

    // ---- 操作失败检测 ----
    failTracker.record(pageType, dec.action, dec.target_desc, loop)
    const failure = failTracker.check()

    // ============================================================
    // ★★ 首页点"+" — 不用 AI 坐标也不用 VL（两者都不准）
    //
    // 日志证据：AI 给 (540,2170) 不准 / VL 给 (48,136) 点到左上角设置按钮
    // 解决：XML 定位 + 固定比例坐标兜底
    // ============================================================
    const isHomeWantingPlus =
      pageType === 'home' &&
      dec.action === 'click' &&
      (dec.target_desc.includes('+') || dec.target_desc.includes('加号') || dec.target_desc.includes('号'))

    if (isHomeWantingPlus) {
      console.log(`[定位] 首页→加号, 先尝试 XML...`)

      // 策略A: XML 定位（找底部导航栏的 + 号）
      const xmlPlus = await locateByText(apiPort, ['+', '发布'], 3000)
      if (xmlPlus) {
        console.log(`[定位✓] XML 加号 → (${xmlPlus.x},${xmlPlus.y})`)
        await doTap(apiPort, xmlPlus.x, xmlPlus.y, signal, adb)
        failTracker.clear()
        await sleep(4000, signal)
        continue
      }

      // 策略B: XML 失败 → 用固定比例坐标（底部导航栏正中间）
      // 抖音首页布局：底部导航栏高度约 screenH * 6.5%~7.5%，+ 号在水平居中
      // 1080x2340 屏幕上约 (540, 2160~2200)
      const plusY = Math.round(screenH * 0.925)  // 底部 7.5% 位置
      const plusX = Math.round(screenW * 0.5)     // 水平居中
      console.log(`[定位] XML未找到, 用比例坐标 → (${plusX},${plusY})`)
      await doTap(apiPort, plusX, plusY, signal, adb)
      failTracker.clear()
      await sleep(4000, signal)
      continue
    }

    // ============================================================
    // ★★ 拍摄页找"相册" — 用 VL 定位器精确定位
    // ============================================================
    const isShootWantingAlbum =
      pageType === 'shoot' &&
      dec.action === 'click' &&
      (dec.target_desc.includes('相册') || dec.target_desc.includes(' album'))

    if (isShootWantingAlbum) {
      shootAlbumFailCount++

      // 策略A：先用 XML 快速尝试（有超时保护）
      console.log(`[策略] shoot→相册 #${shootAlbumFailCount}, 先尝试 XML...`)
      const xmlCoord = await locateByText(apiPort, ['相册', '从相册选择', '相册导入', '从手机相册选择', '相册选择'], 3000)

      if (xmlCoord) {
        console.log(`[策略] XML✓ 相册 → 点击 (${xmlCoord.x},${xmlCoord.y})`)
        await doTap(apiPort, xmlCoord.x, xmlCoord.y, signal, adb)
        await sleep(4000, signal)
        failTracker.clear()
        continue
      }

      // 策略B：XML 找不到 → 用 VL 视觉定位器精确定位"相册"文字
      console.log(`[策略] shoot→相册 XML失败, 调用 VL 定位...`)
      const albumCoord = await locateElement(b64, '相册')
      if (albumCoord) {
        console.log(`[策略] VL✓ 相册 → (${albumCoord.x},${albumCoord.y})`)
        await doTap(apiPort, albumCoord.x, albumCoord.y, signal, adb)
        await sleep(4000, signal)
        failTracker.clear()
        shootAlbumFailCount = 0
        continue
      }

      // 策略C：VL 也找不到 → 重启抖音到首页重新走流程
      if (shootAlbumFailCount >= 2) {
        console.log(`[策略] shoot→相册 XML找不到(#${shootAlbumFailCount})，重启抖音到首页...`)
        await launchDouyin(apiPort, signal, adb)
        await sleep(5000, signal)  // 等待抖音首页加载
        learner.clearAll()
        failTracker.clear()
        shootAlbumFailCount = 0
        samePageCount = 0
        lastAnalysisHash = ''
        continue
      }

      // 第1次 XML 失败：再给一次机会（可能页面还在加载）
      console.log(`[策略] XML 未找到(#${shootAlbumFailCount})，等待重试...`)
      await sleep(3000, signal)
      continue
    }

    // 非 shoot→相册 操作时重置特殊计数器
    if (!isShootWantingAlbum) {
      shootAlbumFailCount = 0
    }

    // ---- 通用操作失败恢复 ----
    if (failure) {
      console.log(`[${TS()}] [⚠️循环] 连续 ${failure.count} 次: ${failure.pageType} → ${failure.action}/${failure.target}`)
      console.log(`[⚠️历史] ${failTracker.getSummary()}`)

      // 重启抖音到首页（比 goBack 可靠）
      console.log(`[恢复] 重启抖音到首页...`)
      await launchDouyin(apiPort, signal, adb)
      await sleep(5000, signal)
      learner.clearAll()
      failTracker.clear()
      samePageCount = 0
      lastAnalysisHash = ''
      continue
    }

    // ---- 卡住检测 ----
    const currentHash = normalizeAnalysis(dec.analysis)
    if (currentHash === lastAnalysisHash) {
      samePageCount++
    } else {
      samePageCount = 0
      lastAnalysisHash = currentHash
    }

    if (samePageCount > 8) {
      console.log(`[${TS()}] [卡住] 同页 ${samePageCount} 次, 重启抖音到首页`)
      await launchDouyin(apiPort, signal, adb)
      learner.clearAll(); failTracker.clear()
      await sleep(5000, signal)
      samePageCount = 0; lastAnalysisHash = ''
      continue
    }

    // ---- 未知页面/桌面 特殊处理 ----
    if (pageType === 'unknown') {
      const isDesktop = dec.analysis.includes('主屏幕') || dec.analysis.includes('桌面') || dec.analysis.includes('未进入抖音')
      if (isDesktop || (dec.action === 'click' && (dec.target_desc.includes('抖音') || dec.target_desc.includes('App')))) {
        console.log(`[恢复] 检测到桌面/未打开抖音, 用 am start 启动...`)
        await launchDouyin(apiPort, signal, adb)
        await sleep(5000, signal)
        failTracker.clear()
        continue
      }
    }

    // ---- 常规坐标确定 ----
    let finalX = dec.coordinates?.x ?? null
    let finalY = dec.coordinates?.y ?? null
    let usedXML = false

    const xmlCoords = await resolveCoordinatesByContext(apiPort, pageType, dec.target_desc, dec.action)
    if (xmlCoords) {
      finalX = xmlCoords.x; finalY = xmlCoords.y; usedXML = true
    }

    // ---- 学习记录命中 ----
    if (pageType !== 'unknown' && pageType !== 'success') {
      const learned = learner.get(pageType)
      if (learned && !usedXML && dec.action === 'click') {
        await doTap(apiPort, learned.x, learned.y, signal, adb)
        console.log(`[${TS()}] [学习命中] ${pageType} → (${learned.x},${learned.y})`)
        await sleep(3500, signal)

        const vB64 = await UI.takeScreenshot(apiPort)
        if (vB64) {
          const vDec = await aiDecideNext(vB64, '', goal, { width: screenW, height: screenH })
          if (vDec) {
            const nPT = detectPageType(vDec.analysis)
            if (nPT && nPT !== pageType) {
              console.log(`[${TS()}] [学习✓] ${pageType}→${nPT}`)
              learner.recordSuccess(pageType, learned.x, learned.y)
              continue
            } else {
              learner.recordFail(pageType)
            }
          }
        }
      }
    }

    // ---- 执行操作 ----
    if (dec.action === 'click' && finalX != null && finalY != null) {
      await doTap(apiPort, finalX, finalY, signal, adb)
      console.log(`[${TS()}] [点击${usedXML ? '/XML' : '/AI'}] (${Math.round(finalX)},${Math.round(finalY)}) ${dec.target_desc}`)

      const waitMs = pageType === 'popup' ? 2000 : pageType === 'publish' ? 3000 : 4000
      await sleep(waitMs, signal)

      // 每 3 次验证一次
      if (loop % 3 === 0 && pageType && pageType !== 'unknown' && pageType !== 'success') {
        const vb = await UI.takeScreenshot(apiPort)
        if (vb) {
          const vd = await aiDecideNext(vb, '', goal, { width: screenW, height: screenH })
          if (vd) {
            const nt = detectPageType(vd.analysis)
            if (nt && nt !== pageType) {
              learner.recordSuccess(pageType, Math.round(finalX), Math.round(finalY))
            }
          }
        }
      }

    } else if (dec.action === 'input' && dec.text_content) {
      if (inputDone) { await sleep(1000, signal); continue }
      await doInput(apiPort, dec.text_content, signal, adb)
      console.log(`[${TS()}] [输入] ${dec.text_content.substring(0, 30)}`)
      inputDone = true
      await sleep(1500, signal)

    } else if (dec.action === 'wait') {
      console.log(`[${TS()}] [等待] ${dec.target_desc}`)
      await sleep(3000, signal)

    } else {
      console.log(`[${TS()}] [跳过] action=${dec.action}, target=${dec.target_desc}`)
      await sleep(2000, signal)
    }
  }

  return { success: false, message: `超时(${maxLoops}轮), 学习:${learner.getSummary()}, 最近:${failTracker.getSummary()}` }
}

// ==================== 坐标解析策略（常规页面）====================

/**
 * 非 shoot→相册 的常规坐标解析
 * 注意：shoot+相册 已在上面主循环中单独处理，不会走到这里
 */
async function resolveCoordinatesByContext(
  apiPort: number,
  pageType: PageType,
  targetDesc: string,
  action: string
): Promise<{ x: number; y: number } | null> {

  if (action !== 'click') return null

  // --- 编辑/发布页：找"添加标题" ---
  if ((pageType === 'edit' || pageType === 'publish') && (targetDesc.includes('标题') || targetDesc.includes('title'))) {
    return locateByText(apiPort, ['添加标题', '请填写标题', '标题', '描述'])
  }

  // --- 发布页：找"发布"/"发作品"按钮 ---
  if (pageType === 'publish' && (targetDesc.includes('发布') || targetDesc.includes('发作品'))) {
    return locateByText(apiPort, ['发布', '发作品', '立即发布'])
  }

  // --- 弹窗：找关闭按钮 ---
  if (pageType === 'popup') {
    return locateByText(apiPort, ['我知道了', '去编辑', '允许', '取消', '确定', '知道了', '下次一定'])
  }

  // --- 首页加号、其他情况：依赖 AI 坐标 ---
  return null
}

// ==================== 工具函数 ====================

function normalizeAnalysis(analysis: string): string {
  if (!analysis) return ''
  return analysis
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：""''（）【】\s]/g, '')
    .replace(/\d+/g, '')
    .substring(0, 50)
}
