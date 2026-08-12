import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const fileId = request.nextUrl.searchParams.get('id')
  if (!fileId) return NextResponse.json({ success: false, message: '缺少id' }, { status: 400 })

  const filePath = path.join('/root/AiMarketing/public/generated', fileId)
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ success: false, message: '文件不存在' }, { status: 404 })
  }

  const buf = fs.readFileSync(filePath)
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment;
  // 2026-08-12 #6: 防路径遍历（原 fileId 可 ../ 读任意文件）
  if (!fileId || !/^[a-zA-Z0-9._\-]+$/.test(fileId)) return NextResponse.json({ error: 'fileId 非法' }, { status: 400 }) filename="${fileId}"`,
      'Content-Length': String(buf.length),
    },
  })
}
