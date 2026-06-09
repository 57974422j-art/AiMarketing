import { NextRequest, NextResponse } from 'next/server'
import { signedUrl } from '@/lib/oss'

/**
 * 返回文件的 OSS 签名 URL
 * 前端拿到 URL 后直接访问 OSS（不走服务端中转，速度最快）
 * 用法: GET /api/storage/url?userId=1&name=xxx.mp4
 */
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  const name = request.nextUrl.searchParams.get('name')
  if (!userId || !name) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })

  const key = `storage/${userId}/${name}`
  try {
    const url = await signedUrl(key)
    return NextResponse.json({ success: true, data: { url, key } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '文件不存在' }, { status: 404 })
  }
}
