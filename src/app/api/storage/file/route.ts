import { NextRequest, NextResponse } from 'next/server'
import { signedUrl } from '@/lib/oss'

const MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', webm: 'video/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp',
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm'])

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  const name = request.nextUrl.searchParams.get('name')
  if (!userId || !name) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })

  const key = `storage/${userId}/${name}`
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const mime = MIME_MAP[ext] || 'application/octet-stream'

  try {
    // 视频 → 签名 URL 重定向到 OSS（浏览器直连，支持 Range 分段下载）
    if (VIDEO_EXTS.has(ext)) {
      const url = await signedUrl(key)
      // 用 302 而非 307，浏览器对视频更友好
      return new NextResponse(null, {
        status: 302,
        headers: { Location: url },
      })
    }

    // 图片/其他 → 直接读取内容返回
    const { getObject } = await import('@/lib/oss')
    const buffer = await getObject(key)
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
