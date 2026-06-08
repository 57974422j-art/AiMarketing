import { NextRequest, NextResponse } from 'next/server'
import { signedUrl } from '@/lib/oss'

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  const name = request.nextUrl.searchParams.get('name')
  if (!userId || !name) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })

  const key = `storage/${userId}/${name}`

  try {
    // 返回签名 URL，前端直连 OSS 下载，不再经 Node 中转
    const url = await signedUrl(key)
    return NextResponse.redirect(url)
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '文件不存在' }, { status: 404 })
  }
}
