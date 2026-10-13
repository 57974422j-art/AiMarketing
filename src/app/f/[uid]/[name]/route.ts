/**
 * ★VF_FILELINK_V1：个人仓库文件的**短链出口**（对外只露本站域名）。
 *   `GET /f/<uid>/<文件名>?t=<过期>.<签名>`            → 浏览器直接打开（302 → OSS 签名地址，Content-Type 已存 text/html ⇒ 渲染）
 *   `GET /f/<uid>/<文件名>?t=<过期>.<签名>&dl=1`       → 同上但带 attachment ⇒ 点了存文件
 *
 * 为什么这样做（用户 2026-10-12 原话：「你至少包装一下 怎么这么现实出来了 连我服务器地址什么都搞出来了」）：
 *   原来交付回复里贴的是 OSS 原始签名地址（桶名/区域/OSSAccessKeyId/内部 key 全暴露）。
 * 这里**不代理流量、不落盘、无状态**：只做一次"短名 → 真地址"的翻译，然后把浏览器 302 走。
 * 分享安全：链接带 HMAC 签名 + 过期时间；没签名/签名不对 = 403，过期 = 410（分开报，别把"过期"当"坏了"）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyFileLink } from '@/lib/file-link'
import { signedUrl, getOSSClient } from '@/lib/oss'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 按扩展名给 MIME（预览必须给对，否则浏览器一律存文件；★VF_FILELINK_V2） */
function mimeOf(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (ext === 'html' || ext === 'htm') return 'text/html; charset=utf-8'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'webm') return 'video/webm'
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'json') return 'application/json; charset=utf-8'
  if (ext === 'txt' || ext === 'md') return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}

export async function GET(req: NextRequest, ctx: { params: { uid: string; name: string } }) {
  const uid = String(ctx?.params?.uid || '').replace(/\D/g, '')
  let name = ''
  try { name = decodeURIComponent(String(ctx?.params?.name || '')) } catch { name = String(ctx?.params?.name || '') }
  // 只接受"个人仓库根目录下的文件名"（不带路径、不带 ..）——防目录穿越
  if (!uid || !name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    return new NextResponse('链接无效', { status: 400 })
  }

  const v = verifyFileLink(uid, name, req.nextUrl.searchParams.get('t') || '')
  if (!v.ok) {
    return new NextResponse(
      v.exp ? '链接已过期 —— 回到应用里再做一份就会给新链接' : '链接无效（签名不对）',
      { status: v.exp ? 410 : 403 },
    )
  }

  const key = `storage/${uid}/${name}`
  const dl = req.nextUrl.searchParams.get('dl') === '1'
  // ★VF_FILELINK_V2（2026-10-13 用户实测「▶ 打开预览（浏览器直接渲染）这个也是下载 并不是展示」）：
  //   病灶：以前预览分支只做 302 到签名地址，**响应头听 OSS 里存的那份** —— 我们上传 HTML 时用的
  //   Content-Type 常常是 `application/octet-stream`（或浏览器不认的），于是浏览器一律**下载**。
  //   修法：签名时**强制覆写响应头**（`response.content-type` + `inline`）：
  //     · 预览：按扩展名给出正确 MIME（.html ⇒ text/html; charset=utf-8）+ `inline; filename*=UTF-8''…`
  //     · 下载：仍 `attachment`（点"下载"就该存文件）
  //   为什么按扩展名而不是一律 text/html：这个出口也给 jpg/mp4/pdf 用（一律 text/html 会把图片也弄坏）。
  const mime = mimeOf(name)
  let url = ''
  try {
    const oss = await getOSSClient()
    const cd = (dl ? 'attachment' : 'inline') + `; filename*=UTF-8''${encodeURIComponent(name)}`
    url = oss.signatureUrl(key, {
      expires: 7 * 86400,
      response: { 'content-type': mime, 'content-disposition': cd },
    })
  } catch {
    try { url = await signedUrl(key, 3600) } catch { url = '' }
  }
  if (!url) return new NextResponse('文件暂时拿不到（存储未配置或对象不存在）', { status: 502 })
  return NextResponse.redirect(url, 302)
}
