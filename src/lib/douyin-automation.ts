import * as UI from './uiautomator-driver'
import { aiLocateButton, aiDescribeScreen, pickInBox } from './ai-providers'

export const DOUYIN_PKG = 'com.ss.android.ugc.aweme'
export const DOUYIN_ACT = '.main.MainActivity'

function randomDelay(min: number, max: number) {
  return UI.sleep(min + Math.random() * (max - min))
}

export async function ensureDouyinOpen(apiPort: number): Promise<boolean> {
  for (let i = 0; i < 3; i++) await UI.goBack(apiPort)
  await randomDelay(500, 1000)
  const r = await UI.openApp(apiPort, DOUYIN_PKG, DOUYIN_ACT)
  await randomDelay(3000, 5000)
  return r.success
}

export async function goHome(apiPort: number): Promise<UI.UIResult> {
  return UI.findAndClick(apiPort, '首页')
}

export async function goProfile(apiPort: number): Promise<UI.UIResult> {
  return UI.findAndClick(apiPort, '我')
}

export async function like(apiPort: number): Promise<UI.UIResult> {
  const waitMs = 20000 + Math.floor(Math.random() * 10000)
  await UI.sleep(waitMs)
  return UI.findAndClick(apiPort, '赞')
}

export async function comment(apiPort: number, text: string): Promise<UI.UIResult> {
  const r = await UI.findAndClick(apiPort, '评论')
  if (!r.success) return r
  await randomDelay(2000, 3000)
  await UI.tapAndInput(apiPort, '消息', text)
  await randomDelay(1000, 1500)
  return UI.findAndClick(apiPort, '发送')
}

export async function follow(apiPort: number): Promise<UI.UIResult> {
  await randomDelay(3000, 6000)
  return UI.findAndClick(apiPort, '关注')
}

export async function favorite(apiPort: number): Promise<UI.UIResult> {
  return UI.findAndClick(apiPort, '收藏')
}

export async function shareVideo(apiPort: number, target?: string): Promise<UI.UIResult> {
  const clickRes = await UI.findAndClick(apiPort, '分享')
  if (!clickRes.success) return clickRes
  await randomDelay(2000, 3000)
  if (target) {
    const r = await UI.swipeToFind(apiPort, target, 5)
    if (!r.success) return { success: false, message: `未找到分享目标"${target}"` }
    return { success: true, message: `已分享到 ${target}` }
  }
  return { success: true, message: '分享面板已打开' }
}

export async function search(apiPort: number, keyword: string): Promise<UI.UIResult> {
  const s = await UI.findAndClick(apiPort, '搜索')
  if (!s.success) { await UI.goBack(apiPort); await randomDelay(500, 1000) }
  const s2 = await UI.findAndClick(apiPort, '搜索')
  if (!s2.success) return { success: false, message: '找不到搜索按钮' }
  await randomDelay(1500, 2000)
  await UI.tapAndInput(apiPort, '搜索', keyword)
  await randomDelay(1000, 1500)
  await UI.tapRatio(apiPort, 0.5, 0.104)
  await randomDelay(3000, 5000)
  return { success: true, message: `已搜索"${keyword}"` }
}

export async function sendDirectMessage(apiPort: number, username: string, message: string): Promise<UI.UIResult> {
  let r = await UI.findAndClick(apiPort, '消息')
  if (!r.success) { for (let i = 0; i < 3; i++) await UI.goBack(apiPort); await randomDelay(1000, 1500); r = await UI.findAndClick(apiPort, '消息') }
  if (!r.success) return { success: false, message: '找不到消息' }
  await randomDelay(2000, 3000)
  let userR = await UI.findAndClick(apiPort, username)
  if (!userR.success) {
    await UI.findAndClick(apiPort, '搜索'); await randomDelay(1000, 1500)
    await UI.tapAndInput(apiPort, '搜索', username); await randomDelay(1500, 2000)
    await UI.tapRatio(apiPort, 0.5, 0.208); await randomDelay(1000, 1500)
    userR = await UI.findAndClick(apiPort, username)
  }
  if (!userR.success) return { success: false, message: `未找到用户"${username}"` }
  await randomDelay(2000, 3000)
  await UI.tapAndInput(apiPort, '消息', message)
  await randomDelay(1000, 1500)
  const sendR = await UI.findAndClick(apiPort, '发送')
  return { success: sendR.success, message: `已私信 ${username}` }
}

