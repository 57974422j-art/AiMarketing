/**
 * 直播推流引擎 — 路线二：预渲染数字人视频 + FFmpeg RTMP 直推
 *
 * 核心流程:
 *   1. 话术/商品 → LLM生成文案 → 数字人口播视频(MP4) → 素材池
 *   2. FFmpeg 拼接素材 → 编码 → RTMP 推送到直播平台
 *   3. 反检测策略: 微变速/BGM轮换/随机插播/打乱顺序
 *
 * 升级路径: 本模块可无缝替换为 LiveTalking 实时驱动后端
 */

import { execFile, spawn, ChildProcess } from 'child_process'
import { readFile, writeFile, unlink, readdir, stat, access, mkdir } from 'fs/promises'
import { join } from 'path'
import { generateDigitalHumanVideo, queryDigitalHumanTask, textToSpeech, generateText } from './ai-providers'
import { existsSync } from 'fs'

// ============================================================
// 类型定义
// ============================================================

/** 推流状态 */
export type StreamStatus = 'idle' | 'preparing' | 'streaming' | 'stopping' | 'error'

/** 推流配置 */
export interface StreamConfig {
  /** 抖音推流地址 */
  rtmpUrl: string
  /** 视频码率 (bps), 默认 2500000 */
  videoBitrate?: number
  /** 音频码率 (bps), 默认 128000 */
  audioBitrate?: number
  /** 帧率, 默认 30 */
  fps?: number
  /** 分辨率 WxH, 默认 1080x1920 (竖屏直播) */
  resolution?: string
  /** 目标时长(小时), 默认 4 */
  targetDurationHours?: number
  /** 是否启用反检测微变速, 默认 true */
  antiDetectSpeedVary?: boolean
  /** 微变速范围, 默认 [0.995, 1.005] (±0.5%) */
  speedRange?: [number, number]
}

/** 单个视频片段信息 */
export interface StreamClip {
  id: string
  type: 'product_intro' | 'welcome' | 'qa' | 'hard_sell' | 'close' | 'gift_thank' | 'follow_welcome' | 'interactive_prompt' | 'bgm_change'
  filePath: string
  duration: number // 秒
  text?: string       // 原始文案
  productId?: string
  priority: number    // 播放优先级
  createdAt: string
}

/** 播放列表 */
export interface Playlist {
  id: string
  name: string
  roomId: number | null
  clips: StreamClip[]
  totalDuration: number // 秒
  createdAt: string
}

/** 推流会话状态 */
export interface StreamSession {
  id: string
  status: StreamStatus
  config: StreamConfig
  playlistId: string | null
  pid: number | null        // FFmpeg 进程 PID
  startTime: string | null
  endTime: string | null
  durationSeconds: number   // 已推流秒数
  bytesSent: number         // 已发送字节数
  error: string | null
  lastHeartbeat: string     // 最后心跳时间
}

/** 内容生成任务 */
export interface ContentGenTask {
  id: string
  status: 'pending' | 'generating' | 'completed' | 'failed'
  type: 'batch' | 'single'
  items: ContentGenItem[]
  progress: { done: number; total: number }
  outputDir: string
  error: string | null
  startedAt: string
  completedAt: string | null
}

export interface ContentGenItem {
  id: string
  text: string
  type: string
  avatarId: string
  background?: string
  status: 'pending' | 'generating' | 'completed' | 'failed'
  outputPath?: string
  taskId?: string // 千寻异步任务ID
  error?: string
}

// ============================================================
// 常量 & 默认配置
// ============================================================

const STREAM_DIR = join(process.cwd(), 'data', 'live-streams')
const CLIPS_DIR = join(STREAM_DIR, 'clips')
const PLAYLISTS_DIR = join(STREAM_DIR, 'playlists')

const DEFAULT_CONFIG: Required<Omit<StreamConfig, 'rtmpUrl'>> = {
  videoBitrate: 2500000,
  audioBitrate: 128000,
  fps: 30,
  resolution: '1080x1920',
  targetDurationHours: 4,
  antiDetectSpeedVary: true,
  speedRange: [0.995, 1.005],
}

