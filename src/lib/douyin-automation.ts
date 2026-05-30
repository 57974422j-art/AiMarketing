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
      // adb 失败时降级到 HTTP
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

// ==================== 页面类型 =================---

type PageType = 'home' | 'shoot' | 'album' | 'edit' | 'publish' | 'popup' | 'success' | 'unknown'

/** 页面关键词映射（优先级从高到低） */
const PAGE_KEYWORDS: Array<{ type: PageType; keywords: string[] }> = [
  { type: 'success', keywords: ['发布成功', '成功发布', '已发布', '上传完成'] },
  { type: 'publish', keywords: ['发布页', '发布', '发作品', '准备发布'] },
  { type: 'edit', keywords: ['编辑', '添加标题', '标题输入', '编辑页'] },
  { type: 'album', keywords: ['相册', '选择视频', '视频列表', '图片列表', '全部'] },
  { type: 'shoot', keywords: ['拍摄', '相机', '实时画面', '拍摄页'] },
  { type: 'popup', keywords: ['弹窗', '提示', '警告', '我知道了', '去编辑', '取消', '允许'] },
  { type: 'home', keywords: ['首页', '推荐', '关注', '朋友', '消息', '我', '底部导航'] },
]

/** 从 AI 分析文本中提取页面类型 */
function detectPageType(analysis: string): PageType {
  if (!analysis) return 'unknown'
  for (const { type, keywords } of PAGE_KEYWORDS) {
    if (keywords.some(kw => analysis.includes(kw))) {
      return type
    }
  }
  return 'unknown'
}

// ==================== 学习系统 ====================

interface LearnedCoord {
  x: number
  y: number
  successCount: number   // 连续成功次数
  failCount: number      // 连续失败次数
  lastUsed: number       // 上次使用时间戳
}

/** 学习记录管理器 */
class CoordinateLearner {
  private coords: Map<string, LearnedCoord> = new Map()
  private maxFails = 3   // 连续失败 N 次后废弃该坐标

  /** 获取某页面的已学习坐标 */
  get(pageType: PageType): LearnedCoord | null {
    return this.coords.get(pageType) || null
  }

  /** 记录点击成功（页面发生了预期变化） */
  recordSuccess(pageType: PageType, x: number, y: number): void {
    const existing = this.coords.get(pageType)
    if (existing) {
      existing.successCount++
      existing.failCount = 0
      existing.lastUsed = Date.now()
      // 成功多次后微调坐标（取平均）
      existing.x = Math.round((existing.x * (existing.successCount - 1) + x) / existing.successCount)
      existing.y = Math.round((existing.y * (existing.successCount - 1) + y) / existing.successCount)
    } else {
      this.coords.set(pageType, { x, y, successCount: 1, failCount: 0, lastUsed: Date.now() })
    }
  }

  /** 记录点击失败（页面没变） */
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

  /** 获取调试信息 */
  getSummary(): string {
    const entries: string[] = []
    for (const [type, c] of this.coords) {
      entries.push(`${type}(${c.x},${c.y}) ✓${c.successCount} ✗${c.failCount}`)
    }
    return entries.join(' | ') || '(空)'
  }
}

// ==================== XML 文字定位 =================---

