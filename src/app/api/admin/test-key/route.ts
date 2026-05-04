import { NextRequest, NextResponse } from 'next/server';
import OSS from 'ali-oss';

// 测试 API Key 或 OSS 配置是否有效
export async function POST(request: NextRequest) {
  try {
    const { provider, key, region, accessKeyId, accessKeySecret, bucket } = await request.json();

    if (!provider) {
      return NextResponse.json({
        valid: false,
        message: '缺少 provider 参数'
      }, { status: 400 });
    }

    console.log(`[Test-Key] 测试 ${provider}`);

    // 根据 provider 测试不同的 API
    switch (provider) {
      case 'deepseek': {
        if (!key) {
          return NextResponse.json({ valid: false, message: '缺少 key 参数' }, { status: 400 });
        }

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
        if (!key) {
          return NextResponse.json({ valid: false, message: '缺少 key 参数' }, { status: 400 });
        }

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

      case 'oss': {
        // 测试 OSS 连接
        if (!region || !accessKeyId || !accessKeySecret || !bucket) {
          return NextResponse.json({
            valid: false,
            message: 'OSS 配置不完整'
          }, { status: 400 });
        }

        try {
          const client = new OSS({
            region,
            accessKeyId,
            accessKeySecret,
            bucket,
            secure: true
          });

          // 测试列出 buckets
          const result = await client.listBuckets();
          console.log('[Test-Key] OSS 连接成功，当前账号 buckets:', result.buckets?.length);

          // 检查指定的 bucket 是否存在
          const targetBucket = result.buckets?.find(b => b.name === bucket);
          if (targetBucket) {
            return NextResponse.json({
              valid: true,
              message: `OSS 连接成功，Bucket "${bucket}" 存在`
            });
          } else {
            return NextResponse.json({
              valid: false,
              message: `OSS 连接成功，但 Bucket "${bucket}" 不存在`
            });
          }
        } catch (ossError: any) {
          console.error('[Test-Key] OSS 连接失败:', ossError);
          return NextResponse.json({
            valid: false,
            message: `OSS 连接失败: ${ossError.message || '未知错误'}`
          });
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
