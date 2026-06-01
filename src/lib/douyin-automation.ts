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
}> {
  try {
    const data = await UI.extractScreenData(apiPort)
    if (!data.success || !data.data) {
      return { step: 'HOME_PLUS', evidence: 'XML获取失败,默认首页', xmlTexts: [] }
    }
    const { texts, clickableTexts } = data.data

    // 按优先级匹配页面特征

    // --- 发布成功 ---
    if (texts.some(t => t.includes('发布成功') || t.includes('已发布') || t.includes('上传完成'))) {
      return { step: 'DONE', evidence: '检测到"发布成功"', xmlTexts: clickableTexts }
    }

    // --- 发布页：有"发布"/"发作品" 按钮 ---
    if (clickableTexts.some(t => t.includes('发布') || t.includes('发作品'))) {
      // 确认不是编辑页（编辑页也有"发布"但主要特征是输入框）
      if (texts.some(t => t.includes('添加标题') || t.includes('请填写') || t.includes('标题'))) {
        return { step: 'EDIT_TITLE', evidence: '编辑页(有标题输入框)', xmlTexts: clickableTexts }
      }
      return { step: 'PUBLISH_BTN', evidence: '发布页(有发布按钮)', xmlTexts: clickableTexts }
    }

    // --- 编辑页：有标题输入区域 ---
    if (texts.some(t => t.includes('添加标题') || t.includes('请填写标题') || t.includes('描述') || t.includes('#添加话题'))) {
      return { step: 'EDIT_TITLE', evidence: '编辑页(有标题区域)', xmlTexts: clickableTexts }
    }

    // --- 相册页：有"全部"/"视频"/"图片"标签 或 "照片"/"视频" 选择 ---
    if (texts.some(t =>
      t === '全部' || t === '视频' || t === '图片' ||
      t.includes('最近视频') || t.includes('选择视频') || t.includes('相册选择')
    )) {
      return { step: 'ALBUM_PICK', evidence: '相册页(有全部/视频/图片标签)', xmlTexts: clickableTexts }
    }

    // --- 拍摄页：有"相册"文字（注意排除相册页）---
    if (clickableTexts.some(t => t === '相册' || t.includes('从相册') || t.includes('相册导入'))) {
      // 如果同时有"全部/视频/图片"标签，说明是相册页而不是拍摄页
      if (texts.some(t => t === '全部' || t === '视频' || t === '图片')) {
        return { step: 'ALBUM_PICK', evidence: '相册页(有相册+标签)', xmlTexts: clickableTexts }
      }
      return { step: 'SHOOT_ALBUM', evidence: '拍摄页(有相册入口)', xmlTexts: clickableTexts }
    }

    // --- 首页：底部导航栏文字 ---
    if (clickableTexts.some(t =>
      t === '首页' || t === '朋友' || t === '消息' || t === '我' ||
      t.includes('推荐') || t.includes('关注')
    ) || texts.some(t => t === '首页' || t === '朋友')) {
      return { step: 'HOME_PLUS', evidence: '首页(有导航栏)', xmlTexts: clickableTexts }
    }

    // --- 弹窗 ---
    if (clickableTexts.some(t =>
      t.includes('我知道了') || t.includes('去编辑') || t.includes('允许') ||
      t.includes('取消') || t.includes('确定') || t.includes('知道了')
    )) {
      return { step: 'HOME_PLUS', evidence: '检测到弹窗,回首页处理', xmlTexts: clickableTexts }
    }

    // 兜底：默认回首页
    return { step: 'HOME_PLUS', evidence: '未匹配特征,默认首页', xmlTexts: clickableTexts }
  } catch (e) {
    return { step: 'HOME_PLUS', evidence: `异常:${e}`, xmlTexts: [] }
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

// ==================== 主工作流（固定状态机，不用AI判断流程）====================

interface WorkflowOptions {
  maxLoops?: number
  totalTimeoutMs?: number
}

/** 模块级变量：安全标题和话题（executeStep 需要访问） */
let _safeTitle = ''
let _safeTopics = ''

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
    console.log(`[${TS()}] [页面] ${pageDetect.step} (${pageDetect.evidence})`)

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
          console.log(`[${TS()}] [回首页] ${currentStep} 页面不变${stepRetryCount}次, Back重置...`)
          await goBack(apiPort, 5, signal, adb)
          await sleep(3000, signal)
          currentStep = 'HOME_PLUS'
          stepRetryCount = 0
          if (loopCount > 15) return { success: false, message: `重试过多,最后:${currentStep}` }
        }
      } else {
        // 页面跳到了意外步骤（比如从首页直接跳到编辑页？）
        // 只要不是回退到HOME_PLUS就算成功，同步过去
        if (verify.step !== 'HOME_PLUS' && stepToOrder(verify.step) > stepToOrder(currentStep)) {
          console.log(`[${TS()}] [跳步] ${currentStep} → ${verify.step} (超前了)`)
          currentStep = verify.step
          stepRetryCount = 0
        } else {
          // 回退了或乱了 → 重试当前步
          console.log(`[${TS()}] [异常] 跳到${verify.step}(顺序异常), 重试${currentStep}`)
          stepRetryCount++
          if (stepRetryCount >= MAX_STEP_RETRY) {
            console.log(`[${TS()}] [回首页] 异常重试耗尽, Back重置...`)
            await goBack(apiPort, 5, signal, adb)
            await sleep(3000, signal)
            currentStep = 'HOME_PLUS'
            stepRetryCount = 0
          }
        }
      }
    } else {
      stepRetryCount++
      if (stepRetryCount >= MAX_STEP_RETRY) {
        console.log(`[${TS()}] [回首页] ${currentStep} 失败${stepRetryCount}次, Back重置...`)
        await goBack(apiPort, 5, signal, adb)
        await sleep(3000, signal)
        currentStep = 'HOME_PLUS'
        stepRetryCount = 0
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
      // 策略A: XML 找底部导航栏相关文字
      const xmlPlus = await locateByText(apiPort, ['+', '创建', '拍摄'], 3000)
      if (xmlPlus) {
        await doTap(apiPort, xmlPlus.x, xmlPlus.y, signal, adb)
        return { success: true, action: 'XML定位+号', message: `(${xmlPlus.x},${xmlPlus.y})`, waitMs: 4000 }
      }

      // 策略B: VL 视觉定位加号
      console.log(`[策略B] XML失败, VL定位加号...`)
      const vlCoord = await locateElement(b64, '加号')
      if (isVlCoordValid(vlCoord?.x ?? 0, vlCoord?.y ?? 0, screenW, screenH) && (vlCoord?.y ?? 0) > screenH * 0.75) {
        console.log(`[VL✓] 加号 → (${vlCoord!.x},${vlCoord!.y})`)
        await doTap(apiPort, vlCoord!.x, vlCoord!.y, signal, adb)
        return { success: true, action: 'VL定位+号', message: `(${vlCoord.x},${vlCoord.y})`, waitMs: 4000 }
      }
      if (vlCoord) {
        console.log(`[VL✗] 加号坐标不合理 (${vlCoord.x},${vlCoord.y}), 忽略`)
      }

      // 策略C: 比例坐标（底部导航栏正中间）
      // ⚠️ 注意：屏幕最底部有虚拟导航栏(返回/桌面/最近任务)，必须避开！
      // 虚拟导航栏约占屏幕底部 4%~6%，抖音 "+" 号在其上方
      // 抖音底部 tab 栏约在 screenH * 0.88~0.92 区域
      const navY = Math.round(screenH * 0.905)   // 避开底部虚拟按键区
      const navX = Math.round(screenW * 0.5)       // 水平居中
      console.log(`[策略C] 比例坐标 → (${navX},${navY}) [screenH*0.905, 避开虚拟导航栏]`)
      await doTap(apiPort, navX, navY, signal, adb)
      return { success: true, action: '比例坐标+号', message: `(${navX},${navY})`, waitMs: 4000 }
    }

    // ========================================
    // STEP 2: 拍摄页 → 点击 "相册" 进入相册选择页
    // ========================================
    case 'SHOOT_ALBUM': {
      // 策略A: XML 找 "相册"
      const xmlAlbum = await locateByText(apiPort, [
        '相册', '从相册选择', '相册导入', '从手机相册选择',
        '相册选择', '选择从相册', '导入'
      ], 3000)
      if (xmlAlbum) {
        await doTap(apiPort, xmlAlbum.x, xmlAlbum.y, signal, adb)
        return { success: true, action: 'XML定位相册', message: `(${xmlAlbum.x},${xmlAlbum.y})`, waitMs: 4000 }
      }

      // 策略B: VL 定位 "相册"
      console.log(`[策略B] XML失败, VL定位相册...`)
      const vlCoord = await locateElement(b64, '相册')
      if (isVlCoordValid(vlCoord?.x ?? 0, vlCoord?.y ?? 0, screenW, screenH)) {
        console.log(`[VL✓] 相册 → (${vlCoord!.x},${vlCoord!.y})`)
        await doTap(apiPort, vlCoord!.x, vlCoord!.y, signal, adb)
        return { success: true, action: 'VL定位相册', message: `(${vlCoord.x},${vlCoord.y})`, waitMs: 4000 }
      }
      if (vlCoord) {
        console.log(`[VL✗] 相册坐标不合理 (${vlCoord.x},${vlCoord.y}), 忽略`)
      }

      return { success: false, action: '相册定位失败', message: 'XML/VL都未找到', waitMs: 3000 }
    }

    // ========================================
    // STEP 3: 相册页 → 选择第一个视频
    // ========================================
    case 'ALBUM_PICK': {
      // 先检查是否有"确定"/"完成"按钮（可能已经选中了视频）
      const confirmBtn = await locateByText(apiPort, ['确定', '完成', '下一步', '继续', '确认'], 2000)
      if (confirmBtn) {
        await doTap(apiPort, confirmBtn.x, confirmBtn.y, signal, adb)
        return { success: true, action: '点确定按钮', message: `(${confirmBtn.x},${confirmBtn.y})`, waitMs: 4000 }
      }

      // 点左上角第一个缩略图区域（屏幕上方偏左）
      const thumbX = Math.round(screenW * 0.15)
      const thumbY = Math.round(screenH * 0.22)
      console.log(`[点击] 第一个缩略图位置 → (${thumbX},${thumbY})`)
      await doTap(apiPort, thumbX, thumbY, signal, adb)
      return { success: true, action: '点第一个视频', message: `(${thumbX},${thumbY})`, waitMs: 4000 }
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
      if (isVlCoordValid(vlCoord?.x ?? 0, vlCoord?.y ?? 0, screenW, screenH)) {
        await doTap(apiPort, vlCoord!.x, vlCoord!.y, signal, adb)
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
      if (isVlCoordValid(vlCoord?.x ?? 0, vlCoord?.y ?? 0, screenW, screenH)) {
        await doTap(apiPort, vlCoord!.x, vlCoord!.y, signal, adb)
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
