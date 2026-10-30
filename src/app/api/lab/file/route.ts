/**
 * ★LAB_DAILY_V1 · 取实验线产物
 * 只允许读 `temp/_lab/out/` 下的 html，禁止路径穿越。
 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

export async function GET(request: NextRequest) {
  const name = String(request.nextUrl.searchParams.get('name') || '')
  if (!/^lab-[0-9T-]+\.html$/.test(name)) {
    return NextResponse.json({ success: false, message: '非法文件名' }, { status: 400 })
  }
  const p = path.join(process.cwd(), 'temp', '_lab', 'out', name)
  if (!fs.existsSync(p)) {
    return NextResponse.json({ success: false, message: '文件不存在' }, { status: 404 })
  }
  const html = fs.readFileSync(p, 'utf8')
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
