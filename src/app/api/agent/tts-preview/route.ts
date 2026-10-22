/**
 * ★VF_VOICE_PICK_V1（2026-10-22 用户定案「配音不能选」）—— 卡片上的「▶ 试听」接口。
 * =============================================================================
 * 为什么要有它：音色有 **48 个**，光看"御姐音/糯米糍"这种描述根本选不出来，必须能**听一句**。
 *
 * 口径：
 *   · 只合成 **≤60 字**（试听不需要整段，省钱也快；卡片默认送第一句口播）；
 *   · 音色走 `tts-voices.ts` 白名单（非法 id ⇒ Cherry，**绝不把非法 id 发出去** ⇒ 阿里 400）；
 *   · 直接返回 `data:audio/mpeg;base64,…`（**不入库、不落盘**）：
 *     30 字一次的成本可以忽略，做成"每次都真合成"比"再做一层缓存+清理"更简单、也永远不过期；
 *     ⚠️ 不要把它写进个人仓库 —— 那会吃掉用户的 450MB 配额，还会在素材列表里多出垃圾。
 *   · 没配 key / 合成失败 ⇒ **如实 500 + 原因**（不返回空音频让前端干等）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { ttsPreviewBuffer } from '@/lib/ai-providers'
import { normTtsVoice, ttsVoiceName } from '@/lib/agent/vf/tts-voices'

export const runtime = 'nodejs'
/** 试听要调外部 TTS ⇒ 给足时间（默认 10s 容易在弱网/排队时被砍） */
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  let body: any = {}
  try { body = await request.json() } catch { /* 空体按下面校验报错 */ }
  // ★不信任前端：长度在这里再夹一次（前端已限 60，但接口是公开可调的）
  const text = String(body?.text || '').trim().slice(0, 60)
  if (!text) return NextResponse.json({ success: false, message: '要试听的内容是空的' }, { status: 400 })

  const voice = normTtsVoice(body?.voice)
  try {
    const buf = await ttsPreviewBuffer(text, voice)
    if (!buf || buf.byteLength < 512) {
      return NextResponse.json({
        success: false,
        message: '试听合成失败（服务端未配 DASHSCOPE_API_KEY 或模型暂时不通）',
      }, { status: 500 })
    }
    return NextResponse.json({
      success: true,
      voice,
      voiceName: ttsVoiceName(voice),
      kb: Math.round(buf.byteLength / 1024),
      dataUrl: 'data:audio/mpeg;base64,' + Buffer.from(buf).toString('base64'),
    })
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      message: '试听异常：' + String(e?.message || e).slice(0, 160),
    }, { status: 500 })
  }
}
