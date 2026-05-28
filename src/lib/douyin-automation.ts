/**
 * 抖音自动化操作 v2 — 基于 uiautomator 文字查找
 * 
 * 平台: 抖音 (com.ss.android.ugc.aweme)
 * 所有操作通过文字查找按钮，不依赖固定坐标
 * 
 * 扩展: 后续加其他平台（快手/小红书/视频号）按相同模式写对应的文件
 */

import * as UI from './uiautomator-driver'

export const DOUYIN_PKG = 'com.ss.android.ugc.aweme'
export const DOUYIN_ACT = '.main.MainActivity'

function randomDelay(min: number, max: number) {
  return UI.sleep(min + Math.random() * (max - min))
}

// ============================================================
// 启动 / 导航
// ============================================================

export async function ensureDouyinOpen(apiPort: number): Promise<boolean> {
  for (let i = 0; i < 3; i++) await UI.goBack(apiPort)
  await randomDelay(500, 1000)
  const r = await UI.openApp(apiPort, DOUYIN_PKG, DOUYIN_ACT)
  await randomDelay(3000, 5000)
  return r.success
}

/** 回到抖音首页 */
export async function goHome(apiPort: number): Promise<UI.UIResult> {
  return UI.findAndClick(apiPort, '首页')
}

/** 打开"我"的个人主页 */
export async function goProfile(apiPort: number): Promise<UI.UIResult> {
  return UI.findAndClick(apiPort, '我')
}

// ============================================================
// 互动
// ============================================================

/** 点赞当前视频（随机延迟 20-30 秒模拟真人） */
export async function like(apiPort: number): Promise<UI.UIResult> {
  const waitMs = 20000 + Math.floor(Math.random() * 10000)
  await UI.sleep(waitMs)
  return UI.findAndClick(apiPort, '赞')
}

/** 评论当前视频 */
export async function comment(apiPort: number, text: string): Promise<UI.UIResult> {
  const r = await UI.findAndClick(apiPort, '评论')
  if (!r.success) return r
  await randomDelay(2000, 3000)
  await UI.tapAndInput(apiPort, '消息', text)
  await randomDelay(1000, 1500)
  return UI.findAndClick(apiPort, '发送')
}

/** 关注作者 */
export async function follow(apiPort: number): Promise<UI.UIResult> {
  await randomDelay(3000, 6000)
  return UI.findAndClick(apiPort, '关注')
}

/** 收藏视频 */
export async function favorite(apiPort: number): Promise<UI.UIResult> {
  return UI.findAndClick(apiPort, '收藏')
}

// ============================================================
// 转发 / 分享
// ============================================================

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

// ============================================================
// 搜索
// ============================================================

export async function search(apiPort: number, keyword: string): Promise<UI.UIResult> {
  const s = await UI.findAndClick(apiPort, '搜索')
  if (!s.success) { await UI.goBack(apiPort); await randomDelay(500, 1000) }
  const s2 = await UI.findAndClick(apiPort, '搜索')
  if (!s2.success) return { success: false, message: '找不到搜索按钮' }
  await randomDelay(1500, 2000)
  await UI.tapAndInput(apiPort, '搜索', keyword)
  await randomDelay(1000, 1500)
  await UI.tap(apiPort, 540, 200)
  await randomDelay(3000, 5000)
  return { success: true, message: `已搜索"${keyword}"` }
}

// ============================================================
// 私信
// ============================================================

