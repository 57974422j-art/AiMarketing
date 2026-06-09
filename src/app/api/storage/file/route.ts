import { NextRequest, NextResponse } from 'next/server'
import { getOSSClient } from '@/lib/oss'

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
    // 从 OSS 获取文件内容并返回（带正确的 Content-Type 让浏览器识别为视频/图片）
    const oss = await getOSSClient()
    const result = await oss.get(key)
    const buffer = result.content as Buffer
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
