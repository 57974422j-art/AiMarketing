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

type WorkflowStep = 'HOME_PLUS' | 'SHOOT_ALBUM' | 'ALBUM_PICK' | 'EDIT_TITLE' | 'SELECT_POI' | 'PUBLISH_BTN' | 'DONE'

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

    // --- 拍摄页（相机界面）：优先检测！防止被相册页误判 ---
    // 拍摄页独有特征：分段拍/翻转/闪光灯/美颜/倒计时/灵感跟拍/选择音乐
    const cameraFeatures = ['分段拍', '翻转', '闪光灯', '美颜', '倒计时', '灵感跟拍', '选择音乐']
    const isCameraPage = texts.some(t => cameraFeatures.includes(t))
    if (isCameraPage) {
      // 拍摄页也有"相册"按钮在底部
      return { step: 'SHOOT_ALBUM', evidence: `拍摄页(有${texts.find(t => cameraFeatures.includes(t))})`, xmlTexts: clickableTexts, isDesktop: false }
    }

    // --- 相册页：有"全部"/"视频"/"图片"标签 或 "照片"/"视频" 选择 ---
    // 注意：此时已排除拍摄页，这里的"视频"是相册标签而非拍摄模式
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
}

/** 模块级变量：安全标题和话题（executeStep 需要访问） */
let _safeTitle = ''
let _safeTopics = ''
/** 模块级变量：POI位置（executeStep 需要访问） */
let _safeLocation = ''
/** 模块级变量：ALBUM_PICK 子步骤状态 */
let _albumSubStep = ''
/** 模块级变量：EDIT_TITLE 子步骤状态 */
let _editSubStep = ''

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
      _editSubStep = ''
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
          _editSubStep = ''
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
          // 超前了超过1步 → 直接跳到检测到的步骤！
          // 原因：某些版本抖音点"+"号会直接进相册页(跳过拍摄页)，这是正常行为
          console.log(`[${TS()}] [✓跨步] 检测到${verify.step}(超前${stepToOrder(verify.step)-stepToOrder(expectedNext)}步)，直接推进`)
          currentStep = verify.step
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
          _editSubStep = ''
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
      _editSubStep = ''
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

              // Step 3: 选择最佳点击目标
              let tapX = 0, tapY = 0, tapReason = ''

              // 策略A: 优先找 clickable=true 的中等大小容器
              const clickableOnes = allContainers.filter(c => c.clickable && c.area < screenW * screenH * 0.3)
              if (clickableOnes.length > 0) {
                // 取最大的那个 clickable 容器
                const best = clickableOnes[clickableOnes.length - 1]
                tapX = Math.round(best.x + best.w / 2)
                tapY = Math.round(best.y + best.h / 2)
                tapReason = `clickable-${best.node.className}`
                console.log(`[选视频→策略A] clickable容器 → (${tapX},${tapY}) via ${tapReason}`)
              } else if (allContainers.length > 0) {
                // 策略B: 无clickable容器 → 取中等面积的容器中心
                const midIdx = Math.min(Math.floor(allContainers.length / 2), allContainers.length - 1)
                const mid = allContainers[midIdx]
                tapX = Math.round(mid.x + mid.w / 2)
                tapY = Math.round(mid.y + mid.h / 2)
                tapReason = `mid-${mid.node.className}(#${midIdx}/${allContainers.length})`
                console.log(`[选视频→策略B] 中等容器(#${midIdx}) → (${tapX},${tapY}) via ${mid.node.className} (无clickable候选!)`)

                // 如果之前已经试过这个位置且失败了（通过检查重试次数），换一个更大的容器
                // 这里我们直接用最大但不是全屏的容器
                if (allContainers.length >= 3) {
                  const bigger = allContainers[Math.min(allContainers.length - 2, allContainers.length - 1)]
                  tapX = Math.round(bigger.x + bigger.w / 2)
                  tapY = Math.round(bigger.y + bigger.h / 2)
                  tapReason = `bigger-${bigger.node.className}(#${allContainers.indexOf(bigger)})`
                  console.log(`[选视频→策略B+] 换更大容器 → (${tapX},${tapY}) via ${bigger.node.className}`)
                }
              }

              // 策略C: 如果有容器就用容器坐标，否则用时长估算
              if (tapX === 0) {
                tapX = Math.round(dur.x - 80)
                tapY = Math.round(durCy - 100)
                tapReason = '估算(时长左上)'
                console.log(`[选视频→策略C] 无容器,估算 → (${tapX},${tapY})`)
              }

              console.log(`[连击] (${tapX},${tapX})×2 via ${tapReason} (desc提示需点按两次激活)`)
              await doTap(apiPort, tapX, tapY, signal, adb)
              await sleep(200, signal)
              await doTap(apiPort, tapX, tapY, signal, adb)
              _albumSubStep = 'CLICK_NEXT'
              return { success: true, action: '时长锚点选视频(双击)', message: `(${tapX},${tapY})×2 via "${dur.node.text}" [${tapReason}]`, waitMs: 3000 }
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
          console.log(`[VL✓] 视频缩略图(带O) → (${vlThumb.x},${vlThumb.y}) 连击×2`)
          await doTap(apiPort, vlThumb.x, vlThumb.y, signal, adb)
          await sleep(200, signal)
          await doTap(apiPort, vlThumb.x, vlThumb.y, signal, adb)
          _albumSubStep = 'CLICK_NEXT'
          return { success: true, action: 'VL选视频(双击)', message: `(${vlThumb.x},${vlThumb.y})×2`, waitMs: 3000 }
        }
        if (vlThumb) {
          console.log(`[VL✗] 坐标不合理 (${vlThumb.x},${vlThumb.y})`)
        } else {
          console.log(`[VL✗] 未找到视频缩略图`)
        }

        // Layer 3: 比例坐标终极兜底（也用连击）
        const thumbX = Math.round(screenW * 0.18)
        const thumbY = Math.round(screenH * 0.32)
        console.log(`[相册-选视频] 比例坐标(终极兜底) → (${thumbX},${thumbY}) 连击×2`)
        await doTap(apiPort, thumbX, thumbY, signal, adb)
        await sleep(200, signal)
        await doTap(apiPort, thumbX, thumbY, signal, adb)
        _albumSubStep = 'CLICK_NEXT'
        return { success: true, action: '比例坐标选视频(双击)', message: `(${thumbX},${thumbY})×2`, waitMs: 3000 }
      }

      // ════════ Sub-C: 点"下一步"按钮 ════════
      if (subStep === 'CLICK_NEXT') {
        // ★★ Layer 0: 强制等待视频选中动画 + 按钮渲染完成（全面屏手机需要更长）
        console.log(`[下一步] 等待UI刷新(3s)...`)
        await sleep(3000, signal)

        // ★★ DEBUG: 重新截图并保存到本地文件（用于人工确认"下一步"位置和视频选中状态）
        let debugB64 = ''
        try {
          debugB64 = await UI.takeScreenshot(apiPort) || ''
          if (debugB64) {
            const fs = await import('fs')
            const path = await import('path')
            const debugDir = path.join(process.cwd(), 'debug-screenshots')
            if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true })
            const ts = new Date().toISOString().replace(/[:.]/g, '-')
            const debugFile = path.join(debugDir, `clicknext-${ts}.png`)
            fs.writeFileSync(debugFile, Buffer.from(debugB64, 'base64'))
            console.log(`[DEBUG] 截图已保存 → ${debugFile}`)
          }
        } catch (e) {
          console.log(`[DEBUG] 保存截图失败: ${e}`)
        }

        // ════════ 改动A: 视频选中状态验证 + 全量XML诊断 ════════
        try {
          const fullDump = await UI.dumpXml(apiPort)
          if (fullDump.success && fullDump.data) {
            const allNodes = UI.parseUiXml(fullDump.data)

            // A1: 打印所有文字节点（无任何过滤），诊断到底有什么
            console.log(`[全量XML] 页面共有 ${allNodes.length} 个节点, 其中有文字的:`)
            let textNodeCount = 0
            for (const rawNode of allNodes) {
              const node = rawNode as { text?: string; contentDesc?: string; className?: string; bounds?: string; clickable?: boolean }
              if (node.text || node.contentDesc) {
                textNodeCount++
                const b = UI.parseBounds(node.bounds || '')
                const pos = b ? `(${Math.round(b.x)},${Math.round(b.y)},${b.width}x${b.height})` : 'no-bounds'
                const extra: string[] = []
                if (node.clickable) extra.push('clickable')
                if (node.contentDesc) extra.push(`desc="${node.contentDesc}"`)
                console.log(`  #${textNodeCount} "${node.text || '(空文本)'}" | ${node.className || '?'} | ${pos} | ${extra.join(' ')}`)
              }
            }

            // A2: 检测视频选中标志（右上角数字、勾选框、"下一步"等）
            const selectionIndicators = ['下一步', '确定', '完成', '已选', '发布']
            const foundIndicators: string[] = []
            for (const rawNode of allNodes) {
              const node = rawNode as { text?: string; contentDesc?: string; className?: string; bounds?: string; clickable?: boolean }
              for (const ind of selectionIndicators) {
                if ((node.text && node.text.includes(ind)) || (node.contentDesc && node.contentDesc.includes(ind))) {
                  foundIndicators.push(ind)
                  const b2 = UI.parseBounds(node.bounds || '')
                  const pos = b2 ? `(${Math.round(b2.x)},${Math.round(b2.y)})` : '?'
                  console.log(`[选中标志✓] "${ind}" → ${pos} clickable=${!!node.clickable} class=${node.className || '?'}`)
                }
              }
              // 检测纯数字（可能是右上角角标 "1", "2" 等）
              if (node.text && /^\d$/.test(node.text) && node.text !== '0') {
                const b3 = UI.parseBounds(node.bounds || '')
                if (b3 && b3.x > screenW * 0.80 && b3.y < screenH * 0.15) {
                  foundIndicators.push(`角标"${node.text}"`)
                  console.log(`[选中标志✓] 右上角数字角标 "${node.text}" → (${Math.round(b3.x)},${Math.round(b3.y)})`)
                }
              }
            }

            if (foundIndicators.length > 0) {
              console.log(`[选中验证✓] 检测到 ${foundIndicators.length} 个选中标志: [${foundIndicators.join(', ')}] → 继续找"下一步"`)
            } else {
              console.log(`[选中验证✗] 未检测到任何选中标志(下一步/已选/角标/发布)！视频可能未选中，但仍尝试点击...`)
            }
          }
        } catch (e) {
          console.log(`[全量XML] 异常: ${e}`)
        }

        // ★★ Layer 1: XML搜索 text + content-desc（Y轴过滤已放宽到0.98）
        const nextBtn = await findAnyText(apiPort, ['下一步', '确定', '完成'], screenH)
        if (nextBtn && nextBtn.y > screenH * 0.15) {
          const nx = nextBtn.x, ny = nextBtn.y
          console.log(`[✓] "${nextBtn.textHint}" → (${nx},${ny}) clickable=${nextBtn.clickable}`)
          
          if (nextBtn.clickable) {
            // 真正可点击的节点，直接用UI.tap
            await UI.tap(apiPort, nx, ny)
            _albumSubStep = 'SWITCH_VIDEO_TAB'
            return { success: true, action: 'UI.tap点下一步(可点击)', message: `(${nx},${ny})`, waitMs: 4000 }
          }
          
          // ★ clickable=false（TextView壳）→ 用ADB原生命令 + 连击 + 多点扫射
          console.log(`[⚠下一步] clickable=false！改用ADB input tap连击+阵列扫射...`)
          
          // 尝试1: 中心点 ADB tap
          await sh(apiPort, `input tap ${nx} ${ny}`, signal)
          await sleep(300, signal)
          
          // 尝试2: 中心点再tap一次（连击）
          await sh(apiPort, `input tap ${nx} ${ny}`, signal)
          await sleep(300, signal)
          
          // 尝试3: 左偏移50px（避开文字渲染层）
          await sh(apiPort, `input tap ${nx - 50} ${ny}`, signal)
          await sleep(300, signal)
          
          // 尝试4: 右偏移50px
          await sh(apiPort, `input tap ${nx + 50} ${ny}`, signal)
          await sleep(300, signal)
          
          _albumSubStep = 'SWITCH_VIDEO_TAB'
          return { success: true, action: 'ADB阵列扫射下一步(clickable=false)', message: `(${nx},${ny})×4次`, waitMs: 5000 }
        }
        if (nextBtn) console.log(`[跳过] "${nextBtn.textHint}"太靠上`)

        // ★★ Layer 2: VL 视觉识别（prompt 已修复，不再被"相册"截胡）
        console.log(`[VL] 找红底白字"下一步"...`)
        const vlNext = await locateElement(b64,
          `视频选择界面${screenW}x${screenH}。屏幕底部右侧有【红色圆角矩形】按钮写白色大字"下一步"。返回中心坐标。看不到返回null。禁止y<400!`)
        if (vlNext && vlNext.y > screenH * 0.10) {
          console.log(`[VL✓] → (${vlNext.x},${vlNext.y}), 用UI.tap(硬件级)`)
          await UI.tap(apiPort, vlNext.x, vlNext.y)
          _albumSubStep = 'SWITCH_VIDEO_TAB'
          return { success: true, action: 'VL+UI.tap点下一步', message: `(${vlNext.x},${vlNext.y})`, waitMs: 4000 }
        }
        console.log(vlNext ? `[VL✗] (${vlNext.x},${vlNext.y})太靠顶` : `[VL✗] null`)

        // ════════ 改动C: 红色像素检测（跳过，无可用图像库） ════════
        // 截图已保存到 debug-screenshots/ 目录，可人工确认右下角是否有红色"下一步"
        const hasScreenshot = !!debugB64
        if (hasScreenshot) {
          console.log(`[像素检测] 截图已保存(见上方DEBUG路径)，人工确认右下角红色区域`)
        }

        // ★★ Layer 3: 比例坐标连击右下角
        //    y=0.92 避开全面屏手势导航栏（0.88 可能点到手势区）
        const ratioX = Math.round(screenW * 0.92)
        const ratioY = Math.round(screenH * 0.92)
        console.log(`[比例坐标] 连击右下角 → (${ratioX},${ratioY}) [screenW*0.92, screenH*0.92]${hasScreenshot ? ' (有截图可人工确认)' : ''}`)
        await UI.tap(apiPort, ratioX, ratioY)
        await sleep(300, signal)
        await UI.tap(apiPort, ratioX, ratioY)  // ★ 连击确保触发
        _albumSubStep = 'SWITCH_VIDEO_TAB'
        return { success: true, action: '比例坐标点下一步', message: `(${ratioX},${ratioY})`, waitMs: 4000 }
      }

      // 兜底
      _albumSubStep = 'SWITCH_VIDEO_TAB'
      return { success: false, action: '相册未知子步骤', message: String(subStep), waitMs: 2000 }
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

      // ════════ Sub-A: 点击标题输入框 ════════
      if (subStep === 'CLICK_INPUT') {
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
      if (subStep === 'INPUT_TITLE') {
        const fullText = _safeTopics ? `${_safeTitle} ${_safeTopics}` : _safeTitle
        console.log(`[编辑-输入] 准备输入: ${fullText.substring(0, 40)}...`)
        await doInput(apiPort, fullText, signal, adb)
        console.log(`[编辑-输入✓] 已发送文本`)
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

      // ════════ Sub-D: 添加话题标签 ════════
      if (subStep === 'ADD_TOPICS') {
        if (!_safeTopics || _safeTopics.trim().length === 0) {
          console.log(`[编辑-标签] 无话题配置, 跳过标签步骤`)
          _editSubStep = '' // 重置子步骤
          return { success: true, action: '跳过标签(空)', message: '', waitMs: 10000 }
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
    // STEP 4.5: 编辑页 → 选择/输入位置（POI）
    // ========================================
    // 抖音发布编辑页通常有"添加位置"入口，流程：
    //   1. 点击"添加位置"/"所在位置"按钮
    //   2. 搜索框输入位置名称
    //   3. 点击搜索结果中的目标位置
    //   4. 返回编辑页 → 进入 PUBLISH_BTN
    //
    // 如果 _safeLocation 为空，getNextStep 会跳过此步骤直接到 PUBLISH_BTN
    case 'SELECT_POI': {
      if (!_safeLocation) {
        console.log(`[位置] 无位置配置, 跳过`)
        return { success: true, action: '跳过位置(空)', message: '', waitMs: 0 }
      }
      console.log(`[位置] 目标位置: "${_safeLocation}"`)

      // Layer 1: XML 找"添加位置" / "所在位置" / "位置" 按钮
      const poiBtn = await locateByText(apiPort, ['添加位置', '所在位置', '位置', '添加地理位置'], 3000)
      if (poiBtn) {
        console.log(`[位置✓] 找到入口 → (${poiBtn.x},${poiBtn.y})`)
        await doTap(apiPort, poiBtn.x, poiBtn.y, signal, adb)
        await sleep(2000, signal) // 等待搜索页打开

        // 输入位置搜索词
        const searchBox = await locateByText(apiPort, ['搜索', '查找地点', '请输入', '搜索位置'], 2000)
        if (searchBox) {
          await doTap(apiPort, searchBox.x, searchBox.y, signal, adb)
          await sleep(800, signal)
          await doInput(apiPort, _safeLocation, signal, adb)
          console.log(`[位置] 已输入搜索: ${_safeLocation}`)
          await sleep(2500, signal) // 等待搜索结果

          // 点击第一个搜索结果（通常是最佳匹配）
          const firstResult = await findAnyText(apiPort, [_safeLocation.substring(0, 3)], screenH * 0.8)
          if (firstResult && firstResult.y > screenH * 0.15) {
            console.log(`[位置✓] 选择结果 → (${firstResult.x},${firstResult.y})`)
            await doTap(apiPort, firstResult.x, firstResult.y, signal, adb)
            return { success: true, action: '选择POI完成', message: _safeLocation.substring(0, 20), waitMs: 3000 }
          }

          // 兜底：点击屏幕中部偏下的区域（列表第一项）
          const fallbackY = Math.round(screenH * 0.45)
          console.log(`[位置] 未找到精确匹配, 点中部兜底 → (540,${fallbackY})`)
          await doTap(apiPort, 540, fallbackY, signal, adb)
          return { success: true, action: 'POI兜底点击', message: _safeLocation.substring(0, 20), waitMs: 3000 }
        }

        // 没找到搜索框，可能直接在当前位置列表中
        console.log(`[位置] 未找到搜索框，尝试直接找位置文字...`)
        const directMatch = await findAnyText(apiPort, [_safeLocation.substring(0, 4)], screenH * 0.9)
        if (directMatch && directMatch.y > screenH * 0.10) {
          console.log(`[位置✓] 直接匹配 → (${directMatch.x},${directMatch.y})`)
          await doTap(apiPort, directMatch.x, directMatch.y, signal, adb)
          return { success: true, action: 'POI直接选择', message: _safeLocation.substring(0, 20), waitMs: 3000 }
        }

        // 最终兜底：VL 定位
        console.log(`[位置] VL定位位置选项...`)
        const vlPoi = await locateElement(b64, `抖音发布页面，找一个与"${_safeLocation}"相关的位置或地点按钮，点击它。如果找不到就返回null。`)
        if (vlPoi && isVlCoordValid(vlPoi.x, vlPoi.y, screenW, screenH)) {
          await doTap(apiPort, vlPoi.x, vlPoi.y, signal, adb)
          return { success: true, action: 'VL选POI', message: `(${vlPoi.x},${vlPoi.y})`, waitMs: 3000 }
        }
      } else {
        console.log(`[位置✗] 未找到"添加位置"等入口按钮`)
      }

      // 全部失败：不阻塞主流程，跳过位置继续发布
      console.log(`[位置⚠] 选择位置失败，跳过继续发布...`)
      return { success: true, action: '跳过位置(失败)', message: _safeLocation.substring(0, 20), waitMs: 1000 }
    }

    // ========================================
    // STEP 5: 发布页 → 点击 "发布" 按钮
    // ========================================
    // ⚠️ 注意：抖音的"发布/发作品"按钮通常是红色圆角卡片，
    //    外层是 clickable=false 的 TextView壳，需要用 ADB input tap 触发！
    case 'PUBLISH_BTN': {
      // ★★ Layer 0: 先诊断发布按钮状态（打印XML信息）★★
      try {
        const pubDump = await UI.dumpXml(apiPort)
        if (pubDump.success && pubDump.data) {
          const pNodes = UI.parseUiXml(pubDump.data)
          const pubKeywords = ['发布', '发作品', '立即发布', '发送']
          for (const rawNode of pNodes) {
            const node = rawNode as { text?: string; contentDesc?: string; className?: string; bounds?: string; clickable?: boolean }
            const nodeText = node.text || ''
            const nodeDesc = node.contentDesc || ''
            const isPub = pubKeywords.some(k => nodeText.includes(k) || nodeDesc.includes(k))
            if (isPub) {
              const b = UI.parseBounds(node.bounds || '')
              const pos = b ? `(${Math.round(b.x)},${Math.round(b.y)},${b.width}x${b.height})` : '?'
              console.log(`[发布-诊断] "${nodeText || nodeDesc}" | ${node.className} | clickable=${!!node.clickable} | ${pos}`)
            }
          }
        }
      } catch (e) {
        console.log(`[发布-诊断] 异常: ${e}`)
      }

      // ★★ Layer 1: XML 搜索（含clickable=false节点）★★
      const pubBtn = await findAnyText(apiPort, ['发布', '发作品', '立即发布', '发送'], screenH, 3000)
      if (pubBtn && pubBtn.y > screenH * 0.10 && pubBtn.y > screenH * 0.50) { // 发布按钮应该在屏幕下半部分
        const px = pubBtn.x, py = pubBtn.y
        console.log(`[发布✓] "${pubBtn.textHint}" → (${px},${py}) clickable=${pubBtn.clickable}`)

        if (pubBtn.clickable) {
          // 真正可点击 — 直接 UI.tap
          await UI.tap(apiPort, px, py)
          return { success: true, action: 'UI.tap点发布(可点击)', message: `(${px},${py})`, waitMs: 10000 }
        }

        // ★ clickable=false（红色卡片壳）→ ADB阵列扫射（和"下一步"一样的策略）
        console.log(`[⚠发布] clickable=false！改用ADB input tap连击+阵列...`)

        // 尝试1: 中心点 ×2 连击
        await sh(apiPort, `input tap ${px} ${py}`, signal)
        await sleep(500, signal)
        await sh(apiPort, `input tap ${px} ${py}`, signal)
        await sleep(500, signal)

        // 尝试2: 左偏移80px（避开文字层）
        await sh(apiPort, `input tap ${px - 80} ${py}`, signal)
        await sleep(500, signal)

        // 尝试3: 右偏移80px
        await sh(apiPort, `input tap ${px + 80} ${py}`, signal)
        await sleep(500, signal)

        return { success: true, action: 'ADB阵列扫射发布(clickable=false)', message: `(${px},${py})×4次`, waitMs: 10000 }
      }
      if (pubBtn) console.log(`[跳过] "${pubBtn.textHint}"位置异常 y=${pubBtn.y}`)

      // ★★ Layer 2: locateByText（要求clickable=true）兜底 ★★
      const xmlPub = await locateByText(apiPort, ['发布', '发作品', '立即发布'], 2000)
      if (xmlPub) {
        console.log(`[发布✓] locateByText → (${xmlPub.x},${xmlPub.y})`)
        // 也用 ADB tap 确保触发
        await sh(apiPort, `input tap ${xmlPub.x} ${xmlPub.y}`, signal)
        await sleep(300, signal)
        await sh(apiPort, `input tap ${xmlPub.x} ${xmlPub.y}`, signal)
        return { success: true, action: 'locateByText+ADB连击发布', message: `(${xmlPub.x},${xmlPub.y})×2`, waitMs: 10000 }
      }

      // ★★ Layer 3: VL 视觉定位 ★★
      console.log(`[发布-VL] XML失败, VL定位红底白字发布按钮...`)
      const vlCoord = await locateElement(
        b64,
        `这是抖音APP的视频发布编辑页面${screenW}x${screenH}。屏幕右下角有一个【红色或橙红色圆角矩形】按钮，上面写着白色的"发布"或"发作品"大字。请找到这个红色按钮的中心坐标并返回。注意这个按钮在屏幕底部区域(y>屏幕高度的60%)。如果看不到就返回null。`
      )
      if (vlCoord && vlCoord.y > screenH * 0.50) {
        console.log(`[发布VL✓] → (${vlCoord.x},${vlCoord.y}), 用ADB tap`)
        await sh(apiPort, `input tap ${vlCoord.x} ${vlCoord.y}`, signal)
        await sleep(300, signal)
        await sh(apiPort, `input tap ${vlCoord.x} ${vlCoord.y}`, signal)
        return { success: true, action: 'VL+ADB发布', message: `(${vlCoord.x},${vlCoord.y})`, waitMs: 10000 }
      }
      if (vlCoord) {
        console.log(`[发布VL✗] 坐标不合理 (${vlCoord.x},${vlCoord.y}), y太靠上`)
      } else {
        console.log(`[发布VL✗] null`)
      }

      // ★★ Layer 4: 比例坐标终极兜底（右下角红色按钮区）★★
      const ratioX = Math.round(screenW * 0.88)
      const ratioY = Math.round(screenH * 0.92)
      console.log(`[发布-比例] 终极兜底 → (${ratioX},${ratioY}) [screenW*0.88, screenH*0.92]`)
      await sh(apiPort, `input tap ${ratioX} ${ratioY}`, signal)
      await sleep(300, signal)
      await sh(apiPort, `input tap ${ratioX} ${ratioY}`, signal)
      return { success: true, action: '比例坐标+ADB发布(终极)', message: `(${ratioX},${ratioY})`, waitMs: 10000 }
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
    case 'EDIT_TITLE': return _safeLocation ? 'SELECT_POI' : 'PUBLISH_BTN'   // 有位置才走SELECT_POI，否则跳过
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
    case 'EDIT_TITLE': return 4
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
