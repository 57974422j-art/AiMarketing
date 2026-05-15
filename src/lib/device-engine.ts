/**
 * 摩云腾设备引擎封装（低阶设备操作层）
 *
 * 职责：单设备级别的指令下发（心跳、锁定、截图、Shell、账号绑定、互动任务）
 * 支持两种模式：
 *   type=mock：返回模拟数据（无真机时调试用）
 *   type=q1：直接调用摩云腾 Q1 设备 API
 *
 * Q1 容器 API 地址格式：http://{ip}:{apiPort}
 *   - 截图：  /task=snap&level=3
 *   - Shell： /modifydev?cmd=6&cmdline=...
 *   - RPA：   http://{ip}:{rpaPort}/tap?x=...&y=...
 *   - ADB：   {ip}:{adbPort}（直连，无密码）
 */

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
/*  Q1 原始 API 调用                                                   */
/* ------------------------------------------------------------------ */

/** 从数据库查设备详情（包含 ip/port） */
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

/** Q1：安卓容器截图 */
export async function q1Screenshot(ip: string, apiPort: number): Promise<string | null> {
  try {
    const res = await fetch(`http://${ip}:${apiPort}/task=snap&level=3`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const blob = await res.blob()
    // 返回 base64 或直接图片 URL（由调用方决定如何处理）
    return URL.createObjectURL(blob)
  } catch { return null }
}

/** Q1：执行 Shell 命令 */
export async function q1ExecShell(ip: string, apiPort: number, cmdline: string): Promise<DeviceActionResult> {
  try {
    const res = await fetch(`http://${ip}:${apiPort}/modifydev?cmd=6&cmdline=${encodeURIComponent(cmdline)}`, { signal: AbortSignal.timeout(30000) })
    const text = await res.text()
    return { success: res.ok, message: text.substring(0, 500) }
  } catch (e: any) {
    return { success: false, message: e?.message || 'Shell 执行失败' }
  }
}

/** Q1：RPA 触摸/点击 */
export async function q1Tap(ip: string, rpaPort: number, x: number, y: number): Promise<DeviceActionResult> {
  try {
    const res = await fetch(`http://${ip}:${rpaPort}/tap?x=${x}&y=${y}`, { signal: AbortSignal.timeout(5000) })
    return { success: res.ok, message: `tap(${x},${y}) => ${res.status}` }
  } catch (e: any) {
    return { success: false, message: e?.message || 'RPA 点击失败' }
  }
}

/** Q1：心跳检查（调截图接口看是否在线） */
export async function q1Heartbeat(ip: string, apiPort: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${ip}:${apiPort}/task=snap&level=1`, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch { return false }
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

/** 设备心跳上报（Q1：调截图接口；Mock：返回模拟） */
export async function reportHeartbeat(deviceId: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.type === 'q1' && dev.ip && dev.apiPort) {
    const online = await q1Heartbeat(dev.ip, dev.apiPort)
    // 更新数据库状态
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
  // Mock
  await delay(300)
  return { success: true, message: `设备 ${deviceId} 心跳已上报` }
}

/** 远程锁定/解锁设备 */
export async function lockDevice(deviceId: string, locked: boolean): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.type === 'q1' && dev.ip && dev.rpaPort) {
    // Q1：通过 RPA 模拟锁屏（点击屏幕边缘外或发锁定指令）
    // 暂时用 Shell 实现
    const r = await q1ExecShell(dev.ip, dev.apiPort!, locked ? 'input keyevent 26' : 'input keyevent 82')
    return r
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
  if (dev?.type === 'q1' && dev.ip && dev.apiPort) {
    // 通过 Shell 在 Android 上打开应用并填写账号
    const cmd = `am start -a android.intent.action.VIEW -d "${platform}://login" && input text "${username}"`
    return q1ExecShell(dev.ip, dev.apiPort, cmd)
  }
  await delay(800)
  return { success: true, message: `已在设备 ${deviceId} 上绑定 ${platform} 账号 ${username}` }
}

/** 解绑社交账号 */
export async function unbindAccount(deviceId: string, platform: string, username: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.type === 'q1' && dev.ip && dev.apiPort) {
    const cmd = `pm clear com.${platform}.app`
    return q1ExecShell(dev.ip, dev.apiPort, cmd)
  }
  await delay(600)
  return { success: true, message: `已解绑 ${platform} 账号 ${username}` }
}

/* ------------------------------------------------------------------ */
/*  自动化任务执行                                                     */
/* ------------------------------------------------------------------ */

async function execQ1Task(deviceId: string, cmd: string): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (!dev?.ip || !dev.apiPort) return { success: false, message: '设备信息不完整' }
  return q1ExecShell(dev.ip, dev.apiPort, cmd)
}

/** 互关任务 */
export async function executeFollowEachOther(deviceId: string, targetAccounts: string[]): Promise<DeviceActionResult> {
  if (await isQ1(deviceId)) {
    // 逐个打开账号页并点击关注
    for (const acc of targetAccounts) {
      await execQ1Task(deviceId, `am start -a android.intent.action.VIEW -d "https://www.example.com/user/${acc}"`)
      await delay(2000)
      await q1TapFromId(deviceId, 500, 800) // 假设关注按钮位置
    }
    return { success: true, message: `互关任务完成`, data: { processed: targetAccounts.length } }
  }
  await delay(2000)
  return { success: true, message: `互关任务完成，已处理 ${targetAccounts.length} 个目标账号`, data: { processed: targetAccounts.length } }
}

/** 点赞任务 */
export async function executeLike(deviceId: string, targetUrls: string[]): Promise<DeviceActionResult> {
  if (await isQ1(deviceId)) {
    for (const url of targetUrls) {
      await execQ1Task(deviceId, `am start -a android.intent.action.VIEW -d "${url}"`)
      await delay(2000)
      await q1TapFromId(deviceId, 300, 600) // 假设点赞按钮位置
    }
    return { success: true, message: `点赞任务完成`, data: { liked: targetUrls.length } }
  }
  await delay(1500)
  return { success: true, message: `点赞任务完成，已点赞 ${targetUrls.length} 条内容`, data: { liked: targetUrls.length } }
}

/** 评论任务 */
export async function executeComment(deviceId: string, targetUrl: string, comment: string): Promise<DeviceActionResult> {
  if (await isQ1(deviceId)) {
    await execQ1Task(deviceId, `am start -a android.intent.action.VIEW -d "${targetUrl}"`)
    await delay(2000)
    await q1TapFromId(deviceId, 400, 700) // 点击评论区
    await delay(1000)
    await execQ1Task(deviceId, `input text "${comment.replace(/"/g, '\\"')}"`)
    await delay(500)
    await q1TapFromId(deviceId, 600, 900) // 点击发送
    return { success: true, message: `评论已发布`, data: { comment } }
  }
  await delay(2000)
  return { success: true, message: `评论已发布`, data: { comment } }
}

