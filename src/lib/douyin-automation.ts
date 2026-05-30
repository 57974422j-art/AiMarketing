import * as UI from './uiautomator-driver'
import { ADB } from './adb-helper'
import { aiDecideNext } from './ai-providers'

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

/** 通过 HTTP 在设备上执行 shell 命令 */
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

/** 点击设备屏幕，返回是否成功 */
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

/** 在设备上输入文字 */
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

/** 按 Back 键返回 */
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

// ==================== 页面类型检测（上下文感知）====================

type PageType = 'home' | 'shoot' | 'album' | 'edit' | 'publish' | 'popup' | 'success' | 'unknown'

/**
 * 精确页面描述短语（最高优先级）
 * 这些是 AI 通常输出的"当前页面为xxx"格式的精确匹配
 * 必须放在关键词之前，因为 "拍摄页...有相册文字" 不能被误判为 album
 */
const EXACT_PAGE_PHRASES: Array<{ type: PageType; phrases: string[] }> = [
  { type: 'success', phrases: ['发布成功', '成功发布', '已发布完成', '上传完成'] },
  { type: 'publish', phrases: ['当前页面为发布页', '发布准备页', '准备发布视频'] },
  { type: 'edit',   phrases: ['当前页面为编辑页', '标题编辑页面', '视频编辑页面'] },
  { type: 'album',  phrases: ['当前页面为相册页', '当前在相册', '视频选择页面', '媒体选择页面', '相册选择页'] },
  { type: 'shoot',  phrases: ['当前页面为拍摄页', '当前在拍摄界面', '相机拍摄界面', '拍照界面'] },
  { type: 'popup',  phrases: ['弹窗', '弹出窗口', '提示框', '对话框'] },
  { type: 'home',   phrases: ['当前页面为首页', '首页信息流', '抖音首页', '推荐信息流'] },
]

/**
 * 辅助特征关键词（第二优先级，用于精确短语未命中时的兜底）
 * 注意：这些关键词可能在不同页面都出现，所以只作为辅助判断
 */
const AUX_KEYWORDS: Array<{ type: PageType; keywords: string[] }> = [
  { type: 'publish', keywords: ['发作品按钮', '发布按钮高亮'] },
  { type: 'edit',   keywords: ['添加标题', '标题输入框', '编辑工具栏'] },
  // ⚠️ 关键：只有同时出现"缩略图/列表/标签"等相册特征时才判为 album
  // 单独的"相册"二字不能判定为 album（因为拍摄页也有"相册"入口文字）
  { type: 'album',  keywords: ['视频缩略图', '图片缩略图', '媒体列表', '全部标签', '视频标签', '图片标签', '选择视频', '相册网格'] },
  { type: 'shoot',  keywords: ['取景器', '实时预览', '快门按钮', '拍摄按钮(圆形)', '前后置切换'] },
  { type: 'home',   keywords: ['底部导航栏', '推荐视频', '关注列表'] },
]

/**
 * 从 AI 分析文本中提取页面类型
 *
 * 核心改进：
 * 1. 精确短语优先 → 解决"拍摄页有相册文字"被误判为 album 的问题
 * 2. 排除性规则 → 如果明确说了"拍摄页"，即使包含"相册"也不判为 album
 * 3. 特征组合 → album 必须有缩略图/网格等特征，不能仅靠"相册"二字
 */
function detectPageType(analysis: string): PageType {
  if (!analysis) return 'unknown'
  const lower = analysis.toLowerCase()

  // === 第1层：精确页面描述短语（最可靠）===
  for (const { type, phrases } of EXACT_PAGE_PHRASES) {
    for (const phrase of phrases) {
      if (lower.includes(phrase.toLowerCase())) {
        return type
      }
    }
  }

  // === 第2层：排除性规则 ===
  // 如果明确提到"拍摄页/相机界面/拍摄界面"，强制判为 shoot
  // 这解决了核心 bug：AI 说"拍摄页有相册文字"→ 原版会匹配到 album 的"相册"关键字
  if (/当前.*拍摄|拍摄界|相机界|拍摄页|相机预览/.test(analysis)) {
    return 'shoot'
  }

  // === 第3层：特征组合匹配 ===
  for (const { type, keywords } of AUX_KEYWORDS) {
    if (keywords.some(kw => analysis.includes(kw))) {
      return type
    }
  }

  // === 第4层：兜底关键词（最低置信度）===
  // 只有当以上都没匹配到才用这些宽松关键词
  if (analysis.includes('底部导航') || analysis.includes('首页')) return 'home'

  return 'unknown'
}

