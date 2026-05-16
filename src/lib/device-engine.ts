/**
 * 摩云腾设备引擎封装（低阶设备操作层）
 *
 * 职责：单设备级别的指令下发（心跳、锁定、截图、Shell、账号绑定、互动任务）
 * 支持两种模式：
 *   type=mock：返回模拟数据（无真机时调试用）
 *   type=q1：通过 FRP 隧道调用摩云腾 Q1 设备 API（localhost:{apiPort}）
 *
 * Q1 API 路径（均通过 localhost:apiPort 访问）：
 *   - 截图：    /task=snap&level=3
 *   - Shell：   /modifydev?cmd=6&cmdline=...
 *   - 点击：    /autoclick?action=tap&id=1&x=...&y=...
 *   - 设备信息： /info
 *   - 上传：    POST /upload (multipart/form-data)
 *   - 下载：    /download?path=...
 *   - 代理：    /proxy?cmd=2&port=...&usr=...&pwd=...
 */

/* ------------------------------------------------------------------ */
/*  抖音 1080×2376 按钮坐标（物理分辨率，已从 180×320 截图换算）      */
/*    x *= 6, y *= 7.425                                              */
/* ------------------------------------------------------------------ */

const DOUYIN = {
  SEARCH:   { x: 984,  y: 171  },
  FOLLOW:   { x: 972,  y: 854  },
  LIKE:     { x: 972,  y: 1002 },
  COMMENT:  { x: 966,  y: 1255 },
  FAVORITE: { x: 966,  y: 1500 },
  SHARE:    { x: 984,  y: 1723 },
  PUBLISH:  { x: 546,  y: 2272 },
  PROFILE:  { x: 978,  y: 2279 },
} as const

/* ------------------------------------------------------------------ */
/*  类型定义                                                           */
/* ------------------------------------------------------------------ */

export interface DeviceInfo {
  deviceId: string
  name: string
  status: 'online' | 'offline' | 'busy'
  lastHeartbeat: string
  groupId: string | null
  /** Q1 扩展字段 */
  ip?: string
  apiPort?: number
  rpaPort?: number
  adbPort?: number
  type?: 'mock' | 'q1'
}

export interface DeviceActionResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
}

/* ------------------------------------------------------------------ */
/*  Q1 辅助函数                                                       */
/* ------------------------------------------------------------------ */

/** FRP 隧道基址：Q1 设备全部走 localhost + apiPort */
function q1Base(dev: DeviceInfo): string | null {
  if (dev.type !== 'q1') return null
  if (!dev.apiPort) return null
  return `http://localhost:${dev.apiPort}`
}

/** 从数据库查设备详情 */
async function getDevice(id: string): Promise<DeviceInfo | null> {
  try {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    const row = await prisma.device.findUnique({ where: { id: parseInt(id) } }) as any
    await prisma.$disconnect()
    if (!row) return null
    return {
      deviceId: String(row.id),
      name: row.name,
      status: row.status,
      lastHeartbeat: row.lastHeartbeat?.toISOString?.() || new Date().toISOString(),
      groupId: row.groupId,
      ip: row.ip,
      apiPort: row.apiPort,
      rpaPort: row.rpaPort,
      adbPort: row.adbPort,
      type: row.type || 'mock',
    }
  } catch { return null }
}

/* ------------------------------------------------------------------ */
/*  Q1 原始 API 调用（通过 FRP 隧道 localhost:apiPort）               */
/* ------------------------------------------------------------------ */