/**
 * 尝试通过多个候选文字定位元素（短路求值，找到即停）
 * @returns 找到的中心坐标，未找到返回 null
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
  maxLoops?: number       // 最大循环次数（默认 60）
  totalTimeoutMs?: number // 总超时毫秒数（默认 5 分钟）
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

  // 构建目标描述（转义特殊字符防止 prompt 注入）
  const safeTitle = title.replace(/"/g, '"').replace(/[{}[\]]/g, '')
  const safeTopics = topics.map(t => t.replace(/[,"]/g, '')).join(',')
  const goal = `发布视频到抖音，标题："${safeTitle}"，话题：${safeTopics}`

  const startTime = Date.now()

  // 获取屏幕尺寸
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
  let lastAnalysisHash = ''   // 用于卡检测的页面指纹
  let samePageCount = 0       // 连续相同页面计数
  let inputDone = false       // 标题是否已输入
  let doneLoopCount = 0       // 连续检测到 DONE 的次数（需确认多次防误判）

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
      doneLoopCount = 0  // 非 DONE 时重置计数
    }

    // ---- 卡住检测（基于分析文本的归一化哈希）----
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
      console.log(`[${TS()}] [卡住] 同一页面连续 ${samePageCount} 次, 学习状态: ${learner.getSummary()}`)
      await goBack(apiPort, 5, signal, adb)
      // 废弃所有学习坐标（回首页后旧坐标可能失效）
      console.log(`[${TS()}] [卡住] 已清空学习记录，等待页面稳定...`)
      await sleep(4000, signal)
      samePageCount = 0
      lastAnalysisHash = ''
      continue
    }

    // ---- 页面类型识别 ----
    const pageType = detectPageType(dec.analysis)
    console.log(`[${TS()}] [页面] ${pageType}${pageType === 'unknown' ? '(' + dec.analysis.substring(0, 30) + ')' : ''}`)

    // ---- 坐标确定策略：XML 定位优先 → AI 坐标兜底 ----
    let finalX = dec.coordinates?.x ?? null
    let finalY = dec.coordinates?.y ?? null
    let usedXML = false

    // 根据页面类型 + 目标描述，选择最佳定位方式
    const xmlCoords = await resolveCoordinatesByContext(apiPort, pageType, dec.target_desc, dec.action)
    if (xmlCoords) {
      finalX = xmlCoords.x
      finalY = xmlCoords.y
      usedXML = true
    }

    // ---- 学习记录命中（带验证机制）----
    if (pageType !== 'unknown' && pageType !== 'success') {
      const learned = learner.get(pageType as Exclude<PageType, 'unknown' | 'success'>)
      if (learned && !usedXML) {
        // 使用学习坐标前先验证：只有非 click 操作或当前无有效坐标时才用学习记录
        if (dec.action === 'click') {
          const tapOk = await doTap(apiPort, learned.x, learned.y, signal, adb)
          console.log(`[${TS()}] [学习命中] ${pageType} → (${learned.x},${learned.y}) ${tapOk ? '✓' : '✗'}`)
          await sleep(3500, signal)

          // 轻量验证：截图检查页面是否变化
          const verifyB64 = await UI.takeScreenshot(apiPort)
          if (verifyB64) {
            const verifyDec = await aiDecideNext(verifyB64, '', goal, { width: screenW, height: screenH })
            if (verifyDec) {
              const newPageType = detectPageType(verifyDec.analysis)
              if (newPageType && newPageType !== pageType) {
                // 页面确实变了，学习坐标有效
                console.log(`[${TS()}] [学习确认] ${pageType}→${newPageType} ✓`)
                learner.recordSuccess(pageType as Exclude<PageType, 'unknown' | 'success'>, learned.x, learned.y)
                continue  // 进入下一轮循环
              } else {
                // 页面没变，学习坐标可能失效
                console.warn(`[${TS()}] [学习失效] ${pageType} 未变为 ${newPageType}, 坐标可能过期`)
                learner.recordFail(pageType as Exclude<PageType, 'unknown' | 'success'>)
                // 不 continue，走下面的正常流程重新决策
              }
            }
          }
          // 验证失败/无结果，继续走正常流程
        }
      }
    }

    // ---- 执行操作 ----
    if (dec.action === 'click' && finalX != null && finalY != null) {
      const tapOk = await doTap(apiPort, finalX, finalY, signal, adb)
      console.log(`[${TS()}] [点击${usedXML ? '/XML' : '/AI'}] (${Math.round(finalX)},${Math.round(finalY)}) ${dec.target_desc}${tapOk ? '' : ' 失败!'}`)

      // 根据操作类型动态调整等待时间
      const waitMs = pageType === 'popup' ? 2000 : pageType === 'publish' ? 3000 : 4000
      await sleep(waitMs, signal)

      // 点击后验证与学习（每 3 次点击验证一次，减少 API 调用）
      if (loop % 3 === 0 && pageType && pageType !== 'unknown' && pageType !== 'success') {
        const verifyB64 = await UI.takeScreenshot(apiPort)
        if (verifyB64) {
          const verifyDec = await aiDecideNext(verifyB64, '', goal, { width: screenW, height: screenH })
          if (verifyDec) {
            const newPageType = detectPageType(verifyDec.analysis)
            if (newPageType && newPageType !== pageType) {
              learner.recordSuccess(pageType as Exclude<PageType, 'unknown' | 'success'>, Math.round(finalX), Math.round(finalY))
              console.log(`[${TS()}] [学习] ${pageType}→${newPageType} (${Math.round(finalX)},${Math.round(finalY)})`)
            }
          }
        }
      }

    } else if (dec.action === 'input' && dec.text_content) {
      if (inputDone) {
        console.log(`[${TS()}] [输入跳过] 标题已输入过, 当前操作: ${dec.text_content.substring(0, 20)}`)
        // 标题已输入过，尝试点击发布或其他操作
        await sleep(1000, signal)
        continue
      }

      const inputOk = await doInput(apiPort, dec.text_content, signal, adb)
      console.log(`[${TS()}] [输入] ${dec.text_content.substring(0, 30)}${inputOk ? '' : ' 失败!'}`)
      inputDone = true
      await sleep(1500, signal)

      // 输入后验证：检查是否还在编辑页
      const postInputB64 = await UI.takeScreenshot(apiPort)
      if (postInputB64) {
        const postDec = await aiDecideNext(postInputB64, '', goal, { width: screenW, height: screenH })
        if (postDec) {
          const postPageType = detectPageType(postDec.analysis)
          console.log(`[${TS()}] [输入后] 页面: ${postPageType}`)
          if (postPageType === 'edit' || postPageType === 'publish') {
            // 正常，仍在编辑/发布流程
          } else if (postPageType === 'popup') {
            console.log(`[${TS()}] [输入后] 出现弹窗，下轮处理`)
          }
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

  return { success: false, message: `执行超时(${maxLoops}轮), 学习状态: ${learner.getSummary()}` }
}

// ==================== 坐标解析策略 =================---

/**
 * 根据页面类型和目标描述，使用 XML 文字定位获取可靠坐标
 * 修复原版多处逻辑 bug：
 *   1. findByText 返回对象不能用 || 短路
 *   2. fallback 查找的结果未被使用
 *   3. 无论是否找到都会执行多余查找
 */
