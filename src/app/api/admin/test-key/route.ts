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
    const { provider, key, baseUrl, proxy, region, accessKeyId, accessKeySecret, bucket, akId, akSecret, appKey } = await request.json();

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

      case 'agnes': {
        const base = (baseUrl || process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1').replace(/\/$/, '');
        const ak = key || process.env.AGNES_API_KEY || '';
        const px = proxy || process.env.OVERSEAS_PROXY || '';
        if (!ak) return NextResponse.json({ valid: false, message: '缺少 Agnes API Key' }, { status: 400 });
        const target = `${base}/models`;
        const url = px ? `${px}?url=${encodeURIComponent(target)}` : target;
        try {
          const res = await fetch(url, { headers: { 'Authorization': `Bearer ${ak}` }, signal: AbortSignal.timeout(20000) });
          if (res.status === 401) return NextResponse.json({ valid: false, message: 'Agnes API Key 无效（401 无效的令牌）' });
          if (res.ok) return NextResponse.json({ valid: true, message: px ? 'Agnes 连接成功（经海外代理）' : 'Agnes 连接成功' });
          const t = await res.text();
          return NextResponse.json({ valid: false, message: `Agnes 连接失败: HTTP ${res.status} ${t.substring(0, 100)}` });
        } catch (e: any) {
          return NextResponse.json({ valid: false, message: `Agnes 连接失败: ${e.message}（请检查海外代理是否配置）` });
        }
      }

      case 'gemini': {
        const gk = key || process.env.GEMINI_API_KEY || '';
        const base = (baseUrl || process.env.GEMINI_BASE_URL || 'https://bboluo.com/v1').replace(/\/$/, '');
        if (!gk) return NextResponse.json({ valid: false, message: '缺少 Gemini API Key' }, { status: 400 });
        const isOpenAI = base.endsWith('/v1');
        const target = isOpenAI ? `${base}/chat/completions` : `${base}/models/gemini-2.5-flash:generateContent?key=${gk}`;
        const body = isOpenAI
          ? JSON.stringify({ model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 })
          : JSON.stringify({ contents: [{ parts: [{ text: 'Hi' }] }] });
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (isOpenAI) headers['Authorization'] = `Bearer ${gk}`
        try {
          const res = await fetch(target, { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) });
          if (res.ok) return NextResponse.json({ valid: true, message: 'Gemini 连接成功' });
          const t = await res.text();
          return NextResponse.json({ valid: false, message: `Gemini 错误: HTTP ${res.status} ${t.substring(0, 100)}` });
        } catch (e: any) {
          return NextResponse.json({ valid: false, message: `Gemini 连接失败: ${e.message}` });
        }
      }

      case 'giphy': {
        const gk = key || process.env.GIPHY_API_KEY || '';
        const px = proxy || process.env.OVERSEAS_PROXY || '';
        if (!gk) return NextResponse.json({ valid: false, message: '缺少 GIPHY API Key' }, { status: 400 });
        const target = `https://api.giphy.com/v1/stickers/search?api_key=${gk}&q=cat&limit=1`;
        const url = px ? `${px}?url=${encodeURIComponent(target)}` : target;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
          const d = await res.json().catch(() => ({} as any));
          if (d.data && Array.isArray(d.data)) return NextResponse.json({ valid: true, message: px ? 'GIPHY 连接成功（经海外代理）' : 'GIPHY 连接成功' });
          return NextResponse.json({ valid: false, message: `GIPHY 返回异常: ${JSON.stringify(d).substring(0, 100)}` });
        } catch (e: any) {
          return NextResponse.json({ valid: false, message: `GIPHY 连接失败: ${e.message}` });
        }
      }

      case 'overseas_proxy': {
        const px = proxy || process.env.OVERSEAS_PROXY || '';
        if (!px) return NextResponse.json({ valid: false, message: '未配置海外代理地址' }, { status: 400 });
        // 用 Agnes 域作探针：代理转发成功会到达 Agnes（返回 401 或 200），否则是代理自身问题
        const target = 'https://apihub.agnes-ai.com/v1/models';
        const url = `${px}?url=${encodeURIComponent(target)}`;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
          if (res.status === 401 || res.ok) return NextResponse.json({ valid: true, message: '海外代理可用，能转发到海外 API' });
          const t = await res.text();
          return NextResponse.json({ valid: false, message: `代理转发异常: HTTP ${res.status} ${t.substring(0, 100)}` });
        } catch (e: any) {
          return NextResponse.json({ valid: false, message: `代理不可达: ${e.message}` });
        }
      }

      // 天行 API Key 测试（热点榜：抖音/微博/微信等）
      case 'tianapi': {
        const k = key || process.env.TIAN_API_KEY || '';
        if (!k) return NextResponse.json({ valid: false, message: '未配置天行 API Key' }, { status: 400 });
        try {
          const res = await fetch(`https://api.tianapi.com/douyinhot/index?key=${k}&num=10`, { signal: AbortSignal.timeout(8000) });
          const j = await res.json();
          if (j && j.code === 200) {
            const n = Array.isArray(j.newslist) ? j.newslist.length : 0;
            return NextResponse.json({ valid: true, message: `天行 Key 有效，返回 ${n} 条抖音热搜` });
          }
          return NextResponse.json({ valid: false, message: `天行返回错误：code=${j?.code} ${j?.msg || ''}` });
        } catch (e: any) {
          return NextResponse.json({ valid: false, message: `天行请求失败：${e.message}` });
        }
      }

      case 'serper': {
        const k = key || process.env.SERPER_API_KEY || '';
        if (!k) return NextResponse.json({ valid: false, message: '未配置 Serper API Key' }, { status: 400 });
        try {
          const res = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'X-API-KEY': k, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: 'test', num: 1 }),
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) return NextResponse.json({ valid: false, message: `Serper HTTP ${res.status}` });
          const j = await res.json();
          const n = Array.isArray(j.organic) ? j.organic.length : 0;
          return NextResponse.json({ valid: true, message: `Serper 有效，返回 ${n} 条结果` });
        } catch (e: any) {
          return NextResponse.json({ valid: false, message: `Serper 请求失败：${e.message}` });
        }
      }
      case 'vvhan': {
        const k = key || process.env.VVHAN_API_KEY || '';
        try {
          const res = await fetch('https://api.vvhan.com/api/hotlist/wbHot' + (k ? `?apikey=${k}` : ''), {
            headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) return NextResponse.json({ valid: false, message: `vvhan HTTP ${res.status}` });
          const j = await res.json();
          const n = Array.isArray(j.data) ? j.data.length : 0;
          return NextResponse.json({ valid: true, message: `vvhan 有效${k ? '（key 已用）' : '（免 key）'}，返回 ${n} 条微博热榜` });
        } catch (e: any) {
          return NextResponse.json({ valid: false, message: `vvhan 请求失败：${e.message}` });
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

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