export interface PublishOptions {
  title?: string; videoIndex?: number; aiCover?: boolean; topics?: string[]; delayBeforePublish?: number; dryRun?: boolean
}

/** 扫描 XML 找 ImageView/FrameLayout 图标按钮（用于定位 "+" 等无文字按钮） */
async function scanIconButton(apiPort: number, SW: number, SH: number, areaFilter: (b: { x: number; y: number; width: number; height: number }, cx: number, cy: number) => boolean): Promise<{ x: number; y: number } | null> {
  const xmlR = await UI.dumpXml(apiPort)
  if (!xmlR.success) return null
  const allNodes = UI.parseUiXml(xmlR.data)
  let best: { x: number; y: number } | null = null
  for (const n of allNodes) {
    if (!n.className.includes('ImageView') && !n.className.includes('FrameLayout')) continue
    const b = UI.parseBounds(n.bounds)
    if (!b) continue
    const cx = Math.round(b.x + b.width / 2)
    const cy = Math.round(b.y + b.height / 2)
    if (!areaFilter(b, cx, cy)) continue
    if (!best || b.y > best.y) best = { x: cx, y: Math.round(b.y + 5) }
  }
  return best
}

export async function publishVideo(apiPort: number, options: PublishOptions = {}): Promise<UI.UIResult> {
  const { title, videoIndex = 1, aiCover = false, delayBeforePublish = 3000 } = options
  const { width: SW, height: SH } = await UI.getScreenSize(apiPort)

  // 详细步骤日志
  const stepLog = (step: string, detail: string) => console.log(`[publish:${step}] ${detail}`)
  const dumpScreenTexts = async () => {
    const r = await UI.extractScreenData(apiPort)
    if (r.success) {
      const texts = (r.data as UI.ExtractedData)?.texts?.slice(0, 10) || []
      stepLog('screen', `可见文字: ${texts.join(' | ') || '(空)'}`)
    }
  }
  const aiCheck = async (step: string) => {
    stepLog(step, 'AI 页面分析中...')
    const desc = await aiDescribeScreen(apiPort)
    stepLog(step, `AI: ${desc || '(分析超时或无返回)'}`)
  }

  // 1. 找初始"+"发布按钮 → 进入上传菜单
  // 注意：不通过文字搜索，+ 号是 ImageView 图标，文字匹配会误点别处
  let publishBtn: any = { success: false, message: '' }
  const plusBtn = await scanIconButton(apiPort, SW, SH, (b, cx) => b.y >= SH * 0.73 && cx >= SW * 0.278 && cx <= SW * 0.685)
  if (plusBtn) {
    await UI.tap(apiPort, plusBtn.x, plusBtn.y)
    await randomDelay(2000, 3000)
    const menuCheck = await UI.findByText(apiPort, '相册')
    if (menuCheck.success) publishBtn = { success: true, message: '已点击 + 号' }
  }
  if (!publishBtn.success) {
    // 兜底：文字匹配
    let textBtn = await UI.findByText(apiPort, '发布')
    if (!textBtn.success) textBtn = await UI.findByText(apiPort, '添加')
    if (textBtn.success && textBtn.center) {
      await UI.tap(apiPort, textBtn.center.x, textBtn.center.y)
      await randomDelay(2000, 3000)
      if ((await UI.findByText(apiPort, '相册')).success) publishBtn = textBtn
    }
  }
  if (!publishBtn.success) {
    // 终极兜底：AI 视觉识别（超时 8 秒，超了就跳过不卡流程）
    console.log('[AI定位] 尝试 AI 识别 "+" 按钮...')
    const aiCoord = await Promise.race([
      aiLocateButton(apiPort, '底部导航栏中间的加号发布按钮'),
      new Promise<null>(r => setTimeout(() => r(null), 8000)),
    ])
    if (aiCoord) {
      const pt = pickInBox(aiCoord)
      await UI.tap(apiPort, pt.x, pt.y)
      await randomDelay(2000, 3000)
      if ((await UI.findByText(apiPort, '相册')).success) publishBtn = { success: true, message: 'AI 定位 + 号成功' }
    }
  }
  if (!publishBtn.success) return { success: false, message: '找不到发布按钮' }
  await aiCheck('post_plus')

  // 2. 点击"相册"进入相册
  stepLog('album', '尝试点击"相册"')
  if (!(await UI.findAndClick(apiPort, '相册')).success) await UI.findAndClick(apiPort, '视频')
  await randomDelay(3000, 4000)
  stepLog('album', '相册点击后可见文字:')
  await dumpScreenTexts()

  // 3. 选"视频"Tab切换到视频列表（dumpXml全节点扫描，不限clickable）
  stepLog('video_tab', '找"视频"Tab')
  const tabXml = await UI.dumpXml(apiPort)
  if (tabXml.success) {
    for (const n of UI.parseUiXml(tabXml.data)) {
      if ((n.text === '视频' || n.contentDesc === '视频') && n.enabled) {
        const b = UI.parseBounds(n.bounds)
        if (b) {
          await UI.tap(apiPort, Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2))
          stepLog('video_tab', `已点击"视频"Tab: ${b.x},${b.y}`)
          break
        }
      }
    }
  }
  await randomDelay(2000, 3000)
  stepLog('video_tab', 'Tab点击后可见文字:')
  await dumpScreenTexts()

  // 4. 选视频：点第一个视频缩略图中心（勾选框是纯视觉绘制，XML 中不存在）
  let vs = false
  const x1 = await UI.dumpXml(apiPort)
  if (x1.success) {
    const allNodes = UI.parseUiXml(x1.data)

    // 找 tab 栏底部的 Y 坐标（视频/图片/动图这一行）
    const tabBarBottom = allNodes
      .filter(n => n.text === '全部' || n.text === '视频' || n.text === '图片')
      .reduce((maxY, n) => {
        const b = UI.parseBounds(n.bounds)
        return b ? Math.max(maxY, b.y + b.height) : maxY
      }, 0)

    // 筛选：tab 栏下方的 ImageView，尺寸符合缩略图（方形，宽高均 > 屏幕 8%）
    const thumbs = allNodes
      .filter(n => {
        if (!n.className.includes('ImageView')) return false
        const b = UI.parseBounds(n.bounds)
        if (!b) return false
        return b.y >= tabBarBottom && b.width > SW * 0.08 && b.height > SH * 0.03 && b.width < SW * 0.5
      })
      .sort((a, b) => {
        const ba = UI.parseBounds(a.bounds)!
        const bb = UI.parseBounds(b.bounds)!
        return (ba.y - bb.y) || (ba.x - bb.x)
      })

    if (thumbs.length > 0) {
      const t = UI.parseBounds(thumbs[0].bounds)!
      stepLog('pick_video', `选第1个缩略图: [${t.x},${t.y},${t.width},${t.height}]`)
      await UI.tap(apiPort, Math.round(t.x + t.width / 2), Math.round(t.y + t.height / 2))
      await randomDelay(2500, 3500)
      vs = true
    } else {
      stepLog('pick_video', '未找到符合条件的缩略图')
    }
  }
  if (!vs) {
    stepLog('pick_video', '缩略图选择失败，使用坐标兜底 tapRatio(0.5,0.25)')
    await UI.tapRatio(apiPort, 0.5, 0.25); await randomDelay(2500, 3500)
  }
  await aiCheck('post_pick')

  // 5+6. 两次"下一步"（AI 图像识别主驱 + 坐标兜底）
  // "下一步"在弹窗/覆盖层上，dumpXml 抓不到文字，靠截图 AI 识别
  for (let i = 0; i < 2; i++) {
    await UI.sleep(1000 + Math.random() * 1000)
    stepLog('next_step', `第${i+1}次"下一步"`)
    // AI 截图定位（8 秒超时，框内随机取点）
    const aiLoc = await Promise.race([
      aiLocateButton(apiPort, '视频编辑页面右下角的"下一步"按钮'),
      new Promise<null>(r => setTimeout(() => r(null), 8000)),
    ])
    if (aiLoc) {
      const pt = pickInBox(aiLoc)
      await UI.tap(apiPort, pt.x, pt.y)
      stepLog('next_step', `第${i+1}次"下一步" AI 定位 (${pt.x},${pt.y})`)
    } else {
      await UI.tapRatio(apiPort, 0.85, 0.92)
      stepLog('next_step', `第${i+1}次"下一步" 坐标兜底`)
    }
    await randomDelay(2000, 3000)
  }

  await aiCheck('after_next')

  // 7. AI封面（默认关闭，用户可手动添加）
  // 预留：后续用户手动填写时统一处理

  // 8. 写标题（兼容多种占位文字）
  if (title) {
    stepLog('title', `准备输入标题: "${title.substring(0, 30)}"`)
    await dumpScreenTexts()
    let tapped = false
    for (const hint of ['添加标题', '写标题', '标题', '请输入标题', '说点什么']) {
      const f = await UI.findByText(apiPort, hint)
      if (f.center) {
        await UI.tap(apiPort, f.center.x, f.center.y)
        await UI.sleep(500)
        tapped = true
        break
      }
    }
    // 兜底：找第一个 EditText 输入框
    if (!tapped) {
      const nodes = UI.parseUiXml((await UI.dumpXml(apiPort)).data || '')
      const et = nodes.find(n => n.className.includes('EditText') && n.enabled)
      if (et) {
        const b = UI.parseBounds(et.bounds)
        if (b) {
          await UI.tap(apiPort, Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2))
          await UI.sleep(500)
          tapped = true
        }
      }
    }
    // 先设置剪贴板，再模拟粘贴（Ctrl+V 在 Q1 上已验证有效）
    const safeTitle = title.replace(/'/g, "'\\''")
    // 剪贴板：尝试多个 service call 版本号
    await UI.shell(apiPort, `service call clipboard 2 i32 1 s16 '${safeTitle}'`).catch(() => {})
    await UI.shell(apiPort, `service call clipboard 7 i32 1 s16 '${safeTitle}'`).catch(() => {})
    await UI.sleep(300)
    // 尝试 KEYCODE_PASTE
    await UI.shell(apiPort, 'input keyevent 279').catch(() => {})
    await UI.sleep(200)
    // 兜底：input text
    await UI.shell(apiPort, `input text "${title.replace(/"/g, '\\"')}"`).catch(() => {})
    stepLog('title', `标题已设置剪贴板+粘贴: "${title.substring(0, 30)}"`)
    await randomDelay(1000, 1500)
  } else {
    stepLog('title', '未传入标题，跳过输入')
  }
  if (options.topics && options.topics.length > 0) {
    for (const topic of options.topics) {
      await UI.findAndClick(apiPort, '话题')
      await randomDelay(1000, 1500)
      await UI.tapAndInput(apiPort, '搜索', topic)
      await randomDelay(1500, 2000)
      await UI.tapRatio(apiPort, 0.5, 0.417)
      await randomDelay(1000, 1500)
    }
  }

  // 10. 测试模式：不发布，只看 AI 分析
  await UI.sleep(2000)
  await aiCheck('publish')
  stepLog('publish', '测试模式完成 — 未点击发布按钮，未实际发布')
  return { success: true, message: `测试通过: 标题"${title || '无标题'}"已尝试输入，未发布` }
}

