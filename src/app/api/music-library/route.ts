import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// 暂时无可用在线音乐库，用户可自定义上传
export async function GET() {
  return NextResponse.json({ success: true, data: [] })
}