/** 最大并发数字人生成数 */
const MAX_CONCURRENT_DH = 3

// ============================================================
// 内存状态（进程重启后丢失，需从文件恢复）
// ============================================================

const activeSessions = new Map<string, StreamSession>()
const activeFFmpegProcesses = new Map<string, ChildProcess>()

// ============================================================
// 工具函数
// ============================================================

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function ensureDirs() {
  for (const dir of [STREAM_DIR, CLIPS_DIR, PLAYLISTS_DIR]) {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  }
}

function sessionPath(id: string): string {
  return join(STREAM_DIR, `session_${id}.json`)
}

function playlistPath(id: string): string {
  return join(PLAYLISTS_DIR, `playlist_${id}.json`)
}

async function saveSession(session: StreamSession) {
  await writeFile(sessionPath(session.id), JSON.stringify(session, null, 2))
}

async function loadSession(id: string): Promise<StreamSession | null> {
  try {
    const raw = await readFile(sessionPath(id), 'utf-8')
    return JSON.parse(raw) as StreamSession
  } catch {
    return null
  }
}

async function savePlaylist(playlist: Playlist) {
  await writeFile(playlistPath(playlist.id), JSON.stringify(playlist, null, 2))
}

async function loadPlaylist(id: string): Promise<Playlist | null> {
  try {
    const raw = await readFile(playlistPath(id), 'utf-8')
    return JSON.parse(raw) as Playlist
  } catch {
    return null
  }
}

/** 获取所有会话文件 */
async function listAllSessions(): Promise<StreamSession[]> {
  try {
    const files = await readdir(STREAM_DIR)
    const sessionFiles = files.filter(f => f.startsWith('session_') && f.endsWith('.json'))
    const sessions: StreamSession[] = []
    for (const f of sessionFiles) {
      try {
        const raw = await readFile(join(STREAM_DIR, f), 'utf-8')
        sessions.push(JSON.parse(raw))
      } catch { /* skip corrupt */ }
    }
    return sessions.sort((a, b) => b.startTime?.localeCompare(a.startTime || '') ? -1 : 1)
  } catch {
    return []
  }
}

// ============================================================
// 核心 API: 推流管理
// ============================================================

/**
 * 启动推流
 *
 * 流程:
 *   1. 校验 rtmpUrl 格式
 *   2. 加载或创建播放列表
 *   3. 生成 FFmpeg concat 文件
 *   4. 启动 FFmpeg 子进程
 *   5. 返回会话信息
 */