// ==================== 操作失败检测器 ====================

/**
 * 检测"同一操作反复执行但页面不变化"的死循环模式
 * 例如：连续5次都在拍摄页点击相册但仍在拍摄页 → 需要换策略
 */
class ActionFailureTracker {
  private history: Array<{ pageType: PageType; action: string; target: string; loop: number }> = []
  private maxHistory = 8
  /** 连续相同操作多少次后触发 */
  private threshold = 4

  /** 记录一次操作 */
  record(pageType: PageType, action: string, target: string, loop: number): void {
    this.history.push({ pageType, action, target, loop })
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }
  }

  /**
   * 检测是否存在重复失败模式
   * @returns 触发时返回重复的操作描述，未触发返回 null
   */
  check(): { action: string; target: string; pageType: PageType; count: number } | null {
    if (this.history.length < this.threshold) return null

    // 取最近 threshold 条记录，检查是否都是相同的 (pageType + action + target)
    const recent = this.history.slice(-this.threshold)
    const first = recent[0]
    const allSame = recent.every(h =>
      h.pageType === first.pageType &&
      h.action === first.action &&
      h.target === first.target
    )

    if (allSame) {
      return { action: first.action, target: first.target, pageType: first.pageType, count: this.threshold }
    }
    return null
  }

  /** 清空历史（策略切换后调用） */
  clear(): void {
    this.history = []
  }

  getSummary(): string {
    return this.history.map(h => `${h.pageType}:${h.action}/${h.target.substring(0, 8)}`).join(' → ')
  }
}

// ==================== 学习系统 ====================

interface LearnedCoord {
  x: number
  y: number
  successCount: number
  failCount: number
  lastUsed: number
}

/** 学习记录管理器 */
class CoordinateLearner {
  private coords: Map<string, LearnedCoord> = new Map()
  private maxFails = 3

  get(pageType: PageType): LearnedCoord | null {
    return this.coords.get(pageType) || null
  }

  recordSuccess(pageType: PageType, x: number, y: number): void {
    const existing = this.coords.get(pageType)
    if (existing) {
      existing.successCount++
      existing.failCount = 0
      existing.lastUsed = Date.now()
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
        console.warn(`[学习] ${pageType} 坐标连续失败 ${coord.failCount} 次，已废弃 (${coord.x},${coord.y})`)
        this.coords.delete(pageType)
      }
    }
  }

  clearAll(): void {
    console.log(`[学习] 清空全部学习记录 (${this.coords.size} 条)`)
    this.coords.clear()
  }

  getSummary(): string {
    const entries: string[] = []
    for (const [type, c] of this.coords) {
      entries.push(`${type}(${c.x},${c.y}) ✓${c.successCount} ✗${c.failCount}`)
    }
    return entries.join(' | ') || '(空)'
  }
}

// ==================== XML 文字定位 ====================

/**
 * 尝试通过多个候选文字定位元素（短路求值，找到即停）
 */
async function locateByText(
  apiPort: number,
  candidates: string[]
): Promise<{ x: number; y: number } | null> {
  for (const text of candidates) {
    try {
      const result = await UI.findByText(apiPort, text)
      if (result?.center) {
        console.log(`[XML] 找到 "${text}" → (${result.center.x},${result.center.y})`)
        return result.center
      }
    } catch (e) {
      console.warn(`[XML] 查找 "${text}" 异常: ${e}`)
    }
  }
  return null
}

