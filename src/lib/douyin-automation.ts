/**
 * 抖音自动化操作 v2 — 基于 uiautomator 文字查找
 * 
 * 所有操作通过文字查找按钮，不依赖固定坐标
 */

import * as UI from './uiautomator-driver'

function randomDelay(min: number, max: number) {
  return UI.sleep(min + Math.random() * (max - min))
}

/** 确认当前是否在抖音内 */
export async function ensureDouyinOpen(apiPort: number): Promise<boolean> {
  for (let i = 0; i < 3; i++) await UI.goBack(apiPort)
  await randomDelay(500, 1000)
  const r = await UI.openApp(apiPort, 'com.ss.android.ugc.aweme', '.main.MainActivity')
  await randomDelay(3000, 5000)
  return r.success
}

// ============================================================
// 转发 / 分享
// ============================================================

export type ShareTarget = '微信' | '朋友圈' | 'QQ' | 'QQ空间' | '微博' | '复制链接'

export async function shareVideo(apiPort: number, target?: ShareTarget): Promise<UI.UIResult> {
  // 1. 点击分享按钮
  const clickRes = await UI.findAndClick(apiPort, '分享')
  if (!clickRes.success) return clickRes
  await randomDelay(2000, 3000)

  if (target) {
    // 2. 选择分享目标
    const targetRes = await UI.findAndClick(apiPort, target)
    if (!targetRes.success) {
      const found = await UI.swipeToFind(apiPort, target, 5)
      if (!found.success || !found.center) return { success: false, message: `未找到分享目标"${target}"` }
      await UI.tap(apiPort, found.center.x, found.center.y)
    }
    await randomDelay(1500, 2500)
    return { success: true, message: `已分享到 ${target}` }
  }
  return { success: true, message: '分享面板已打开' }
}

export async function copyVideoLink(apiPort: number): Promise<UI.UIResult> {
  return shareVideo(apiPort, '复制链接')
}

// ============================================================
// 搜索
// ============================================================

export async function searchAndOpen(apiPort: number, keyword: string): Promise<UI.UIResult> {
  const searchRes = await UI.findAndClick(apiPort, '搜索')
  if (!searchRes.success) {
    await UI.goBack(apiPort); await randomDelay(500, 1000)
    const r2 = await UI.findAndClick(apiPort, '搜索')
    if (!r2.success) return { success: false, message: '找不到搜索按钮' }
  }
  await randomDelay(1500, 2000)
  await UI.tapAndInput(apiPort, '搜索', keyword)
  await randomDelay(1000, 1500)
  await UI.tap(apiPort, 540, 200) // 点搜索结果区域
  await randomDelay(3000, 5000)
  const likeCheck = await UI.findByText(apiPort, '赞')
  if (!likeCheck.success) {
    await UI.tap(apiPort, 540, 600)
    await randomDelay(3000, 5000)
  }
  return { success: true, message: `已搜索"${keyword}"` }
}

export async function searchUser(apiPort: number, username: string): Promise<UI.UIResult> {
  await UI.findAndClick(apiPort, '用户')
  await randomDelay(1000, 1500)
  return UI.findAndClick(apiPort, username)
}

// ============================================================
// 私信
// ============================================================

export async function sendDirectMessage(apiPort: number, username: string, message: string): Promise<UI.UIResult> {
  const msgRes = await UI.findAndClick(apiPort, '消息')
  if (!msgRes.success) {
    for (let i = 0; i < 3; i++) await UI.goBack(apiPort)
    await randomDelay(1000, 1500)
    const r2 = await UI.findAndClick(apiPort, '消息')
    if (!r2.success) return { success: false, message: '找不到消息入口' }
  }
  await randomDelay(2000, 3000)

  const userRes = await UI.findAndClick(apiPort, username)
  if (!userRes.success) {
    await UI.findAndClick(apiPort, '搜索')
    await randomDelay(1000, 1500)
    await UI.tapAndInput(apiPort, '搜索', username)
    await randomDelay(1500, 2000)
    await UI.tap(apiPort, 540, 400)
    await randomDelay(1000, 1500)
    const foundUser = await UI.findAndClick(apiPort, username)
    if (!foundUser.success) return { success: false, message: `未找到用户"${username}"` }
  }
  await randomDelay(2000, 3000)

  await UI.tapAndInput(apiPort, '消息', message)
  await randomDelay(1000, 1500)
  const sendRes = await UI.findAndClick(apiPort, '发送')
  await randomDelay(1000, 1500)

  return sendRes.success
    ? { success: true, message: `已私信 ${username}` }
    : { success: true, message: `已输入消息（可能自动发送）` }
}

