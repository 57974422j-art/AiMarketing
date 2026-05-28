import * as UI from './uiautomator-driver'

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
  title?: string; videoIndex?: number; aiCover?: boolean; topics?: string[]; delayBeforePublish?: number
}

/** 扫描 XML 找 ImageView/FrameLayout 图标按钮（用于定位 "+" 等无文字按钮） */
async function scanIconButton(apiPort: number, SW: number, SH: number, areaFilter: (b: { x: number; y: number; width: number; height: number }) => boolean): Promise<{ x: number; y: number } | null> {
  const xmlR = await UI.dumpXml(apiPort)
  if (!xmlR.success) return null
  const allNodes = UI.parseUiXml(xmlR.data)
  let best: { x: number; y: number } | null = null
  for (const n of allNodes) {
    if (!n.className.includes('ImageView') && !n.className.includes('FrameLayout')) continue
    const b = UI.parseBounds(n.bounds)
    if (!b) continue
    if (!areaFilter(b)) continue
    const cx = Math.round(b.x + b.width / 2)
    if (!best || b.y > best.y) best = { x: cx, y: Math.round(b.y + 5) }
  }
  return best
}

export async function publishVideo(apiPort: number, options: PublishOptions = {}): Promise<UI.UIResult> {
  const { title, videoIndex = 1, aiCover = false, delayBeforePublish = 3000 } = options
  const { width: SW, height: SH } = await UI.getScreenSize(apiPort)

  // 1. 找初始"+"发布按钮 → 进入上传菜单
  let publishBtn = await UI.findByText(apiPort, '发布')
  if (!publishBtn.success) publishBtn = await UI.findByText(apiPort, '添加')
  if (!publishBtn.success) {
    // "+" 图标：底部导航栏中间区域的 ImageView
    const best = await scanIconButton(apiPort, SW, SH, b => b.y < SH * 0.73 && b.x > SW * 0.2 && b.x < SW * 0.8)
    if (best) {
      await UI.tap(apiPort, best.x, best.y)
      await randomDelay(2000, 3000)
      const menuCheck = await UI.findByText(apiPort, '相册')
      if (menuCheck.success) publishBtn = { success: true, message: '坐标点击成功' } as any
    }
  }
  if (publishBtn.success && publishBtn.center) {
    await UI.tap(apiPort, publishBtn.center.x, publishBtn.center.y)
    await randomDelay(2000, 3000)
  }
  if (!publishBtn.success) return { success: false, message: '找不到发布按钮' }

  // 2. 点击"相册"进入相册
  if (!(await UI.findAndClick(apiPort, '相册')).success) await UI.findAndClick(apiPort, '视频')
  await randomDelay(3000, 4000)

  // 3. 选"视频"Tab切换到视频列表（dumpXml全节点扫描，不限clickable）
  const tabXml = await UI.dumpXml(apiPort)
  if (tabXml.success) {
    for (const n of UI.parseUiXml(tabXml.data)) {
      if ((n.text === '视频' || n.contentDesc === '视频') && n.enabled) {
        const b = UI.parseBounds(n.bounds)
        if (b) {
          await UI.tap(apiPort, Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2))
          break
        }
      }
    }
  }
  await randomDelay(2000, 3000)

  // 4. 选视频：优先找 checkable=true 的勾选框（视频缩略图上的圆圈）
  let vs = false
  const x1 = await UI.dumpXml(apiPort)
  if (x1.success) {
    const allNodes = UI.parseUiXml(x1.data)

    // 优先：找 checkable=true 的节点（视频缩略图上的勾选框）
    const checkboxes = allNodes.filter(n => n.checkable && n.enabled)
    if (checkboxes.length > 0) {
      const c = UI.parseBounds(checkboxes[0].bounds)
      if (c) {
        await UI.tap(apiPort, Math.round(c.x + c.width / 2), Math.round(c.y + c.height / 2))
        await randomDelay(2500, 3500)
        vs = true
      }
    }

    // 次优：找缩略图节点点右上角（勾选框位置）
    if (!vs) {
      const ts = allNodes.filter(n => {
        const b = UI.parseBounds(n.bounds)
        return b && b.y > SH * 0.156 && b.y < SH * 0.521 && b.width > SW * 0.056 && b.height > SH * 0.031
      }).sort((a, b) => {
        const ba = UI.parseBounds(a.bounds)!; const bb = UI.parseBounds(b.bounds)!
        return (ba.y - bb.y) || (ba.x - bb.x)
      })
      if (ts.length > 0) {
        const f = UI.parseBounds(ts[0].bounds)!
        await UI.tap(apiPort, f.x + f.width - Math.round(SW * 0.023), f.y + Math.round(SH * 0.013))
        await randomDelay(2500, 3500)
        vs = true
      }
    }
  }
  if (!vs) { await UI.tapRatio(apiPort, 0.5, 0.25); await randomDelay(2500, 3500) }

  // 5+6. 两次"下一步"（全节点找文字，不限 clickable）
  for (let i = 0; i < 2; i++) {
    const x2 = await UI.dumpXml(apiPort); let done = false
    if (x2.success) {
      for (const n of UI.parseUiXml(x2.data)) {
        if ((n.text === '下一步' || n.contentDesc === '下一步') && n.enabled) {
          const b = UI.parseBounds(n.bounds)
          if (b) { await UI.tap(apiPort, Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)); done = true; break }
        }
      }
    }
    if (!done) await UI.tapRatio(apiPort, 0.5, 0.938)
    await randomDelay(2000, 3000)
  }

  // 7. AI封面（默认关闭，用户可手动添加）
  // 预留：后续用户手动填写时统一处理

  // 8. 写标题
  if (title) {
    await UI.tapAndInput(apiPort, '添加标题', title)
    await randomDelay(1000, 1500)
  }

  // 9. 添加话题
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

  // 10. 最终发布（可能是文字按钮或 "+" 图标按钮）
  await UI.sleep(delayBeforePublish)
  let pub = await UI.findByText(apiPort, '发作品')
  if (!pub.success) pub = await UI.findByText(apiPort, '发布')
  if (!pub.success) {
    // 非文字按钮：扫描 ImageView（"+"/图标）— 顶栏右侧或底部区域
    const best = await scanIconButton(apiPort, SW, SH, b =>
      (b.y < SH * 0.12 && b.x > SW * 0.6) || // 顶栏右侧
      (b.y > SH * 0.85 && b.x > SW * 0.5)    // 底部偏右
    )
    if (best) {
      await UI.tap(apiPort, best.x, best.y)
      await randomDelay(3000, 5000)
      return { success: true, message: `视频已发布: ${title || '无标题'}` }
    }
  }
  if (pub.success && pub.center) {
    await UI.tap(apiPort, pub.center.x, pub.center.y)
  }
  await randomDelay(3000, 5000)
  return { ...pub, message: pub.success ? `视频已发布: ${title || '无标题'}` : `发布失败: ${pub.message}` }
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
