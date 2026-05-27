import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'

const STORAGE = '/root/AiMarketing/public/storage'

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  const name = request.nextUrl.searchParams.get('name')
  if (!userId || !name) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })

  const fp = path.join(STORAGE, userId, name)
  if (!fp.startsWith(path.join(STORAGE, userId))) {
    return NextResponse.json({ success: false, message: '非法路径' }, { status: 403 })
  }
  if (!fs.existsSync(fp)) return NextResponse.json({ success: false, message: '文件不存在' }, { status: 404 })

  const buf = fs.readFileSync(fp)
  const ext = name.split('.').pop()?.toLowerCase()
  const mime: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }
  return new NextResponse(buf, {
    headers: { 'Content-Type': mime[ext || ''] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' },
  })
}