export async function sendDirectMessage(apiPort: number, username: string, message: string): Promise<UI.UIResult> {
  let r = await UI.findAndClick(apiPort, '消息')
  if (!r.success) { for (let i = 0; i < 3; i++) await UI.goBack(apiPort); await randomDelay(1000, 1500); r = await UI.findAndClick(apiPort, '消息') }
  if (!r.success) return { success: false, message: '找不到消息' }
  await randomDelay(2000, 3000)

  let userR = await UI.findAndClick(apiPort, username)
  if (!userR.success) {
    await UI.findAndClick(apiPort, '搜索'); await randomDelay(1000, 1500)
    await UI.tapAndInput(apiPort, '搜索', username); await randomDelay(1500, 2000)
    await UI.tap(apiPort, 540, 400); await randomDelay(1000, 1500)
    userR = await UI.findAndClick(apiPort, username)
  }
  if (!userR.success) return { success: false, message: `未找到用户"${username}"` }
  await randomDelay(2000, 3000)
  await UI.tapAndInput(apiPort, '消息', message)
  await randomDelay(1000, 1500)
  const sendR = await UI.findAndClick(apiPort, '发送')
  return { success: sendR.success, message: `已私信 ${username}` }
}

// ============================================================
// 发布视频（核心）
// ============================================================

export interface PublishOptions {
  /** 视频标题 */
  title?: string
  /** 相册里选第几个视频（1=第一个） */
  videoIndex?: number
  /** 是否开启 AI 封面 */
  aiCover?: boolean
  /** 添加话题标签 */
  topics?: string[]
  /** 发布前等待秒数 */
  delayBeforePublish?: number
}

/**
 * 完整发布视频流程
 * 路径: + → 选视频 → 下一步 → AI封面/标题 → 发作品
 */
export async function publishVideo(apiPort: number, options: PublishOptions = {}): Promise<UI.UIResult> {
  const { title, videoIndex = 1, aiCover = true, delayBeforePublish = 3000 } = options

  // 1. 点击底部 "+" 发布
  let publishBtn = await UI.findByText(apiPort, '发布')
  if (!publishBtn.success) publishBtn = await UI.findByText(apiPort, '添加')
  if (!publishBtn.success) {
    // 坐标兜底：底部居中区域
    await UI.tap(apiPort, 540, 1830)
    await randomDelay(2000, 3000)
    // 检查是否弹出了选择菜单
    const menuCheck = await UI.findByText(apiPort, '相册')
    if (menuCheck.success) { publishBtn = { success: true, message: '坐标点击成功' } as any }
  } else {
    await UI.tap(apiPort, publishBtn.center!.x, publishBtn.center!.y)
    await randomDelay(2000, 3000)
  }
  if (!publishBtn.success) return { success: false, message: '找不到发布按钮' }

  // 2. 点击"相册"或"视频"
  const videoBtn = await UI.findAndClick(apiPort, '视频')
  if (!videoBtn.success) await UI.findAndClick(apiPort, '相册')
  await randomDelay(3000, 4000)

  // 3. 选视频（默认第一个）
  const firstVideo = await UI.findByText(apiPort, '图片') // 找图片类元素
  if (!firstVideo.success) await UI.tap(apiPort, 375, 600) // 默认位置
  else { const x = 200 + (videoIndex - 1) * 250; await UI.tap(apiPort, x, 500) }
  await randomDelay(1500, 2000)

  // 4. 下一步（裁剪页面）
  await UI.findAndClick(apiPort, '下一步')
  await randomDelay(1500, 2000)

  // 5. 再下一步（编辑页面）
  await UI.findAndClick(apiPort, '下一步')
  await randomDelay(2000, 3000)

  // 6. AI 编辑封面（可选）
  if (aiCover) {
    await UI.findAndClick(apiPort, '编辑封面')
    await randomDelay(1000, 1500)
    await UI.goBack(apiPort) // 回到编辑页
    await randomDelay(1000, 1500)
  }

  // 7. 写标题
  if (title) {
    await UI.tapAndInput(apiPort, '添加标题', title)
    await randomDelay(1000, 1500)
  }

  // 8. 添加话题（可选）
  if (options.topics && options.topics.length > 0) {
    for (const topic of options.topics) {
      await UI.findAndClick(apiPort, '话题')
      await randomDelay(1000, 1500)
      await UI.tapAndInput(apiPort, '搜索', topic)
      await randomDelay(1500, 2000)
      await UI.tap(apiPort, 540, 800)
      await randomDelay(1000, 1500)
    }
  }

  // 9. 等待 + 发布
  await UI.sleep(delayBeforePublish)
  const result = await UI.findAndClick(apiPort, '发作品')

  await randomDelay(3000, 5000)
  return { ...result, message: result.success ? `视频已发布: ${title || '无标题'}` : `发布失败: ${result.message}` }
}

