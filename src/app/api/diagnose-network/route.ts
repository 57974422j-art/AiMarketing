import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const results: any = {
    timestamp: new Date().toISOString(),
    tests: {}
  }

  // 测试 1: Google
  try {
    const start = Date.now()
    const res = await fetch('https://www.google.com', { 
      signal: AbortSignal.timeout(5000) 
    })
    results.tests.google = {
      status: res.status,
      time: Date.now() - start
    }
  } catch (e: any) {
    results.tests.google = {
      error: e.message,
      code: e.name
    }
  }

  // 测试 2: DeepSeek API
  try {
    const start = Date.now()
    const res = await fetch('https://api.deepseek.com', { 
      signal: AbortSignal.timeout(5000) 
    })
    results.tests.deepseek = {
      status: res.status,
      time: Date.now() - start
    }
  } catch (e: any) {
    results.tests.deepseek = {
      error: e.message,
      code: e.name
    }
  }

  // 测试 3: 本地网络
  try {
    const start = Date.now()
    const res = await fetch('http://localhost:3000', { 
      signal: AbortSignal.timeout(3000) 
    })
    results.tests.localhost = {
      status: res.status,
      time: Date.now() - start
    }
  } catch (e: any) {
    results.tests.localhost = {
      error: e.message,
      code: e.name
    }
  }

  // 环境信息
  results.env = {
    nodeVersion: process.version,
    platform: process.platform,
    env: {
      HTTP_PROXY: process.env.HTTP_PROXY || 'not set',
      HTTPS_PROXY: process.env.HTTPS_PROXY || 'not set',
      http_proxy: process.env.http_proxy || 'not set',
      https_proxy: process.env.https_proxy || 'not set',
      NO_PROXY: process.env.NO_PROXY || 'not set',
      no_proxy: process.env.no_proxy || 'not set',
    }
  }

  return NextResponse.json(results)
}
