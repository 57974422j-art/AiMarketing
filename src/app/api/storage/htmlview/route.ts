/**
 * ★VF_DAILY_V19（2026-10-13 用户拍板「A 执行」= 本地镜像 + 同级扁平图）：
 *   个人仓库里的 HTML **带图**直出 —— 把 HTML 里的相对图名（`gen_..._p1.jpg` 这种同级扁平名）
 *   在**服务端**换成本站签名短链（`/f/<uid>/<图名>?t=<过期>.<签名>`），再整页回给前端。
 *
 * 为什么必须"服务端改写"（三条实测约束，一条都不能绕）：
 *   ① 客户端预览 = 父页 fetch + `<iframe sandbox="allow-scripts" srcDoc>`（**没有 allow-same-origin**）
 *      ⇒ iframe 里相对 `images/1.jpg` 会解析到**服务器站点的相对路径**（根本没有那条路由）⇒ 空图；
 *   ② `/api/storage/file` 需要 **cookie** 登录态，而 sandbox 无同源的 iframe 发请求算跨站
 *      ⇒ SameSite=Lax 的会话 cookie 不一定带上 ⇒ 图会 401；
 *   ③ 单文件版把图内嵌成 `data:`（几 MB 的 `srcDoc`）既大又慢，客户端里还可能整片空白。
 *   换成 `/f/…?t=签名` 后：**同一站点、无需 cookie、签名即通行** ⇒ iframe 里稳定出图。
 *
 * 改写规则本身在 `src/lib/html-rewrite.ts`（纯函数、可单测）；本文件只管鉴权、取件、出件。
 * 本地那一路（A 的本体）不受影响：仓库里的 HTML 仍是**相对扁平名**，与图同目录时离线双击也能看。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromCookie } from '@/lib/api-auth'
import { getObject } from '@/lib/oss'
import { rewriteRelativeRefs, REF_NAME_OK } from '@/lib/html-rewrite'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = getAuthFromCookie(req)
  if (!auth?.userId) return new NextResponse('请先登录', { status: 401 })
  const uid = String(req.nextUrl.searchParams.get('userId') || '').replace(/\D/g, '')
  const name = String(req.nextUrl.searchParams.get('name') || '')
  // 与读/删接口同口径：只接受"仓库根目录下的文件名"（**禁 `/`**，防目录穿越）
  if (!uid || !name || !REF_NAME_OK.test(name)) return new NextResponse('参数无效', { status: 400 })

  let text = ''
  try {
    const buf = await getObject(`storage/${uid}/${name}`)
    text = buf.toString('utf8')
  } catch {
    return new NextResponse('文件暂时拿不到（存储未配置或对象不存在）', { status: 502 })
  }
  const r = rewriteRelativeRefs(text, uid)
  return new NextResponse(r.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      // 页面里的短链有时效 ⇒ 不长缓存（不要 public，避免中间层串号：见 api/storage/file 的 PRIVCACHE 记录）
      'Cache-Control': 'private, no-store',
      // 便于排障：这次改写了几处（不落盘、不敏感）
      'X-Html-View': `rewritten=${r.done}`,
    },
  })
}
