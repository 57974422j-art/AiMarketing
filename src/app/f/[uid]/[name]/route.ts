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
  let url = ''
  try {
    if (dl) {
      const oss = await getOSSClient()
      url = oss.signatureUrl(key, {
        expires: 7 * 86400,
        response: { 'content-disposition': `attachment; filename="${name}"` },
      })
    } else {
      url = await signedUrl(key, 7 * 86400)
    }
  } catch {
    try { url = await signedUrl(key, 3600) } catch { url = '' }
  }
  if (!url) return new NextResponse('文件暂时拿不到（存储未配置或对象不存在）', { status: 502 })
  return NextResponse.redirect(url, 302)
}
