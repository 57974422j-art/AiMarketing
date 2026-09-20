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
    // ★VF_VOICE_V1（2026-09-20）：克隆音色存服务端（AgentMemory，tag=voice_clone）
    //   背景：数字人页的克隆只存了 localStorage.dh_voice_id → 服务端成片拿不到
    let voiceClone: any = null
    try {
      const vc = await prisma.agentMemory.findFirst({ where: { userId: String(auth.userId), tags: { contains: 'voice_clone' } }, orderBy: { updatedAt: 'desc' } })
      if (vc?.content) voiceClone = JSON.parse(String(vc.content).replace(/^声音克隆:/, ''))
    } catch {}
    return NextResponse.json({
      success: true,
      data: {
        ttsVoice: u?.agentTtsVoice || 'longxiaochun',
        industry: u?.industry || '',
        temperature: u?.agentTemperature ?? 0.7,
        vadThreshold: u?.agentVadThreshold ?? 0.045,
        vadSilence: u?.agentVadSilence ?? 1800,
        voices: TTS_VOICES,
        voiceClone,
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
    if (typeof body.industry === 'string') data.industry = ['餐饮', '美业', '教育', '电商', '房产', '健身', '旅游', '服装'].includes(body.industry) ? body.industry : undefined
    const u = await prisma.user.update({ where: { id: auth.userId }, data })
    // ★VF_VOICE_V1：保存克隆音色（{id,name}）→ AgentMemory（服务端成片也能用）
    try {
      const vc = body.voiceClone
      if (!vc || typeof vc.id !== 'string' || !vc.id.trim()) {
        if (body.voiceClone === null) await prisma.agentMemory.deleteMany({ where: { userId: String(auth.userId), tags: { contains: 'voice_clone' } } })
      } else {
        const content = '声音克隆:' + JSON.stringify({ id: String(vc.id).trim().slice(0, 80), name: String(vc.name || '我的克隆音色').trim().slice(0, 40), at: Date.now() })
        const ex = await prisma.agentMemory.findFirst({ where: { userId: String(auth.userId), tags: { contains: 'voice_clone' } } })
        if (ex) await prisma.agentMemory.update({ where: { id: ex.id }, data: { content } })
        else await prisma.agentMemory.create({ data: { userId: String(auth.userId), content, tags: 'voice_clone', salience: 0.6 } })
      }
    } catch (eVC: any) { console.error('[prefs] 保存克隆音色失败:', eVC?.message || eVC) }
    return NextResponse.json({
      success: true,
      data: {
        ttsVoice: u.agentTtsVoice || 'longxiaochun',
        industry: u.industry || '',
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
