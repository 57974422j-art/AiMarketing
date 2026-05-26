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

    const voiceName = VOICE_MAP[voice] || 'zh-CN-XiaoxiaoNeural'
    ensureDir()

    const hash = crypto.createHash('md5').update(text + voice).digest('hex').slice(0, 12)
    const filename = `${hash}.mp3`
    const outputPath = path.join(TTS_DIR, filename)
    const publicUrl = `/tts/${filename}`

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      return NextResponse.json({ success: true, audioUrl: publicUrl })
    }

    // Use Python directly to call edge_tts - avoids all shell escaping
    const pyFile = outputPath + '.py'
    const safeText = text.replace(/"/g, '\\"').replace(/`/g, '').replace(/\$/g, '')
    const pyCode = `import asyncio, edge_tts
async def main():
    t = edge_tts.Communicate("${safeText}", "${voiceName}")
    await t.save("${outputPath}")
asyncio.run(main())`
    fs.writeFileSync(pyFile, pyCode, 'utf-8')
    execSync(`python3 ${pyFile}`, { timeout: 30000 })
    fs.unlinkSync(pyFile)

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
      return NextResponse.json({ success: false, message: 'TTS文件无效' }, { status: 500 })
    }

    return NextResponse.json({ success: true, audioUrl: publicUrl })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message })
  }
}