async function resolveCoordinatesByContext(
  apiPort: number,
  pageType: PageType,
  targetDesc: string,
  action: string
): Promise<{ x: number; y: number } | null> {

  // 只对 click 操作做 XML 增强，input/wait 不需要
  if (action !== 'click') return null

  // --- 拍摄页：找"相册"入口 ---
  if (pageType === 'shoot' && (targetDesc.includes('相册') || targetDesc.includes(' album'))) {
    return locateByText(apiPort, ['相册', '从相册选择', '相册导入'])
  }

  // --- 编辑页：找"添加标题" ---
  if ((pageType === 'edit' || pageType === 'publish') && (targetDesc.includes('标题') || targetDesc.includes('title'))) {
    return locateByText(apiPort, ['添加标题', '请填写标题', '标题', '描述'])
  }

  // --- 发布页：找"发布"/"发作品"按钮 ---
  if (pageType === 'publish' && (targetDesc.includes('发布') || targetDesc.includes('发作品') || targetDesc.includes(' publish'))) {
    // 短路：先找"发布"，找到了就不找"发作品"
    return locateByText(apiPort, ['发布', '发作品', '立即发布'])
  }

  // --- 弹窗：找关闭/确认按钮 ---
  if (pageType === 'popup') {
    return locateByText(apiPort, ['我知道了', '去编辑', '允许', '取消', '确定', '知道了', '下次一定'])
  }

  // --- 首页：找加号（纯图标，XML 无法定位）---
  // 首页的加号是图标按钮，没有文字，只能靠 AI 坐标
  return null
}

// ==================== 工具：文本归一化（用于卡检测）====

/**
 * 将 AI 分析文本归一化为"指纹"，用于判断页面是否真的没变
 * 解决原版问题：AI 对同一页面可能输出略有不同的描述文本
 */
function normalizeAnalysis(analysis: string): string {
  if (!analysis) return ''
  return analysis
    .toLowerCase()
    .replace(/\s+/g, '')           // 去空白
    .replace(/[，。！？、；：""''（）【】\s]/g, '')  // 去中英文标点
    .replace(/\d+/g, '')            // 去数字（像素坐标等）
    .substring(0, 50)              // 取前50字符
}
