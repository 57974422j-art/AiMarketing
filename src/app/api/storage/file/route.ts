import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromCookie } from '@/lib/api-auth'  // 白名单路径无 X-User-* 头，必须读 cookie
import { getOSSClient, signedUrl } from '@/lib/oss'

const MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', webm: 'video/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webm',
}

export async function GET(request: NextRequest) {
  // 2026-08-12 #5: 加登录 + 归属校验（原免鉴权任意 userId+name 可下载他人私有素材）
  const auth = getAuthFromCookie(request)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })
  const userId = request.nextUrl.searchParams.get('userId')
  const name = request.nextUrl.searchParams.get('name')
  if (!userId || !name) return NextResponse.json({ success: false, message: '缺少参数' }, { status: 400 })
  const ownerId = parseInt(userId, 10)
  if (isNaN(ownerId)) return NextResponse.json({ success: false, message: 'userId 无效' }, { status: 400 })
  if (ownerId !== auth.userId && auth.role !== 'admin') return NextResponse.json({ success: false, message: '无权访问该文件' }, { status: 403 })
  if (!/^[a-zA-Z0-9._\-]+$/.test(name)) return NextResponse.json({ success: false, message: '文件名非法' }, { status: 400 })

  const key = `storage/${userId}/${name}`
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const mime = MIME_MAP[ext] || 'application/octet-stream'
  const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(ext)

  try {
    const oss = await getOSSClient()

    // 视频用 fetch 签名 URL（已验证可正常播放/显示首帧）
    if (isVideo) {
      const url = await signedUrl(key)
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`OSS读取失败: ${resp.status}`)
      const buffer = Buffer.from(await resp.arrayBuffer())
      return new NextResponse(buffer, {
        headers: { 'Content-Type': mime, 'Content-Length': String(buffer.length), 'Cache-Control': 'public, max-age=86400' },
      })
    }

    // 图片等小文件用 oss.get
    const result = await oss.get(key)
    const buffer = result.content as Buffer
    return new NextResponse(buffer, {
      headers: { 'Content-Type': mime, 'Content-Length': String(buffer.length), 'Cache-Control': 'public, max-age=86400' },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '文件不存在' }, { status: 404 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
