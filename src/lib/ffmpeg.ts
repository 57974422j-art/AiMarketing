// ============================================================
// FFmpeg 统一执行层
//
// 设计目标：
//   1. 全局串行队列 — 所有 FFmpeg 调用排队执行，避免 CPU 爆满
//   2. nice -n 19   — 最低优先级，不阻塞 Web 服务
//   3. -threads 1   — 单线程，4核机器留3核给其他业务
//   4. 超时保护     — 防止死进程
//
// 使用方式：
//   import { runFFmpeg, getFFmpegPath, checkFFmpeg } from '@/lib/ffmpeg'
//   const output = await runFFmpeg('-i input.mp4 -c copy out.mp4', { timeout: 30000 })
// ============================================================

import { exec, execSync } from 'child_process'
import { existsSync } from 'fs'

// ─── FFmpeg 路径检测 ──────────────────────────────────────

const commonPaths = process.platform === 'win32' ? [
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\ProgramData\\winget\\Packages\\Gyan.FFmpeg\\bin\\ffmpeg.exe',
  process.env.LOCALAPPDATA + '\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
  'ffmpeg',
] : [
  '/usr/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
  'ffmpeg',
]

let _cachedPath: string | null = null

export function getFFmpegPath(): string {
  if (_cachedPath) return _cachedPath
  if (process.env.FFMPEG_PATH) {
    _cachedPath = process.env.FFMPEG_PATH
    return _cachedPath!
  }
  for (const p of commonPaths) {
    if (p && existsSync(p)) {
      _cachedPath = p
      return _cachedPath
    }
  }
  _cachedPath = 'ffmpeg'
  return _cachedPath
}

