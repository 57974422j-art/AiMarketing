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
      'Content-Disposition': `attachment; filename="${fileId}"`,
      'Content-Length': String(buf.length),
    },
  })
}
