import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromCookie } from '@/lib/api-auth'  // 白名单路径无 X-User-* 头，必须读 cookie
import { getOSSClient, signedUrl } from '@/lib/oss'

const MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', webm: 'video/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  // ★修（2026-10-10）：原来是 'image/webm'（webm 是**视频**容器）⇒ webp 会被浏览器当视频播放/直接下载
  gif: 'image/gif', webp: 'image/webp',
  // ★VF_HTMLVIEW_V1（2026-10-13 用户实测「▶ 打开预览打不开报错，**可能是不支持HTML格式**；个人仓库也打不开」）：
  //   病灶：这张表**根本没有 html** ⇒ 落到 `MIME_MAP[ext] || 'application/octet-stream'`
  //   ⇒ 浏览器/客户端一律**下载**（或直接报"不支持HTML格式"）。
  //   日报落地页交付的正是 .html ⇒ 预览永远打不开；个人仓库点文件名也走这条路由，同样打不开。
  //   现在给 html/htm + 几个常见文本类补上正确 MIME；配合下面的"HTML 流式 inline 直出" ⇒ 同源直接渲染。
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
  pdf: 'application/pdf', svg: 'image/svg+xml',
}

/** ★VF_PRIVCACHE_V1（2026-10-12 用户实测「我的账号上传正常，**其它账号在别的机器**上传缩略图是错的」）：
 *  病灶：本路由原来对所有响应都发 `Cache-Control: public, max-age=86400` —— `public` 允许**共享缓存**
 *  （nginx / CDN / 网关代理）缓存。而本路由路径恒为 `/api/storage/file`，不同用户之间**只差 query**
 *  （userId、name）⇒ 一旦链路上有按路径缓存的中间层，**先访问者的图会被返给后来的人**
 *  （观感就是"别人的缩略图跑到我这儿 / 我的跑到别人那儿"）。
 *  口径：用户私有素材一律 `private`（只允许**浏览器自己**缓存）；跨账号路径隔离不受影响。
 *  配合 ★VF_CACHEBUST_V1（files/route.ts 给缩略图 URL 挂 `&v=<size-mtime>`）⇒ 内容变了 URL 也变，
 *  浏览器那 24h 缓存也不会再显示旧图。 */
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
  /* ★VF_THUMB_400_V1（2026-10-18 用户实测 console：`GET /api/storage/file?…&name=.thumbs/gen_…jpg` **400 Bad Request**）：
     病灶：这条校验正则 `/^[a-zA-Z0-9._\-]+$/` **不允许 `/`**，而**缩略图的 key 就是 `.thumbs/<同名>.jpg`**
     ⇒ **所有缩略图请求都 400** ⇒ 列表里图/视频封面全挂（用户看到的"只有底色"有一半是这个）。
     现口径：**只额外允许 `.thumbs/` 这一个子目录前缀**，并显式禁掉 `..`（防目录穿越）；
     其余字符集不变 ⇒ 安全性不降低。
     ⚠️ 边界：`storage/<uid>/.thumbs/xxx.jpg` 仍在**同一用户目录**下 ⇒ 归属校验照旧生效。 */
  const NAME_OK = /^(?:\.thumbs\/)?[a-zA-Z0-9._\-]+$/.test(name) && !name.includes('..')
  if (!NAME_OK) return NextResponse.json({ success: false, message: '文件名非法' }, { status: 400 })

  const key = `storage/${userId}/${name}`
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const mime = MIME_MAP[ext] || 'application/octet-stream'
  const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(name)
  const isDownload = request.nextUrl.searchParams.get('download') === '1'

  try {
    const oss = await getOSSClient()

    // ★2026-09-20 修（用户实测：播放每 3 秒卡一下、像暂停）
    //   老做法：把整个视频 fetch 进 Node 内存再吐出去，且不返回 Accept-Ranges
    //   → 浏览器无法 Range 请求 → 必须整段下完才能续播 → 长视频必卡（还吃服务器内存）
    //   新做法（仅播放，非下载）：302 跳到 OSS 签名 URL —— OSS 原生支持 Range/边下边播，
    //   服务器零内存开销；签名 1 小时有效且每次请求重新签，不会过期
    if (isVideo && !isDownload) {
      const url = await signedUrl(key, 3600)
      return NextResponse.redirect(url, 302)
    }

    // ★VF_HTMLVIEW_V1：HTML**浏览**时由本站直接流式吐出（`text/html; charset=utf-8` + **不**带
    //   Content-Disposition ⇒ 浏览器/客户端内联渲染）。
    //   为什么不 302 到 OSS：OSS 里存的是上传时的 Content-Type（HTML 多半是 octet-stream）
    //   ⇒ 跳过去还是"下载/不支持"。本站直出才拿得准；顺带**流式转发**（单文件版可能十几 MB，
    //   不整块读进内存）。下载（download=1）仍走下面的 attachment 分支。
    if (/\.(html?|svg)$/i.test(name) && !isDownload) {
      const url = await signedUrl(key)
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`OSS读取失败: ${resp.status}`)
      const headers: Record<string, string> = {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=60',
      }
      const len = resp.headers.get('content-length')
      if (len) headers['Content-Length'] = len
      return new NextResponse(resp.body as any, { headers })
    }

    // 视频下载
    // ★2026-09-22（用户实测「点下载弹窗非常慢」）：
    //   原来把整个视频从 OSS `fetch` 回 Node 内存（`Buffer.from(await resp.arrayBuffer())`）再吐出去
    //   → 文件被搬两遍（OSS→服务器→浏览器）、服务器吃满内存；前端还要等**整段下完**才弹"另存为"。
    //   现在：**流式转发**（不缓冲整文件）+ 保留 Content-Disposition（配合前端改回"原生 <a> 下载"，
    //   浏览器会立刻弹保存框并边下边写盘）。Content-Length 用 OSS 给的长度，便于显示进度。
    if (isVideo) {
      const url = await signedUrl(key)
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`OSS读取失败: ${resp.status}`)
      const len = resp.headers.get('content-length')
      const headers: Record<string, string> = {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=86400',
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name),
      }
      if (len) headers['Content-Length'] = len
      // resp.body 是 web ReadableStream → 直接交给 NextResponse，边收边发，不进内存
      return new NextResponse(resp.body as any, { headers })
    }

    // 图片等小文件用 oss.get
    const result = await oss.get(key)
    const buffer = result.content as Buffer
    return new NextResponse(buffer, {
      headers: { 'Content-Type': mime, 'Content-Length': String(buffer.length), 'Cache-Control': 'private, max-age=86400', ...(isDownload ? { 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name) } : {}) },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '文件不存在' }, { status: 404 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
