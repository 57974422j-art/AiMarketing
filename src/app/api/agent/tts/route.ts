import { NextRequest, NextResponse } from 'next/server'
import { volcanoTTS } from '@/lib/ai-providers'

// AGENT 语音朗读：封装火山 TTS（后台已配置 VOLCANO_TTS_* 环境变量）
// 返回 mp3 音频（ArrayBuffer 转 base64 以便前端直接播放）
export async function POST(request: NextRequest) {
  try {
    const { text, voice } = await request.json()
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ success: false, message: '缺少文本' }, { status: 400 })
    }
    // TTS 单条不宜过长，截断到 500 字（与现有 tts 路由一致）
    const clean = text.replace(/\n+/g, '。').slice(0, 500)
    const audio = await volcanoTTS(clean, voice || 'zh_female_vv_uranus_bigtts')
    if (!audio || audio.byteLength < 1000) {
      return NextResponse.json({ success: false, message: 'TTS 合成失败（可能未配置火山 TTS）' }, { status: 500 })
    }
    const base64 = Buffer.from(audio).toString('base64')
    return NextResponse.json({
      success: true,
      audioBase64: base64,
      mime: 'audio/mpeg',
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
