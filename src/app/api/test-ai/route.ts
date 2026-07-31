import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
import { isAIConfigured } from '@/lib/ai-providers'

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
  if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

  const aiConfigured = await isAIConfigured()
  const provider = process.env.AI_PROVIDER || '(未设置)'
  const baseUrl = process.env.AI_BASE_URL || '(未设置)'
  const model = process.env.AI_MODEL || '(未设置)'
  const url = baseUrl + '/v1/chat/completions'

  console.log('========== 配置诊断 ==========')
  console.log('AI_PROVIDER:', provider)
  console.log('AI_BASE_URL:', baseUrl)
  console.log('AI_MODEL:', model)
  console.log('AI Configured:', aiConfigured)
  console.log('DEEPSEEK_API_KEY:', process.env.DEEPSEEK_API_KEY ? '已配置' : '未配置')
  console.log('SILICONFLOW_API_KEY:', process.env.SILICONFLOW_API_KEY ? '已配置' : '未配置')
  console.log('VOLCANO_API_KEY:', process.env.VOLCANO_API_KEY ? '已配置' : '未配置')
  console.log('请求URL:', url)

  const results: Record<string, unknown> = {
    aiConfigured,
    provider,
    baseUrl,
    model,
    requestUrl: url,
    deepseekConfigured: !!process.env.DEEPSEEK_API_KEY,
    siliconflowConfigured: !!process.env.SILICONFLOW_API_KEY,
    volcanoConfigured: !!process.env.VOLCANO_API_KEY,
    ossConfigured: !!(process.env.OSS_REGION && process.env.OSS_ACCESS_KEY_ID && process.env.OSS_BUCKET),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      AI_PROVIDER: process.env.AI_PROVIDER,
      AI_BASE_URL: process.env.AI_BASE_URL,
      AI_MODEL: process.env.AI_MODEL,
    },
  }

  try {
    const start = Date.now()
    const testPayload = {
      model: model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    }
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.SILICONFLOW_API_KEY || process.env.VOLCANO_API_KEY || ''

    if (apiKey) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(10000),
      })
      results.apiTest = { success: res.ok, status: res.status, latency: Date.now() - start }
    } else {
      results.apiTest = { success: false, message: '未配置任何 API Key' }
    }
  } catch (e) {
    results.apiTest = { success: false, error: e instanceof Error ? e.message : '连接测试失败' }
  }

  return NextResponse.json({ success: true, data: results })
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
