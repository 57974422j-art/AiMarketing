/**
 * FunASR 语音识别服务
 * 通过 Node.js child_process.execFile 调用 Python 脚本
 * 支持服务器（Linux）和本地（Windows）双路径自动检测
 * 返回含单词级时间戳和说话人标签的识别结果
 */

import { join } from 'path'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** FunASR 返回的句子级识别结果 */
export interface FunasrSentence {
  text: string
  start: number   // 开始时间（秒）
  end: number     // 结束时间（秒）
  speaker: string // 说话人标签，如 "SPEAKER_00"
}

/** FunASR 返回的完整结果 */
export interface FunasrResult {
  success: boolean
  text: string           // 完整识别文本
  error?: string
  sentences: FunasrSentence[]  // 句子级结果（含时间戳和说话人）
  words?: [number, number][]   // 单词级时间戳
  timestamp?: [number, number][] // 时间戳（与每个词对应）
  speaker_count?: number
  speakers?: string[]
}

/** 自动检测脚本路径：统一使用项目目录下的 scripts/funasr_asr.py */
function getScriptPath(): string {
  const envPath = process.env.FUNASR_SCRIPT_PATH
  if (envPath) return envPath
  return join(process.cwd(), 'scripts', 'funasr_asr.py')
}

/** 自动检测 Python 路径 */
function getPythonPath(): string {
  const envPath = process.env.PYTHON_PATH
  if (envPath) return envPath

  if (process.platform === 'win32') {
    return 'python'
  }
  return 'python3'
}

/**
 * 调用 FunASR Python 脚本进行语音识别
 * @param audioPath - 音频文件路径（WAV, 16kHz, 单声道）
 * @returns 识别结果（含单词级时间戳和说话人标签）
 */
export async function recognizeWithFunasr(audioPath: string): Promise<FunasrResult> {
  const scriptPath = getScriptPath()
  const pythonPath = getPythonPath()

  console.log(`[FunASR] 平台: ${process.platform}, Python: ${pythonPath}, 脚本: ${scriptPath}`)
  console.log(`[FunASR] 音频文件: ${audioPath}`)

  if (!existsSync(scriptPath)) {
    const err = `FunASR 脚本不存在: ${scriptPath}`
    console.error(`[FunASR] ${err}`)
    return { success: false, text: '', error: err, sentences: [] }
  }

  try {
    const { stdout, stderr } = await execFileAsync(pythonPath, [scriptPath, audioPath], {
      timeout: 300000, // 5 分钟超时
      maxBuffer: 10 * 1024 * 1024, // 10MB 缓冲区
    })

    if (stderr && stderr.length > 0) {
      console.warn(`[FunASR] stderr:`, stderr.substring(0, 500))
    }

    const result: FunasrResult = JSON.parse(stdout.trim())

    if (!result.success) {
      console.error(`[FunASR] 识别失败:`, result.error)
      return result
    }

    console.log(`[FunASR] 成功: 文本=${result.text.length}字, 句子=${result.sentences?.length || 0}`)
    if (result.speakers && result.speakers.length > 0) {
      console.log(`[FunASR] 说话人: ${result.speakers.join(', ')}`)
    }

    return result
  } catch (error: any) {
    console.error(`[FunASR] 调用失败:`, error.message || error)
    return {
      success: false,
      text: '',
      error: error.message || 'FunASR 调用异常',
      sentences: [],
    }
  }
}
