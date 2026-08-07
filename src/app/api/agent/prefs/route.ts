import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

// 百炼 CosyVoice 音色（与 textToSpeech 一致）
export const TTS_VOICES = [
  { id: 'longxiaochun', label: '龙小淳（女声，温柔，默认）' },
  { id: 'longxiaoxia', label: '龙小夏（女声，清亮）' },
  { id: 'cherry', label: '豆豆（女声，甜美）' },
  { id: 'longshu', label: '龙书（男声，沉稳）' },
  { id: 'longchen', label: '龙陈（男声，浑厚）' },
  { id: 'longjing', label: '龙靖（男声，知性）' },
  { id: 'longxiaohui', label: '龙小辉（男声，阳光）' },
]

/**
 * 用户级 AI 设置（2026-08-07）
 * GET /api/agent/prefs → { ttsVoice, temperature, vadThreshold, vadSilence }
 * PUT /api/agent/prefs → body 任意子集
 */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const u = await prisma.user.findUnique({ where: { id: auth.userId } })
    return NextResponse.json({
      success: true,
      data: {
        ttsVoice: u?.agentTtsVoice || 'longxiaochun',
        temperature: u?.agentTemperature ?? 0.7,
        vadThreshold: u?.agentVadThreshold ?? 0.045,
        vadSilence: u?.agentVadSilence ?? 1800,
        voices: TTS_VOICES,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })
  try {
    const body = await request.json()
    const data: any = {}
    if (typeof body.ttsVoice === 'string') data.agentTtsVoice = body.ttsVoice.slice(0, 40)
    if (typeof body.temperature === 'number') data.agentTemperature = Math.min(1.5, Math.max(0, body.temperature))
    if (typeof body.vadThreshold === 'number') data.agentVadThreshold = Math.min(0.15, Math.max(0.01, body.vadThreshold))
    if (typeof body.vadSilence === 'number') data.agentVadSilence = Math.min(4000, Math.max(1000, Math.round(body.vadSilence)))
    const u = await prisma.user.update({ where: { id: auth.userId }, data })
    return NextResponse.json({
      success: true,
      data: {
        ttsVoice: u.agentTtsVoice || 'longxiaochun',
        temperature: u.agentTemperature ?? 0.7,
        vadThreshold: u.agentVadThreshold ?? 0.045,
        vadSilence: u.agentVadSilence ?? 1800,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
