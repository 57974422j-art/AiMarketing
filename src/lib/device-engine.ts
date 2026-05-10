/**
 * 摩云腾设备引擎封装（低阶设备操作层）
 *
 * 职责：单设备级别的指令下发（心跳、锁定、账号绑定、互关/点赞/评论/转发/发布）
 * 与 src/lib/platform-api.ts 的高阶自动化策略引擎（OfficialApi / Fingerprint / RealDevice）职责互补：
 *   - device-engine.ts：直接操作摩云腾 API 的单设备指令
 *   - platform-api.ts：抽象平台自动化的策略模式（含多引擎切换）
 * 两者 publishVideo 均为各自层级的入口，详见具体函数注释。
 *
 * 当前阶段所有函数返回 Mock 数据。
 * 设备到后，将环境变量 MOYUNTENG_API_BASE 和 MOYUNTENG_TOKEN 投入使用，
 * 替换各函数体内的 Mock 实现为真实 fetch 调用。
 */

const API_BASE = process.env.MOYUNTENG_API_BASE || 'https://api.moyunteng.com'
const TOKEN = process.env.MOYUNTENG_TOKEN || ''

/* ------------------------------------------------------------------ */
/*  类型定义                                                           */
/* ------------------------------------------------------------------ */

export interface DeviceInfo {
  deviceId: string
  name: string
  status: 'online' | 'offline' | 'busy'
  lastHeartbeat: string
  groupId: string | null
}

export interface DeviceActionResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
}

/* ------------------------------------------------------------------ */
/*  辅助 - 通用请求头                                                  */
/* ------------------------------------------------------------------ */

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`,
  }
}

/* ------------------------------------------------------------------ */
/*  设备管理                                                           */
/* ------------------------------------------------------------------ */

/** 获取设备列表 */
export async function fetchDevices(): Promise<DeviceInfo[]> {
  if (!TOKEN) {
    // ---- Mock ----
    await delay(500)
    return [
      { deviceId: 'DEV-001', name: 'Windows 模拟器 #1', status: 'online', lastHeartbeat: new Date().toISOString(), groupId: null },
      { deviceId: 'DEV-002', name: 'Windows 模拟器 #2', status: 'busy', lastHeartbeat: new Date().toISOString(), groupId: 'G-01' },
      { deviceId: 'DEV-003', name: 'Windows 模拟器 #3', status: 'offline', lastHeartbeat: new Date(Date.now() - 3600_000).toISOString(), groupId: null },
    ]
  }
  const res = await fetch(`${API_BASE}/devices`, { headers: headers() })
  return res.json()
}

/** 设备心跳上报 */
export async function reportHeartbeat(deviceId: string): Promise<DeviceActionResult> {
  if (!TOKEN) {
    await delay(300)
    return { success: true, message: `设备 ${deviceId} 心跳已上报` }
  }
  const res = await fetch(`${API_BASE}/devices/${deviceId}/heartbeat`, {
    method: 'POST',
    headers: headers(),
  })
  return res.json()
}

/** 远程锁定/解锁设备 */
export async function lockDevice(deviceId: string, locked: boolean): Promise<DeviceActionResult> {
  if (!TOKEN) {
    await delay(400)
    return { success: true, message: `设备 ${deviceId} 已${locked ? '锁定' : '解锁'}` }
  }
  const res = await fetch(`${API_BASE}/devices/${deviceId}/lock`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ locked }),
  })
  return res.json()
}

/* ------------------------------------------------------------------ */
/*  社交账号操作                                                       */
/* ------------------------------------------------------------------ */

/** 绑定社交账号到设备 */
export async function bindAccount(deviceId: string, platform: string, username: string, password: string): Promise<DeviceActionResult> {
  if (!TOKEN) {
    await delay(800)
    return { success: true, message: `已在设备 ${deviceId} 上绑定 ${platform} 账号 ${username}` }
  }
  const res = await fetch(`${API_BASE}/devices/${deviceId}/bind`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ platform, username, password }),
  })
  return res.json()
}

/** 解绑社交账号 */
export async function unbindAccount(deviceId: string, platform: string, username: string): Promise<DeviceActionResult> {
  if (!TOKEN) {
    await delay(600)
    return { success: true, message: `已解绑 ${platform} 账号 ${username}` }
  }
  const res = await fetch(`${API_BASE}/devices/${deviceId}/unbind`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ platform, username }),
  })
  return res.json()
}

/* ------------------------------------------------------------------ */
/*  自动化任务执行                                                     */
/* ------------------------------------------------------------------ */

/** 互关任务 */
export async function executeFollowEachOther(deviceId: string, targetAccounts: string[]): Promise<DeviceActionResult> {
  if (!TOKEN) {
    await delay(2000)
    return { success: true, message: `互关任务完成，已处理 ${targetAccounts.length} 个目标账号`, data: { processed: targetAccounts.length } }
  }
  const res = await fetch(`${API_BASE}/tasks/follow-each-other`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ deviceId, targetAccounts }),
  })
  return res.json()
}

/** 点赞任务 */
export async function executeLike(deviceId: string, targetUrls: string[]): Promise<DeviceActionResult> {
  if (!TOKEN) {
    await delay(1500)
    return { success: true, message: `点赞任务完成，已点赞 ${targetUrls.length} 条内容`, data: { liked: targetUrls.length } }
  }
  const res = await fetch(`${API_BASE}/tasks/like`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ deviceId, targetUrls }),
  })
  return res.json()
}

/** 评论任务 */
export async function executeComment(deviceId: string, targetUrl: string, comment: string): Promise<DeviceActionResult> {
  if (!TOKEN) {
    await delay(2000)
    return { success: true, message: `评论已发布`, data: { comment } }
  }
  const res = await fetch(`${API_BASE}/tasks/comment`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ deviceId, targetUrl, comment }),
  })
  return res.json()
}

/** 转发任务 */
export async function executeRepost(deviceId: string, targetUrl: string): Promise<DeviceActionResult> {
  if (!TOKEN) {
    await delay(1800)
    return { success: true, message: `转发完成` }
  }
  const res = await fetch(`${API_BASE}/tasks/repost`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ deviceId, targetUrl }),
  })
  return res.json()
}

/** 发布视频 */
export async function publishVideo(deviceId: string, videoUrl: string, caption: string, platform: string): Promise<DeviceActionResult> {
  if (!TOKEN) {
    await delay(3000)
    return { success: true, message: `视频已发布到 ${platform}`, data: { publishedUrl: `https://${platform}.com/video/mock_${Date.now()}` } }
  }
  const res = await fetch(`${API_BASE}/tasks/publish-video`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ deviceId, videoUrl, caption, platform }),
  })
  return res.json()
}

/* ------------------------------------------------------------------ */
/*  辅助                                                               */
/* ------------------------------------------------------------------ */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
