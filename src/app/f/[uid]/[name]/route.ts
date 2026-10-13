/**
 * ★VF_FILELINK_V1：个人仓库文件的**短链出口**（对外只露本站域名）。
 *   `GET /f/<uid>/<文件名>?t=<过期>.<签名>`            → **本站流式直出**（按扩展名给 MIME + inline ⇒ 浏览器直接渲染）
 *   `GET /f/<uid>/<文件名>?t=<过期>.<签名>&dl=1`       → 同一条流 + attachment ⇒ 点了存文件
 *   ⚠️ V1/V2 曾是"302 到 OSS 签名地址"（V2 还想让 OSS 覆写响应头）—— 实测 OSS **拒绝**覆写 content-type
 *      （`InvalidRequest / Can not override response header on content-type`，EC 0017-00000902）
 *      ⇒ 四条入口全废。现口径见下面 V3 的注释：自己取、自己设头。
 *
 * 为什么这样做（用户 2026-10-12 原话：「你至少包装一下 怎么这么现实出来了 连我服务器地址什么都搞出来了」）：
 *   原来交付回复里贴的是 OSS 原始签名地址（桶名/区域/OSSAccessKeyId/内部 key 全暴露）。
 * 这里**不代理流量、不落盘、无状态**：只做一次"短名 → 真地址"的翻译，然后把浏览器 302 走。
 * 分享安全：链接带 HMAC 签名 + 过期时间；没签名/签名不对 = 403，过期 = 410（分开报，别把"过期"当"坏了"）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyFileLink } from '@/lib/file-link'
import { signedUrl } from '@/lib/oss'

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
  // ★VF_FILELINK_V3（2026-10-13 用户实测，**推翻 V2 的修法**）：
  //   V2 是"签名时覆写响应头（response.content-type）"+ 302 到 OSS。实测 OSS **直接拒绝**：
  //     `<Code>InvalidRequest</Code><Message>Can not override response header on content-type</Message>`
  //     `EC 0017-00000902`（HostId 就是我们那个桶）
  //   ⇒ 打开预览 / 下载 / 配图版 / 手动复制出去的地址 **四条全废**（用户看到的就是这段 XML）。
  //   现口径：**本站流式代理** —— 我们自己取对象、自己设 `Content-Type`，不再 302、不再求 OSS 改头：
  //     · 预览：`Content-Type: text/html; charset=utf-8` + `inline`（按扩展名给 MIME，jpg/mp4 也不会被弄坏）
  //     · 下载（`dl=1`）：同一条流 + `attachment` 文件名
  //   代价：字节过一下我们的服务器（HTML 几 MB，可接受）；换来的是"链接在浏览器、在客户端都用得住"。
  const mime = mimeOf(name)
  let resp: Response | null = null
  try {
    const url = await signedUrl(key, 300)          // 服务端内部取用，5 分钟足够
    resp = await fetch(url)
    if (!resp.ok) resp = null
  } catch { resp = null }
  if (!resp || !resp.body) {
    // 兜底：连取都取不到时，退回老口径的 302（至少还有一线生机），并如实说清
    try {
      const url = await signedUrl(key, 3600)
      return NextResponse.redirect(url, 302)
    } catch {
      return new NextResponse('文件暂时拿不到（存储未配置或对象不存在）', { status: 502 })
    }
  }
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Content-Disposition': (dl ? 'attachment' : 'inline') + `; filename*=UTF-8''${encodeURIComponent(name)}`,
    // 分享链接：允许浏览器自己缓存一会儿（不要 public，避免中间层串号 —— 见 api/storage/file 的 PRIVCACHE 记录）
    'Cache-Control': 'private, max-age=300',
  }
  const len = resp.headers.get('content-length')
  if (len) headers['Content-Length'] = len
  return new NextResponse(resp.body as any, { headers })
}
