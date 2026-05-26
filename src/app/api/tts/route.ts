import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

// 使用火山引擎 TTS（配了就用），否则用 edge-tts（免费无需Key）
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

    const voiceName = VOICE_MAP[voice] || 'zh-CN-XiaoxiaoNeural'
    ensureDir()
    const filename = `${voice}_${Buffer.from(text.slice(0, 20)).toString('base64url')}.mp3`
    const outputPath = path.join(TTS_DIR, filename)
    const publicUrl = `/tts/${filename}`

    // 如果已存在直接返回
    if (fs.existsSync(outputPath)) {
      return NextResponse.json({ success: true, audioUrl: publicUrl })
    }

    // 用 edge-tts（免费，不需要 API Key）
    try {
      execSync(`edge-tts --voice "${voiceName}" --text "${text.slice(0, 300)}" --write-media "${outputPath}"`, { timeout: 30000 })
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
        return NextResponse.json({ success: true, audioUrl: publicUrl })
      }
    } catch (e) {
      console.error('[TTS] edge-tts failed, trying volcano...')
    }

    // 备用：火山引擎 TTS（需配 Key）
    const appId = process.env.TTS_APP_ID
    const accessKey = process.env.TTS_ACCESS_KEY
    if (appId && accessKey) {
      const res = await fetch('https://openspeech.bytedance.com/api/v1/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer;${accessKey}` },
        body: JSON.stringify({
          app: { appid: appId },
          user: { uid: '1' },
          request: { text, voice_type: voice, operation: 'query', audio_format: 'mp3' },
        }),
      })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        fs.writeFileSync(outputPath, buf)
        return NextResponse.json({ success: true, audioUrl: publicUrl })
      }
    }

    return NextResponse.json({ success: false, message: 'TTS失败，请安装 edge-tts: pip install edge-tts' }, { status: 500 })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message })
  }
}