// ============================================================
// 数据提取
// ============================================================

export interface VideoInfo {
  title: string; author: string; likeCount: string
  commentCount: string; shareCount: string; allTexts: string[]
}
export interface UserProfile {
  nickname: string; douyinId: string; followerCount: string
  followingCount: string; likeCount: string; bio: string
}

/** 提取当前视频信息 */
export async function extractVideoInfo(apiPort: number): Promise<UI.UIResult & { info?: VideoInfo }> {
  const screen = await UI.extractScreenData(apiPort)
  if (!screen.success) return { ...screen, message: '提取数据失败' }
  const data = screen.data as UI.ExtractedData

  const info: VideoInfo = {
    title: '', author: '', likeCount: '', commentCount: '', shareCount: '', allTexts: data.texts,
  }
  for (const t of data.texts) {
    if (t.includes('万') || t.includes('赞')) info.likeCount = t
    if (t.includes('评论')) info.commentCount = t
    if (t.includes('分享')) info.shareCount = t
    if (t.includes('@')) info.author = t
  }
  for (const t of data.clickableTexts) {
    if (t.startsWith('@')) info.author = t
  }
  return { success: true, message: '提取完成', info, data: screen.data }
}

/** 提取用户主页信息 */
export async function extractProfile(apiPort: number): Promise<UI.UIResult & { profile?: UserProfile }> {
  const screen = await UI.extractScreenData(apiPort)
  if (!screen.success) return { ...screen, message: '提取失败' }
  const data = screen.data as UI.ExtractedData

  const profile: UserProfile = {
    nickname: '', douyinId: '', followerCount: '', followingCount: '', likeCount: '', bio: '',
  }
  for (const t of data.texts) {
    if (!t) continue
    if (t.startsWith('抖音号')) profile.douyinId = t.replace('抖音号', '').trim()
    else if (t.includes('粉丝')) profile.followerCount = t
    else if (t.includes('关注')) profile.followingCount = t
    else if (t.includes('获赞')) profile.likeCount = t
    else if (t.length > 2 && t.length < 30 && !profile.nickname) profile.nickname = t
  }
  return { success: true, message: '提取完成', profile, data: screen.data }
}

/** 提取评论区 */
export async function extractComments(apiPort: number, max = 10): Promise<UI.UIResult> {
  const commentBtn = await UI.findAndClick(apiPort, '评论')
  if (!commentBtn.success) return commentBtn
  await randomDelay(2000, 3000)

  const comments: string[] = []
  for (let i = 0; i < 5 && comments.length < max; i++) {
    const screen = await UI.extractScreenData(apiPort)
    const data = screen.data as UI.ExtractedData
    for (const t of data.texts) {
      if (t.length > 3 && !comments.includes(t) && !t.includes('回复') && !t.includes('点赞')) {
        comments.push(t)
      }
    }
    await UI.scrollUp(apiPort)
    await randomDelay(1500, 2000)
  }
  await UI.goBack(apiPort)
  await randomDelay(500, 1000)
  return { success: true, message: `提取到 ${comments.length} 条评论`, data: comments.slice(0, max) }
}

/** 在当前视频执行一套互动 */
export async function interactWithVideo(apiPort: number, options: {
  like?: boolean; comment?: string; follow?: boolean; share?: boolean
  delay?: { min: number; max: number }
}): Promise<UI.UIResult[]> {
  const d = options.delay || { min: 3000, max: 8000 }
  const results: UI.UIResult[] = []

  if (options.like) { await randomDelay(d.min, d.max); results.push(await UI.findAndClick(apiPort, '赞')) }
  if (options.comment) {
    await randomDelay(d.min, d.max)
    const r = await UI.findAndClick(apiPort, '评论')
    results.push(r)
    if (r.success) { await randomDelay(2000, 3000); results.push(await UI.tapAndInput(apiPort, '消息', options.comment)) }
  }
  if (options.follow) { await randomDelay(d.min, d.max); results.push(await UI.findAndClick(apiPort, '关注')) }
  if (options.share) { await randomDelay(d.min, d.max); results.push(await shareVideo(apiPort)) }

  return results
}