// ==================== 主工作流 ====================
interface WorkflowOptions {
  maxLoops?: number
  totalTimeoutMs?: number
}

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
    screenW = size.width
    screenH = size.height
  } catch (e) {
    console.warn(`[初始化] 获取屏幕尺寸失败，使用默认值: ${screenW}x${screenH}`)
  }
  console.log(`[${TS()}] 屏幕 ${screenW}x${screenH}, 目标: ${safeTitle.substring(0, 30)}`)

  // 初始化子系统
  const learner = new CoordinateLearner()
  const failTracker = new ActionFailureTracker()
  let lastAnalysisHash = ''
  let samePageCount = 0
  let inputDone = false
  let doneLoopCount = 0

  for (let loop = 0; loop < maxLoops; loop++) {
    // ---- 超时检查 ----
    if (signal?.aborted) return { success: false, message: '用户停止' }
    if (Date.now() - startTime > totalTimeoutMs) {
      console.log(`[${TS()}] [超时] 总耗时 ${Math.round((Date.now() - startTime) / 1000)}s > ${totalTimeoutMs / 1000}s`)
      return { success: false, message: '执行超时' }
    }

    // ---- 截图 ----
    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) {
      console.warn(`[${TS()}] [截图] 第${loop + 1}次截图失败`)
      await sleep(2000, signal)
      continue
    }

    // ---- AI 决策 ----
    const dec = await aiDecideNext(b64, '', goal, { width: screenW, height: screenH })
    if (!dec) {
      console.warn(`[${TS()}] [AI] 第${loop + 1}次决策返回空`)
      await sleep(2000, signal)
      continue
    }
    console.log(`[${TS()}] [AI#${loop + 1}] ${dec.analysis.substring(0, 60)} → ${dec.action}/${dec.target_desc}`)

    // ---- DONE 检测（连续确认 2 次防误判）----
    if (dec.status === 'DONE') {
      doneLoopCount++
      if (doneLoopCount >= 2) {
        console.log(`[${TS()}] [完成] AI 连续 ${doneLoopCount} 次确认 DONE，任务结束`)
        return { success: true, message: '视频已发布' }
      }
      console.log(`[${TS()}] [DONE] 第 ${doneLoopCount} 次检测到 DONE，等待再次确认...`)
      await sleep(2000, signal)
      continue
    } else {
      doneLoopCount = 0
    }

    // ---- 页面类型识别 ----
    const pageType = detectPageType(dec.analysis)
    console.log(`[${TS()}] [页面] ${pageType}${pageType === 'unknown' ? '(' + dec.analysis.substring(0, 30) + ')' : ''}`)

    // ---- 操作失败检测（新增！解决 shoot→相册 循环点击死锁）----
    failTracker.record(pageType, dec.action, dec.target_desc, loop)
    const failure = failTracker.check()
    if (failure) {
      console.log(`[${TS()}] [⚠️操作循环] 连续 ${failure.count} 次相同操作无效: ${failure.pageType} → ${failure.action}/${failure.target}`)
      console.log(`[⚠️操作循环] 近期操作历史: ${failTracker.getSummary()}`)

      // 根据失败模式采取恢复策略
      if (failure.pageType === 'shoot' && failure.target.includes('相册')) {
        // ★ 核心 fix：拍摄页点"相册"一直失败
        console.log(`[⚠️恢复] shoot→相册 失败，强制使用 XML 精确定位...`)
        const xmlCoord = await locateByText(apiPort, ['相册', '从相册选择', '相册导入'])
        if (xmlCoord) {
          console.log(`[⚠️恢复] XML 找到相册 → (${xmlCoord.x},${xmlCoord.y})，重试点击`)
          await doTap(apiPort, xmlCoord.x, xmlCoord.y, signal, adb)
          await sleep(4000, signal)
          failTracker.clear()
          continue
        } else {
          console.log(`[⚠️恢复] XML 也找不到"相册"文字，可能不在拍摄页。尝试回首页重新开始...`)
          await goBack(apiPort, 5, signal, adb)
          learner.clearAll()
          await sleep(4000, signal)
          failTracker.clear()
          samePageCount = 0
          lastAnalysisHash = ''
          continue
        }
      }

      // 通用恢复：回退 + 清空状态
      console.log(`[⚠️恢复] 回退 ${failure.pageType} 并重试`)
      await goBack(apiPort, 3, signal, adb)
      learner.clearAll()
      await sleep(3000, signal)
      failTracker.clear()
      samePageCount = 0
      lastAnalysisHash = ''
      continue
    }

    // ---- 卡住检测（基于归一化指纹）----
    const currentHash = normalizeAnalysis(dec.analysis)
    if (currentHash === lastAnalysisHash) {
      samePageCount++
    } else {
      if (samePageCount > 2) {
        console.log(`[${TS()}] [页面切换] 连续 ${samePageCount} 次相同 → 变为新页面`)
      }
      samePageCount = 0
      lastAnalysisHash = currentHash
    }

    if (samePageCount > 8) {
      console.log(`[${TS()}] [卡住] 同一页面连续 ${samePageCount} 次, 学习: ${learner.getSummary()}, 操作: ${failTracker.getSummary()}`)
      await goBack(apiPort, 5, signal, adb)
      learner.clearAll()
      failTracker.clear()
      console.log(`[${TS()}] [卡住] 已清空所有状态，等待页面稳定...`)
      await sleep(4000, signal)
      samePageCount = 0
      lastAnalysisHash = ''
      continue
    }

    // ---- 坐标确定策略 ----
    let finalX = dec.coordinates?.x ?? null
    let finalY = dec.coordinates?.y ?? null
    let usedXML = false

    // ★ 关键改进：拍摄页找"相册"时，默认优先用 XML 而非 AI 坐标
    // 因为日志显示 AI 在拍摄页给的"相册"坐标实际是拍照按钮(~y1870)
    const xmlCoords = await resolveCoordinatesByContext(apiPort, pageType, dec.target_desc, dec.action, {
      forceXML: failTracker.getSummary().includes('shoot')
    })
    if (xmlCoords) {
      finalX = xmlCoords.x
      finalY = xmlCoords.y
      usedXML = true
    }

    // ---- 学习记录命中（带验证）----
    if (pageType !== 'unknown' && pageType !== 'success') {
      const learned = learner.get(pageType)
      if (learned && !usedXML && dec.action === 'click') {
        const tapOk = await doTap(apiPort, learned.x, learned.y, signal, adb)
        console.log(`[${TS()}] [学习命中] ${pageType} → (${learned.x},${learned.y}) ${tapOk ? '✓' : '✗'}`)
        await sleep(3500, signal)

        const verifyB64 = await UI.takeScreenshot(apiPort)
        if (verifyB64) {
          const verifyDec = await aiDecideNext(verifyB64, '', goal, { width: screenW, height: screenH })
          if (verifyDec) {
            const newPageType = detectPageType(verifyDec.analysis)
            if (newPageType && newPageType !== pageType) {
              console.log(`[${TS()}] [学习确认] ${pageType}→${newPageType} ✓`)
              learner.recordSuccess(pageType, learned.x, learned.y)
              continue
            } else {
              console.warn(`[${TS()}] [学习失效] ${pageType} 未变为 ${newPageType}`)
              learner.recordFail(pageType)
            }
          }
        }
      }
    }

    // ---- 执行操作 ----
    if (dec.action === 'click' && finalX != null && finalY != null) {
      const tapOk = await doTap(apiPort, finalX, finalY, signal, adb)
      console.log(`[${TS()}] [点击${usedXML ? '/XML' : '/AI'}] (${Math.round(finalX)},${Math.round(finalY)}) ${dec.target_desc}${tapOk ? '' : ' 失败!'}`)

      const waitMs = pageType === 'popup' ? 2000 : pageType === 'publish' ? 3000 : 4000
      await sleep(waitMs, signal)

      // 每 3 次验证一次（减少 API 调用）
      if (loop % 3 === 0 && pageType && pageType !== 'unknown' && pageType !== 'success') {
        const verifyB64 = await UI.takeScreenshot(apiPort)
        if (verifyB64) {
          const verifyDec = await aiDecideNext(verifyB64, '', goal, { width: screenW, height: screenH })
          if (verifyDec) {
            const newPageType = detectPageType(verifyDec.analysis)
            if (newPageType && newPageType !== pageType) {
              learner.recordSuccess(pageType, Math.round(finalX), Math.round(finalY))
              console.log(`[${TS()}] [学习] ${pageType}→${newPageType} (${Math.round(finalX)},${Math.round(finalY)})`)
            }
          }
        }
      }

    } else if (dec.action === 'input' && dec.text_content) {
      if (inputDone) {
        console.log(`[${TS()}] [输入跳过] 标题已输入过`)
        await sleep(1000, signal)
        continue
      }

      const inputOk = await doInput(apiPort, dec.text_content, signal, adb)
      console.log(`[${TS()}] [输入] ${dec.text_content.substring(0, 30)}${inputOk ? '' : ' 失败!'}`)
      inputDone = true
      await sleep(1500, signal)

      const postInputB64 = await UI.takeScreenshot(apiPort)
      if (postInputB64) {
        const postDec = await aiDecideNext(postInputB64, '', goal, { width: screenW, height: screenH })
        if (postDec) {
          const postPageType = detectPageType(postDec.analysis)
          console.log(`[${TS()}] [输入后] 页面: ${postPageType}`)
        }
      }

    } else if (dec.action === 'wait') {
      console.log(`[${TS()}] [等待] AI 要求等待: ${dec.target_desc}`)
      await sleep(3000, signal)

    } else {
      console.log(`[${TS()}] [跳过] action=${dec.action}, target=${dec.target_desc}, coordinates=${finalX ? `${finalX},${finalY}` : '无'}`)
      await sleep(2000, signal)
    }
  }

  return { success: false, message: `执行超时(${maxLoops}轮), 学习: ${learner.getSummary()}, 最近操作: ${failTracker.getSummary()}` }
}

