import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'
import { recognizeWithFunasr } from '@/lib/funasr-service'

// AGENT 语音输入：接收浏览器录制的音频文件 → 本地 FunASR 转写 → 返回文本
// 复用现有 src/lib/funasr-service.ts（调用 scripts/funasr_asr.py）
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('audio') as File | null
    if (!file) return NextResponse.json({ success: false, message: '缺少音频' }, { status: 400 })

    const tmpDir = path.join(os.tmpdir(), 'agent-asr-' + crypto.randomBytes(4).toString('hex'))
    fs.mkdirSync(tmpDir, { recursive: true })
    const ext = (file.name.split('.').pop() || 'webm').split('?')[0]
    const rawPath = path.join(tmpDir, 'input.' + ext)
    const buf = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(rawPath, buf)

    // FunASR 需要 wav(16k 单声道)；非 wav 用 ffmpeg 转一下（若存在）
    let wavPath = rawPath
    if (ext !== 'wav') {
      const converted = path.join(tmpDir, 'input.wav')
      try {
        const { execFileSync } = require('child_process')
        execFileSync('ffmpeg', ['-y', '-i', rawPath, '-ar', '16000', '-ac', '1', '-f', 'wav', converted], { timeout: 30000 })
        if (fs.existsSync(converted) && fs.statSync(converted).size > 1000) wavPath = converted
      } catch {
        // ffmpeg 不可用则直接用原文件尝试（FunASR 也可能支持）
      }
    }

    const result = await recognizeWithFunasr(wavPath)
    // 清理临时目录
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}

    if (!result.success) {
      return NextResponse.json({ success: false, message: result.error || '识别失败' }, { status: 500 })
    }
    return NextResponse.json({ success: true, text: result.text })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