/**
 * AI 驱动发布（ReAct 里程碑循环）
 * 完全由 AI 视觉决策驱动，脚本只做截图和执行
 */
export async function aiPublishVideo(
  apiPort: number, _rpaPort: number, options: PublishOptions = {}
): Promise<UI.UIResult> {
  const { title = '', topics = [] } = options
  const goal = `在抖音发布视频，标题"${title}"${topics.length ? `，话题${topics.join('')}` : ''}`
  const SLEEP = (ms: number) => new Promise(r => setTimeout(r, ms))
  const q1 = (cmd: string) => fetch(`http://127.0.0.1:${apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmd)}`, { signal: AbortSignal.timeout(10000) }).catch(() => {})
  // 获取实际屏幕分辨率，用于换算比例坐标
  const { width: SW, height: SH } = await (await import('./uiautomator-driver')).getScreenSize(apiPort)
  console.log(`[aiPublish] 屏幕 ${SW}x${SH}`)

  const milestones = ['打开抖音首页', '点击加号进入上传', '进入相册选视频', '点击下一步(第1次)', '点击下一步(第2次)', '填写标题和话题', '点击发布', '完成']
  let current = 0
  let lastAction = ''
  let stuckCount = 0
  const { aiDecideNext } = await import('./ai-providers')

  for (let loop = 0; loop < 40; loop++) {
    const b64 = await (await import('./uiautomator-driver')).takeScreenshot(apiPort)
    if (!b64) { console.log('[aiPublish] 截图失败'); await SLEEP(2000); continue }

    const dec = await aiDecideNext(b64, milestones[current], goal)
    if (!dec) { console.log('[aiPublish] AI 决策失败'); await SLEEP(2000); continue }

    console.log(`[aiPublish] [${milestones[current]}] ${dec.analysis}`)

    if (dec.status === 'STAGE_CHANGED') {
      current++; console.log(`[aiPublish] → 进入阶段: ${milestones[current]}`)
      if (current >= milestones.length - 1) break
      stuckCount = 0; continue
    }

    const actionKey = `${dec.action}|${dec.target_desc}`
    if (actionKey === lastAction) stuckCount++; else { stuckCount = 0; lastAction = actionKey }
    if (stuckCount > 3) {
      console.log('[aiPublish] 死循环，重置')
      current = 0; stuckCount = 0
      await q1(`am force-stop com.ss.android.ugc.aweme`); await SLEEP(2000)
      await q1(`am start -n com.ss.android.ugc.aweme/.main.MainActivity`); await SLEEP(10000)
      continue
    }

    try {
      if (dec.action === 'click' && dec.coordinates) {
        // 比例坐标 → 实际像素
        const px = Math.round(dec.coordinates.x * SW)
        const py = Math.round(dec.coordinates.y * SH)
        await q1(`input tap ${px + Math.round(Math.random() * 6 - 3)} ${py + Math.round(Math.random() * 6 - 3)}`)
      } else if (dec.action === 'input' && dec.text_content) {
        await q1(`input text "${dec.text_content.replace(/"/g, '\\"')}"`)
      } else if (dec.action === 'wait') {
        await SLEEP(3000)
      }
    } catch (e: any) {
      console.log(`[aiPublish] 执行失败: ${e.message}`)
    }
    await SLEEP(1500 + Math.random() * 1000)
  }

  return {
    success: current >= milestones.length - 2,
    message: current >= milestones.length - 2 ? `AI 发布成功: ${goal}` : `AI 超时未完成(阶段${current})`,
  }
}

