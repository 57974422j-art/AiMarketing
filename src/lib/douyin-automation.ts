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

// ==================== 页面检测（基于XML，不用AI）====================

type WorkflowStep = 'HOME_PLUS' | 'SHOOT_ALBUM' | 'ALBUM_PICK' | 'EDIT_TITLE' | 'PUBLISH_BTN' | 'DONE'

/**
 * 通过 XML 文字特征判断当前页面类型
 * 不依赖 AI，直接从 UI 树提取关键字
 */
async function detectCurrentPage(apiPort: number): Promise<{
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
      t.includes('添加标题') || t.includes('确定') || t === '完成'
    ) || texts.some(t =>
      t === '全部' || t === '视频' || t === '图片' ||
      t.includes('发布成功') || t.includes('已发布')
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
    if (texts.some(t => t.includes('发布成功') || t.includes('已发布') || t.includes('上传完成'))) {
      return { step: 'DONE', evidence: '检测到"发布成功"', xmlTexts: clickableTexts, isDesktop: false }
    }

    // --- 发布页：有"发布"/"发作品" 按钮 ---
    if (clickableTexts.some(t => t.includes('发布') || t.includes('发作品'))) {
      // 确认不是编辑页（编辑页也有"发布"但主要特征是输入框）
      if (texts.some(t => t.includes('添加标题') || t.includes('请填写') || t.includes('标题'))) {
        return { step: 'EDIT_TITLE', evidence: '编辑页(有标题输入框)', xmlTexts: clickableTexts, isDesktop: false }
      }
      return { step: 'PUBLISH_BTN', evidence: '发布页(有发布按钮)', xmlTexts: clickableTexts, isDesktop: false }
    }

    // --- 编辑页：有标题输入区域 ---
    if (texts.some(t => t.includes('添加标题') || t.includes('请填写标题') || t.includes('描述') || t.includes('#添加话题'))) {
      return { step: 'EDIT_TITLE', evidence: '编辑页(有标题区域)', xmlTexts: clickableTexts, isDesktop: false }
    }

    // --- 相册页：有"全部"/"视频"/"图片"标签 或 "照片"/"视频" 选择 ---
    if (texts.some(t =>
      t === '全部' || t === '视频' || t === '图片' ||
      t.includes('最近视频') || t.includes('选择视频') || t.includes('相册选择')
    )) {
      return { step: 'ALBUM_PICK', evidence: '相册页(有全部/视频/图片标签)', xmlTexts: clickableTexts, isDesktop: false }
    }

    // --- 拍摄页：有"相册"文字（注意排除相册页）---
    if (clickableTexts.some(t => t === '相册' || t.includes('从相册') || t.includes('相册导入'))) {
      // 如果同时有"全部/视频/图片"标签，说明是相册页而不是拍摄页
      if (texts.some(t => t === '全部' || t === '视频' || t === '图片')) {
        return { step: 'ALBUM_PICK', evidence: '相册页(有相册+标签)', xmlTexts: clickableTexts, isDesktop: false }
      }
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

        // 排除状态栏区域（顶部3%）和底部导航栏（底部10%）
        const b = UI.parseBounds(node.bounds)
        if (!b) continue
        if (b.y < screenH * 0.03) continue
        if (b.y > screenH * 0.90) continue
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
}

/** 模块级变量：安全标题和话题（executeStep 需要访问） */
let _safeTitle = ''
let _safeTopics = ''
/** 模块级变量：ALBUM_PICK 子步骤状态 */
let _albumSubStep = ''

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

  let screenW = 1080, screenH = 2340
  try {
    const size = await UI.getScreenSize(apiPort)
    screenW = size.width; screenH = size.height
  } catch (e) {
    console.warn(`[初始化] 获取屏幕尺寸失败，使用默认值 ${screenW}x${screenH}`)
  }

  console.log(`[${TS()}] ========== 固定流程启动（v2-无AI决策版）==========`)
  console.log(`[${TS()}] 屏幕 ${screenW}x${screenH}, 目标: ${_safeTitle.substring(0, 30)}`)

  let currentStep: WorkflowStep = 'HOME_PLUS'
  let stepRetryCount = 0          // 当前步骤的重试次数
  let loopCount = 0               // 总循环次数
  let inputDone = false           // 标题是否已输入
  const MAX_STEP_RETRY = 3        // 单步最大重试次数

  while (loopCount < maxLoops) {
    loopCount++
    if (signal?.aborted) return { success: false, message: '用户停止' }

    console.log(`\n[${TS()}] [#${loopCount}] 步骤=${currentStep} 重试=${stepRetryCount}/${MAX_STEP_RETRY}`)

    // ---- 1. 截图 + XML页面检测 ----
    const b64 = await UI.takeScreenshot(apiPort)
    if (!b64) { await sleep(2000, signal); continue }

    const pageDetect = await detectCurrentPage(apiPort)
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
      continue
    }

    // ---- 2. 先处理弹窗 ----
    if (pageDetect.evidence.includes('弹窗')) {
      console.log(`[${TS()}] [弹窗] 尝试关闭...`)
      const popupBtn = await locateByText(apiPort, ['我知道了', '去编辑', '允许', '取消', '确定', '知道了', '下次一定'], 2000)
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
      const verify = await detectCurrentPage(apiPort)
      console.log(`[${TS()}] [验证] 点击后页面=${verify.step} (期望推进到 ${getNextStep(currentStep)})`)

      const expectedNext = getNextStep(currentStep)
      if (verify.step === expectedNext || verify.step === 'DONE') {
        // 页面正确切换 → 推进步骤
        stepRetryCount = 0
        if (verify.step === 'DONE') {
          console.log(`[${TS()}] ========== 完成！视频已发布 ==========`)
          return { success: true, message: '视频已发布' }
        }
        console.log(`[${TS()}] [✓推进] ${currentStep} → ${verify.step}`)
        currentStep = verify.step
      } else if (verify.step === currentStep) {
        // 页面没变 → 不推进，算重试
        console.log(`[${TS()}] [×停留] 页面还是${currentStep}, 未切换，计入重试`)
        stepRetryCount++
        if (stepRetryCount >= MAX_STEP_RETRY) {
          console.log(`[${TS()}] [重置] ${currentStep} 页面不变${stepRetryCount}次, 重启抖音...`)
          await sh(apiPort, `am force-stop ${DOUYIN_PKG}`, signal)
          await sleep(1000, signal)
          await sh(apiPort, `am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`, signal)
          await sleep(5000, signal)
          currentStep = 'HOME_PLUS'
          stepRetryCount = 0
          _albumSubStep = ''
          if (loopCount > 15) return { success: false, message: `重试过多,最后:${currentStep}` }
        }
      } else {
        // 页面跳到了意外步骤
        // ★★ 限制：只允许推进到 expectedNext（下一步），禁止跨步跳跃！
        //    原因：拍摄页(SHOOT_ALBUM)常被误判为相册页(ALBUM_PICK)，跨跳会导致漏执行关键步骤
        if (verify.step === expectedNext) {
          // 刚好是期望的下一步 → 正常推进
          console.log(`[${TS()}] [✓推进] ${currentStep} → ${verify.step}`)
          currentStep = verify.step
          stepRetryCount = 0
        } else if (verify.step !== 'HOME_PLUS' && stepToOrder(verify.step) > stepToOrder(expectedNext)) {
          // 超前了超过1步 → 不跳！回退到 expectedNext 继续走流程
          console.log(`[${TS()}] [!超前] 检测到${verify.step}，但只允许→${expectedNext}，不跨步`)
          currentStep = expectedNext   // 推进到下一步（不跳步），让流程正常走完每个环节
          stepRetryCount = 0
        } else {
          // 回退了或乱了 → 重试当前步
          console.log(`[${TS()}] [异常] 跳到${verify.step}(顺序异常), 重试${currentStep}`)
          stepRetryCount++
          if (stepRetryCount >= MAX_STEP_RETRY) {
            console.log(`[${TS()}] [重置] 异常重试耗尽, 重启抖音...`)
            await sh(apiPort, `am force-stop ${DOUYIN_PKG}`, signal)
            await sleep(1000, signal)
            await sh(apiPort, `am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`, signal)
            await sleep(5000, signal)
            currentStep = 'HOME_PLUS'
            stepRetryCount = 0
            _albumSubStep = ''
          }
        }
      }
    } else {
      stepRetryCount++
      if (stepRetryCount >= MAX_STEP_RETRY) {
        console.log(`[${TS()}] [重置] ${currentStep} 失败${stepRetryCount}次, 重启抖音...`)
        await sh(apiPort, `am force-stop ${DOUYIN_PKG}`, signal)
        await sleep(1000, signal)
        await sh(apiPort, `am start -n ${DOUYIN_PKG}/${DOUYIN_ACT}`, signal)
        await sleep(5000, signal)
        currentStep = 'HOME_PLUS'
        stepRetryCount = 0
        _albumSubStep = ''
        if (loopCount > 15) {  // 安全保护
          return { success: false, message: `重试过多,最后步骤:${currentStep}` }
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
          await doTap(apiPort, videoTab.x, videoTab.y, signal, adb)
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
      // ★★★ 核心思路：时长锚点反推法 ★★★
      // 抖音相册的视频缩略图右下角覆盖有时长文字(如"00:15")
      // 这个时长就是最可靠的定位锚点！找到它 → 向上找包含它的大面积容器 → 点容器中心
      if (subStep === 'PICK_VIDEO') {
        // Layer 1: 时长锚点反推法（最可靠！）
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
              // 取第一个（=左上角的视频）
              const dur = durationNodes[0]
              console.log(`[时长锚点✓] "${dur.node.text}" → (${dur.x},${dur.y},${dur.w}x${dur.h})`)

              // Step 2: 找包含此时长节点的大面积容器
              const durCenterX = dur.x + dur.w / 2
              const durCenterY = dur.y + dur.h / 2

              let bestContainer: UI.UINode | null = null
              let bestArea = 0

              for (const node of nodes) {
                const b = UI.parseBounds(node.bounds)
                if (!b) continue
                if (b.width < 200 || b.height < 200) continue
                if (b.y < screenH * 0.12 || b.y > screenH * 0.85) continue
                if (durCenterX >= b.x && durCenterX <= b.x + b.width &&
                    durCenterY >= b.y && durCenterY <= b.y + b.height) {
                  const area = b.width * b.height
                  if (!bestContainer || area < bestArea) {
                    bestContainer = node
                    bestArea = area
                  }
                }
              }

              if (bestContainer) {
                const cb = UI.parseBounds(bestContainer.bounds)!
                // ★ 点击位置：容器中心偏上偏左一点（避开右下角的时长文字区域，点缩略图视觉中心）
                const cx = Math.round(cb.x + cb.width * 0.4)
                const cy = Math.round(cb.y + cb.height * 0.4)
                console.log(`[时长→容器✓] "${dur.node.text}"(${Math.round(durCenterX)},${Math.round(durCenterY)}) → [${bestContainer.className}]点击(${cx},${cy}) 容器=${cb.x},${cb.y} ${cb.width}x${cb.height}`)
                await doTap(apiPort, cx, cy, signal, adb)
                _albumSubStep = 'CLICK_NEXT'
                return { success: true, action: '时长锚点选视频', message: `(${cx},${cy}) via "${dur.node.text}"`, waitMs: 2500 }
              } else {
                // 无容器 → 用时长位置估算（时长在缩略图右下角，往左上推算缩略图中心）
                const estCx = Math.round(dur.x - 50)
                const estCy = Math.round(dur.y - screenH * 0.10)
                console.log(`[时长→估算✓] 无容器,估算点击(${estCx},${estCy})`)
                await doTap(apiPort, estCx, estCy, signal, adb)
                _albumSubStep = 'CLICK_NEXT'
                return { success: true, action: '时长估算选视频', message: `(${estCx},${estCy})`, waitMs: 2500 }
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
          console.log(`[VL✓] 视频缩略图(带O) → (${vlThumb.x},${vlThumb.y})`)
          await doTap(apiPort, vlThumb.x, vlThumb.y, signal, adb)
          _albumSubStep = 'CLICK_NEXT'
          return { success: true, action: 'VL选视频(带O)', message: `(${vlThumb.x},${vlThumb.y})`, waitMs: 2000 }
        }
        if (vlThumb) {
          console.log(`[VL✗] 坐标不合理 (${vlThumb.x},${vlThumb.y})`)
        } else {
          console.log(`[VL✗] 未找到视频缩略图`)
        }

        // Layer 3: 比例坐标终极兜底
        const thumbX = Math.round(screenW * 0.18)
        const thumbY = Math.round(screenH * 0.32)
        console.log(`[相册-选视频] 比例坐标(终极兜底) → (${thumbX},${thumbY})`)
        await doTap(apiPort, thumbX, thumbY, signal, adb)
        _albumSubStep = 'CLICK_NEXT'
        return { success: true, action: '比例坐标选视频', message: `(${thumbX},${thumbY})`, waitMs: 2000 }
      }

      // ════════ Sub-C: 点"下一步"按钮 ════════
      if (subStep === 'CLICK_NEXT') {
        // ★★ Layer 1: findAnyText 找"下一步"（不限 clickable!）
        // 抖音的"下一步"按钮很可能是 Button 但 clickable=false（和标签一样的问题）
        const nextBtn = await findAnyText(apiPort, ['下一步', '确定', '完成', '发布', '好了'], screenH)
        if (nextBtn) {
          console.log(`[相册-下一步✓] 找到"${nextBtn.textHint || '?'}" → (${nextBtn.x},${nextBtn.y})`)
          await doTap(apiPort, nextBtn.x, nextBtn.y, signal, adb)
          _albumSubStep = 'SWITCH_VIDEO_TAB'
          return { success: true, action: '点下一步', message: `(${nextBtn.x},${nextBtn.y})`, waitMs: 4000 }
        }

        // ★★ Layer 2: VL找红底白字"下一步"按钮 — 更精确的prompt
        console.log(`[相册-下一步] VL找红色卡片白字"下一步"...`)
        const vlNext = await locateElement(
          b64,
          '这是抖音APP的相册选择页面。屏幕右下角有一个红色的圆角矩形按钮，上面写着白色的"下一步"三个字。这个按钮位于屏幕最底部导航栏上方一点的位置，大约在屏幕高度的85%~95%区域、水平靠右侧。请找到并点击这个红色"下一步"按钮的中心位置。如果看不到"下一步"文字，找一个橙红色或红色的圆角矩形按钮也可以。'
        )
        if (vlNext && isVlCoordValid(vlNext.x, vlNext.y, screenW, screenH) && vlNext.y > screenH * 0.65) {
          console.log(`[VL✓] 下一步 → (${vlNext.x},${vlNext.y})`)
          await doTap(apiPort, vlNext.x, vlNext.y, signal, adb)
          _albumSubStep = 'SWITCH_VIDEO_TAB'
          return { success: true, action: 'VL点下一步', message: `(${vlNext.x},${vlNext.y})`, waitMs: 4000 }
        }
        if (vlNext) {
          console.log(`[VL✗] 下一步坐标不合理 y=${vlNext.y} < 屏幕底部35%, 拒绝`)
        } else {
          console.log(`[VL✗] 未找到下一步按钮`)
        }

        // ★★ Layer 3: 比例坐标兜底 — 右下角红色按钮典型位置
        const nextX = Math.round(screenW * 0.82)
        const nextY = Math.round(screenH * 0.90)
        console.log(`[相册-下一步] 比例坐标兜底(右下红按钮) → (${nextX},${nextY})`)
        await doTap(apiPort, nextX, nextY, signal, adb)
        _albumSubStep = 'SWITCH_VIDEO_TAB'
        return { success: true, action: '比例坐标点下一步', message: `(${nextX},${nextY})`, waitMs: 4000 }
      }

      // 兜底
      _albumSubStep = 'SWITCH_VIDEO_TAB'
      return { success: false, action: '相册未知子步骤', message: String(subStep), waitMs: 2000 }
    }

    // ========================================
    // STEP 4: 编辑页 → 输入标题
    // ========================================
    case 'EDIT_TITLE': {
      // 策略A: XML 找标题输入框
      const xmlTitle = await locateByText(apiPort, [
        '添加标题', '请填写标题', '标题', '描述', '#添加话题',
        '填写作品描述', '添加描述'
      ], 3000)
      if (xmlTitle) {
        await doTap(apiPort, xmlTitle.x, xmlTitle.y, signal, adb)
        await sleep(1000, signal)
        const fullText = _safeTopics ? `${_safeTitle} ${_safeTopics}` : _safeTitle
        await doInput(apiPort, fullText, signal, adb)
        console.log(`[输入] ${fullText.substring(0, 40)}...`)
        return { success: true, action: '输入标题', message: fullText.substring(0, 30), waitMs: 2000 }
      }

      // 策略B: VL 定位
      console.log(`[策略B] XML失败, VL定位标题...`)
      const vlCoord = await locateElement(b64, '标题')
      if (vlCoord && isVlCoordValid(vlCoord.x, vlCoord.y, screenW, screenH)) {
        await doTap(apiPort, vlCoord.x, vlCoord.y, signal, adb)
        await sleep(1000, signal)
        const fullText = _safeTopics ? `${_safeTitle} ${_safeTopics}` : _safeTitle
        await doInput(apiPort, fullText, signal, adb)
        return { success: true, action: 'VL+输入', message: fullText.substring(0, 30), waitMs: 2000 }
      }
      if (vlCoord) {
        console.log(`[VL✗] 标题坐标不合理 (${vlCoord.x},${vlCoord.y}), 忽略`)
      }

      return { success: false, action: '标题框定位失败', message: '未找到', waitMs: 3000 }
    }

    // ========================================
    // STEP 5: 发布页 → 点击 "发布" 按钮
    // ========================================
    case 'PUBLISH_BTN': {
      // 策略A: XML 找发布按钮
      const xmlPub = await locateByText(apiPort, ['发布', '发作品', '立即发布', '发送'], 3000)
      if (xmlPub) {
        await doTap(apiPort, xmlPub.x, xmlPub.y, signal, adb)
        return { success: true, action: 'XML定位发布', message: `(${xmlPub.x},${xmlPub.y})`, waitMs: 5000 }
      }

      // 策略B: VL 定位
      console.log(`[策略B] XML失败, VL定位发布...`)
      const vlCoord = await locateElement(b64, '发布')
      if (vlCoord && isVlCoordValid(vlCoord.x, vlCoord.y, screenW, screenH)) {
        await doTap(apiPort, vlCoord.x, vlCoord.y, signal, adb)
        return { success: true, action: 'VL定位发布', message: `(${vlCoord.x},${vlCoord.y})`, waitMs: 5000 }
      }
      if (vlCoord) {
        console.log(`[VL✗] 发布坐标不合理 (${vlCoord.x},${vlCoord.y}), 忽略`)
      }

      return { success: false, action: '发布按钮定位失败', message: '未找到', waitMs: 3000 }
    }

    default:
      return { success: false, action: '未知步骤', message: String(step), waitMs: 2000 }
  }
}

/** 步骤推进顺序 */
function getNextStep(current: WorkflowStep): WorkflowStep {
  switch (current) {
    case 'HOME_PLUS': return 'SHOOT_ALBUM'
    case 'SHOOT_ALBUM': return 'ALBUM_PICK'
    case 'ALBUM_PICK': return 'EDIT_TITLE'
    case 'EDIT_TITLE': return 'PUBLISH_BTN'
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
    case 'EDIT_TITLE': return 4
    case 'PUBLISH_BTN': return 5
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