/** 先验证设备在线状态，offline 直接返回错误 */
async function ensureOnline(dev: DeviceInfo): Promise<DeviceActionResult | null> {
  const base = q1Base(dev)
  if (!base) return { success: false, message: '设备非 Q1 类型' }
  try {
    const res = await fetch(`${base}/info`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { success: false, message: `设备离线 (HTTP ${res.status})` }
    return null // 在线，正常继续
  } catch (e: any) {
    return { success: false, message: `设备离线: ${e?.message || '连接超时'}` }
  }
}

/** Q1：获取设备详细信息 */
export async function q1Info(dev: DeviceInfo): Promise<DeviceActionResult> {
  const base = q1Base(dev)
  if (!base) return { success: false, message: '设备非 Q1 类型' }
  try {
    const res = await fetch(`${base}/info`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { success: false, message: `info 失败: ${res.status}` }
    const text = await res.text()
    return { success: true, message: 'ok', data: { raw: text.substring(0, 2000) } }
  } catch (e: any) {
    return { success: false, message: e?.message || '获取设备信息失败' }
  }
}

/** Q1：安卓容器截图 */
export async function q1Screenshot(dev: DeviceInfo): Promise<string | null> {
  const base = q1Base(dev)
  if (!base) return null
  try {
    const res = await fetch(`${base}/task=snap&level=3`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  } catch { return null }
}

/** Q1：执行 Shell 命令 */
export async function q1ExecShell(dev: DeviceInfo, cmdline: string): Promise<DeviceActionResult> {
  const base = q1Base(dev)
  if (!base) return { success: false, message: '设备非 Q1 类型' }
  try {
    const res = await fetch(`${base}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmdline)}`, { signal: AbortSignal.timeout(30000) })
    const text = await res.text()
    return { success: res.ok, message: text.substring(0, 500), data: { output: text.substring(0, 2000) } }
  } catch (e: any) {
    return { success: false, message: e?.message || 'Shell 执行失败' }
  }
}

/** Q1：模拟点击 */
export async function q1Click(dev: DeviceInfo, x: number, y: number): Promise<DeviceActionResult> {
  if (!dev.apiPort) return { success: false, message: '设备未配置 API 端口' }
  try {
    const res = await fetch(`http://localhost:${dev.apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent(`input tap ${x} ${y}`)}`, { signal: AbortSignal.timeout(8000) })
    const text = await res.text()
    return { success: res.ok, message: `点击 (${x},${y}) => ${text.substring(0, 100)}` }
  } catch (e: any) {
    return { success: false, message: e?.message || '点击失败' }
  }
}

/** Q1：心跳检查（调 info 接口判断在线） */
export async function q1Heartbeat(dev: DeviceInfo): Promise<boolean> {
  const base = q1Base(dev)
  if (!base) return false
  try {
    const res = await fetch(`${base}/info`, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch { return false }
}

/** Q1：文件上传 */
export async function q1Upload(dev: DeviceInfo, fileUrl: string, remotePath: string): Promise<DeviceActionResult> {
  const base = q1Base(dev)
  if (!base) return { success: false, message: '设备非 Q1 类型' }
  try {
    // 先下载文件
    const fileRes = await fetch(fileUrl, { signal: AbortSignal.timeout(60000) })
    if (!fileRes.ok) return { success: false, message: '文件下载失败' }
    const buf = await fileRes.arrayBuffer()
    // 上传到 Q1
    const form = new FormData()
    const fileName = remotePath.split('/').pop() || 'upload.bin'
    form.append('file', new Blob([buf]), fileName)
    const upRes = await fetch(`${base}/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) })
    const text = await upRes.text()
    return { success: upRes.ok, message: text.substring(0, 200) }
  } catch (e: any) {
    return { success: false, message: e?.message || '上传失败' }
  }
}

/** Q1：文件下载 */
export async function q1Download(dev: DeviceInfo, path: string): Promise<ArrayBuffer | null> {
  const base = q1Base(dev)
  if (!base) return null
  try {
    const res = await fetch(`${base}/download?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) return null
    return res.arrayBuffer()
  } catch { return null }
}

/** Q1：设置代理 */
export async function q1Proxy(dev: DeviceInfo, port: number, usr: string, pwd: string): Promise<DeviceActionResult> {
  const base = q1Base(dev)
  if (!base) return { success: false, message: '设备非 Q1 类型' }
  try {
    const res = await fetch(`${base}/proxy?cmd=2&port=${port}&usr=${encodeURIComponent(usr)}&pwd=${encodeURIComponent(pwd)}`, { signal: AbortSignal.timeout(10000) })
    const text = await res.text()
    return { success: res.ok, message: text.substring(0, 200) }
  } catch (e: any) {
    return { success: false, message: e?.message || '设置代理失败' }
  }
}

/** Q1：设置剪贴板 */
export async function q1Clipboard(dev: DeviceInfo, text: string): Promise<DeviceActionResult> {
  const base = q1Base(dev)
  if (!base) return { success: false, message: '设备非 Q1 类型' }
  try {
    const res = await fetch(`${base}/clipboard?cmd=2&text=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(5000) })
    const out = await res.text()
    return { success: res.ok, message: out.substring(0, 200) }
  } catch (e: any) {
    return { success: false, message: e?.message || '设置剪贴板失败' }
  }
}

/** 发布抖音视频（按顺序执行操作链） */
export async function publishTikTokVideo(deviceId: string, videoUrl: string, caption: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  if (dev.type !== 'q1') return { success: false, message: '仅 Q1 设备支持' }
  const base = q1Base(dev)
  if (!base) return { success: false, message: '设备配置不完整' }

  // 0. 检查在线
  const err = await ensureOnline(dev)
  if (err) return err

  // 1. 启动抖音（monkey 比 am start 更可靠）
  await q1ExecShell(dev, 'monkey -p com.ss.android.ugc.aweme 1')
  await delay(3000)

  // 2. 截图确认已打开
  const snap = await q1Screenshot(dev)
  if (!snap) return { success: false, message: '抖音启动后截图失败' }

  // 3. 点击发布按钮（坐标需根据实际截图调整）
  await q1Click(dev, 500, 800)
  await delay(2000)

  // 4. 上传视频到设备
  const up = await q1Upload(dev, videoUrl, '/sdcard/Download/publish_video.mp4')
  if (!up.success) return { success: false, message: `视频上传失败: ${up.message}` }
  await delay(2000)

  // 5. 设置标题到剪贴板并粘贴
  const clip = await q1Clipboard(dev, caption)
  if (!clip.success) return { success: false, message: `设置标题失败: ${clip.message}` }
  await delay(500)

  // 6. 长按输入框弹出粘贴（用 Shell 模拟）
  await q1ExecShell(dev, 'input keyevent 279') // KEYCODE_PASTE
  await delay(1000)

  // 7. 点击发布
  await q1Click(dev, 600, 900)
  await delay(3000)

  // 8. 再次截图确认
  const finalSnap = await q1Screenshot(dev)

  return {
    success: true,
    message: '抖音发布流程已完成',
    data: { videoUrl, caption, finalSnapshot: finalSnap || '' },
  }
}

/** 打开并进入抖音视频（共用于所有互动操作） */
async function douyinOpenVideo(dev: DeviceInfo, url?: string): Promise<DeviceActionResult | null> {
  // 用 monkey 启动比 am start 更可靠
  const r1 = await q1ExecShell(dev, 'monkey -p com.ss.android.ugc.aweme 1')
  if (!r1.success) return r1
  await delay(3000)
  if (url) {
    await q1ExecShell(dev, `am start -a android.intent.action.VIEW -d "${url}"`)
    await delay(2000)
  }
  return null
}

/** 抖音关注 */
export async function douyinFollow(deviceId: string, targetUrl?: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (!dev || dev.type !== 'q1') return { success: false, message: '仅 Q1 设备支持' }
  const err = await ensureOnline(dev); if (err) return err
  const r = await douyinOpenVideo(dev, targetUrl); if (r) return r
  await q1Click(dev, DOUYIN.FOLLOW.x, DOUYIN.FOLLOW.y)
  return { success: true, message: '已点击关注' }
}

/** 抖音点赞 */
export async function douyinLike(deviceId: string, targetUrl?: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (!dev || dev.type !== 'q1') return { success: false, message: '仅 Q1 设备支持' }
  const err = await ensureOnline(dev); if (err) return err
  const r = await douyinOpenVideo(dev, targetUrl); if (r) return r
  await q1Click(dev, DOUYIN.LIKE.x, DOUYIN.LIKE.y)
  return { success: true, message: '已点击点赞' }
}

/** 抖音评论 */
export async function douyinComment(deviceId: string, comment: string, targetUrl?: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (!dev || dev.type !== 'q1') return { success: false, message: '仅 Q1 设备支持' }
  const err = await ensureOnline(dev); if (err) return err
  const r = await douyinOpenVideo(dev, targetUrl); if (r) return r
  await q1Click(dev, DOUYIN.COMMENT.x, DOUYIN.COMMENT.y)
  await delay(2000)
  await q1Clipboard(dev, comment)
  await delay(500)
  await q1ExecShell(dev, 'input keyevent 279') // paste
  await delay(1000)
  // 发送按钮（评论区底部）
  await q1Click(dev, 140, 300)
  return { success: true, message: '评论已发送', data: { comment } }
}

/** 抖音转发 */
export async function douyinShare(deviceId: string, targetUrl?: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (!dev || dev.type !== 'q1') return { success: false, message: '仅 Q1 设备支持' }
  const err = await ensureOnline(dev); if (err) return err
  const r = await douyinOpenVideo(dev, targetUrl); if (r) return r
  await q1Click(dev, DOUYIN.SHARE.x, DOUYIN.SHARE.y)
  await delay(1500)
  // 分享弹窗中第一个选项
  await q1Click(dev, 90, 90)
  return { success: true, message: '已点击分享' }
}

/** 抖音搜索 */
export async function douyinSearch(deviceId: string, keyword: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (!dev || dev.type !== 'q1') return { success: false, message: '仅 Q1 设备支持' }
  const err = await ensureOnline(dev); if (err) return err
  await q1ExecShell(dev, 'monkey -p com.ss.android.ugc.aweme 1')
  await delay(3000)
  await q1Click(dev, DOUYIN.SEARCH.x, DOUYIN.SEARCH.y)
  await delay(1500)
  await q1Clipboard(dev, keyword)
  await delay(500)
  await q1ExecShell(dev, 'input keyevent 279') // paste
  await delay(1000)
  await q1ExecShell(dev, 'input keyevent 66')  // enter
  return { success: true, message: `已搜索: ${keyword}` }
}

/* ------------------------------------------------------------------ */
/*  设备管理                                                           */
/* ------------------------------------------------------------------ */

/** 获取设备列表（从 Device 表查） */
export async function fetchDevices(): Promise<DeviceInfo[]> {
  try {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    const rows = await prisma.device.findMany({ orderBy: { createdAt: 'desc' } }) as any[]
    await prisma.$disconnect()
    return rows.map((r: any) => ({
      deviceId: String(r.id),
      name: r.name,
      status: r.status,
      lastHeartbeat: r.lastHeartbeat?.toISOString?.() || new Date().toISOString(),
      groupId: r.groupId,
      ip: r.ip,
      apiPort: r.apiPort,
      rpaPort: r.rpaPort,
      adbPort: r.adbPort,
      type: r.type || 'mock',
    }))
  } catch {
    return []
  }
}

/** 设备心跳上报（Q1：调 info 接口；Mock：返回模拟） */
export async function reportHeartbeat(deviceId: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.type === 'q1') {
    const online = await q1Heartbeat(dev)
    try {
      const { PrismaClient } = await import('@prisma/client')
      const prisma = new PrismaClient()
      await prisma.device.update({
        where: { id: parseInt(deviceId) },
        data: { status: online ? 'online' : 'offline', lastHeartbeat: new Date() },
      })
      await prisma.$disconnect()
    } catch {}
    return { success: online, message: online ? '设备在线' : '设备离线' }
  }
  await delay(300)
  return { success: true, message: `设备 ${deviceId} 心跳已上报` }
}

/** 远程锁定/解锁设备 */
export async function lockDevice(deviceId: string, locked: boolean): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.type === 'q1') {
    const err = await ensureOnline(dev)
    if (err) return err
    return q1ExecShell(dev, locked ? 'input keyevent 26' : 'input keyevent 82')
  }
  await delay(400)
  return { success: true, message: `设备 ${deviceId} 已${locked ? '锁定' : '解锁'}` }
}

/* ------------------------------------------------------------------ */
/*  社交账号操作                                                       */
/* ------------------------------------------------------------------ */

/** 绑定社交账号到设备 */
export async function bindAccount(deviceId: string, platform: string, username: string, password: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.type === 'q1') {
    const err = await ensureOnline(dev)
    if (err) return err
    const cmd = `am start -a android.intent.action.VIEW -d "${platform}://login" && input text "${username}"`
    return q1ExecShell(dev, cmd)
  }
  await delay(800)
  return { success: true, message: `已在设备 ${deviceId} 上绑定 ${platform} 账号 ${username}` }
}

/** 解绑社交账号 */
export async function unbindAccount(deviceId: string, platform: string, username: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.type === 'q1') {
    const err = await ensureOnline(dev)
    if (err) return err
    return q1ExecShell(dev, `pm clear com.${platform}.app`)
  }
  await delay(600)
  return { success: true, message: `已解绑 ${platform} 账号 ${username}` }
}

/* ------------------------------------------------------------------ */
/*  自动化任务执行                                                     */
/* ------------------------------------------------------------------ */

async function execQ1Task(deviceId: string, cmd: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (!dev) return { success: false, message: '设备不存在' }
  const err = await ensureOnline(dev)
  if (err) return err
  return q1ExecShell(dev, cmd)
}

/** 互关任务 */
export async function executeFollowEachOther(deviceId: string, targetAccounts: string[]): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.type === 'q1') {
    const err = await ensureOnline(dev)
    if (err) return err
    for (const acc of targetAccounts) {
      await q1ExecShell(dev, `am start -a android.intent.action.VIEW -d "https://www.douyin.com/user/${acc}"`)
      await delay(2000)
      await q1Click(dev, DOUYIN.FOLLOW.x, DOUYIN.FOLLOW.y)
    }
    return { success: true, message: `互关任务完成`, data: { processed: targetAccounts.length } }
  }
  await delay(2000)
  return { success: true, message: `互关任务完成，已处理 ${targetAccounts.length} 个目标账号`, data: { processed: targetAccounts.length } }
}

/** 点赞任务 */
export async function executeLike(deviceId: string, targetUrls: string[]): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.type === 'q1') {
    const err = await ensureOnline(dev)
    if (err) return err
    for (const url of targetUrls) {
      await q1ExecShell(dev, `am start -a android.intent.action.VIEW -d "${url}"`)
      await delay(2000)
      await q1Click(dev, DOUYIN.LIKE.x, DOUYIN.LIKE.y)
    }
    return { success: true, message: `点赞任务完成`, data: { liked: targetUrls.length } }
  }
  await delay(1500)
  return { success: true, message: `点赞任务完成，已点赞 ${targetUrls.length} 条内容`, data: { liked: targetUrls.length } }
}

/** 评论任务 */
export async function executeComment(deviceId: string, targetUrl: string, comment: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.type === 'q1') {
    const err = await ensureOnline(dev)
    if (err) return err
    await q1ExecShell(dev, `am start -a android.intent.action.VIEW -d "${targetUrl}"`)
    await delay(2000)
    await q1Click(dev, 400, 700)
    await delay(1000)
    await q1ExecShell(dev, `input text "${comment.replace(/"/g, '\\"')}"`)
    await delay(500)
    await q1Click(dev, 600, 900)
    return { success: true, message: `评论已发布`, data: { comment } }
  }
  await delay(2000)
  return { success: true, message: `评论已发布`, data: { comment } }
}

/** 转发任务 */
export async function executeRepost(deviceId: string, targetUrl: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.type === 'q1') {
    const err = await ensureOnline(dev)
    if (err) return err
    await q1ExecShell(dev, `am start -a android.intent.action.VIEW -d "${targetUrl}"`)
    await delay(2000)
    await q1Click(dev, 550, 50)
    return { success: true, message: `转发完成` }
  }
  await delay(1800)
  return { success: true, message: `转发完成` }
}

/** 发布视频 */
export async function publishVideo(deviceId: string, videoUrl: string, caption: string, platform: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.type === 'q1') {
    const err = await ensureOnline(dev)
    if (err) return err
    // 通过 q1Upload 上传视频到 Q1 设备
    const up = await q1Upload(dev, videoUrl, '/sdcard/Download/publish.mp4')
    if (!up.success) return up
    await delay(3000)
    await q1ExecShell(dev, `am start -a android.intent.action.VIEW -d "${platform}://publish"`)
    return { success: true, message: `视频已推送到设备，请在 ${platform} 应用中完成发布` }
  }
  await delay(3000)
  return { success: true, message: `视频已发布到 ${platform}`, data: { publishedUrl: `https://${platform}.com/video/mock_${Date.now()}` } }
}

/* ------------------------------------------------------------------ */
/*  辅助                                                               */
/* ------------------------------------------------------------------ */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}