// ============================================================
// 数据提取
// ============================================================

export interface VideoInfo {
  title: string; author: string; likeCount: string;
  commentCount: string; shareCount: string; allTexts: string[]
}
export interface UserProfile {
  nickname: string; douyinId: string; followerCount: string;
  followingCount: string; likeCount: string; bio: string
}

export async function extractVideoInfo(apiPort: number): Promise<UI.UIResult & { info?: VideoInfo }> {
  const screen = await UI.extractScreenData(apiPort)
  if (!screen.success) return { ...screen, message: '提取失败' }
  const data = screen.data as UI.ExtractedData
  const info: VideoInfo = { title: '', author: '', likeCount: '', commentCount: '', shareCount: '', allTexts: data.texts }
  for (const t of data.texts) {
    if (t.includes('万') || t.includes('赞')) info.likeCount = t
    if (t.includes('评论')) info.commentCount = t
    if (t.includes('分享')) info.shareCount = t
    if (t.includes('@')) info.author = t
  }
  return { success: true, message: '提取完成', info, data: screen.data }
}

export async function extractProfile(apiPort: number): Promise<UI.UIResult & { profile?: UserProfile }> {
  const screen = await UI.extractScreenData(apiPort)
  if (!screen.success) return { ...screen, message: '提取失败' }
  const data = screen.data as UI.ExtractedData
  const profile: UserProfile = { nickname: '', douyinId: '', followerCount: '', followingCount: '', likeCount: '', bio: '' }
  for (const t of data.texts) {
    if (t.startsWith('抖音号')) profile.douyinId = t.replace('抖音号', '').trim()
    else if (t.includes('粉丝')) profile.followerCount = t
    else if (t.includes('关注')) profile.followingCount = t
    else if (t.includes('获赞')) profile.likeCount = t
    else if (t.length > 2 && t.length < 30 && !profile.nickname) profile.nickname = t
  }
  return { success: true, message: '提取完成', profile, data: screen.data }
}

export async function extractComments(apiPort: number, max = 10): Promise<UI.UIResult> {
  const r = await UI.findAndClick(apiPort, '评论')
  if (!r.success) return r
  await randomDelay(2000, 3000)
  const comments: string[] = []
  for (let i = 0; i < 5 && comments.length < max; i++) {
    const screen = await UI.extractScreenData(apiPort)
    const data = screen.data as UI.ExtractedData
    for (const t of data.texts) {
      if (t.length > 3 && !comments.includes(t) && !t.includes('回复') && !t.includes('点赞')) comments.push(t)
    }
    await UI.scrollUp(apiPort); await randomDelay(1500, 2000)
  }
  await UI.goBack(apiPort)
  return { success: true, message: `提取到 ${comments.length} 条评论`, data: comments.slice(0, max) }
}

// ============================================================
// 综合任务（一次跑多个操作）
// ============================================================

export interface InteractionOptions {
  like?: boolean; comment?: string; follow?: boolean; share?: boolean
  delay?: { min: number; max: number }
}

export async function interact(apiPort: number, opts: InteractionOptions): Promise<UI.UIResult[]> {
  const d = opts.delay || { min: 3000, max: 8000 }
  const results: UI.UIResult[] = []
  if (opts.like) { await randomDelay(d.min, d.max); results.push(await like(apiPort)) }
  if (opts.comment) { await randomDelay(d.min, d.max); results.push(await comment(apiPort, opts.comment)) }
  if (opts.follow) { await randomDelay(d.min, d.max); results.push(await follow(apiPort)) }
  if (opts.share) { await randomDelay(d.min, d.max); results.push(await shareVideo(apiPort)) }
  return results
}
