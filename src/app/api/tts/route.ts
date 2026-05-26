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
    const filename = hash + '.mp3'
    const outputPath = path.join(TTS_DIR, filename)
    const publicUrl = '/tts/' + filename

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      return NextResponse.json({ success: true, audioUrl: publicUrl })
    }

    // Write Python script as temp file to call edge_tts
    const pyFile = outputPath + '.py'
    const textFile = outputPath + '.txt'
    fs.writeFileSync(textFile, text, 'utf8')

    const pyCode = [
      'import asyncio, sys',
      'import edge_tts',
      'async def main():',
      '    with open(sys.argv[1], "r", encoding="utf-8") as f:',
      '        t = f.read()',
      '    await edge_tts.Communicate(t, sys.argv[2]).save(sys.argv[3])',
      'asyncio.run(main())',
    ].join('\n')

    fs.writeFileSync(pyFile, pyCode, 'utf8')
    execSync('python3 ' + pyFile + ' ' + textFile + ' ' + voiceName + ' ' + outputPath, { timeout: 30000 })
    try { fs.unlinkSync(pyFile); fs.unlinkSync(textFile) } catch {}

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
      return NextResponse.json({ success: false, message: 'TTS失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true, audioUrl: publicUrl })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message })
  }
}