// ==================== 坐标解析策略 ====================

interface ResolveOptions {
  forceXML?: boolean  // 是否强制使用 XML 定位（忽略 AI 坐标）
}

/**
 * 根据页面类型和目标描述，使用 XML 文字定位获取可靠坐标
 *
 * 关键修复：拍摄页的"相册"文字入口位置固定，AI 经常混淆为拍照按钮坐标
 * 所以 shoot+相册 组合应该积极使用 XML 定位
 */
async function resolveCoordinatesByContext(
  apiPort: number,
  pageType: PageType,
  targetDesc: string,
  action: string,
  options: ResolveOptions = {}
): Promise<{ x: number; y: number } | null> {

  if (action !== 'click') return null

  // --- 拍摄页：找"相册"入口 ---
  // ★★ 这是核心修复点：AI 给的"相册"坐标经常是拍照按钮(y~1870)
  //    XML findByText 能精确定位"相册"二字的中心位置
  if (pageType === 'shoot' && (targetDesc.includes('相册') || targetDesc.includes(' album'))) {
    console.log(`[策略] shoot+相册 → 强制 XML 定位（AI 坐标不可靠）`)
    return locateByText(apiPort, ['相册', '从相册选择', '相册导入', '从手机相册选择'])
  }

  // --- 编辑/发布页：找"添加标题" ---
  if ((pageType === 'edit' || pageType === 'publish') && (targetDesc.includes('标题') || targetDesc.includes('title'))) {
    return locateByText(apiPort, ['添加标题', '请填写标题', '标题', '描述', '添加描述'])
  }

  // --- 发布页：找"发布"/"发作品"按钮 ---
  if (pageType === 'publish' && (targetDesc.includes('发布') || targetDesc.includes('发作品') || targetDesc.includes(' publish'))) {
    return locateByText(apiPort, ['发布', '发作品', '立即发布', ' publish'])
  }

  // --- 弹窗：找关闭/确认按钮 ---
  if (pageType === 'popup') {
    return locateByText(apiPort, ['我知道了', '去编辑', '允许', '取消', '确定', '知道了', '下次一定', '我知道'])
  }

  // --- 首页加号：纯图标，XML 无法帮助 ---
  return null
}

// ==================== 工具：文本归一化 ====================

function normalizeAnalysis(analysis: string): string {
  if (!analysis) return ''
  return analysis
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：""''（）【】\s]/g, '')
    .replace(/\d+/g, '')
    .substring(0, 50)
}
