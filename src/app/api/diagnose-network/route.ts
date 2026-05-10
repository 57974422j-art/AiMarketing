import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
  if (auth.role !== 'admin') return NextResponse.json({ success: false, message: '仅管理员可操作' }, { status: 403 })

  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    tests: {} as Record<string, unknown>,
  }

  // 测试 1: Google
  try {
    const start = Date.now()
    const res = await fetch('https://www.google.com', { signal: AbortSignal.timeout(5000) })
    results.tests = {
      ...(results.tests as Record<string, unknown>),
      google: { success: res.ok, latency: Date.now() - start, status: res.status },
    }
  } catch (e) {
    results.tests = {
      ...(results.tests as Record<string, unknown>),
      google: { success: false, error: e instanceof Error ? e.message : '未知错误' },
    }
  }

  // 测试 2: AI API
  const aiBaseUrl = process.env.AI_BASE_URL || process.env.DEEPSEEK_BASE_URL || process.env.VOLCANO_API_BASE || ''
  try {
    const start = Date.now()
    const testUrl = aiBaseUrl ? `${aiBaseUrl}/v1/models` : 'https://api.deepseek.com/v1/models'
    const res = await fetch(testUrl, { signal: AbortSignal.timeout(5000) })
    results.tests = {
      ...(results.tests as Record<string, unknown>),
      aiApi: { success: res.ok, latency: Date.now() - start, url: testUrl, status: res.status },
    }
  } catch (e) {
    results.tests = {
      ...(results.tests as Record<string, unknown>),
      aiApi: { success: false, error: e instanceof Error ? e.message : '未知错误', url: aiBaseUrl || '未配置' },
    }
  }

  // 测试 3: OSS
  const ossEndpoint = `https://${process.env.OSS_BUCKET || 'unknown'}.${process.env.OSS_REGION || 'oss-cn-hangzhou'}.aliyuncs.com`
  try {
    const start = Date.now()
    const res = await fetch(ossEndpoint, { signal: AbortSignal.timeout(5000) })
    results.tests = {
      ...(results.tests as Record<string, unknown>),
      oss: { success: res.ok, latency: Date.now() - start, status: res.status, endpoint: ossEndpoint },
    }
  } catch (e) {
    results.tests = {
      ...(results.tests as Record<string, unknown>),
      oss: { success: false, error: e instanceof Error ? e.message : '未知错误', endpoint: ossEndpoint },
    }
  }

  results.tests = {
    ...(results.tests as Record<string, unknown>),
    env: {
      AI_PROVIDER: process.env.AI_PROVIDER || '未设置',
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ? '已配置' : '未设置',
      SILICONFLOW_API_KEY: process.env.SILICONFLOW_API_KEY ? '已配置' : '未设置',
      VOLCANO_API_KEY: process.env.VOLCANO_API_KEY ? '已配置' : '未设置',
      OSS_BUCKET: process.env.OSS_BUCKET || '未设置',
    },
  }

  return NextResponse.json({ success: true, data: results })
}