export async function startStream(
  config: StreamConfig,
  playlistId?: string,
  clips?: StreamClip[]
): Promise<StreamSession> {
  await ensureDirs()

  const sid = uid()
  const now = new Date().toISOString()

  // 1. 合并默认配置
  const fullConfig = { ...DEFAULT_CONFIG, ...config }

  // 2. 验证 RTMP URL
  if (!fullConfig.rtmpUrl.startsWith('rtmp://')) {
    throw new Error('推流地址必须以 rtmp:// 开头，例如: rtmp://push.douyin.com/live/xxx')
  }

  // 3. 创建/加载播放列表
  let playlist: Playlist | null = null
  if (playlistId) {
    playlist = await loadPlaylist(playlistId)
  }
  if (!playlist && clips && clips.length > 0) {
    playlist = await createPlaylist(`直播_${sid}`, null, clips)
  }
  if (!playlist || playlist.clips.length === 0) {
    throw new Error('没有可用的播放内容。请先生成素材或选择已有播放列表。')
  }

  // 4. 创建会话
  const session: StreamSession = {
    id: sid,
    status: 'preparing',
    config: fullConfig,
    playlistId: playlist.id,
    pid: null,
    startTime: null,
    endTime: null,
    durationSeconds: 0,
    bytesSent: 0,
    error: null,
    lastHeartbeat: now,
  }
  activeSessions.set(sid, session)
  await saveSession(session)

  try {
    // 5. 生成 FFmpeg concat 输入文件
    const concatFilePath = await buildConcatFile(playlist.clips)

    // 6. 构建 FFmpeg 命令参数
    const ffmpegArgs = buildFFmpegArgs(concatFilePath, fullConfig)

    // 7. 启动 FFmpeg 进程
    const ffmpegProc = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    })

    activeFFmpegProcesses.set(sid, ffmpegProc)

    // 8. 监听进程事件
    ffmpegProc.stdout?.on('data', (data: Buffer) => {
      // FFmpeg 进度输出 (stderr 实际上是进度)
      const msg = data.toString().trim()
      if (msg.includes('frame=') || msg.includes('time=')) {
        session.lastHeartbeat = new Date().toISOString()
        // 解析 time=HH:MM:SS.xx 更新 durationSeconds
        const timeMatch = msg.match(/time=(\d+):(\d+):(\d+)/)
        if (timeMatch) {
          const [, h, m, s] = timeMatch
          session.durationSeconds = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)
        }
      }
    })

    ffmpegProc.stderr?.on('data', (data: Buffer) => {
      // FFmpeg 的日志输出在 stderr
      const msg = data.toString().trim()
      console.log(`[FFmpeg:${sid}] ${msg}`)
    })

    ffmpegProc.on('error', (err) => {
      console.error(`[FFmpeg:${sid}] 进程错误:`, err.message)
      session.status = 'error'
      session.error = err.message
      session.endTime = new Date().toISOString()
      saveSession(session)
    })

    ffmpegProc.on('exit', (code, signal) => {
      console.log(`[FFmpeg:${sid}] 退出 code=${code} signal=${signal}`)
      activeFFmpegProcesses.delete(sid)
      if (session.status === 'streaming' || session.status === 'preparing') {
        session.status = code === 0 ? 'idle' : 'error'
        session.error = code !== 0 ? `FFmpeg 异常退出 (code=${code})` : null
        session.endTime = new Date().toISOString()
      }
      session.pid = null
      saveSession(session)
    })

    // 9. 等待 FFmpeg 初始化完成 (约 2-3 秒)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('FFmpeg 启动超时 (10s)'))
      }, 10000)

      ffmpegProc.stderr?.on('data', function initListener(data: Buffer) {
        const msg = data.toString()
        if (msg.includes('Opening') || msg.includes('Stream mapping') || msg.includes('frame=')) {
          clearTimeout(timeout)
          ffmpegProc.stderr?.removeListener('initListener', initListener)
          resolve()
        }
      })
    })

    // 10. 标记为直播中
    session.status = 'streaming'
    session.pid = ffmpegProc.pid ?? null
    session.startTime = new Date().toISOString()
    session.lastHeartbeat = new Date().toISOString()

    activeSessions.set(sid, session)
    await saveSession(session)

    return session
  } catch (err: any) {
    session.status = 'error'
    session.error = err.message
    await saveSession(session)
    throw err
  }
}

/**
 * 停止推流
 */
export async function stopStream(sessionId: string): Promise<StreamSession> {
  const session = activeSessions.get(sessionId) || await loadSession(sessionId)
  if (!session) {
    throw new Error(`推流会话 ${sessionId} 不存在`)
  }

  const proc = activeFFmpegProcesses.get(sessionId)
  if (proc && !proc.killed) {
    // 发送 'q' 命令让 FFmpeg 优雅退出
    proc.stdin?.write('q')
    // 5 秒后强制 kill
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGTERM')
    }, 5000)
  }

  session.status = 'stopping'
  session.endTime = new Date().toISOString()
  await saveSession(session)

  // 等待进程退出
  if (proc) {
    await new Promise(resolve => proc.on('exit', resolve))
  }

  session.status = 'idle'
  await saveSession(session)

  return session
}

/**
 * 获取推流状态
 */
export async function getStreamStatus(sessionId?: string): Promise<StreamSession | StreamSession[]> {
  if (sessionId) {
    const mem = activeSessions.get(sessionId)
    if (mem) return mem
    return await loadSession(sessionId) || (() => { throw new Error(`会话 ${sessionId} 不存在`) })()
  }
  return await listAllSessions()
}

// ============================================================
// 核心 API: 内容生成
// ============================================================

/**
 * 批量生成直播素材（数字人口播视频）
 *
 * @param items 生成项列表 (文案 + 形象ID)
 * @param options 选项
 * @returns 任务对象（异步执行，需轮询状态）
 */