/** 转发任务 */
export async function executeRepost(deviceId: string, targetUrl: string): Promise<DeviceActionResult> {
  if (await isQ1(deviceId)) {
    await execQ1Task(deviceId, `am start -a android.intent.action.VIEW -d "${targetUrl}"`)
    await delay(2000)
    await q1TapFromId(deviceId, 550, 50) // 点击转发按钮
    return { success: true, message: `转发完成` }
  }
  await delay(1800)
  return { success: true, message: `转发完成` }
}

/** 发布视频 */
export async function publishVideo(deviceId: string, videoUrl: string, caption: string, platform: string): Promise<DeviceActionResult> {
  if (await isQ1(deviceId)) {
    // 通过 ADB 推送视频文件到设备，再用 am start 打开应用发布
    // 简化：先用 Shell 下载视频
    await execQ1Task(deviceId, `curl -o /sdcard/Download/publish.mp4 "${videoUrl}"`)
    await delay(5000)
    await execQ1Task(deviceId, `am start -a android.intent.action.VIEW -d "${platform}://publish"`)
    return { success: true, message: `视频已推送到设备，请在 ${platform} 应用中完成发布` }
  }
  await delay(3000)
  return { success: true, message: `视频已发布到 ${platform}`, data: { publishedUrl: `https://${platform}.com/video/mock_${Date.now()}` } }
}

/* ------------------------------------------------------------------ */
/*  辅助                                                               */
/* ------------------------------------------------------------------ */

async function isQ1(deviceId: string): Promise<boolean> {
  const dev = await getDevice(deviceId)
  return dev?.type === 'q1' && !!dev.ip && !!dev.apiPort
}

async function q1TapFromId(deviceId: string, x: number, y: number): Promise<DeviceActionResult> {
  const dev = await getDevice(deviceId)
  if (dev?.ip && dev.rpaPort) return q1Tap(dev.ip, dev.rpaPort, x, y)
  return { success: false, message: 'RPA 端口未配置' }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
