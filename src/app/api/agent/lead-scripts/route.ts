import { NextRequest, NextResponse } from 'next/server'
import { generateText, isAIConfigured } from '@/lib/ai-providers'
import { getAuthFromHeaders, getAuthFromCookie } from '@/lib/api-auth'
import { normalizeLeadScripts, LEAD_SCRIPT_MAX } from '@/lib/agent/lead'

/**
 * POST /api/agent/lead-scripts —— 「智能获客」面板的「✨ 让 AI 推荐话术」。
 *
 * ★VF_LEAD_V1（2026-09-29 老板定案）：
 *   老板要「可填写可推荐话术」→ 这里只做**一次便宜的纯文本调用**（generateText，
 *   不走多模态、不看图），生成 5~10 条评论/私信话术，返回前统一 `normalizeLeadScripts`
 *   清洗（去 emoji + 限长 120 字 + 去重 + 兜底场景名）—— 不靠 AI 自觉。
 *
 * ⚠️ 已知缺口（如实记录，未在本轮修）：本接口**未过 withBilling**（与 `lead-collector` 的
 *    `handleAnalyzeKeywords` 同一类问题，见 docs/获客系统方案-20260929.md 第五节 5.5）。
 *    本轮是内部面板自用、调用量极小；开放给非 Admin 前必须补计费，别让这里成为"免费无限调用"的口子。
 */

/** 鉴权：优先用 middleware 注入的 X-User-Id，其次回退到登录 Cookie（与项目其它接口同一套） */
function getUserId(req: NextRequest): number | null {
  const auth = getAuthFromHeaders(req) || getAuthFromCookie(req)
  return auth?.userId ? Number(auth.userId) : null
}

/** 从 AI 回复里抠出 JSON 数组（模型常带 ```json 围栏或前后废话） */
function extractArray(raw: string): any[] {
  const s = String(raw || '')
  const a = s.indexOf('[')
  const b = s.lastIndexOf(']')
  if (a >= 0 && b > a) {
    try {
      const arr = JSON.parse(s.slice(a, b + 1))
      if (Array.isArray(arr)) return arr
    } catch { /* 落到下面的行式兜底 */ }
  }
  // 兜底：按行拆（每行可能形如「场景|话术」或纯话术）
  return s.split('\n').map((line) => line.trim()).filter(Boolean)
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ success: false, message: '未登录' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({} as any))
    const industry = String(body?.industry || '').slice(0, 100)
    const target = String(body?.target || '').slice(0, 100)
    const platform = String(body?.platform || '').slice(0, 60)
    const count = Math.max(5, Math.min(10, parseInt(body?.count) || 8))

    if (!await isAIConfigured()) {
      return NextResponse.json({ success: false, message: 'AI 未配置（请先在后台上传 Key）' })
    }

    const prompt =
      `你是社媒获客话术写手。为「${industry || '通用行业'}」的潜在客户（人群/关键词：${target || '不限'}）` +
      `写 ${count} 条用于 ${platform || '抖音/小红书'} 的**评论或私信**触达话术。\n` +
      `硬要求：\n` +
      `· 每条 ${LEAD_SCRIPT_MAX} 字以内，口语化、像真人，不要机械群发感；\n` +
      `· 不要 emoji、不要话题标签、不要夸张营销词（“最”“第一”“保证”）；\n` +
      `· 不要直接留联系方式，用“想了解可以聊聊”这类自然引导；\n` +
      `· 场景/触发条件用 4~10 字（如“对方问价”“提到预算”）。\n` +
      `只输出一个 JSON 数组，每项形如 {"scene":"场景","text":"话术"}，不要解释、不要 markdown 围栏。`

    const raw = String(await generateText(prompt) || '')
    const parsed = extractArray(raw)
    const scripts = normalizeLeadScripts(parsed, 10)
    if (!scripts.length) {
      return NextResponse.json({ success: false, message: 'AI 没返回可用话术（可重试一次）' })
    }
    return NextResponse.json({ success: true, scripts })
  } catch (e: any) {
    console.error('[API /agent/lead-scripts]', e)
    return NextResponse.json({ success: false, message: String(e?.message || '生成失败').slice(0, 120) }, { status: 500 })
  }
}

// 强制动态渲染：依赖 request.cookies 鉴权，禁止构建期静态预渲染
export const dynamic = 'force-dynamic'
