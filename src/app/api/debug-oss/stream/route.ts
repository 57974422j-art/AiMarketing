import { NextResponse } from 'next/server'

/**
 * 流式返回测试接口
 * 用法: /api/debug-oss/stream?key=storage/1/xxx.mp4
 * 直接在浏览器打开测试视频能否播放
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const key = url.searchParams.get('key')
  if (!key) return NextResponse.json({ error: '缺少key参数' }, { status: 400 })

  try {
    // 读取环境变量
    let region = '', akId = '', akSecret = '', bucket = ''
    const keys = ['OSS_REGION', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET']
    for (const k of keys) {
      if (process.env[k]) { if (k === 'OSS_REGION') region = process.env[k]!; else if (k === 'OSS_ACCESS_KEY_ID') akId = process.env[k]!; else if (k === 'OSS_ACCESS_KEY_SECRET') akSecret = process.env[k]!; else if (k === 'OSS_BUCKET') bucket = process.env[k]! }
      else {
        const { readFile } = await import('fs/promises')
        const { join } = await import('path')
        const content = await readFile(join(process.cwd(), '.env.local'), 'utf-8')
        const match = content.match(new RegExp(`^${k}=(.+)$`, 'm'))
        const v = match?.[1] || ''
        if (k === 'OSS_REGION') region = v; else if (k === 'OSS_ACCESS_KEY_ID') akId = v; else if (k === 'OSS_ACCESS_KEY_SECRET') akSecret = v; else if (k === 'OSS_BUCKET') bucket = v
      }
    }

    const { default: OSS } = await import('ali-oss')
    const client = new OSS({ region, accessKeyId: akId, accessKeySecret: akSecret, bucket })

    // 方案A: getStream (流式，低内存)
    try {
      const result = await client.getStream(key)
      const stream = result.stream as any
      // 检查 stream 是否有效
      if (!stream || typeof stream.pipe !== 'function') throw new Error('getStream返回无效')
      return new NextResponse(stream as any, {
        headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'public, max-age=3600' },
      })
    } catch (streamErr: any) {
      // 方案B失败 → 方案C: fetch签名URL再返回buffer (兼容性最好)
      const signedUrl = client.signatureUrl(key, { expires: 3600, response: { 'content-type': 'video/mp4' } } as any)
      const resp = await fetch(signedUrl)
      if (!resp.ok) throw new Error(`fetch OSS失败: ${resp.status}`)
      const buffer = Buffer.from(await resp.arrayBuffer())
      return new NextResponse(buffer, {
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buffer.length), 'Cache-Control': 'public, max-age=3600' },
      })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