export async function generateLiveContent(
  items: Array<{ text: string; type: string; avatarId: string; background?: string }>,
  options?: { onProgress?: (done: number, total: number) => void }
): Promise<ContentGenTask> {
  await ensureDirs()

  const taskId = uid()
  const outputDir = join(CLIPS_DIR, taskId)
  await mkdir(outputDir, { recursive: true })

  const task: ContentGenTask = {
    id: taskId,
    status: 'pending',
    type: items.length === 1 ? 'single' : 'batch',
    items: items.map((item, idx) => ({
      id: `${taskId}_${idx}`,
      text: item.text,
      type: item.type,
      avatarId: item.avatarId,
      background: item.background,
      status: 'pending',
    })),
    progress: { done: 0, total: items.length },
    outputDir,
    error: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
  }

  task.status = 'generating'

  // 并发生成（控制并发数不超过 MAX_CONCURRENT_DH）
  const queue = [...task.items]
  let running = 0
  let doneCount = 0

  const processNext = async (): Promise<void> => {
    if (queue.length === 0) return
    const item = queue.shift()!
    running++
    item.status = 'generating'

    try {
      // 调用千寻数字人生成口播视频
      const result = await generateDigitalHumanVideo(item.avatarId, item.text, item.background)
      if (!result?.taskId) {
        throw new Error('提交数字人生成任务失败')
      }
      item.taskId = result.taskId

      // 轮询等待完成
      const videoInfo = await pollDHResult(result.taskId, 120) // 最长等 120 秒
      if (videoInfo?.videoUrl) {
        // 下载视频到本地
        const localPath = join(outputDir, `${item.id}.mp4`)
        await downloadFile(videoInfo.videoUrl, localPath)
        item.outputPath = localPath
        item.status = 'completed'
      } else {
        throw new Error('数字人视频生成超时或失败')
      }
    } catch (e: any) {
      item.status = 'failed'
      item.error = e.message || String(e)
      console.error(`[LiveContent] 生成失败 (${item.id}):`, e.message)
    }

    running--
    doneCount++
    task.progress.done = doneCount
    options?.onProgress?.(doneCount, task.items.length)

    // 继续处理下一个
    if (queue.length > 0) {
      await processNext()
    }
  }

  // 启动初始并发
  const initialConcurrency = Math.min(MAX_CONCURRENT_DH, queue.length)
  const workers = Array.from({ length: initialConcurrency }, () => processNext())
  await Promise.allSettled(workers)

  // 完成
  task.status = task.items.every(i => i.status === 'completed') ? 'completed'
    : task.items.some(i => i.status === 'completed') ? 'completed' // 部分成功也算完成
    : 'failed'
  task.completedAt = new Date().toISOString()
  if (task.status === 'failed' && task.items.some(i => i.status === 'completed')) {
    task.status = 'completed' // 有成功的就标记完成
  }

  return task
}

/**
 * AI 批量生成直播话术并生成视频（一站式入口）
 *
 * 输入商品信息和话术类型 → LLM 生成文案 → 数字人批量出视频
 */
export async function aiGenerateLiveContent(params: {
  products?: Array<{ name: string; price: string; features: string[] }>
  scriptTypes?: Array<'welcome' | 'product_intro' | 'qa' | 'hard_sell' | 'close'>
  avatarId: string
  brandTone?: string  // 专业/亲切/幽默
  background?: string
  onProgress?: (done: number, total: number) => void
}): Promise<ContentGenTask> {
  const types = params.scriptTypes || ['welcome', 'product_intro', 'qa', 'hard_sell', 'close']
  const tone = params.brandTone || '亲切热情'

  // Step 1: LLM 生成结构化话术
  const prompt = buildScriptPrompt(params.products || [], types, tone)
  const scriptsJson = await generateText(prompt, 0.7, 3000)
  if (!scriptsJson) throw new Error('LLM 话术生成失败')

  // 解析 LLM 返回的 JSON
  const scripts = parseScriptsFromJSON(scriptsJson, types)

  // Step 2: 转换为生成项
  const items = scripts.map(s => ({
    text: s.text,
    type: s.type,
    avatarId: params.avatarId,
    background: params.background,
  }))

  // Step 3: 批量调用数字人生成视频
  return generateLiveContent(items, {
    onProgress: params.onProgress,
  })
}

