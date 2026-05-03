import { NextRequest, NextResponse } from 'next/server';

// 测试 API Key 是否有效
export async function POST(request: NextRequest) {
  try {
    const { provider, key } = await request.json();

    if (!provider || !key) {
      return NextResponse.json({
        valid: false,
        message: '缺少 provider 或 key 参数'
      }, { status: 400 });
    }

    console.log(`[Test-Key] 测试 ${provider} API Key: ${key.substring(0, 10)}...`);

    // 根据 provider 测试不同的 API
    switch (provider) {
      case 'deepseek': {
        // 测试 DeepSeek API
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 10
          }),
          signal: AbortSignal.timeout(15000)
        });

        const responseText = await response.text();

        if (response.ok) {
          return NextResponse.json({
            valid: true,
            message: 'DeepSeek API Key 有效'
          });
        } else {
          try {
            const error = JSON.parse(responseText);
            return NextResponse.json({
              valid: false,
              message: `API 错误: ${error.error?.message || responseText.substring(0, 100)}`
            });
          } catch {
            return NextResponse.json({
              valid: false,
              message: `HTTP ${response.status}: ${responseText.substring(0, 100)}`
            });
          }
        }
      }

      case 'dashscope': {
        // 测试阿里云百炼 API
        const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: 'qwen-plus',
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 10
          }),
          signal: AbortSignal.timeout(15000)
        });

        const responseText = await response.text();

        if (response.ok) {
          return NextResponse.json({
            valid: true,
            message: '阿里云百炼 API Key 有效'
          });
        } else {
          try {
            const error = JSON.parse(responseText);
            return NextResponse.json({
              valid: false,
              message: `API 错误: ${error.error?.message || error.message || responseText.substring(0, 100)}`
            });
          } catch {
            return NextResponse.json({
              valid: false,
              message: `HTTP ${response.status}: ${responseText.substring(0, 100)}`
            });
          }
        }
      }

      default:
        return NextResponse.json({
          valid: false,
          message: `不支持的 provider: ${provider}`
        }, { status: 400 });
    }

  } catch (error) {
    console.error('[Test-Key] 测试失败:', error);
    return NextResponse.json({
      valid: false,
      message: error instanceof Error ? error.message : '测试请求失败'
    }, { status: 500 });
  }
}
