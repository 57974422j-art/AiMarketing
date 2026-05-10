import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// ==================== NLS Token 测试工具 ====================

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

async function testNlsToken(akId: string, akSecret: string, appKey: string): Promise<NextResponse> {
  try {
    const params: Record<string, string> = {
      Action: 'CreateToken',
      Format: 'JSON',
      Version: '2019-02-28',
      AccessKeyId: akId,
      SignatureMethod: 'HMAC-SHA1',
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      SignatureVersion: '1.0',
      SignatureNonce: crypto.randomUUID(),
    };

    const sortedKeys = Object.keys(params).sort();
    const canonicalizedQuery = sortedKeys
      .map(key => `${percentEncode(key)}=${percentEncode(params[key])}`)
      .join('&');

    const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalizedQuery)}`;

    const signature = crypto
      .createHmac('sha1', akSecret + '&')
      .update(stringToSign)
      .digest('base64');

    params.Signature = signature;

    const allParams = Object.entries(params)
      .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
      .join('&');

    const url = `https://nls-meta.cn-shanghai.aliyuncs.com/?${allParams}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    const data = JSON.parse(text);

    if (data.Token?.Id) {
      return NextResponse.json({
        valid: true,
        message: `阿里云 NLS 连接成功（AppKey: ${appKey.substring(0, 4)}...）`
      });
    } else {
      return NextResponse.json({
        valid: false,
        message: `NLS 认证失败: ${text.substring(0, 200)}`
      });
    }
  } catch (error: any) {
    return NextResponse.json({
      valid: false,
      message: `NLS 连接失败: ${error.message || '未知错误'}`
    });
  }
}

// 测试 API Key 或 OSS 配置是否有效
export async function POST(request: NextRequest) {
  try {
    const { provider, key, region, accessKeyId, accessKeySecret, bucket, akId, akSecret, appKey } = await request.json();

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

      case 'volcano': {
        if (!key) {
          return NextResponse.json({ valid: false, message: '缺少 key 参数' }, { status: 400 });
        }

        // 测试火山方舟 API
        const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: 'doubao-seed-1-6-flash-250828',
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 10
          }),
          signal: AbortSignal.timeout(15000)
        });

        const responseText = await response.text();

        if (response.ok) {
          return NextResponse.json({
            valid: true,
            message: '火山方舟 API Key 有效'
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

      case 'siliconflow': {
        if (!key) {
          return NextResponse.json({ valid: false, message: '缺少 key 参数' }, { status: 400 });
        }

        // 测试硅基流动 API - 使用 models 接口验证 Key
        const response = await fetch('https://api.siliconflow.cn/v1/models', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${key}`
          },
          signal: AbortSignal.timeout(15000)
        });

        if (response.ok) {
          return NextResponse.json({
            valid: true,
            message: '硅基流动 API Key 有效'
          });
        } else {
          const responseText = await response.text();
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

        // 测试阿里云百炼 API - 用模型列表接口验证 Key
        const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${key}`
          },
          signal: AbortSignal.timeout(15000)
        });

        if (response.ok) {
          return NextResponse.json({
            valid: true,
            message: '阿里云百炼 API Key 有效'
          });
        } else {
          const responseText = await response.text();
          return NextResponse.json({
            valid: false,
            message: `API 错误: ${responseText.substring(0, 100)}`
          });
        }
      }

      case 'nls': {
        if (!akId || !akSecret || !appKey) {
          return NextResponse.json({ valid: false, message: '缺少参数（需 akId, akSecret, appKey）' }, { status: 400 });
        }
        return testNlsToken(akId, akSecret, appKey);
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
          const { default: OSS } = await import('ali-oss');
          const client = new OSS({
            region,
            accessKeyId,
            accessKeySecret,
            bucket,
            secure: true
          });

          // 测试列出 buckets
          const result = await client.listBuckets({ 'max-keys': 1 }) as any;
          // ali-oss 6.x 返回 { buckets: [...], ... } 而不是数组
          const buckets = Array.isArray(result) ? result : (result.buckets || []);
          console.log('[Test-Key] OSS 连接成功，当前账号 buckets:', buckets.length);

          // 检查指定的 bucket 是否存在
          const targetBucket = buckets.find((b: any) => b.name === bucket);
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
