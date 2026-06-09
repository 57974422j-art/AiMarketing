import { NextRequest, NextResponse } from 'next/server'
import { getOSSClient, signedUrl } from '@/lib/oss'

const MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', webm: 'video/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp',
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  const name = request.nextUrl.searchParams.get('name')
  if (!userId || !name) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })

  const key = `storage/${userId}/${name}`
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const mime = MIME_MAP[ext] || 'application/octet-stream'

  try {
    const oss = await getOSSClient()

    // 方案A: getStream 流式返回（低内存）
    try {
      const result = await oss.getStream(key)
      const stream = result.stream as any
      if (stream && typeof stream.pipe === 'function') {
        return new NextResponse(stream, {
          headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' },
        })
      }
    } catch (_) { /* getStream失败 → 降级到方案B */ }

    // 方案B: fetch签名URL读buffer（兼容性最好，已验证可播放视频）
    const url = await signedUrl(key)
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`OSS读取失败: ${resp.status}`)
    const buffer = Buffer.from(await resp.arrayBuffer())
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '文件不存在' }, { status: 404 })
  }
}
