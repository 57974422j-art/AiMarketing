import { NextRequest, NextResponse } from 'next/server'
import { getAIConfig } from '@/lib/ai-config'

export async function GET(request: NextRequest) {
  const config = getAIConfig()
  
  const url = config.baseUrl + '/v1/chat/completions'
  
  console.log('========== 配置诊断 ==========')
  console.log('AI_PROVIDER:', config.provider)
  console.log('AI_API_KEY:', config.apiKey ? config.apiKey.substring(0, 10) + '...' : 'EMPTY')
  console.log('AI_BASE_URL:', config.baseUrl)
  console.log('AI_MODEL:', config.model)
  console.log('完整 URL:', url)
  console.log('================================')
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: '你好' }],
        max_tokens: 50
      }),
      signal: AbortSignal.timeout(15000)
    })
    
    const text = await response.text()
    
    console.log('HTTP 状态:', response.status)
    console.log('响应内容:', text.substring(0, 500))
    
    return NextResponse.json({
      config: {
        provider: config.provider,
        apiKeyPrefix: config.apiKey?.substring(0, 10),
        baseUrl: config.baseUrl,
        model: config.model,
        fullUrl: url
      },
      response: {
        status: response.status,
        body: text.substring(0, 500)
      }
    })
  } catch (error: any) {
    console.error('请求失败:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