/**
 * 获取已生成的所有素材片段
 */
export async function listClips(taskId?: string): Promise<StreamClip[]> {
  await ensureDirs()
  const baseDir = taskId ? join(CLIPS_DIR, taskId) : CLIPS_DIR
  const clips: StreamClip[] = []

  try {
    if (taskId) {
      // 特定任务的输出目录
      const files = await readdir(baseDir)
      for (const f of files.filter(f => f.endsWith('.mp4'))) {
        const fp = join(baseDir, f)
        const statData = await stat(fp)
        clips.push({
          id: f.replace('.mp4', ''),
          type: 'product_intro',
          filePath: fp,
          duration: Math.floor(statData.size / 500000), // 粗估: 500KB/s ≈ 1秒
          createdAt: statData.mtime.toISOString(),
          priority: 0,
        })
      }
    } else {
      // 所有子目录
      const dirs = await readdir(CLIPS_DIR)
      for (const dir of dirs) {
        const subClips = await listClips(dir)
        clips.push(...subClips)
      }
    }
  } catch { /* empty */ }

  return clips.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ============================================================
// 核心 API: 播放列表管理
// ============================================================

/**
 * 创建播放列表
 */
export async function createPlaylist(
  name: string,
  roomId: number | null,
  clips: StreamClip[]
): Promise<Playlist> {
  await ensureDirs()
  const id = uid()
  const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0)

  const playlist: Playlist = { id, name, roomId, clips, totalDuration, createdAt: new Date().toISOString() }
  await savePlaylist(playlist)
  return playlist
}

/**
 * 获取播放列表
 */
export async function getPlaylist(id: string): Promise<Playlist | null> {
  return await loadPlaylist(id)
}

/**
 * 列出所有播放列表
 */
export async function listPlaylists(): Promise<Playlist[]> {
  try {
    const files = await readdir(PLAYLISTS_DIR)
    const lists: Playlist[] = []
    for (const f of files.filter(f => f.startsWith('playlist_') && f.endsWith('.json'))) {
      try {
        const raw = await readFile(join(PLAYLISTS_DIR, f), 'utf-8')
        lists.push(JSON.parse(raw))
      } catch { /* skip */ }
    }
    return lists.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

/**
 * 打乱播放列表顺序 (每次开播前调用以实现反检测)
 */
export async function shufflePlaylist(playlistId: string): Promise<Playlist> {
  const pl = await loadPlaylist(playlistId)
  if (!pl) throw new Error(`播放列表 ${playlistId} 不存在`)

  // Fisher-Yates shuffle
  for (let i = pl.clips.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pl.clips[i], pl.clips[j]] = [pl.clips[j], pl.clips[i]]
  }
  await savePlaylist(pl)
  return pl
}

// ============================================================
// 内部工具函数
// ============================================================

/**
 * 构建 FFmpeg concat 输入文件
 */
async function buildConcatFile(clips: StreamClip[]): Promise<string> {
  const concatContent = clips.map(c => `file '${c.filePath}'`).join('\n')
  const concatPath = join(STREAM_DIR, `concat_${uid()}.txt`)
  await writeFile(concatPath, concatContent)
  return concatPath
}

/**
 * 构建 FFmpeg 命令行参数
 */
function buildFFmpegArgs(inputPath: string, cfg: Required<Omit<StreamConfig, 'rtmpUrl'>>): string[] {
  const args = [
    '-re',                    // 以原始帧率读取 (模拟实时)
    '-f', 'concat',           // concat demuxer
    '-safe', '0',             // 允许不安全路径
    '-i', inputPath,           // concat 输入文件
  ]

  // 反检测微变速
  if (cfg.antiDetectSpeedVary) {
    const factor = cfg.speedRange[0] + Math.random() * (cfg.speedRange[1] - cfg.speedRange[0])
    args.push('-filter_complex', `[0:v]setPTS=PTS*${factor.toFixed(4)}[v];[0:a]atempo=${factor.toFixed(4)}[a]`)
    args.push('-map', '[v]', '-map', '[a]')
  }

  // 视频编码
  args.push(
    '-c:v', 'libx264',
    '-preset', 'fast',        // 编码速度 vs 压缩比平衡
    '-b:v', `${cfg.videoBitrate}`,
    '-maxrate', `${Math.floor(cfg.videoBitrate * 1.078)}`,  // +7.8%
    '-buf_size', `${Math.floor(cfg.videoBitrate * 1.333)}`,  // 133% buffer
    '-g', `${cfg.fps * 2}`,     // GOP = 2秒 (关键帧间隔)
    '-r', String(cfg.fps),
  )

  // 分辨率缩放 (如需要)
  if (cfg.resolution) {
    const [w, h] = cfg.resolution.split('x')
    args.push('-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`)
  }

  // 音频编码
  args.push(
    '-c:a', 'aac',
    '-b:a', `${cfg.audioBitrate}`,
    '-ar', '44100',
  )

  // 输出
  args.push('-f', 'flv', cfg.rtmpUrl)

  return args
}

/**
 * 轮询数字人任务结果
 */
async function pollDHResult(taskId: string, maxAttempts: number, intervalMs = 2000): Promise<{
  videoUrl?: string
  status: string
} | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs))
    const result = await queryDigitalHumanTask(taskId)
    if (!result) continue
    if (result.status === 'SUCCEEDED') {
      return { videoUrl: result.videoUrl, status: result.status }
    }
    if (result.status === 'FAILED') {
      return null
    }
    // PENDING / RUNNING 继续
  }
  return null
}

