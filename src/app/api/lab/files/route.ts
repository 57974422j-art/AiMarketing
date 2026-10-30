/**
 * ★LAB_DAILY_V1 · 实验线自己的"列素材"接口
 *
 * 为什么不复用 `/api/storage/files`：
 *   那个接口只用 `getAuthFromHeaders`（只读 middleware 注入的 `X-User-Id`）。
 *   一旦 middleware 因为任何原因没注入，就报"未登录"，而 lab 页面没办法自证。
 *   ⇒ 这里**双鉴权兜底**（header 拿不到就读 cookie），并且只读仓库、不写任何东西。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders, getAuthFromCookie } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const auth = getAuthFromHeaders(request) || getAuthFromCookie(request)
  if (!auth?.userId) {
    return NextResponse.json({
      success: false,
      message: '请先登录（header 与 cookie 都没拿到用户）',
      diag: {
        hasXUserId: !!request.headers.get('x-user-id'),
        hasCookie: !!request.headers.get('cookie'),
      },
    }, { status: 401 })
  }

  const uid = String(auth.userId)
  try {
    const { listAllObjects, signedUrl } = await import('@/lib/oss')
    const all = await listAllObjects('storage/' + uid + '/', 3000)

    /* 只要图片，排除缩略图与生成物 */
    const imgs = all.filter((o) => {
      const n = String(o.name || '')
      if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(n)) return false
      if (n.indexOf('.thumbs') >= 0) return false
      const base = n.split('/').pop() || ''
      if (/^gen_/i.test(base)) return false
      return true
    })

    /* 按时间倒序，取最近 120 张（够用且快） */
    imgs.sort((a, b) => Number(new Date(b.lastModified)) - Number(new Date(a.lastModified)))
    const pick = imgs.slice(0, 120)

    const out: Array<{ name: string; url: string; size: number }> = []
    for (const o of pick) {
      const base = String(o.name).split('/').pop() || ''
      let url = ''
      try { url = await signedUrl(String(o.name), 3600) } catch { /* 单张失败就跳过 */ }
      if (!url) continue
      out.push({ name: base, url, size: Number(o.size || 0) })
    }

    return NextResponse.json({
      success: true,
      data: out,
      total: imgs.length,
      uid,
    })
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      message: '列素材失败：' + String(e?.message || e).slice(0, 160),
    }, { status: 500 })
  }
}
