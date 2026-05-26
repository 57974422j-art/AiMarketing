import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

const TTS_DIR = '/root/AiMarketing/public/tts'
function ensureDir() { if (!fs.existsSync(TTS_DIR)) fs.mkdirSync(TTS_DIR, { recursive: true }) }

const VOICE_MAP: Record<string, string> = {
  'zh_female_vv_uranus_bigtts': 'zh-CN-XiaoxiaoNeural',
  'zh_female_vv_aurora_bigtts': 'zh-CN-XiaoyiNeural',
  'zh_male_fengge_bigtts': 'zh-CN-YunxiNeural',
  'zh_male_xiaoming_bigtts': 'zh-CN-YunyangNeural',
}

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

    // Write text to temp file, then use edge-tts via piped stdin
    const textFile = outputPath + '.txt'
    fs.writeFileSync(textFile, text.replace(/\n/g, ' ').slice(0, 500), 'utf8')
    execSync('edge-tts --voice ' + voiceName + ' --text "$(cat ' + textFile + ')" --write-media ' + outputPath, { timeout: 30000, shell: '/bin/bash' })
    try { fs.unlinkSync(textFile) } catch {}

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
      return NextResponse.json({ success: false, message: 'TTS失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true, audioUrl: publicUrl })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message })
  }
}