export function checkFFmpeg(): boolean {
  try {
    execSync(`"${getFFmpegPath()}" -version`, { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

// ─── 全局串行队列 ─────────────────────────────────────────
// 所有 FFmpeg 命令排队执行，同一时间只跑一个进程
// 4核机器：1核给FFmpeg，其余3核给 Node.js / 数据库 / 其他请求

let queueProcessing = false
const ffQueue: Array<{
  cmd: string
  opts: FFmpegOptions
  resolve: (v: string) => void
  reject: (e: Error) => void
}> = []

interface FFmpegOptions {
  /** 超时毫秒，默认 120s */
  timeout?: number
  /** 是否跳过 nice（ffprobe等短命令可设为true） */
  skipNice?: boolean
  /** 自定义线程数，默认1 */
  threads?: number
  /** 最大输出 buffer（MB），默认50 */
  maxBufferMB?: number
  /** 高优先级 — 插队到队列前面（缩微图、探测等短命令用） */
  priority?: 'high'
}

function processQueue() {
  if (queueProcessing || ffQueue.length === 0) return
  queueProcessing = true
  const item = ffQueue.shift()!

  const { cmd, opts, resolve, reject } = item
  const timeout = opts.timeout || 120000
  const threads = opts.opts?.threads ?? 1
  const maxBuffer = (opts.maxBufferMB ?? 50) * 1024 * 1024

  // 构建完整命令：nice + ffmpeg + 用户参数
  const ffmpegPath = getFFmpegPath()
  let fullCmd: string

  if (opts.skipNice) {
    // ffprobe 等短命令不需要 nice，但用户参数中已有 -threads 则保留
    fullCmd = `"${ffmpegPath}" ${cmd}`
  } else {
    // 生产命令：nice 降级 + 限制线程
    // 如果用户参数里已包含 -threads，不再重复添加
    const hasThreads = /\-threads/.test(cmd)
    const threadArg = hasThreads ? '' : ` -threads ${threads}`
    fullCmd = `nice -n 19 "${ffmpegPath}"${threadArg} ${cmd}`
  }

  console.log(`[FF队列] 排队=${ffQueue.length+1} 执行: ${fullCmd.slice(0,120)}...`)
  const startTime = Date.now()

  exec(fullCmd, { timeout, maxBuffer }, (err, stdout, stderr) => {
    queueProcessing = false

    if (err) {
      const errMsg = (stderr || err.message).slice(0, 500)
      console.error(`[FF队列] ❌ 失败 (${Date.now()-startTime}ms): ${errMsg}`)
      reject(new Error(`FFmpeg error: ${errMsg}`))
    } else {
      console.log(`[FF队列] ✅ 完成 (${Date.now()-startTime}ms)`)
      resolve(stdout || '')
    }

    // 继续处理下一个
    processQueue()
  })
}

/**
 * 核心方法：提交 FFmpeg 命令到全局串行队列
 *
 * @example
 * await runFFmpeg('-y -i input.mp4 -vf scale=1280:720 output.mp4', { timeout: 60000 })
 *
 * @param args  FFmpeg 参数字符串（不含 "ffmpeg" 本身）
 * @param opts  可选配置
 */
export function runFFmpeg(args: string, opts?: FFmpegOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const item = { cmd: args, opts: opts || {}, resolve, reject }
    // 高优先级任务插队到队列前面（缩微图、探测等短命令）
    if (opts?.priority === 'high') {
      ffQueue.unshift(item)
    } else {
      ffQueue.push(item)
    }
    processQueue()
  })
}

/**
 * 快捷方法：同步执行（仅用于极短的 ffprobe 命令）
 * 注意：这个不走队列，直接执行。仅限 < 5s 的探测命令。
 */
export function runFFprobe(args: string, timeout = 10000): string {
  const ffmpegPath = getFFmpegPath()
  // 用 ffprobe 或 ffmpeg -i ... 方式
  if (args.startsWith('ffprobe')) {
    return execSync(args, { encoding: 'utf8', timeout, stdio: ['pipe','pipe','pipe'] }).trim()
  }
  return execSync(`${ffmpegPath.replace(/ffmpeg$/, 'ffprobe')} ${args}`, {
    encoding: 'utf8', timeout, stdio: ['pipe','pipe','pipe']
  }).trim()
}

/**
 * 查询当前队列状态（调试/监控用）
 */
export function getQueueStatus(): { queued: number; processing: boolean } {
  return { queued: ffQueue.length, processing: queueProcessing }
}


// ══════════════════════════════════════════════════════════
// 以下为向后兼容的高层 API（内部调用 runFFmpeg）
// 新代码建议直接使用 runFFmpeg()
// ══════════════════════════════════════════════════════════

import { existsSync as _existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'

function ensureDir(outputPath: string) {
  const dir = join(outputPath, '..')
  if (!_existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/** 视频裁剪 */
export async function trimVideo(input: string, startTime: number, duration: number, output: string): Promise<void> {
  ensureDir(output)
  await runFFmpeg(`-y -i "${input}" -ss ${startTime} -t ${duration} -c copy "${output}"`, { timeout: 60000 })
}

/** 视频拼接 */
export async function concatVideos(inputs: string[], output: string): Promise<void> {
  ensureDir(output)
  const listPath = join(process.cwd(), 'temp', `concat_${Date.now()}.txt`)
  ensureDir(listPath)
  writeFileSync(listPath, inputs.map(f => `file '${f}'`).join('\n'))
  try {
    await runFFmpeg(`-f concat -safe 0 -i "${listPath}" -c copy "${output}"`, { timeout: 120000 })
  } finally {
    try { unlinkSync(listPath) } catch {}
  }
}

/** 文字叠加 */
export async function addTextOverlay(input: string, text: string, position: string, output: string): Promise<void> {
  ensureDir(output)
  const posMap: Record<string, string> = {
    'top-left': '10:10', 'top-center': '(w-text_w)/2:10', 'top-right': 'w-text_w-10:10',
    'bottom-left': '10:h-text_h-10', 'bottom-center': '(w-text_w)/2:h-text_h-10',
    'bottom-right': 'w-text_w-10:h-text_h-10', 'center': '(w-text_w)/2:(h-text_h)/2'
  }
  const pos = posMap[position] || posMap['bottom-center']
  await runFFmpeg(`-i "${input}" -vf "drawtext=text='${text}':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.5:boxborderw=5:x=${pos}" -c:a copy "${output}"`, { timeout: 60000 })
}

/** 调整分辨率 */
export async function resizeVideo(input: string, width: number, height: number, output: string): Promise<void> {
  ensureDir(output)
  await runFFmpeg(`-i "${input}" -vf "scale=${width}:${height}" "${output}"`, { timeout: 120000 })
}