export interface VideoInfo {
  title: string; author: string; likeCount: string; commentCount: string; shareCount: string; allTexts: string[]
}
export interface UserProfile {
  nickname: string; douyinId: string; followerCount: string; followingCount: string; likeCount: string; bio: string
}

export async function extractVideoInfo(apiPort: number): Promise<UI.UIResult & { info?: VideoInfo }> {
  const r = await UI.extractScreenData(apiPort)
  if (!r.success) return { success: false, message: '提取失败', info: undefined }
  const texts = (r.data as UI.ExtractedData)?.texts || []
  const info: VideoInfo = {
    title: texts[0] || '', author: texts.find(t => t.includes('@')) || '',
    likeCount: texts.find(t => t.includes('万') || t.includes('赞')) || '0',
    commentCount: texts.find(t => t.includes('评'))?.replace('评论', '') || '0',
    shareCount: texts.find(t => t.includes('分享'))?.replace('分享', '') || '0',
    allTexts: texts,
  }
  return { success: true, message: '提取成功', info }
}

export async function extractProfile(apiPort: number): Promise<UI.UIResult & { profile?: UserProfile }> {
  const r = await UI.extractScreenData(apiPort)
  if (!r.success) return { success: false, message: '提取失败', profile: undefined }
  const texts = (r.data as UI.ExtractedData)?.texts || []
  const profile: UserProfile = {
    nickname: texts[0] || '', douyinId: texts.find(t => t.includes('抖音号'))?.replace('抖音号:', '').trim() || '',
    followerCount: texts.find(t => t.includes('获赞')) || '0',
    followingCount: texts.find(t => t.includes('关注'))?.split('关注')[0] || '0',
    likeCount: texts.find(t => t.includes('获赞'))?.replace('获赞', '').trim() || '0',
    bio: texts.find(t => t.includes('简介'))?.replace('简介', '').trim() || '',
  }
  return { success: true, message: '提取成功', profile }
}

export async function extractComments(apiPort: number, max = 10): Promise<UI.UIResult> {
  const r = await UI.extractScreenData(apiPort)
  if (!r.success) return { success: false, message: '提取失败' }
  const texts = (r.data as UI.ExtractedData)?.texts || []
  return { success: true, message: `提取到 ${texts.length} 条评论`, data: texts.slice(0, max) }
}

export interface InteractionOptions {
  actions: string[]; keyword?: string; maxResults?: number
}

export async function interact(apiPort: number, opts: InteractionOptions): Promise<UI.UIResult[]> {
  const results: UI.UIResult[] = []
  for (const action of opts.actions) {
    if (action === 'like') results.push(await like(apiPort))
    else if (action === 'comment') results.push(await comment(apiPort, opts.keyword || '不错'))
    else if (action === 'follow') results.push(await follow(apiPort))
    else results.push({ success: false, message: `未知操作: ${action}` })
  }
  return results
}
