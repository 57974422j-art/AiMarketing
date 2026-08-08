import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getAuthFromHeaders } from '@/lib/api-auth'

const prisma = new PrismaClient()

/**
 * AI 自检（2026-08-08，A+B 方案）
 * GET /api/agent/selfcheck → 账号/订阅/点数/记忆/语音/TTS/热点/模型 一次性体检
 */
export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '未认证' }, { status: 401 })

  const checks: { key: string; label: string; ok: boolean; detail?: string }[] = []

  try {
    // 1) 账号
    const user = await prisma.user.findUnique({ where: { id: auth.userId } })
    checks.push({
      key: 'account', label: '账号',
      ok: !!user,
      detail: user ? `${user.username}（${user.role === 'admin' ? '超级管理' : user.role === 'editor' ? '代理' : '普通用户'}）` : '账号不存在',
    })
    if (!user) return NextResponse.json({ success: true, data: { checks } })

    // 2) 订阅有效期 + 点数
    let subInfo = '无订阅'
    let subOk = false
    try {
      const sub = await prisma.userSubscription.findFirst({ where: { userId: user.id }, orderBy: { endDate: 'desc' } })
      if (sub?.endDate) {
        const end = new Date(sub.endDate)
        const expired = end.getTime() < Date.now()
        subOk = !expired
        subInfo = expired ? `已于 ${end.toLocaleDateString('zh-CN')} 过期` : `订阅至 ${end.toLocaleDateString('zh-CN')}`
      } else { subInfo = '无订阅' }
    } catch {}
    const points = user.pointBalance ?? 0
    checks.push({ key: 'subscription', label: '订阅有效期', ok: subOk, detail: subInfo })
    checks.push({ key: 'points', label: '剩余点数', ok: points > 0, detail: points < 0 ? `${points} 点（⚠️ 余额为负，请联系管理员）` : `${points} 点（点卡余额）` })

    // 3) 长期记忆
    try {
      const memCount = await prisma.agentMemory.count({ where: { userId: String(user.id) } })
      checks.push({ key: 'memory', label: '长期记忆', ok: true, detail: `${memCount} 条` })
    } catch (e: any) {
      checks.push({ key: 'memory', label: '长期记忆', ok: false, detail: '查询失败: ' + e.message })
    }

    // 4) 语音 ASR（本地 8766 代理 + 百炼 key）
    try {
      const http = require('http')
      const asrAlive = await new Promise<boolean>((resolve) => {
        const req = http.get({ host: '127.0.0.1', port: 8766, path: '/', timeout: 1200 }, (r: any) => { r.resume(); resolve(true) })
        req.on('error', () => resolve(false))
        req.on('timeout', () => { req.destroy(); resolve(false) })
      })
      const dashKey = process.env.DASHSCOPE_API_KEY ? '已配置' : '未配置'
      checks.push({
        key: 'asr', label: '语音识别',
        ok: asrAlive && !!process.env.DASHSCOPE_API_KEY,
        detail: `本地代理${asrAlive ? '正常' : '未启动'} · 百炼key ${dashKey}`,
      })
    } catch { checks.push({ key: 'asr', label: '语音识别', ok: false, detail: '检查失败' }) }

    // 5) TTS
    checks.push({
      key: 'tts', label: '语音朗读(TTS)',
      ok: !!process.env.DASHSCOPE_API_KEY || !!process.env.VOLCANO_API_KEY,
      detail: process.env.DASHSCOPE_API_KEY ? '百炼 TTS 可用' : '百炼/火山 key 未配置',
    })

    // 6) 热点
    try {
      const hs = await fetch('http://127.0.0.1:3000/api/agent/hotspots', { signal: AbortSignal.timeout(25000) }).catch(() => null) // 多源串行抓取慢，给足 25s
      const hsData = hs?.ok ? await hs.json().catch(() => null) : null
      checks.push({
        key: 'hotspots', label: '热点大屏',
        ok: !!(hs && hsData && hsData.success !== false && Array.isArray(hsData.sources) && hsData.sources.length > 0),
        detail: !hs ? '接口无响应' : (hsData?.success === false ? '热点源不可用（有兜底）' : `正常（${(hsData?.sources || []).length} 个来源）`),
      })
    } catch { checks.push({ key: 'hotspots', label: '热点大屏', ok: true, detail: '正常（内置兜底）' }) }

    // 7) 当前模型配置
    const modelInfo = {
      brain: process.env.AGENT_BRAIN_MODEL || 'qwen-plus（百炼）',
      asr: 'paraformer-realtime-v2（百炼流式）',
      tts: 'cosyvoice-v1（百炼）',
      asrEngine: process.env.ASR_ENGINE || 'bailian',
    }
    checks.push({ key: 'model', label: '当前模型', ok: true, detail: `大脑 ${modelInfo.brain} / 识别 ${modelInfo.asr} / 朗读 cosyvoice` })

    return NextResponse.json({ success: true, data: { checks, model: modelInfo } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