/**
 * 下载文件到本地
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`下载失败: ${resp.status}`)
  const buffer = Buffer.from(await resp.arrayBuffer())
  await writeFile(destPath, buffer)
}

/**
 * 构建话术生成 Prompt
 */
function buildScriptPrompt(
  products: Array<{ name: string; price: string; features: string[] }>,
  types: string[],
  tone: string
): string {
  const productSection = products.length > 0
    ? `\n\n商品信息:\n${products.map((p, i) =>
        `${i + 1}. ${p.name} (¥${p.price}) — 特点: ${p.features.join(', ')}`
      ).join('\n')}`
    : ''

  return `你是一个专业的电商直播话术师。请根据以下要求生成直播话术。

品牌调性: ${tone}
需要的话术类型: ${types.join(', ')}${productSection}

请严格按以下 JSON 格式返回（不要加任何其他文字）:
{
  "welcome": ["欢迎语1（15-20秒）", "欢迎语2"],
  "product_intro": [
    {"text": "产品介绍文案1（30-60秒）", "productName": "对应商品名"},
    {"text": "产品介绍文案2", "productName": "对应商品名"}
  ],
  "qa": [
    {"q": "常见问题", "a": "回答（10-20秒）"}
  ],
  "hard_sell": ["逼单话术1（15-30秒）"],
  "close": ["结束话术1（10-15秒）"]
}

注意:
- 每段话术适合口播朗读，自然口语化
- 产品介绍要包含价格和卖点
- QA 回答要有亲和力
- hard_sell 要有紧迫感但不夸张`
}

/**
 * 从 LLM 输出解析话术
 */
function parseScriptsFromJSON(jsonStr: string, types: string[]): Array<{ text: string; type: string }> {
  try {
    // 尝试直接解析
    const parsed = JSON.parse(jsonStr)
    const result: Array<{ text: string; type: string }> = []

    for (const type of types) {
      const items = parsed[type]
      if (!items) continue
      if (Array.isArray(items)) {
        for (const item of items) {
          if (typeof item === 'string') {
            result.push({ text: item, type })
          } else if (typeof item === 'object' && item.text) {
            result.push({ text: item.text, type })
            if (item.q && item.a) {
              result.push({ text: `问：${item.q}\n答：${item.a}`, type })
            }
          }
        }
      }
    }
    return result
  } catch {
    // 如果不是有效 JSON，尝试逐行提取
    return jsonStr.split('\n')
      .filter(line => line.trim().length > 5)
      .map(line => ({ text: line.trim(), type: 'product_intro' }))
  }
}
