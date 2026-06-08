import { NextRequest, NextResponse } from 'next/server'
import { getObject } from '@/lib/oss'

const MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', webm: 'video/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webmp',
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  const name = request.nextUrl.searchParams.get('name')
  if (!userId || !name) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })

  const key = `storage/${userId}/${name}`
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const mime = MIME_MAP[ext] || 'application/octet-stream'

  try {
    // 直接从 OSS 读取文件内容返回，不走重定向
    const buffer = await getObject(key)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=86400',
        'Accept-Ranges': 'bytes',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '文件不存在' }, { status: 404 })
  }
}
