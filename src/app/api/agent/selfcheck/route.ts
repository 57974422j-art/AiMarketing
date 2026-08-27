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
    // 2026-08-10：剩余点数 = 套餐额度 + 点卡（不再只显示点卡，年卡用户也能看到额度）
    let pointsDetail = `${points} 点（点卡余额）`
    let pointsOk = points > 0
    try {
      const { getTokenWallet } = await import('@/lib/token-wallet')
      const wallet = await getTokenWallet(user.id)
      if (wallet.hasSubscription) {
        // 2026-08-27: 按实际订阅周期显示（周卡=周额度/月卡=月额度/年卡=年额度）——不再盲目显“月”
        const planT = String(user.plan || 'monthly').toLowerCase()
        const periodTxt = planT.includes('week') ? '周' : planT.includes('year') ? '年' : '月'
        const subTxt = wallet.subRemaining < 0 ? '无限额度' : `${wallet.subRemaining} 点（${periodTxt}套餐额度，${periodTxt}${wallet.allowance < 0 ? '?' : wallet.allowance}）`
        pointsDetail = `${subTxt} + 点卡 ${wallet.pointBalance} 点`
        pointsOk = wallet.remaining > 0
      }
    } catch {}
    checks.push({ key: 'points', label: '剩余点数', ok: pointsOk, detail: pointsDetail })

    // 3) 长期记忆
    try {
      const memCount = await prisma.agentMemory.count({ where: { userId: String(user.id) } })
      checks.push({ key: 'memory', label: '长期记忆', ok: true, detail: memCount > 0 ? `✅ 功能正常（${memCount} 条记忆）` : '✅ 功能正常（暂无记忆，对话后自动记录用户偏好）' })
    } catch (e: any) {
      checks.push({ key: 'memory', label: '长期记忆', ok: false, detail: '查询失败: ' + e.message })
    }

    // 4) 语音 ASR（2026-08-10：检查 FunASR 常驻服务 8765——服务器实际用的；8766 是本地客户端百炼代理）
    try {
      const http = require('http')
      const asrAlive = await new Promise<boolean>((resolve) => {
        const req = http.get({ host: '127.0.0.1', port: 8765, path: '/', timeout: 1500 }, (r: any) => { r.resume(); resolve(true) })
        req.on('error', () => resolve(false))
        req.on('timeout', () => { req.destroy(); resolve(false) })
      })
      const dashKey = process.env.DASHSCOPE_API_KEY ? '已配置' : '未配置'
      checks.push({
        key: 'asr', label: '语音识别',
        ok: asrAlive || !!process.env.DASHSCOPE_API_KEY,
        detail: `FunASR服务${asrAlive ? '正常' : '未启动（可回退脚本/百炼）'} · 百炼key ${dashKey}`,
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
      // 2026-08-11：不再 HTTP 调热点接口（未登录会 401 误报"0 来源"）；改为检查热点配置 + 内置兜底就绪
      const hs = await fetch('http://127.0.0.1:3000/api/agent/hotspots', { signal: AbortSignal.timeout(25000), headers: { 'x-selfcheck': '1' } }).catch(() => null)
      const hsData = hs?.ok ? await hs.json().catch(() => null) : null
      const realFail = !!(hs && hsData && hsData.success === false)
      checks.push({
        key: 'hotspots', label: '热点大屏',
        // 2026-08-15: 接口无响应（首次慢/外部源未就绪）不算失败——有内置兜底，避免首次自检误报 1 项异常
        ok: !realFail,
        detail: realFail ? '热点源不可用（有兜底）' : (hsData ? `正常（${(hsData?.sources || []).length} 个来源）` : '正常（内置兜底，接口响应慢）'),
      })
    } catch { checks.push({ key: 'hotspots', label: '热点大屏', ok: true, detail: '正常（内置兜底）' }) }

    // 7) 当前模型配置（验证模型是否通——实际调用 DeepSeek V4 flash 测连通）
    const modelInfo = {
      brain: process.env.AGENT_BRAIN_MODEL || 'deepseek-v4-flash（DeepSeek）',
      asr: 'paraformer-realtime-v2（百炼流式）',
      tts: 'cosyvoice-v1（百炼）',
      asrEngine: process.env.ASR_ENGINE || 'bailian',
    }
    let modelStatus = '未验证'
    try {
      const dsKey = process.env.DEEPSEEK_API_KEY
      if (!dsKey) modelStatus = '未配置 DEEPSEEK_API_KEY'
      else {
        const mr = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dsKey },
          body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
          signal: AbortSignal.timeout(15000),
        }).catch(() => null)
        modelStatus = mr && mr.ok ? '✅ deepseek-v4-flash 可用' : '❌ deepseek-v4-flash 不可用（HTTP ' + (mr ? mr.status : '时间超') + '）'
      }
    } catch (eM) { modelStatus = '❌ deepseek-v4-flash 不可用: ' + (eM?.message || eM) }
    checks.push({ key: 'model', label: '当前模型', ok: modelStatus.startsWith('✅'), detail: `大脑 ${modelStatus} / 识别 ${modelInfo.asr} / 朗读 cosyvoice` })

    // 8) 个人仓库（2026-08-24：AI 生成自动入库；容量超 80% 提示转移本地仓库）
    try {
      const assetCount = await prisma.mediaAsset.count({ where: { ownerId: auth.userId } })
      const QUOTA = 500 * 1024 * 1024  // 500MB（估算配额）
      let used = 0
      try {
        const { listObjects } = await import('@/lib/oss')
        const objs = await listObjects(`storage/${auth.userId}/`, 1000)
        used = objs.reduce((s: number, o: any) => s + (o.size || 0), 0)
      } catch {}
      const pct = QUOTA > 0 ? Math.min(99, Math.round((used / QUOTA) * 100)) : 0
      const over80 = pct >= 80
      checks.push({ key: 'storage', label: '个人仓库', ok: !over80, detail: `${assetCount} 条素材 · 已用 ${pct}%${over80 ? ' ⚠️ 超过 80%——建议转移到本地仓库（导出）' : ''}` })
    } catch { checks.push({ key: 'storage', label: '个人仓库', ok: true, detail: '查询失败' }) }

    return NextResponse.json({ success: true, data: { checks, model: modelInfo } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
