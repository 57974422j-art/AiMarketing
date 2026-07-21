import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { ttsQwen3 } from '@/lib/qwen3-tts'

const TTS_DIR = '/root/AiMarketing/public/tts'
function ensureDir() { if (!fs.existsSync(TTS_DIR)) fs.mkdirSync(TTS_DIR, { recursive: true }) }

export async function POST(request: NextRequest) {
  try {
    const { text, voice } = await request.json()
    if (!text) return NextResponse.json({ success: false, message: '缺少文本' }, { status: 400 })

    ensureDir()
    const hash = crypto.createHash('md5').update(text + voice).digest('hex').slice(0, 12)
    const filename = hash + '.mp3'
    const outputPath = path.join(TTS_DIR, filename)
    const publicUrl = '/tts/' + filename

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      return NextResponse.json({ success: true, audioUrl: publicUrl })
    }

    // Qwen3 TTS 优先，失败自动降级火山 TTS（均国内可达，替代被墙的微软 edge-tts）
    const tmpDir = path.join(TTS_DIR, 'tmp_' + hash)
    fs.mkdirSync(tmpDir, { recursive: true })
    try {
      const r = await ttsQwen3(text.replace(/\n/g, ' ').slice(0, 500), voice, tmpDir, 0)
      if (!r.ok || !fs.existsSync(r.path) || fs.statSync(r.path).size < 1000) {
        throw new Error('TTS合成失败')
      }
      fs.copyFileSync(r.path, outputPath)
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    }

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
      return NextResponse.json({ success: false, message: 'TTS失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true, audioUrl: publicUrl })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message })
  }
}
